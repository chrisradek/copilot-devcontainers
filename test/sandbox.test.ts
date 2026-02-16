import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  sandboxListCore,
  sandboxCleanupCore,
} from "../src/sandbox.js";
import {
  createWorktree,
  removeWorktree,
  deleteBranch,
} from "../src/worktree.js";

describe("sandbox", () => {
  let testRepoDir: string;

  beforeEach(() => {
    // Create a temporary git repository for testing
    testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-test-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: testRepoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: testRepoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: testRepoDir });
    
    // Create initial commit
    fs.writeFileSync(path.join(testRepoDir, "README.md"), "# Test\n");
    execFileSync("git", ["add", "README.md"], { cwd: testRepoDir });
    execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: testRepoDir });
  });

  afterEach(() => {
    // Clean up test repository
    if (testRepoDir && fs.existsSync(testRepoDir)) {
      fs.rmSync(testRepoDir, { recursive: true, force: true });
    }
  });

  describe("sandboxListCore", () => {
    it("should return empty list when no sandboxes exist", async () => {
      const result = await sandboxListCore(testRepoDir);
      expect(result.sandboxes).toHaveLength(0);
    });

    it("should list existing worktrees", async () => {
      const worktreePath = path.join(testRepoDir, "..", "test-sandbox");
      const branchName = "sandbox/test-branch";

      await createWorktree(testRepoDir, worktreePath, branchName, "main");

      const result = await sandboxListCore(testRepoDir);
      expect(result.sandboxes).toHaveLength(1);
      expect(result.sandboxes[0].branch).toBe(branchName);
      expect(result.sandboxes[0].worktreePath).toBe(worktreePath);
      expect(result.sandboxes[0].head).toBeDefined();
      expect(result.sandboxes[0].sessions).toEqual([]);

      await removeWorktree(testRepoDir, worktreePath);
      await deleteBranch(testRepoDir, branchName);
    });

    it("should filter out bare repositories", async () => {
      const result = await sandboxListCore(testRepoDir);
      // The main worktree itself should be filtered
      const mainInList = result.sandboxes.find(s => s.worktreePath === testRepoDir);
      expect(mainInList).toBeUndefined();
    });
  });

  describe("sandboxCleanupCore", () => {
    it("should find orphaned sandbox branches", async () => {
      // Create a worktree
      const worktreePath = path.join(testRepoDir, "..", "test-sandbox");
      const branchName = "sandbox/orphaned-branch";
      await createWorktree(testRepoDir, worktreePath, branchName, "main");
      
      // Remove the worktree but leave the branch
      await removeWorktree(testRepoDir, worktreePath);

      const result = await sandboxCleanupCore({ dir: testRepoDir, dryRun: true });
      expect(result.orphanedBranches).toContain(branchName);
      expect(result.deletedBranches).toHaveLength(0);

      // Clean up
      await deleteBranch(testRepoDir, branchName);
    });

    it("should delete orphaned branches when not in dry-run mode", async () => {
      const worktreePath = path.join(testRepoDir, "..", "test-sandbox");
      const branchName = "sandbox/to-delete";
      await createWorktree(testRepoDir, worktreePath, branchName, "main");
      await removeWorktree(testRepoDir, worktreePath);

      const result = await sandboxCleanupCore({ dir: testRepoDir, dryRun: false });
      expect(result.orphanedBranches).toContain(branchName);
      expect(result.deletedBranches).toContain(branchName);

      // Verify the branch was actually deleted
      const branches = execFileSync("git", ["branch", "--list", branchName], {
        cwd: testRepoDir,
        encoding: "utf-8",
      }).trim();
      expect(branches).toBe("");
    });

    it("should not delete current branch", async () => {
      // Switch to a sandbox branch
      execFileSync("git", ["checkout", "-b", "sandbox/current"], { cwd: testRepoDir });

      const result = await sandboxCleanupCore({ dir: testRepoDir, dryRun: false });
      expect(result.orphanedBranches).not.toContain("sandbox/current");

      // Switch back and clean up
      execFileSync("git", ["checkout", "main"], { cwd: testRepoDir });
      execFileSync("git", ["branch", "-D", "sandbox/current"], { cwd: testRepoDir });
    });

    it("should not delete branches with active worktrees", async () => {
      const worktreePath = path.join(testRepoDir, "..", "active-sandbox");
      const branchName = "sandbox/active";
      await createWorktree(testRepoDir, worktreePath, branchName, "main");

      const result = await sandboxCleanupCore({ dir: testRepoDir, dryRun: false });
      expect(result.orphanedBranches).not.toContain(branchName);

      await removeWorktree(testRepoDir, worktreePath);
      await deleteBranch(testRepoDir, branchName);
    });
  });
});
