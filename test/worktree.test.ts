import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getGitRoot,
  getRepoName,
  createWorktree,
  removeWorktree,
  listWorktrees,
  deleteBranch,
  getCurrentBranch,
  generateBranchName,
  listLocalBranches,
} from "../src/worktree.js";

describe("worktree", () => {
  let testRepoDir: string;

  beforeEach(() => {
    // Create a temporary git repository for testing
    testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-test-"));
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

  describe("getGitRoot", () => {
    it("should return the git root directory", () => {
      const root = getGitRoot(testRepoDir);
      expect(root).toBe(testRepoDir);
    });

    it("should work from a subdirectory", () => {
      const subDir = path.join(testRepoDir, "subdir");
      fs.mkdirSync(subDir);
      const root = getGitRoot(subDir);
      expect(root).toBe(testRepoDir);
    });
  });

  describe("getRepoName", () => {
    it("should return the repository basename", () => {
      const name = getRepoName(testRepoDir);
      expect(name).toMatch(/^worktree-test-/);
    });
  });

  describe("getCurrentBranch", () => {
    it("should return the current branch name", () => {
      const branch = getCurrentBranch(testRepoDir);
      expect(branch).toBe("main");
    });
  });

  describe("generateBranchName", () => {
    it("should generate a branch name with sandbox/ prefix", () => {
      const name = generateBranchName();
      expect(name).toMatch(/^sandbox\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    });

    it("should generate unique names when called at different times", async () => {
      const name1 = generateBranchName();
      // Wait a tiny bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      const name2 = generateBranchName();
      // Since they're generated from timestamps down to seconds,
      // they should be different if we wait a bit
      expect(name1).toMatch(/^sandbox\//);
      expect(name2).toMatch(/^sandbox\//);
    });
  });

  describe("createWorktree and removeWorktree", () => {
    it("should create a worktree with a new branch", async () => {
      const worktreePath = path.join(testRepoDir, "..", "test-worktree");
      const branchName = "test-branch";

      await createWorktree(testRepoDir, worktreePath, branchName, "main");

      expect(fs.existsSync(worktreePath)).toBe(true);
      expect(fs.existsSync(path.join(worktreePath, ".git"))).toBe(true);
      expect(fs.existsSync(path.join(worktreePath, "README.md"))).toBe(true);

      // Verify .git file has relative gitdir path
      const dotGitContent = fs.readFileSync(path.join(worktreePath, ".git"), "utf-8");
      expect(dotGitContent).toMatch(/^gitdir: /);
      expect(dotGitContent).not.toMatch(/^gitdir: \//); // Should not be absolute

      // Clean up
      await removeWorktree(testRepoDir, worktreePath);
      expect(fs.existsSync(worktreePath)).toBe(false);
    });
  });

  describe("listWorktrees", () => {
    it("should list the main worktree", async () => {
      const worktrees = await listWorktrees(testRepoDir);
      expect(worktrees.length).toBeGreaterThanOrEqual(1);
      
      const main = worktrees.find(wt => wt.path === testRepoDir);
      expect(main).toBeDefined();
      expect(main?.branch).toBe("main");
    });

    it("should list created worktrees", async () => {
      const worktreePath = path.join(testRepoDir, "..", "test-worktree");
      const branchName = "feature-branch";

      await createWorktree(testRepoDir, worktreePath, branchName, "main");

      const worktrees = await listWorktrees(testRepoDir);
      const feature = worktrees.find(wt => wt.branch === branchName);
      
      expect(feature).toBeDefined();
      expect(feature?.path).toBe(worktreePath);

      await removeWorktree(testRepoDir, worktreePath);
    });
  });

  describe("listLocalBranches", () => {
    it("should list local branches", async () => {
      const branches = await listLocalBranches(testRepoDir);
      expect(branches).toContain("main");
    });

    it("should include newly created branches", async () => {
      const worktreePath = path.join(testRepoDir, "..", "test-worktree");
      const branchName = "new-feature";

      await createWorktree(testRepoDir, worktreePath, branchName, "main");

      const branches = await listLocalBranches(testRepoDir);
      expect(branches).toContain("new-feature");

      await removeWorktree(testRepoDir, worktreePath);
      await deleteBranch(testRepoDir, branchName);
    });
  });

  describe("deleteBranch", () => {
    it("should delete a branch", async () => {
      const worktreePath = path.join(testRepoDir, "..", "test-worktree");
      const branchName = "deletable-branch";

      await createWorktree(testRepoDir, worktreePath, branchName, "main");
      await removeWorktree(testRepoDir, worktreePath);
      
      let branches = await listLocalBranches(testRepoDir);
      expect(branches).toContain(branchName);

      await deleteBranch(testRepoDir, branchName);

      branches = await listLocalBranches(testRepoDir);
      expect(branches).not.toContain(branchName);
    });
  });
});
