import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
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
  type WorktreeInfo,
  type RebaseResult,
} from "./worktree.js";
import {
  hasDevcontainerConfig,
  createDefaultDevcontainerConfig,
  ensureCopilotFeature,
  ensureMultiPhaseSkill,
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
  sessions: SessionEntry[];
}

/** Result from sandbox operations that can be used programmatically. */
export interface SandboxUpResult {
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

const SANDBOX_BRANCH_PREFIX = "sandbox/";
const SESSION_METADATA_FILE = ".copilot-sandbox.json";

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

// ── Session metadata ──

interface SessionEntry {
  sessionId: string;
  createdAt: string;
  task?: string;
}

interface SandboxMetadata {
  sessions: SessionEntry[];
}

function readSandboxMetadata(worktreePath: string): SandboxMetadata {
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

// ── Core functions (return structured results, no process.exit) ──

/**
 * Prepare remote env vars (GH_TOKEN forwarding).
 */
function prepareRemoteEnvs(): { remoteEnvs: Record<string, string>; hasToken: boolean } {
  const remoteEnvs: Record<string, string> = {};
  const ghToken = getHostGitHubToken();
  if (ghToken) {
    remoteEnvs["GH_TOKEN"] = ghToken;
  }
  return { remoteEnvs, hasToken: !!ghToken };
}

/**
 * Core "up" logic: create worktree, start container, optionally run a task.
 * Returns structured result or throws on failure.
 */
export async function sandboxUpCore(options: SandboxUpOptions): Promise<SandboxUpResult> {
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
    createDefaultDevcontainerConfig(worktreePath);
  }

  ensureCopilotFeature(worktreePath);
  ensureMultiPhaseSkill(worktreePath);

  const { remoteEnvs } = prepareRemoteEnvs();

  let upResult: ContainerUpResult;
  try {
    upResult = await containerUp(worktreePath, remoteEnvs, { verbose: options.verbose });
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
    branch: branchName,
    worktreePath,
    containerId: upResult.containerId,
    remoteUser: upResult.remoteUser,
    remoteWorkspaceFolder: upResult.remoteWorkspaceFolder,
  };

  if (options.task) {
    const sessionId = options.sessionId ?? crypto.randomUUID();
    result.sessionId = sessionId;
    result.exitCode = await containerExec(worktreePath, [
      "copilot",
      "-p",
      options.task,
      "--resume",
      sessionId,
      "--allow-all",
      "--no-ask-user",
    ], remoteEnvs, options.onOutput);
    addSessionEntry(worktreePath, {
      sessionId,
      createdAt: new Date().toISOString(),
      task: options.task,
    });
  }

  return result;
}

/**
 * Core "exec" logic: ensure container is running, run copilot with a task.
 * Returns exit code or throws on failure.
 */
export async function sandboxExecCore(options: {
  dir: string;
  branch: string;
  task: string;
  sessionId?: string;
  verbose?: boolean;
  onOutput?: (line: string) => void;
}): Promise<{ worktreePath: string; exitCode: number; sessionId: string }> {
  const gitRoot = getGitRoot(options.dir);
  const worktrees = await listWorktrees(gitRoot);

  const target = worktrees.find((wt) => wt.branch === options.branch);
  if (!target) {
    throw new Error(`No worktree found for branch "${options.branch}".`);
  }

  const { remoteEnvs } = prepareRemoteEnvs();

  const upResult = await containerUp(target.path, remoteEnvs, { verbose: options.verbose });
  if (upResult.outcome !== "success") {
    throw new Error(`Container failed to start: ${upResult.message ?? "unknown error"}`);
  }

  // Use provided sessionId to resume, or generate a new one
  const sessionId = options.sessionId ?? crypto.randomUUID();
  const copilotArgs = [
    "copilot",
    "-p",
    options.task,
    "--resume",
    sessionId,
    "--allow-all",
    "--no-ask-user",
  ];

  const exitCode = await containerExec(target.path, copilotArgs, remoteEnvs, options.onOutput);

  if (!options.sessionId) {
    addSessionEntry(target.path, {
      sessionId,
      createdAt: new Date().toISOString(),
      task: options.task,
    });
  }

  return { worktreePath: target.path, exitCode, sessionId };
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
      sessions: readSandboxMetadata(wt.path).sessions,
    }));

  return { sandboxes };
}

