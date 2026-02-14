import * as path from "node:path";
import * as fs from "node:fs";
import {
  getGitRoot,
  getRepoName,
  createWorktree,
  removeWorktree,
  listWorktrees,
  deleteBranch,
  generateBranchName,
  type WorktreeInfo,
} from "./worktree.js";
import {
  hasDevcontainerConfig,
  ensureCopilotFeature,
  containerUp,
  containerExec,
  containerExecInteractive,
  containerDown,
  getHostGitHubToken,
  type ContainerUpResult,
} from "./container.js";

export interface SandboxUpOptions {
  dir: string;
  branch?: string;
  base: string;
  worktreeDir?: string;
  task?: string;
  interactive: boolean;
}

export interface SandboxDownOptions {
  dir: string;
  branch: string;
}

export interface SandboxInfo {
  branch: string;
  worktreePath: string;
  head: string;
}

const SANDBOX_BRANCH_PREFIX = "sandbox/";

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/**
 * Main "up" flow: create worktree, start container, run copilot.
 */
export async function sandboxUp(options: SandboxUpOptions): Promise<void> {
  const gitRoot = getGitRoot(options.dir);
  const repoName = getRepoName(options.dir);

  // Determine branch name
  const branchName = options.branch ?? generateBranchName();

  // Determine worktree directory
  const worktreeBase =
    options.worktreeDir ?? path.resolve(gitRoot, "..", `${repoName}-worktrees`);
  const worktreePath = path.join(worktreeBase, branchName.replace(/\//g, "-"));

  log(`Creating worktree at ${worktreePath} (branch: ${branchName}, base: ${options.base})`);
  fs.mkdirSync(worktreeBase, { recursive: true });
  await createWorktree(gitRoot, worktreePath, branchName, options.base);
  log(`Worktree created.`);

  // Verify devcontainer config exists
  if (!hasDevcontainerConfig(worktreePath)) {
    log(
      `Error: No .devcontainer/devcontainer.json found in ${worktreePath}.\n` +
        `The target project must have a devcontainer configuration.`,
    );
    // Clean up the worktree we just created
    await removeWorktree(gitRoot, worktreePath);
    await deleteBranch(gitRoot, branchName);
    process.exit(1);
  }

  // Inject copilot CLI feature and git safe.directory config
  ensureCopilotFeature(worktreePath);

  log(`Starting dev container...`);

  // Forward GitHub token from host into the container
  const remoteEnvs: Record<string, string> = {};
  const ghToken = getHostGitHubToken();
  if (ghToken) {
    remoteEnvs["GH_TOKEN"] = ghToken;
    log(`Forwarding GitHub auth token from host.`);
  } else {
    log(`Warning: Could not get GitHub token from host (gh auth token failed).`);
    log(`You may need to run /login inside copilot.`);
  }

  let upResult: ContainerUpResult;
  try {
    upResult = await containerUp(worktreePath, remoteEnvs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Error starting container: ${msg}`);
    log(`Cleaning up worktree...`);
    await removeWorktree(gitRoot, worktreePath);
    await deleteBranch(gitRoot, branchName);
    process.exit(1);
  }

  if (upResult.outcome !== "success") {
    log(`Container failed to start: ${upResult.message ?? "unknown error"}`);
    log(`Cleaning up worktree...`);
    await removeWorktree(gitRoot, worktreePath);
    await deleteBranch(gitRoot, branchName);
    process.exit(1);
  }

  log(`Container started (id: ${upResult.containerId?.slice(0, 12)})`);
  log(`Remote user: ${upResult.remoteUser}`);
  log(`Workspace: ${upResult.remoteWorkspaceFolder}`);

  if (options.task) {
    // Non-interactive: run copilot with a task
    log(`\nRunning copilot with task: "${options.task}"`);
    const exitCode = await containerExec(worktreePath, [
      "copilot",
      "-p",
      options.task,
    ], remoteEnvs);
    log(`\ncopilot exited with code ${exitCode}`);
    log(`\nWorktree with changes: ${worktreePath}`);
    log(`Branch: ${branchName}`);
    log(`To resume: copilot-sandbox exec --branch ${branchName}`);
    log(`To clean up: copilot-sandbox down --branch ${branchName}`);
  } else {
    // Interactive mode
    log(`\nStarting interactive copilot session...`);
    log(`(Use Ctrl+C or exit to end the session)\n`);

    const child = containerExecInteractive(worktreePath, ["copilot"], remoteEnvs);

    await new Promise<void>((resolve) => {
      child.on("close", () => resolve());
    });

    log(`\nSession ended.`);
    log(`Worktree with changes: ${worktreePath}`);
    log(`Branch: ${branchName}`);
    log(`To resume: copilot-sandbox exec --branch ${branchName}`);
    log(`To clean up: copilot-sandbox down --branch ${branchName}`);
  }
}

export interface SandboxExecOptions {
  dir: string;
  branch: string;
  task?: string;
  interactive: boolean;
}

/**
 * Reconnect to an existing sandbox: ensure container is running, then exec copilot.
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

  const worktreePath = target.path;

  // Forward GitHub token from host into the container
  const remoteEnvs: Record<string, string> = {};
  const ghToken = getHostGitHubToken();
  if (ghToken) {
    remoteEnvs["GH_TOKEN"] = ghToken;
    log(`Forwarding GitHub auth token from host.`);
  } else {
    log(`Warning: Could not get GitHub token from host (gh auth token failed).`);
    log(`You may need to run /login inside copilot.`);
  }

  // Ensure the container is running (devcontainer up is idempotent)
  log(`Ensuring dev container is running...`);
  let upResult: ContainerUpResult;
  try {
    upResult = await containerUp(worktreePath, remoteEnvs);
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

  if (options.task) {
    log(`\nRunning copilot with task: "${options.task}"`);
    const exitCode = await containerExec(worktreePath, [
      "copilot",
      "-p",
      options.task,
    ], remoteEnvs);
    log(`\ncopilot exited with code ${exitCode}`);
  } else {
    log(`\nResuming interactive copilot session...`);
    log(`(Use Ctrl+C or exit to end the session)\n`);

    const child = containerExecInteractive(worktreePath, ["copilot"], remoteEnvs);

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
  const gitRoot = getGitRoot(options.dir);
  const worktrees = await listWorktrees(gitRoot);

  // Find the worktree matching the branch
  const target = worktrees.find(
    (wt) => wt.branch === options.branch,
  );

  if (!target) {
    log(`No worktree found for branch "${options.branch}".`);
    log(`Use 'copilot-sandbox list' to see active sandboxes.`);
    process.exit(1);
  }

  log(`Stopping container for ${target.path}...`);
  try {
    await containerDown(target.path);
    log(`Container stopped.`);
  } catch {
    log(`No running container found (may already be stopped).`);
  }

  log(`Removing worktree at ${target.path}...`);
  await removeWorktree(gitRoot, target.path);
  log(`Worktree removed.`);

  log(`Deleting branch ${options.branch}...`);
  try {
    await deleteBranch(gitRoot, options.branch);
    log(`Branch deleted.`);
  } catch {
    log(`Could not delete branch (may have been merged or already deleted).`);
  }

  log(`Sandbox cleaned up.`);
}

/**
 * List all sandbox worktrees.
 */
export async function sandboxList(dir: string): Promise<void> {
  const gitRoot = getGitRoot(dir);
  const worktrees = await listWorktrees(gitRoot);

  const sandboxes = worktrees.filter(
    (wt) => !wt.isBare && wt.path !== gitRoot,
  );

  if (sandboxes.length === 0) {
    log(`No active sandboxes.`);
    return;
  }

  log(`Active sandboxes:\n`);
  for (const wt of sandboxes) {
    log(`  Branch: ${wt.branch}`);
    log(`  Path:   ${wt.path}`);
    log(`  HEAD:   ${wt.head?.slice(0, 8)}`);
    log(``);
  }
}
