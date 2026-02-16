import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { getGitRoot } from "./worktree.js";

export interface Orchestration {
  id: string;
  description: string;
  status: "active" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorTask {
  id: string;
  orchestrationId: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "done" | "failed" | "cancelled";
  branch?: string;
  sessionId?: string;
  reviewSessionId?: string;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  result?: string;
}

interface StoreData {
  orchestrations: Record<string, Orchestration>;
  tasks: Record<string, OrchestratorTask>;
}

export class OrchestratorStore {
  constructor(private storePath: string) {}

  private read(): StoreData {
    try {
      const content = fs.readFileSync(this.storePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return { orchestrations: {}, tasks: {} };
    }
  }

  private write(data: StoreData): void {
    const dir = path.dirname(this.storePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  createOrchestration(opts: { id?: string; description: string }): Orchestration {
    const data = this.read();
    const now = new Date().toISOString();
    const orchestration: Orchestration = {
      id: opts.id ?? randomUUID(),
      description: opts.description,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    data.orchestrations[orchestration.id] = orchestration;
    this.write(data);
    return orchestration;
  }

  getOrchestration(id: string): Orchestration | undefined {
    const data = this.read();
    return data.orchestrations[id];
  }

  listOrchestrations(): Orchestration[] {
    const data = this.read();
    return Object.values(data.orchestrations);
  }

  updateOrchestration(
    id: string,
    updates: Partial<Pick<Orchestration, "description" | "status">>,
  ): Orchestration {
    const data = this.read();
    const orchestration = data.orchestrations[id];
    if (!orchestration) {
      throw new Error(`Orchestration not found: ${id}`);
    }
    Object.assign(orchestration, updates, { updatedAt: new Date().toISOString() });
    this.write(data);
    return orchestration;
  }

  createTask(opts: {
    id?: string;
    orchestrationId: string;
    title: string;
    description: string;
    dependencies?: string[];
    branch?: string;
    sessionId?: string;
  }): OrchestratorTask {
    const data = this.read();
    const now = new Date().toISOString();
    const task: OrchestratorTask = {
      id: opts.id ?? randomUUID(),
      orchestrationId: opts.orchestrationId,
      title: opts.title,
      description: opts.description,
      status: "pending",
      branch: opts.branch,
      sessionId: opts.sessionId,
      dependencies: opts.dependencies ?? [],
      createdAt: now,
      updatedAt: now,
    };
    data.tasks[task.id] = task;
    this.write(data);
    return task;
  }

  getTask(id: string): OrchestratorTask | undefined {
    const data = this.read();
    return data.tasks[id];
  }

  listTasks(filter?: { orchestrationId?: string; status?: string }): OrchestratorTask[] {
    const data = this.read();
    let tasks = Object.values(data.tasks);
    if (filter?.orchestrationId) {
      tasks = tasks.filter((t) => t.orchestrationId === filter.orchestrationId);
    }
    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    return tasks;
  }

  updateTask(
    id: string,
    updates: Partial<Pick<OrchestratorTask, "status" | "branch" | "sessionId" | "reviewSessionId" | "result">>,
  ): OrchestratorTask {
    const data = this.read();
    const task = data.tasks[id];
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    this.write(data);
    return task;
  }

  getUnmetDependencies(taskId: string): OrchestratorTask[] {
    const data = this.read();
    const task = data.tasks[taskId];
    if (!task) return [];
    return task.dependencies
      .map((depId) => data.tasks[depId])
      .filter((dep): dep is OrchestratorTask => dep !== undefined && dep.status !== "done");
  }

  findTaskByBranch(branch: string): OrchestratorTask | undefined {
    const data = this.read();
    return Object.values(data.tasks).find((t) => t.branch === branch);
  }
}

export function getStorePath(dir: string): string {
  const gitRoot = getGitRoot(dir);
  return path.join(gitRoot, ".orchestrator", "tasks.json");
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "high" | "medium" | "low";
  labels: string[];
  linkedCommits: string[];
  linkedTasks: string[];
  resolution?: string;
  sourceFile?: string;
  createdAt: string;
  updatedAt: string;
}

interface IssueStoreData {
  issues: Record<string, Issue>;
}

export class IssueStore {
  constructor(private storePath: string) {}

  private read(): IssueStoreData {
    try {
      const content = fs.readFileSync(this.storePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return { issues: {} };
    }
  }

  private write(data: IssueStoreData): void {
    const dir = path.dirname(this.storePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  createIssue(opts: {
    id?: string;
    title: string;
    description: string;
    priority?: "high" | "medium" | "low";
    labels?: string[];
    sourceFile?: string;
  }): Issue {
    const data = this.read();
    const now = new Date().toISOString();
    const issue: Issue = {
      id: opts.id ?? randomUUID(),
      title: opts.title,
      description: opts.description,
      status: "open",
      priority: opts.priority ?? "medium",
      labels: opts.labels ?? [],
      linkedCommits: [],
      linkedTasks: [],
      sourceFile: opts.sourceFile,
      createdAt: now,
      updatedAt: now,
    };
    data.issues[issue.id] = issue;
    this.write(data);
    return issue;
  }

  getIssue(id: string): Issue | undefined {
    const data = this.read();
    return data.issues[id];
  }

  listIssues(filter?: {
    status?: string;
    priority?: string;
    label?: string;
  }): Issue[] {
    const data = this.read();
    let issues = Object.values(data.issues);

    if (filter?.status) {
      issues = issues.filter((i) => i.status === filter.status);
    }
    if (filter?.priority) {
      issues = issues.filter((i) => i.priority === filter.priority);
    }
    if (filter?.label) {
      const label = filter.label;
      issues = issues.filter((i) => i.labels.includes(label));
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.localeCompare(b.createdAt);
    });

    return issues;
  }

  updateIssue(
    id: string,
    updates: {
      status?: "open" | "in_progress" | "resolved" | "closed";
      priority?: "high" | "medium" | "low";
      labels?: string[];
      resolution?: string;
      linkedCommits?: string[];
      linkedTasks?: string[];
      sourceFile?: string;
    },
  ): Issue {
    const data = this.read();
    const issue = data.issues[id];
    if (!issue) {
      throw new Error(`Issue not found: ${id}`);
    }

    if (updates.status !== undefined) issue.status = updates.status;
    if (updates.priority !== undefined) issue.priority = updates.priority;
    if (updates.labels !== undefined) issue.labels = updates.labels;
    if (updates.resolution !== undefined) issue.resolution = updates.resolution;
    if (updates.linkedCommits !== undefined) {
      issue.linkedCommits = [...issue.linkedCommits, ...updates.linkedCommits];
    }
    if (updates.linkedTasks !== undefined) {
      issue.linkedTasks = [...issue.linkedTasks, ...updates.linkedTasks];
    }
    if (updates.sourceFile !== undefined) issue.sourceFile = updates.sourceFile;

    issue.updatedAt = new Date().toISOString();
    this.write(data);
    return issue;
  }
}

export function getIssueStorePath(dir: string): string {
  const gitRoot = getGitRoot(dir);
  return path.join(gitRoot, ".orchestrator", "issues.json");
}