// ── CLI wrappers (logging + process.exit) ──

/**
 * Main "up" flow: create worktree, start container, run copilot.
 */
export async function sandboxUp(options: SandboxUpOptions): Promise<void> {
  const branchName = options.branch ?? generateBranchName();

  log(`Creating sandbox (branch: ${branchName}, base: ${options.base})`);

  const { hasToken } = prepareRemoteEnvs();
  if (hasToken) {
    log(`Forwarding GitHub auth token from host.`);
  } else {
    log(`Warning: Could not get GitHub token from host (gh auth token failed).`);
    log(`You may need to run /login inside copilot.`);
  }

  log(`Starting dev container...`);

  let result: SandboxUpResult;
  try {
    result = await sandboxUpCore({ ...options, branch: branchName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Error: ${msg}`);
    process.exit(1);
  }

  log(`Container started (id: ${result.containerId?.slice(0, 12)})`);
  log(`Remote user: ${result.remoteUser}`);
  log(`Workspace: ${result.remoteWorkspaceFolder}`);

  if (options.task) {
    log(`\ncopilot exited with code ${result.exitCode}`);
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
    log(`\nStarting interactive copilot session...`);
    log(`(Use Ctrl+C or exit to end the session)\n`);

    const { remoteEnvs } = prepareRemoteEnvs();
    const child = containerExecInteractive(result.worktreePath, ["copilot"], remoteEnvs);

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
  task?: string;
  sessionId?: string;
  interactive: boolean;
  verbose?: boolean;
}

/**
 * Reconnect to an existing sandbox: ensure container is running, then exec copilot.
 */
export async function sandboxExec(options: SandboxExecOptions): Promise<void> {
  const { hasToken } = prepareRemoteEnvs();
  if (hasToken) {
    log(`Forwarding GitHub auth token from host.`);
  } else {
    log(`Warning: Could not get GitHub token from host (gh auth token failed).`);
    log(`You may need to run /login inside copilot.`);
  }

  log(`Ensuring dev container is running...`);

  if (options.task) {
    let result: { worktreePath: string; exitCode: number; sessionId: string };
    try {
      result = await sandboxExecCore({
        dir: options.dir,
        branch: options.branch,
        task: options.task,
        sessionId: options.sessionId,
        verbose: options.verbose,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Error: ${msg}`);
      process.exit(1);
    }
    log(`\ncopilot exited with code ${result.exitCode}`);
    log(`Session ID: ${result.sessionId}`);
  } else {
    // Interactive — need to find worktree and ensure container manually
    const gitRoot = getGitRoot(options.dir);
    const worktrees = await listWorktrees(gitRoot);
    const target = worktrees.find((wt) => wt.branch === options.branch);
    if (!target) {
      log(`No worktree found for branch "${options.branch}".`);
      log(`Use 'copilot-sandbox list' to see active sandboxes.`);
      process.exit(1);
    }

    const { remoteEnvs } = prepareRemoteEnvs();
    let upResult: ContainerUpResult;
    try {
      upResult = await containerUp(target.path, remoteEnvs, { verbose: options.verbose });
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
    log(`\nResuming interactive copilot session...`);
    log(`(Use Ctrl+C or exit to end the session)\n`);

    const child = containerExecInteractive(target.path, ["copilot"], remoteEnvs);

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
    if (s.sessions.length > 0) {
      log(`  Sessions:`);
      for (const sess of s.sessions) {
        log(`    - ${sess.sessionId}${sess.task ? ` (${sess.task.slice(0, 60)}${sess.task.length > 60 ? "..." : ""})` : ""}`);
      }
    }
    log(``);
  }
}
