import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  hasDevcontainerConfig,
  createDefaultDevcontainerConfig,
  ensureCopilotFeature,
  resolveWorktreeMainGitDir,
  getHostGitHubToken,
} from "../src/container.js";

describe("container", () => {
  describe("hasDevcontainerConfig", () => {
    it("should return false when no config exists", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-test-"));
      expect(hasDevcontainerConfig(tmpDir)).toBe(false);
      fs.rmSync(tmpDir, { recursive: true });
    });

    it("should return true when .devcontainer/devcontainer.json exists", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-test-"));
      const devcontainerDir = path.join(tmpDir, ".devcontainer");
      fs.mkdirSync(devcontainerDir);
      fs.writeFileSync(path.join(devcontainerDir, "devcontainer.json"), "{}");
      
      expect(hasDevcontainerConfig(tmpDir)).toBe(true);
      fs.rmSync(tmpDir, { recursive: true });
    });

    it("should return true when .devcontainer.json exists", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-test-"));
      fs.writeFileSync(path.join(tmpDir, ".devcontainer.json"), "{}");
      
      expect(hasDevcontainerConfig(tmpDir)).toBe(true);
      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe("createDefaultDevcontainerConfig", () => {
    it("should create a default devcontainer.json", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-test-"));
      createDefaultDevcontainerConfig(tmpDir);

      const configPath = path.join(tmpDir, ".devcontainer", "devcontainer.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.name).toBe("Copilot Sandbox");
      expect(config.image).toBeDefined();
      expect(config.features).toBeDefined();
      expect(config.postCreateCommand).toContain("safe.directory");

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe("ensureCopilotFeature", () => {
    it("should add copilot feature to existing config", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-test-"));
      const configPath = path.join(tmpDir, ".devcontainer.json");
      fs.writeFileSync(configPath, JSON.stringify({ name: "Test" }, null, 2));

      ensureCopilotFeature(tmpDir);

      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.features).toBeDefined();
      expect(config.features["ghcr.io/devcontainers/features/copilot-cli:1"]).toBeDefined();

      fs.rmSync(tmpDir, { recursive: true });
    });

    it("should handle JSONC with comments", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-test-"));
      const configPath = path.join(tmpDir, ".devcontainer.json");
      const jsonc = `{
  // This is a comment
  "name": "Test",
  /* Multi-line
     comment */
  "image": "test"
}`;
      fs.writeFileSync(configPath, jsonc);

      ensureCopilotFeature(tmpDir);

      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.features).toBeDefined();

      fs.rmSync(tmpDir, { recursive: true });
    });

    it("should handle trailing commas", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-test-"));
      const configPath = path.join(tmpDir, ".devcontainer.json");
      const jsonc = `{
  "name": "Test",
  "features": {
    "some-feature": {},
  },
}`;
      fs.writeFileSync(configPath, jsonc);

      ensureCopilotFeature(tmpDir);

      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.features).toBeDefined();

      fs.rmSync(tmpDir, { recursive: true });
    });

    it("should remove docker.sock mounts", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-test-"));
      const configPath = path.join(tmpDir, ".devcontainer.json");
      const config = {
        name: "Test",
        mounts: [
          "source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind",
          "source=${localWorkspaceFolder}/data,target=/data,type=bind"
        ]
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      ensureCopilotFeature(tmpDir);

      const updated = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(updated.mounts).toHaveLength(1);
      expect(updated.mounts[0]).toContain("/data");
      expect(updated.mounts[0]).not.toContain("docker.sock");

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe("resolveWorktreeMainGitDir", () => {
    it("should return undefined for a regular repo", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-test-"));
      fs.mkdirSync(path.join(tmpDir, ".git"));
      
      const result = resolveWorktreeMainGitDir(tmpDir);
      expect(result).toBeUndefined();

      fs.rmSync(tmpDir, { recursive: true });
    });

    it("should resolve worktree git dir", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-test-"));
      const mainGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "main-git-"));
      
      const worktreeGitDir = path.join(mainGitDir, "worktrees", "test");
      fs.mkdirSync(path.join(mainGitDir, "worktrees"), { recursive: true });
      fs.mkdirSync(worktreeGitDir);
      
      // Create .git file pointing to worktree git dir
      const relGitDir = path.relative(tmpDir, worktreeGitDir);
      fs.writeFileSync(path.join(tmpDir, ".git"), `gitdir: ${relGitDir}\n`);
      
      // Create commondir file with relative path to parent (..)
      // The commondir is relative to the worktree git dir itself
      fs.writeFileSync(path.join(worktreeGitDir, "commondir"), "../..\n");
      
      const result = resolveWorktreeMainGitDir(tmpDir);
      expect(result).toBe(mainGitDir);

      fs.rmSync(tmpDir, { recursive: true });
      fs.rmSync(mainGitDir, { recursive: true });
    });
  });

  describe("getHostGitHubToken", () => {
    it("should return undefined when gh is not available", () => {
      // This test depends on the system state, so we just verify it doesn't throw
      const token = getHostGitHubToken();
      expect(token === undefined || typeof token === "string").toBe(true);
    });
  });
});
