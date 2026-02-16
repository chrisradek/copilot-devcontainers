import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { getGitRoot } from "./worktree.js";

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
