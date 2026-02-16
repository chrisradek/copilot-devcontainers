import { execFile, execFileSync, type ExecFileOptions } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isBare: boolean;
}

export interface DiffResult {
  files: string[];
  stats: string;
  diff: string;
}

/**
 * Find the git root directory for a given path.
 */
export function getGitRoot(dir: string): string {
  return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  }).trim();
}

/**
 * Get the repository name from the git root.
 */
export function getRepoName(dir: string): string {
  const root = getGitRoot(dir);
  return path.basename(root);
}

/**
 * Create a git worktree with a new branch.
 */
export async function createWorktree(
  repoDir: string,
  worktreePath: string,
  branchName: string,
  baseRef: string,
): Promise<void> {
  await execGit(repoDir, [
    "worktree",
    "add",
    "-b",
    branchName,
    worktreePath,
    baseRef,
  ]);

  // Rewrite the worktree's .git file to use a relative gitdir path.
  // Git creates it with an absolute path by default, but inside a dev container
  // the absolute host path won't resolve. A relative path works in both contexts
  // as long as the main .git dir is mounted at the matching relative position.
  // We avoid --relative-paths because it sets the `extensions.relativeWorktrees`
  // git config, which is unsupported by Microsoft.Build.Tasks.Git (Source Link)
  // and breaks `dotnet build`.
  const absWorktreePath = path.resolve(worktreePath);
  const dotGitFile = path.join(absWorktreePath, ".git");
  // Read the gitdir path that git wrote (handles name collisions from duplicate basenames)
  const gitdirContent = fs.readFileSync(dotGitFile, "utf-8").trim();
  const gitdirMatch = gitdirContent.match(/^gitdir:\s*(.+)$/);
  if (gitdirMatch) {
    const absWorktreeGitDir = path.resolve(absWorktreePath, gitdirMatch[1]);
    const relGitDir = path.relative(absWorktreePath, absWorktreeGitDir);
    fs.writeFileSync(dotGitFile, `gitdir: ${relGitDir}\n`, "utf-8");
  }
}

/**
 * Remove a git worktree.
 */
export async function removeWorktree(
  repoDir: string,
  worktreePath: string,
): Promise<void> {
  await execGit(repoDir, ["worktree", "remove", "--force", worktreePath]);
}

/**
 * List all git worktrees for a repository.
 */
export async function listWorktrees(repoDir: string): Promise<WorktreeInfo[]> {
  const output = await execGit(repoDir, [
    "worktree",
    "list",
    "--porcelain",
  ]);

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        worktrees.push(current as WorktreeInfo);
      }
      current = { path: line.slice("worktree ".length), isBare: false };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      // e.g. "branch refs/heads/my-branch"
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    } else if (line === "bare") {
      current.isBare = true;
    } else if (line === "detached") {
      current.branch = "(detached)";
    }
  }

  if (current.path) {
    worktrees.push(current as WorktreeInfo);
  }

  return worktrees;
}

/**
 * Delete a local branch.
 */
export async function deleteBranch(
  repoDir: string,
  branchName: string,
): Promise<void> {
  await execGit(repoDir, ["branch", "-D", branchName]);
}

/**
 * Get the current branch name for a repository.
 */
export function getCurrentBranch(repoDir: string): string {
  return execFileSync("git", ["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf-8",
  }).trim();
}

export interface RebaseResult {
  success: boolean;
  conflictFiles?: string[];
}

/**
 * Rebase the worktree's branch onto the given branch.
 * If conflicts occur, leaves the rebase in-progress and returns the conflicting files.
 */
export async function rebaseWorktree(
  worktreePath: string,
  ontoBranch: string,
): Promise<RebaseResult> {
  try {
    await execGit(worktreePath, ["rebase", ontoBranch]);
    return { success: true };
  } catch {
    // Check if rebase is in progress (conflicts)
    try {
      const output = await execGit(worktreePath, ["diff", "--name-only", "--diff-filter=U"]);
      const files = output.trim().split("\n").filter(Boolean);
      if (files.length > 0) {
        return { success: false, conflictFiles: files };
      }
    } catch {
      // Ignore — fall through to generic error
    }
    // Rebase failed for a non-conflict reason; abort and rethrow
    try {
      await execGit(worktreePath, ["rebase", "--abort"]);
    } catch {
      // Ignore abort failures
    }
    throw new Error(`Rebase of worktree onto "${ontoBranch}" failed.`);
  }
}

/**
 * Fast-forward merge a branch into the current branch of the given repo.
 */
export async function fastForwardMerge(
  repoDir: string,
  branchName: string,
): Promise<void> {
  await execGit(repoDir, ["merge", "--ff-only", branchName]);
}

/**
 * Generate a sandbox branch name.
 */
export function generateBranchName(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  return `sandbox/${timestamp}`;
}

/**
 * Get the diff of changes in a worktree.
 * If no base is provided, uses merge-base with the current branch of the main repo.
 */
export async function getWorktreeDiff(
  worktreePath: string,
  base?: string,
): Promise<DiffResult> {
  let baseRef = base;

  // If no base provided, auto-detect using merge-base
  if (!baseRef) {
    // Get the git root to find the parent branch
    const gitRoot = getGitRoot(worktreePath);
    const parentBranch = getCurrentBranch(gitRoot);

    // Find merge-base between HEAD and parent branch
    const mergeBase = await execGit(worktreePath, [
      "merge-base",
      "HEAD",
      parentBranch,
    ]);
    baseRef = mergeBase.trim();
  }

  // Get diff --stat for summary
  const stats = await execGit(worktreePath, [
    "diff",
    "--stat",
    `${baseRef}..HEAD`,
  ]);

  // Get full diff
  const diff = await execGit(worktreePath, [
    "diff",
    `${baseRef}..HEAD`,
  ]);

  // Get list of changed files
  const filesOutput = await execGit(worktreePath, [
    "diff",
    "--name-only",
    `${baseRef}..HEAD`,
  ]);
  const files = filesOutput.trim().split("\n").filter(Boolean);

  return {
    files,
    stats: stats.trim(),
    diff: diff.trim(),
  };
}

/**
 * List all local branch names.
 */
export async function listLocalBranches(repoDir: string): Promise<string[]> {
  const output = await execGit(repoDir, [
    "branch",
    "--list",
    "--format=%(refname:short)",
  ]);
  return output.trim().split("\n").filter(Boolean);
}

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { encoding: "utf-8" }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`git ${args.join(" ")} failed: ${stderr || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}
