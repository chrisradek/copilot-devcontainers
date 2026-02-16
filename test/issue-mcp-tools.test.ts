import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createIssueMcpServer } from "../src/issue-mcp.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

function getTextContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]?.text ?? "";
}

describe("Issue MCP Tools Integration", () => {
  let client: Client;
  let server: ReturnType<typeof createIssueMcpServer>;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-mcp-tools-test-"));
    execFileSync("git", ["init", "-b", "main", tempDir]);
    execFileSync("git", ["-C", tempDir, "config", "user.email", "test@test.com"]);
    execFileSync("git", ["-C", tempDir, "config", "user.name", "Test"]);
    fs.writeFileSync(path.join(tempDir, "README.md"), "test\n");
    execFileSync("git", ["-C", tempDir, "add", "."]);
    execFileSync("git", ["-C", tempDir, "commit", "-m", "init"]);

    server = createIssueMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("issue tools", () => {
    it("should create an issue", async () => {
      const result = await client.callTool({
        name: "issue_create",
        arguments: {
          dir: tempDir,
          title: "Test issue",
          description: "A test issue",
          id: "issue-1",
        },
      });
      const text = getTextContent(result);
      expect(text).toContain("Issue created successfully");
      expect(text).toContain("ID: issue-1");
      expect(text).toContain("Priority: medium");
    });

    it("should create an issue with priority and labels", async () => {
      const result = await client.callTool({
        name: "issue_create",
        arguments: {
          dir: tempDir,
          title: "High priority issue",
          description: "Urgent",
          id: "issue-2",
          priority: "high",
          labels: ["bug", "critical"],
        },
      });
      const text = getTextContent(result);
      expect(text).toContain("Priority: high");
      expect(text).toContain("Labels: bug, critical");
    });

    it("should list issues sorted by priority", async () => {
      const result = await client.callTool({
        name: "issue_list",
        arguments: { dir: tempDir },
      });
      const text = getTextContent(result);
      expect(text).toContain("Issues (2)");
      // High priority should come first
      const highIdx = text.indexOf("High priority issue");
      const medIdx = text.indexOf("Test issue");
      expect(highIdx).toBeLessThan(medIdx);
    });

    it("should filter issues by priority", async () => {
      const result = await client.callTool({
        name: "issue_list",
        arguments: { dir: tempDir, priority: "high" },
      });
      const text = getTextContent(result);
      expect(text).toContain("High priority issue");
      expect(text).not.toContain("Test issue");
    });

    it("should get issue details", async () => {
      const result = await client.callTool({
        name: "issue_get",
        arguments: { dir: tempDir, id: "issue-1" },
      });
      const text = getTextContent(result);
      expect(text).toContain("Issue Details");
      expect(text).toContain("Test issue");
      expect(text).toContain("A test issue");
    });

    it("should return error for missing issue", async () => {
      const result = await client.callTool({
        name: "issue_get",
        arguments: { dir: tempDir, id: "nonexistent" },
      });
      expect(result.isError).toBe(true);
    });

    it("should update issue status and resolution", async () => {
      const result = await client.callTool({
        name: "issue_update",
        arguments: {
          dir: tempDir,
          id: "issue-1",
          status: "resolved",
          resolution: "Fixed the thing",
        },
      });
      const text = getTextContent(result);
      expect(text).toContain("Status: resolved");
      expect(text).toContain("Resolution: Fixed the thing");
    });

    it("should append linked commits and tasks", async () => {
      const result = await client.callTool({
        name: "issue_update",
        arguments: {
          dir: tempDir,
          id: "issue-1",
          linkedCommits: ["abc123"],
          linkedTasks: ["task-1"],
        },
      });
      const text = getTextContent(result);
      expect(text).toContain("Linked Commits: 1");
      expect(text).toContain("Linked Tasks: 1");
    });

    it("should filter issues by status", async () => {
      const result = await client.callTool({
        name: "issue_list",
        arguments: { dir: tempDir, status: "open" },
      });
      const text = getTextContent(result);
      expect(text).toContain("High priority issue");
      expect(text).not.toContain("Test issue");
    });
  });
});
