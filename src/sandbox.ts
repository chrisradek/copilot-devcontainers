import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import {
  getAgentDefinition,
  getAgentExecutionEnvs,
  type AgentName,
} from "./agent.js";
import {
  getGitRoot,
  getRepoName,
  createWorktree,
  removeWorktree,
  listWorktrees,
  deleteBranch,
  generateBranchName,
  getCurrentBranch,
  rebaseWorktree,
  fastForwardMerge,
  getWorktreeDiff,
  listLocalBranches,
  type WorktreeInfo,
  type RebaseResult,
  type DiffResult,
} from "./worktree.js";
import {
  hasDevcontainerConfig,
  createDefaultDevcontainerConfig,
  ensureAgentSupport,
  ensureMultiPhaseSkill,
  addToWorktreeExclude,
  containerUp,
  containerExec,
  containerExecInteractive,
  containerDown,
  getHostGitHubToken,
  type ContainerUpResult,
  type ContainerUpOptions,
} from "./container.js";

export interface SandboxUpOptions {
  dir: string;
  agent?: AgentName;
  branch?: string;
  base: string;
  worktreeDir?: string;
  task?: string;
  sessionId?: string;
  interactive: boolean;
  verbose?: boolean;
  onOutput?: (line: string) => void;
}

export interface SandboxDownOptions {
  dir: string;
  branch: string;
  /** If true, only stop the container — don't remove the worktree or branch. */
  containerOnly?: boolean;
}

export interface SandboxInfo {
  branch: string;
  worktreePath: string;
  head: string;
  agent: AgentName;
  sessions: SessionEntry[];
}

/** Result from sandbox operations that can be used programmatically. */
export interface SandboxUpResult {
  agent: AgentName;
  branch: string;
  worktreePath: string;
  containerId?: string;
  remoteUser?: string;
  remoteWorkspaceFolder?: string;
  exitCode?: number;
  sessionId?: string;
}

export interface SandboxListResult {
  sandboxes: SandboxInfo[];
}

export interface SandboxDiffResult {
  branch: string;
  files: string[];
  stats: string;
  diff: string;
}

const SANDBOX_BRANCH_PREFIX = "sandbox/";
const SESSION_METADATA_FILE = ".copilot-sandbox.json";

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

// ── Session metadata ──

export interface SessionEntry {
  sessionId: string;
  agent?: AgentName;
  createdAt: string;
  task?: string;
}

export interface SandboxMetadata {
  agent?: AgentName;
  sessions: SessionEntry[];
}

export function readSandboxMetadata(worktreePath: string): SandboxMetadata {
  const metaPath = path.join(worktreePath, SESSION_METADATA_FILE);
  try {
    const raw = fs.readFileSync(metaPath, "utf-8");
    return JSON.parse(raw) as SandboxMetadata;
  } catch {
    return { sessions: [] };
  }
}

function writeSandboxMetadata(worktreePath: string, metadata: SandboxMetadata): void {
  const metaPath = path.join(worktreePath, SESSION_METADATA_FILE);
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2) + "\n", "utf-8");
}

function addSessionEntry(worktreePath: string, entry: SessionEntry): void {
  const metadata = readSandboxMetadata(worktreePath);
  metadata.sessions.push(entry);
  writeSandboxMetadata(worktreePath, metadata);
}

function getSandboxAgent(
  worktreePath: string,
  requestedAgent?: AgentName,
  sessionId?: string,
): AgentName {
  if (requestedAgent) return requestedAgent;

  const metadata = readSandboxMetadata(worktreePath);
  if (sessionId) {
    const session = metadata.sessions.find((entry) => entry.sessionId === sessionId);
    if (session?.agent) return session.agent;
  }
  return metadata.agent ?? "copilot";
}

// ── Core functions (return structured results, no process.exit) ──

/**
 * Prepare credentials for the selected agent.
 */
function prepareRemoteEnvs(
  agent: AgentName,
  includeAgentCredentials = true,
): { remoteEnvs: Record<string, string>; hasToken: boolean } {
  const remoteEnvs: Record<string, string> = {};
  if (agent === "copilot") {
    const ghToken = getHostGitHubToken();
    if (ghToken) {
      remoteEnvs.GH_TOKEN = ghToken;
    }
    return { remoteEnvs, hasToken: !!ghToken };
  }

  if (includeAgentCredentials) {
    Object.assign(remoteEnvs, getAgentExecutionEnvs(agent));
  }
  return {
    remoteEnvs,
    hasToken: !!(remoteEnvs.CODEX_API_KEY || remoteEnvs.CODEX_ACCESS_TOKEN),
  };
}

