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

export { Issue, IssueStore, getIssueStorePath } from "./issue-store.js";
