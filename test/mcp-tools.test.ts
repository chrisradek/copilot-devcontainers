import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

function getTextContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]?.text ?? "";
}

describe("MCP Tools Integration", () => {
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-tools-test-"));
    execFileSync("git", ["init", "-b", "main", tempDir]);
    execFileSync("git", ["-C", tempDir, "config", "user.email", "test@test.com"]);
    execFileSync("git", ["-C", tempDir, "config", "user.name", "Test"]);
    fs.writeFileSync(path.join(tempDir, "README.md"), "test\n");
    execFileSync("git", ["-C", tempDir, "add", "."]);
    execFileSync("git", ["-C", tempDir, "commit", "-m", "init"]);

    server = createMcpServer();
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

  describe("generate_session_id", () => {
    it("should return a valid UUID v4", async () => {
      const result = await client.callTool({ name: "generate_session_id", arguments: {} });
      const text = getTextContent(result);
      expect(text).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe("orchestration tools", () => {
    let orchestrationId: string;

    it("should create an orchestration", async () => {
      const result = await client.callTool({
        name: "orchestration_create",
        arguments: { dir: tempDir, description: "Test orchestration" },
      });
      const text = getTextContent(result);
      expect(text).toContain("Orchestration created successfully");
      expect(text).toContain("Test orchestration");
      const match = text.match(/ID: (.+)/);
      expect(match).not.toBeNull();
      orchestrationId = match![1];
    });

    it("should create an orchestration with custom ID", async () => {
      const result = await client.callTool({
        name: "orchestration_create",
        arguments: { dir: tempDir, description: "Custom ID orch", id: "custom-orch-1" },
      });
      const text = getTextContent(result);
      expect(text).toContain("ID: custom-orch-1");
    });

    it("should list orchestrations", async () => {
      const result = await client.callTool({
        name: "orchestration_list",
        arguments: { dir: tempDir },
      });
      const text = getTextContent(result);
      expect(text).toContain("Orchestrations (2)");
      expect(text).toContain("Test orchestration");
      expect(text).toContain("Custom ID orch");
    });
  });

  describe("task tools", () => {
    let orchestrationId: string;

    beforeAll(async () => {
      const result = await client.callTool({
        name: "orchestration_create",
        arguments: { dir: tempDir, description: "Task test orch", id: "task-test-orch" },
      });
      orchestrationId = "task-test-orch";
    });

    it("should create a task", async () => {
      const result = await client.callTool({
        name: "task_create",
        arguments: {
          dir: tempDir,
          orchestrationId,
          title: "Test task",
          description: "A test task",
          id: "test-task-1",
        },
      });
      const text = getTextContent(result);
      expect(text).toContain("Task created successfully");
      expect(text).toContain("ID: test-task-1");
      expect(text).toContain("Status: pending");
    });

    it("should create a task with dependencies", async () => {
      const result = await client.callTool({
        name: "task_create",
        arguments: {
          dir: tempDir,
          orchestrationId,
          title: "Dependent task",
          description: "Depends on test-task-1",
          id: "test-task-2",
          dependencies: ["test-task-1"],
        },
      });
      const text = getTextContent(result);
      expect(text).toContain("Dependencies: test-task-1");
    });

    it("should update a task", async () => {
      const result = await client.callTool({
        name: "task_update",
        arguments: {
          dir: tempDir,
          id: "test-task-1",
          status: "in_progress",
          branch: "feature/test",
        },
      });
      const text = getTextContent(result);
      expect(text).toContain("Task updated successfully");
      expect(text).toContain("Status: in_progress");
      expect(text).toContain("Branch: feature/test");
    });

    it("should get a task", async () => {
      const result = await client.callTool({
        name: "task_get",
        arguments: { dir: tempDir, id: "test-task-1" },
      });
      const text = getTextContent(result);
      expect(text).toContain("Task Details");
      expect(text).toContain("Test task");
      expect(text).toContain("in_progress");
    });

    it("should return error for missing task", async () => {
      const result = await client.callTool({
        name: "task_get",
        arguments: { dir: tempDir, id: "nonexistent" },
      });
      expect(result.isError).toBe(true);
    });

    it("should list all tasks", async () => {
      const result = await client.callTool({
        name: "task_list",
        arguments: { dir: tempDir },
      });
      const text = getTextContent(result);
      expect(text).toContain("Tasks (");
      expect(text).toContain("Test task");
      expect(text).toContain("Dependent task");
    });

    it("should filter tasks by orchestrationId", async () => {
      const result = await client.callTool({
        name: "task_list",
        arguments: { dir: tempDir, orchestrationId: "task-test-orch" },
      });
      const text = getTextContent(result);
      expect(text).toContain("Test task");
    });

    it("should filter tasks by status", async () => {
      const result = await client.callTool({
        name: "task_list",
        arguments: { dir: tempDir, status: "pending" },
      });
      const text = getTextContent(result);
      expect(text).toContain("Dependent task");
      expect(text).not.toContain("Test task");
    });

    it("should filter ready tasks", async () => {
      // test-task-2 depends on test-task-1 which is in_progress, so not ready
      const result = await client.callTool({
        name: "task_list",
        arguments: { dir: tempDir, ready: true },
      });
      const text = getTextContent(result);
      // test-task-2 has unmet dep, so shouldn't appear
      expect(text).not.toContain("Dependent task");
    });

    it("should show ready tasks when dependencies are met", async () => {
      // Mark test-task-1 as done
      await client.callTool({
        name: "task_update",
        arguments: { dir: tempDir, id: "test-task-1", status: "done" },
      });
      const result = await client.callTool({
        name: "task_list",
        arguments: { dir: tempDir, ready: true },
      });
      const text = getTextContent(result);
      expect(text).toContain("Dependent task");
    });
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