/**
 * Core "up" logic: create worktree, start container, optionally run a task.
 * Returns structured result or throws on failure.
 */
export async function sandboxUpCore(options: SandboxUpOptions): Promise<SandboxUpResult> {
  const agent = options.agent ?? "copilot";
  const gitRoot = getGitRoot(options.dir);
  const repoName = getRepoName(options.dir);

  const branchName = options.branch ?? generateBranchName();
  const worktreeBase =
    options.worktreeDir ?? path.resolve(gitRoot, "..", `${repoName}-worktrees`);
  const worktreePath = path.join(worktreeBase, branchName.replace(/\//g, "-"));

  fs.mkdirSync(worktreeBase, { recursive: true });
  await createWorktree(gitRoot, worktreePath, branchName, options.base);

  if (!hasDevcontainerConfig(worktreePath)) {
    log("No devcontainer config found — using default configuration.");
    createDefaultDevcontainerConfig(worktreePath, agent);
  }

  ensureAgentSupport(worktreePath, agent);
  ensureMultiPhaseSkill(worktreePath);
  addToWorktreeExclude(worktreePath, SESSION_METADATA_FILE);
  writeSandboxMetadata(worktreePath, { agent, sessions: [] });

  const { remoteEnvs: containerEnvs } = prepareRemoteEnvs(agent, false);

  let upResult: ContainerUpResult;
  try {
    upResult = await containerUp(worktreePath, containerEnvs, { verbose: options.verbose });
  } catch (err) {
    await removeWorktree(gitRoot, worktreePath);
    await deleteBranch(gitRoot, branchName);
    throw err;
  }

  if (upResult.outcome !== "success") {
    await removeWorktree(gitRoot, worktreePath);
    await deleteBranch(gitRoot, branchName);
    throw new Error(`Container failed to start: ${upResult.message ?? "unknown error"}`);
  }

  const result: SandboxUpResult = {
    agent,
    branch: branchName,
    worktreePath,
    containerId: upResult.containerId,
    remoteUser: upResult.remoteUser,
    remoteWorkspaceFolder: upResult.remoteWorkspaceFolder,
  };

  if (options.task) {
    const definition = getAgentDefinition(agent);
    let sessionId = options.sessionId ??
      (agent === "copilot" ? crypto.randomUUID() : undefined);
    const { remoteEnvs } = prepareRemoteEnvs(agent);
    result.exitCode = await containerExec(
      worktreePath,
      definition.buildTaskCommand(options.task, sessionId),
      remoteEnvs,
      (line) => {
        sessionId ??= definition.parseSessionId(line);
        options.onOutput?.(line);
      },
    );
    result.sessionId = sessionId;
    if (sessionId) {
      addSessionEntry(worktreePath, {
        sessionId,
        agent,
        createdAt: new Date().toISOString(),
        task: options.task,
      });
    }
  }

  return result;
}

/**
 * Core "exec" logic: ensure container is running, then run an agent task.
 * Returns exit code or throws on failure.
 */
export async function sandboxExecCore(options: {
  dir: string;
  branch: string;
  agent?: AgentName;
  task: string;
  sessionId?: string;
  verbose?: boolean;
  onOutput?: (line: string) => void;
}): Promise<{
  agent: AgentName;
  worktreePath: string;
  exitCode: number;
  sessionId?: string;
}> {
  const gitRoot = getGitRoot(options.dir);
  const worktrees = await listWorktrees(gitRoot);

  const target = worktrees.find((wt) => wt.branch === options.branch);
  if (!target) {
    throw new Error(`No worktree found for branch "${options.branch}".`);
  }

  const agent = getSandboxAgent(target.path, options.agent, options.sessionId);
  ensureAgentSupport(target.path, agent);
  const { remoteEnvs: containerEnvs } = prepareRemoteEnvs(agent, false);

  const upResult = await containerUp(target.path, containerEnvs, { verbose: options.verbose });
  if (upResult.outcome !== "success") {
    throw new Error(`Container failed to start: ${upResult.message ?? "unknown error"}`);
  }

  const definition = getAgentDefinition(agent);
  let sessionId = options.sessionId ??
    (agent === "copilot" ? crypto.randomUUID() : undefined);
  const { remoteEnvs } = prepareRemoteEnvs(agent);
  const exitCode = await containerExec(
    target.path,
    definition.buildTaskCommand(options.task, sessionId),
    remoteEnvs,
    (line) => {
      sessionId ??= definition.parseSessionId(line);
      options.onOutput?.(line);
    },
  );

  if (!options.sessionId && sessionId) {
    addSessionEntry(target.path, {
      sessionId,
      agent,
      createdAt: new Date().toISOString(),
      task: options.task,
    });
  }

  return { agent, worktreePath: target.path, exitCode, sessionId };
}

/**
 * Core "down" logic: stop container, optionally remove worktree and branch.
 */
export async function sandboxDownCore(options: SandboxDownOptions): Promise<void> {
  const gitRoot = getGitRoot(options.dir);
  const worktrees = await listWorktrees(gitRoot);

  const target = worktrees.find((wt) => wt.branch === options.branch);
  if (!target) {
    throw new Error(`No worktree found for branch "${options.branch}".`);
  }

  try {
    await containerDown(target.path);
  } catch {
    // Container may already be stopped
  }

  if (!options.containerOnly) {
    await removeWorktree(gitRoot, target.path);

    try {
      await deleteBranch(gitRoot, options.branch);
    } catch {
      // Branch may have been merged or already deleted
    }
  }
}

export interface SandboxMergeOptions {
  dir: string;
  branch: string;
}

export interface SandboxMergeResult {
  success: boolean;
  /** Set when rebase succeeds and merge completes. */
  merged?: boolean;
  /** Conflicting files when rebase fails. */
  conflictFiles?: string[];
}

/**
 * Core "merge" logic: rebase sandbox branch onto source, fast-forward merge,
 * then clean up (container + worktree + branch).
 *
 * If rebase conflicts occur, the rebase is left in-progress so an agent
 * inside the container can resolve conflicts and run `git rebase --continue`.
 */
export async function sandboxMergeCore(options: SandboxMergeOptions): Promise<SandboxMergeResult> {
  const gitRoot = getGitRoot(options.dir);
  const worktrees = await listWorktrees(gitRoot);

  const target = worktrees.find((wt) => wt.branch === options.branch);
  if (!target) {
    throw new Error(`No worktree found for branch "${options.branch}".`);
  }

  const sourceBranch = getCurrentBranch(gitRoot);

  // Rebase the sandbox (Feature) branch onto the source branch
  const rebaseResult = await rebaseWorktree(target.path, sourceBranch);

  if (!rebaseResult.success) {
    return {
      success: false,
      conflictFiles: rebaseResult.conflictFiles,
    };
  }

  // Fast-forward merge the source branch to the rebased sandbox branch
  await fastForwardMerge(gitRoot, options.branch);

  // Clean up: stop container, remove worktree, delete branch
  try {
    await containerDown(target.path);
  } catch {
    // Container may already be stopped
  }

  await removeWorktree(gitRoot, target.path);

  try {
    await deleteBranch(gitRoot, options.branch);
  } catch {
    // Branch may have been merged or already deleted
  }

  return { success: true, merged: true };
}

/**
 * Core "list" logic: return all sandbox worktrees.
 */
export async function sandboxListCore(dir: string): Promise<SandboxListResult> {
  const gitRoot = getGitRoot(dir);
  const worktrees = await listWorktrees(gitRoot);

  const sandboxes = worktrees
    .filter((wt) => !wt.isBare && wt.path !== gitRoot)
    .map((wt) => ({
      branch: wt.branch,
      worktreePath: wt.path,
      head: wt.head,
      agent: readSandboxMetadata(wt.path).agent ?? "copilot",
      sessions: readSandboxMetadata(wt.path).sessions,
    }));

  return { sandboxes };
}

/**
 * Core "diff" logic: show changes in a sandbox worktree.
 */
export async function sandboxDiffCore(options: {
  dir: string;
  branch: string;
  base?: string;
}): Promise<SandboxDiffResult> {
  const gitRoot = getGitRoot(options.dir);
  const worktrees = await listWorktrees(gitRoot);

  const target = worktrees.find((wt) => wt.branch === options.branch);
  if (!target) {
    throw new Error(`No worktree found for branch "${options.branch}".`);
  }

  // If no base provided, use the main repo's current branch
  const base = options.base ?? getCurrentBranch(gitRoot);
  const diffResult = await getWorktreeDiff(target.path, base);

  return {
    branch: options.branch,
    ...diffResult,
  };
}

export interface SandboxCleanupResult {
  orphanedBranches: string[];
  deletedBranches: string[];
}

/**
 * Core "cleanup" logic: find and optionally delete orphaned sandbox branches.
 */
export async function sandboxCleanupCore(options: {
  dir: string;
  dryRun?: boolean;
}): Promise<SandboxCleanupResult> {
  const gitRoot = getGitRoot(options.dir);
  const worktrees = await listWorktrees(gitRoot);
  const currentBranch = getCurrentBranch(gitRoot);

  const worktreeBranches = new Set(worktrees.map((wt) => wt.branch));
  const allBranches = await listLocalBranches(gitRoot);

  const orphanedBranches = allBranches.filter(
    (b) => b.startsWith("sandbox/") && !worktreeBranches.has(b) && b !== currentBranch,
  );

  const deletedBranches: string[] = [];
  if (!options.dryRun) {
    for (const branch of orphanedBranches) {
      try {
        await deleteBranch(gitRoot, branch);
        deletedBranches.push(branch);
      } catch {
        // Skip branches that can't be deleted
      }
    }
  }

  return { orphanedBranches, deletedBranches };
}

// ── CLI wrappers (logging + process.exit) ──

/**
 * Main "up" flow: create worktree, start container, and run the selected agent.
 */
export async function sandboxUp(options: SandboxUpOptions): Promise<void> {
  const agent = options.agent ?? "copilot";
  const definition = getAgentDefinition(agent);
  const branchName = options.branch ?? generateBranchName();

  log(`Creating ${definition.displayName} sandbox (branch: ${branchName}, base: ${options.base})`);

  const { hasToken } = prepareRemoteEnvs(agent);
  if (hasToken) {
    log(`Forwarding ${definition.displayName} credentials from host.`);
  } else if (agent === "copilot") {
    log(`Warning: Could not get GitHub token from host (gh auth token failed).`);
    log(`You may need to run /login inside Copilot.`);
  } else {
    log(`No Codex API key or access token found on the host.`);
    log(`You may need to run codex login --device-auth inside the container.`);
  }

  log(`Starting dev container...`);

  let result: SandboxUpResult;
  try {
    result = await sandboxUpCore({ ...options, agent, branch: branchName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Error: ${msg}`);
    process.exit(1);
  }

  log(`Container started (id: ${result.containerId?.slice(0, 12)})`);
  log(`Remote user: ${result.remoteUser}`);
  log(`Workspace: ${result.remoteWorkspaceFolder}`);

  if (options.task) {
    log(`\n${definition.displayName} exited with code ${result.exitCode}`);
    if (result.sessionId) {
      log(`Session ID: ${result.sessionId}`);
    }
    log(`\nWorktree with changes: ${result.worktreePath}`);
    log(`Branch: ${result.branch}`);
    log(`To resume: copilot-sandbox exec --branch ${result.branch}`);
    log(`To clean up: copilot-sandbox down --branch ${result.branch}`);
  } else {
    // Interactive mode — sandboxUpCore doesn't handle interactive,
    // so we do it here after the container is ready.
    log(`\nStarting interactive ${definition.displayName} session...`);
    log(`(Use Ctrl+C or exit to end the session)\n`);

    const { remoteEnvs } = prepareRemoteEnvs(agent);
    const child = containerExecInteractive(
      result.worktreePath,
      definition.buildInteractiveCommand(options.sessionId),
      remoteEnvs,
    );

    await new Promise<void>((resolve) => {
      child.on("close", () => resolve());
    });

    log(`\nSession ended.`);
    log(`Worktree with changes: ${result.worktreePath}`);
    log(`Branch: ${result.branch}`);
    log(`To resume: copilot-sandbox exec --branch ${result.branch}`);
    log(`To clean up: copilot-sandbox down --branch ${result.branch}`);
  }
}

export interface SandboxExecOptions {
  dir: string;
  branch: string;
  agent?: AgentName;
  task?: string;
  sessionId?: string;
  interactive: boolean;
  verbose?: boolean;
}

/**
 * Reconnect to an existing sandbox and run the selected agent.
 */
export async function sandboxExec(options: SandboxExecOptions): Promise<void> {
  const gitRoot = getGitRoot(options.dir);
  const worktrees = await listWorktrees(gitRoot);
  const target = worktrees.find((wt) => wt.branch === options.branch);
  if (!target) {
    log(`No worktree found for branch "${options.branch}".`);
    log(`Use 'copilot-sandbox list' to see active sandboxes.`);
    process.exit(1);
  }

  const agent = getSandboxAgent(target.path, options.agent, options.sessionId);
  const definition = getAgentDefinition(agent);
  const { hasToken } = prepareRemoteEnvs(agent);
  if (hasToken) {
    log(`Forwarding ${definition.displayName} credentials from host.`);
  } else if (agent === "copilot") {
    log(`Warning: Could not get GitHub token from host (gh auth token failed).`);
    log(`You may need to run /login inside Copilot.`);
  } else {
    log(`No Codex API key or access token found on the host.`);
    log(`You may need to run codex login --device-auth inside the container.`);
  }

  log(`Ensuring dev container is running...`);

  if (options.task) {
    let result: {
      agent: AgentName;
      worktreePath: string;
      exitCode: number;
      sessionId?: string;
    };
    try {
      result = await sandboxExecCore({
        dir: options.dir,
        branch: options.branch,
        agent,
        task: options.task,
        sessionId: options.sessionId,
        verbose: options.verbose,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Error: ${msg}`);
      process.exit(1);
    }
    log(`\n${definition.displayName} exited with code ${result.exitCode}`);
    if (result.sessionId) {
      log(`Session ID: ${result.sessionId}`);
    }
  } else {
    ensureAgentSupport(target.path, agent);
    const { remoteEnvs: containerEnvs } = prepareRemoteEnvs(agent, false);
    let upResult: ContainerUpResult;
    try {
      upResult = await containerUp(target.path, containerEnvs, { verbose: options.verbose });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Error starting container: ${msg}`);
      process.exit(1);
    }

    if (upResult.outcome !== "success") {
      log(`Container failed to start: ${upResult.message ?? "unknown error"}`);
      process.exit(1);
    }

    log(`Container ready (id: ${upResult.containerId?.slice(0, 12)})`);
    log(`\nStarting interactive ${definition.displayName} session...`);
    log(`(Use Ctrl+C or exit to end the session)\n`);

    const { remoteEnvs } = prepareRemoteEnvs(agent);
    const child = containerExecInteractive(
      target.path,
      definition.buildInteractiveCommand(options.sessionId),
      remoteEnvs,
    );

    await new Promise<void>((resolve) => {
      child.on("close", () => resolve());
    });

    log(`\nSession ended.`);
  }

  log(`To resume again: copilot-sandbox exec --branch ${options.branch}`);
  log(`To clean up: copilot-sandbox down --branch ${options.branch}`);
}

/**
 * Tear down a sandbox: stop container, remove worktree and branch.
 */
export async function sandboxDown(options: SandboxDownOptions): Promise<void> {
  log(`Tearing down sandbox for branch "${options.branch}"...`);

  try {
    await sandboxDownCore(options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Error: ${msg}`);
    process.exit(1);
  }

  log(`Sandbox cleaned up.`);
}

/**
 * List all sandbox worktrees.
 */
export async function sandboxList(dir: string): Promise<void> {
  const { sandboxes } = await sandboxListCore(dir);

  if (sandboxes.length === 0) {
    log(`No active sandboxes.`);
    return;
  }

  log(`Active sandboxes:\n`);
  for (const s of sandboxes) {
    log(`  Branch: ${s.branch}`);
    log(`  Path:   ${s.worktreePath}`);
    log(`  HEAD:   ${s.head?.slice(0, 8)}`);
    log(`  Agent:  ${s.agent}`);
    if (s.sessions.length > 0) {
      log(`  Sessions:`);
      for (const sess of s.sessions) {
        log(`    - ${sess.sessionId} [${sess.agent ?? s.agent}]${sess.task ? ` (${sess.task.slice(0, 60)}${sess.task.length > 60 ? "..." : ""})` : ""}`);
      }
    }
    log(``);
  }
}
