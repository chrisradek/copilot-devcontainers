import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { IssueStore } from "../src/issue-store.js";

import { OrchestratorStore } from "../src/store.js";

describe("OrchestratorStore", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Orchestration CRUD", () => {
    it("creates orchestration with auto-generated ID", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test orchestration" });

      expect(orch.id).toBeDefined();
      expect(typeof orch.id).toBe("string");
      expect(orch.id.length).toBeGreaterThan(0);
      expect(orch.description).toBe("Test orchestration");
      expect(orch.status).toBe("active");
      expect(orch.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(orch.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("creates orchestration with custom ID", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ id: "custom-id", description: "Custom ID test" });

      expect(orch.id).toBe("custom-id");
      expect(orch.description).toBe("Custom ID test");
      expect(orch.status).toBe("active");
    });

    it("getOrchestration returns undefined for missing ID", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const result = store.getOrchestration("nonexistent");

      expect(result).toBeUndefined();
    });

    it("listOrchestrations returns empty array initially", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const list = store.listOrchestrations();

      expect(list).toEqual([]);
    });

    it("listOrchestrations returns all created orchestrations", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      store.createOrchestration({ description: "First" });
      store.createOrchestration({ description: "Second" });
      store.createOrchestration({ description: "Third" });

      const list = store.listOrchestrations();

      expect(list).toHaveLength(3);
      expect(list.map(o => o.description)).toEqual(["First", "Second", "Third"]);
    });

    it("updateOrchestration changes status", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test" });
      const updated = store.updateOrchestration(orch.id, { status: "completed" });

      expect(updated.status).toBe("completed");
      expect(updated.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("updateOrchestration throws for missing ID", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));

      expect(() => store.updateOrchestration("missing", { status: "completed" }))
        .toThrow("Orchestration not found: missing");
    });
  });

  describe("Task CRUD", () => {
    it("creates task with auto-generated ID", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test" });
      const task = store.createTask({
        orchestrationId: orch.id,
        title: "Test task",
        description: "Test description",
      });

      expect(task.id).toBeDefined();
      expect(typeof task.id).toBe("string");
      expect(task.id.length).toBeGreaterThan(0);
      expect(task.orchestrationId).toBe(orch.id);
      expect(task.title).toBe("Test task");
      expect(task.description).toBe("Test description");
      expect(task.status).toBe("pending");
      expect(task.dependencies).toEqual([]);
      expect(task.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(task.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("creates task with custom ID and dependencies", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test" });
      const task = store.createTask({
        id: "custom-task-id",
        orchestrationId: orch.id,
        title: "Dependent task",
        description: "Has dependencies",
        dependencies: ["dep1", "dep2"],
      });

      expect(task.id).toBe("custom-task-id");
      expect(task.dependencies).toEqual(["dep1", "dep2"]);
    });

    it("getTask returns undefined for missing ID", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const result = store.getTask("nonexistent");

      expect(result).toBeUndefined();
    });

    it("listTasks returns all tasks", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test" });
      store.createTask({ orchestrationId: orch.id, title: "Task 1", description: "First" });
      store.createTask({ orchestrationId: orch.id, title: "Task 2", description: "Second" });

      const tasks = store.listTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks.map(t => t.title)).toEqual(["Task 1", "Task 2"]);
    });

    it("listTasks filters by orchestrationId", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch1 = store.createOrchestration({ description: "Orch 1" });
      const orch2 = store.createOrchestration({ description: "Orch 2" });
      store.createTask({ orchestrationId: orch1.id, title: "Task 1", description: "First" });
      store.createTask({ orchestrationId: orch2.id, title: "Task 2", description: "Second" });
      store.createTask({ orchestrationId: orch1.id, title: "Task 3", description: "Third" });

      const filtered = store.listTasks({ orchestrationId: orch1.id });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.title)).toEqual(["Task 1", "Task 3"]);
    });

    it("listTasks filters by status", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test" });
      const task1 = store.createTask({ orchestrationId: orch.id, title: "Task 1", description: "First" });
      const task2 = store.createTask({ orchestrationId: orch.id, title: "Task 2", description: "Second" });
      store.updateTask(task1.id, { status: "done" });

      const filtered = store.listTasks({ status: "done" });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe("Task 1");
    });

    it("updateTask changes status and branch", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test" });
      const task = store.createTask({ orchestrationId: orch.id, title: "Task", description: "Test" });
      const updated = store.updateTask(task.id, { status: "in_progress", branch: "task-branch" });

      expect(updated.status).toBe("in_progress");
      expect(updated.branch).toBe("task-branch");
      expect(updated.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("updateTask throws for missing ID", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));

      expect(() => store.updateTask("missing", { status: "done" }))
        .toThrow("Task not found: missing");
    });
  });

  describe("Dependency helpers", () => {
    it("getUnmetDependencies returns empty for task with no deps", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test" });
      const task = store.createTask({ orchestrationId: orch.id, title: "Task", description: "No deps" });

      const unmet = store.getUnmetDependencies(task.id);

      expect(unmet).toEqual([]);
    });

    it("getUnmetDependencies returns tasks not in done status", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test" });
      const dep1 = store.createTask({ orchestrationId: orch.id, title: "Dep 1", description: "First" });
      const dep2 = store.createTask({ orchestrationId: orch.id, title: "Dep 2", description: "Second" });
      const task = store.createTask({
        orchestrationId: orch.id,
        title: "Main",
        description: "Main task",
        dependencies: [dep1.id, dep2.id],
      });

      const unmet = store.getUnmetDependencies(task.id);

      expect(unmet).toHaveLength(2);
      expect(unmet.map(t => t.id)).toEqual([dep1.id, dep2.id]);
    });

    it("getUnmetDependencies returns empty when all deps are done", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test" });
      const dep1 = store.createTask({ orchestrationId: orch.id, title: "Dep 1", description: "First" });
      const dep2 = store.createTask({ orchestrationId: orch.id, title: "Dep 2", description: "Second" });
      store.updateTask(dep1.id, { status: "done" });
      store.updateTask(dep2.id, { status: "done" });
      const task = store.createTask({
        orchestrationId: orch.id,
        title: "Main",
        description: "Main task",
        dependencies: [dep1.id, dep2.id],
      });

      const unmet = store.getUnmetDependencies(task.id);

      expect(unmet).toEqual([]);
    });

    it("getUnmetDependencies returns empty for missing task", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));

      const unmet = store.getUnmetDependencies("nonexistent");

      expect(unmet).toEqual([]);
    });

    it("findTaskByBranch returns matching task", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));
      const orch = store.createOrchestration({ description: "Test" });
      const task = store.createTask({
        orchestrationId: orch.id,
        title: "Task",
        description: "Test",
        branch: "feature-branch",
      });

      const found = store.findTaskByBranch("feature-branch");

      expect(found).toBeDefined();
      expect(found?.id).toBe(task.id);
    });

    it("findTaskByBranch returns undefined for no match", () => {
      const store = new OrchestratorStore(path.join(tempDir, "test.json"));

      const found = store.findTaskByBranch("nonexistent");

      expect(found).toBeUndefined();
    });
  });
});

describe("IssueStore", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Issue CRUD", () => {
    it("creates issue with auto-generated ID", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      const issue = store.createIssue({
        title: "Test issue",
        description: "Test description",
      });

      expect(issue.id).toBeDefined();
      expect(typeof issue.id).toBe("string");
      expect(issue.id.length).toBeGreaterThan(0);
      expect(issue.title).toBe("Test issue");
      expect(issue.description).toBe("Test description");
      expect(issue.status).toBe("open");
      expect(issue.priority).toBe("medium");
      expect(issue.labels).toEqual([]);
      expect(issue.linkedCommits).toEqual([]);
      expect(issue.linkedTasks).toEqual([]);
      expect(issue.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(issue.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("creates issue with custom ID and labels", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      const issue = store.createIssue({
        id: "custom-issue-id",
        title: "Custom issue",
        description: "With labels",
        priority: "high",
        labels: ["bug", "urgent"],
      });

      expect(issue.id).toBe("custom-issue-id");
      expect(issue.priority).toBe("high");
      expect(issue.labels).toEqual(["bug", "urgent"]);
    });

    it("getIssue returns undefined for missing ID", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      const result = store.getIssue("nonexistent");

      expect(result).toBeUndefined();
    });

    it("listIssues returns empty array initially", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      const list = store.listIssues();

      expect(list).toEqual([]);
    });

    it("listIssues sorts by priority then creation date", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      // Create in mixed order
      store.createIssue({ title: "Low 1", description: "Low priority", priority: "low" });
      store.createIssue({ title: "High 1", description: "High priority", priority: "high" });
      store.createIssue({ title: "Medium 1", description: "Medium priority", priority: "medium" });
      store.createIssue({ title: "High 2", description: "High priority 2", priority: "high" });
      store.createIssue({ title: "Low 2", description: "Low priority 2", priority: "low" });

      const list = store.listIssues();

      expect(list).toHaveLength(5);
      expect(list.map(i => i.title)).toEqual(["High 1", "High 2", "Medium 1", "Low 1", "Low 2"]);
    });

    it("listIssues filters by status", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      const issue1 = store.createIssue({ title: "Issue 1", description: "First" });
      store.createIssue({ title: "Issue 2", description: "Second" });
      store.updateIssue(issue1.id, { status: "resolved" });

      const filtered = store.listIssues({ status: "resolved" });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe("Issue 1");
    });

    it("listIssues filters by priority", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      store.createIssue({ title: "Low", description: "Low", priority: "low" });
      store.createIssue({ title: "High", description: "High", priority: "high" });
      store.createIssue({ title: "Medium", description: "Medium", priority: "medium" });

      const filtered = store.listIssues({ priority: "high" });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe("High");
    });

    it("listIssues filters by label", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      store.createIssue({ title: "Bug", description: "Bug issue", labels: ["bug", "critical"] });
      store.createIssue({ title: "Feature", description: "Feature request", labels: ["enhancement"] });
      store.createIssue({ title: "Another bug", description: "Another bug", labels: ["bug"] });

      const filtered = store.listIssues({ label: "bug" });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(i => i.title).sort()).toEqual(["Another bug", "Bug"]);
    });
  });

  describe("Issue updates", () => {
    it("updateIssue changes status", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      const issue = store.createIssue({ title: "Test", description: "Test issue" });
      const updated = store.updateIssue(issue.id, { status: "in_progress" });

      expect(updated.status).toBe("in_progress");
      expect(updated.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("updateIssue appends linkedCommits", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      const issue = store.createIssue({ title: "Test", description: "Test issue" });
      store.updateIssue(issue.id, { linkedCommits: ["commit1", "commit2"] });
      const updated = store.updateIssue(issue.id, { linkedCommits: ["commit3"] });

      expect(updated.linkedCommits).toEqual(["commit1", "commit2", "commit3"]);
    });

    it("updateIssue appends linkedTasks", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      const issue = store.createIssue({ title: "Test", description: "Test issue" });
      store.updateIssue(issue.id, { linkedTasks: ["task1"] });
      const updated = store.updateIssue(issue.id, { linkedTasks: ["task2", "task3"] });

      expect(updated.linkedTasks).toEqual(["task1", "task2", "task3"]);
    });

    it("updateIssue replaces labels", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      const issue = store.createIssue({ title: "Test", description: "Test issue", labels: ["old1", "old2"] });
      const updated = store.updateIssue(issue.id, { labels: ["new1", "new2", "new3"] });

      expect(updated.labels).toEqual(["new1", "new2", "new3"]);
    });

    it("updateIssue sets resolution", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));
      const issue = store.createIssue({ title: "Test", description: "Test issue" });
      const updated = store.updateIssue(issue.id, {
        status: "resolved",
        resolution: "Fixed by applying patch",
      });

      expect(updated.status).toBe("resolved");
      expect(updated.resolution).toBe("Fixed by applying patch");
    });

    it("updateIssue throws for missing ID", () => {
      const store = new IssueStore(path.join(tempDir, "issues.json"));

      expect(() => store.updateIssue("missing", { status: "closed" }))
        .toThrow("Issue not found: missing");
    });
  });
});
