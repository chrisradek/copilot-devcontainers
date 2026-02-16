#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  sandboxUpCore,
  sandboxDownCore,
  sandboxListCore,
  sandboxExecCore,
  sandboxMergeCore,
} from "./sandbox.js";
import { OrchestratorStore, getStorePath, IssueStore, getIssueStorePath } from "./store.js";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const PROGRESS_INTERVAL_MS = 15_000;

/**
 * Start a periodic progress heartbeat to prevent MCP client timeouts
 * during long-running operations. Returns a cleanup function.
 */
function startProgressHeartbeat(extra: ToolExtra): () => void {
  const progressToken = extra._meta?.progressToken;
  if (progressToken == null) {
    return () => {};
  }

  let tick = 0;
  const interval = setInterval(() => {
    tick++;
    extra.sendNotification({
      method: "notifications/progress" as const,
      params: {
        progressToken,
        progress: tick,
        message: "Working...",
      },
    }).catch(() => {
      // Ignore notification send failures
    });
  }, PROGRESS_INTERVAL_MS);

  return () => clearInterval(interval);
}

/**
 * Create an output notifier that sends copilot output as progress notifications.
 * Also maintains a heartbeat for periods with no output.
 */
function createOutputNotifier(extra: ToolExtra): {
  onOutput: (line: string) => void;
  stop: () => void;
} {
  const progressToken = extra._meta?.progressToken;
  if (progressToken == null) {
    return { onOutput: () => {}, stop: () => {} };
  }

  let tick = 0;
  const interval = setInterval(() => {
    tick++;
    extra.sendNotification({
      method: "notifications/progress" as const,
      params: {
        progressToken,
        progress: tick,
        message: "Working...",
      },
    }).catch(() => {});
  }, PROGRESS_INTERVAL_MS);

  const onOutput = (line: string) => {
    tick++;
    interval.refresh();
    extra.sendNotification({
      method: "notifications/progress" as const,
      params: {
        progressToken,
        progress: tick,
        message: line,
      },
    }).catch(() => {});
  };

  return { onOutput, stop: () => clearInterval(interval) };
}

function getStore(dir: string): OrchestratorStore {
  return new OrchestratorStore(getStorePath(dir));
}

function getIssueStore(dir: string): IssueStore {
  return new IssueStore(getIssueStorePath(dir));
}

const server = new McpServer(
  { name: "copilot-sandbox", version: "0.1.0" },
);

server.registerTool(
  "sandbox_up",
  {
    description: "Create a new sandbox (git worktree + dev container). " +
    "Each sandbox is fully isolated with its own branch and container. " +
    "Use sandbox_exec to run copilot tasks in the sandbox after creation.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      branch: z.string().optional().describe("Branch name for the worktree (default: auto-generated)"),
      base: z.string().default("HEAD").describe("Base ref to branch from (default: HEAD)"),
      worktreeDir: z.string().optional().describe("Where to create worktrees (default: ../<repo>-worktrees/)"),
    },
  },
  async ({ dir, branch, base, worktreeDir }, extra) => {
    const notifier = createOutputNotifier(extra);
    try {
      const result = await sandboxUpCore({
        dir,
        branch,
        base,
        worktreeDir,
        interactive: false,
        verbose: false,
        onOutput: notifier.onOutput,
      });

      const lines = [
        `Sandbox created successfully.`,
        `Branch: ${result.branch}`,
        `Worktree: ${result.worktreePath}`,
        `Container: ${result.containerId?.slice(0, 12) ?? "unknown"}`,
        `Remote user: ${result.remoteUser ?? "unknown"}`,
        `Workspace: ${result.remoteWorkspaceFolder ?? "unknown"}`,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    } finally {
      notifier.stop();
    }
  },
);

server.registerTool(
  "sandbox_exec",
  {
    description: "Run a copilot agent with a task in an existing sandbox. The container will be started if not already running.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      branch: z.string().describe("Branch name of the existing sandbox"),
      task: z.string().describe("Task description for copilot to work on"),
      sessionId: z.string().describe("Session ID for the copilot session. Pass the same ID returned from sandbox_up to resume, or generate a new UUID for a fresh session."),
    },
  },
  async ({ dir, branch, task, sessionId }, extra) => {
    const notifier = createOutputNotifier(extra);
    try {
      const result = await sandboxExecCore({ dir, branch, task, sessionId, verbose: false, onOutput: notifier.onOutput });

      return {
        content: [{
          type: "text" as const,
          text: `Copilot finished in sandbox "${branch}".\nWorktree: ${result.worktreePath}\nExit code: ${result.exitCode}\nSession ID: ${result.sessionId}`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    } finally {
      notifier.stop();
    }
  },
);

server.registerTool(
  "sandbox_down",
  {
    description: "Stop the dev container for a sandbox. The worktree and branch are preserved " +
    "so work is not lost. Use sandbox_merge to merge changes and clean up, or " +
    "pass removeWorktree: true to fully tear down the sandbox.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      branch: z.string().describe("Branch name of the sandbox to stop"),
      removeWorktree: z.boolean().optional().default(false).describe("If true, also remove the worktree and delete the branch (full teardown). Default: false (container-only)."),
    },
  },
  async ({ dir, branch, removeWorktree }) => {
    try {
      await sandboxDownCore({ dir, branch, containerOnly: !removeWorktree });

      const msg = removeWorktree
        ? `Sandbox "${branch}" has been fully torn down.`
        : `Container for sandbox "${branch}" has been stopped. Worktree and branch are preserved.`;
      return {
        content: [{ type: "text" as const, text: msg }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "sandbox_merge",
  {
    description: "Merge a sandbox branch into the current branch of the main repository. " +
    "Rebases the sandbox branch onto the current branch, then fast-forward merges. " +
    "On success, stops the container and cleans up the worktree and branch. " +
    "On conflict, leaves the rebase in-progress — use sandbox_exec to have the agent " +
    "resolve conflicts and run 'git rebase --continue', then retry sandbox_merge.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      branch: z.string().describe("Branch name of the sandbox to merge"),
    },
  },
  async ({ dir, branch }, extra) => {
    const stopHeartbeat = startProgressHeartbeat(extra);
    try {
      const result = await sandboxMergeCore({ dir, branch });

      if (result.success) {
        return {
          content: [{
            type: "text" as const,
            text: `Sandbox "${branch}" has been successfully merged and cleaned up.`,
          }],
        };
      }

      const conflictList = result.conflictFiles?.join("\n  ") ?? "unknown";
      return {
        content: [{
          type: "text" as const,
          text: [
            `Rebase of "${branch}" has conflicts. The rebase is in-progress.`,
            `Conflicting files:`,
            `  ${conflictList}`,
            ``,
            `To resolve: use sandbox_exec to tell the agent to resolve the merge conflicts ` +
            `in the listed files and then run 'git rebase --continue'. ` +
            `Once resolved, retry sandbox_merge.`,
          ].join("\n"),
        }],
        isError: true,
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    } finally {
      stopHeartbeat();
    }
  },
);

server.registerTool(
  "sandbox_list",
  {
    description: "List all active sandboxes (worktrees) for a git repository.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
    },
  },
  async ({ dir }) => {
    try {
      const { sandboxes } = await sandboxListCore(dir);

      if (sandboxes.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No active sandboxes." }],
        };
      }

      const lines = [`Active sandboxes (${sandboxes.length}):\n`];
      for (const s of sandboxes) {
        lines.push(`  Branch: ${s.branch}`);
        lines.push(`  Path:   ${s.worktreePath}`);
        lines.push(`  HEAD:   ${s.head?.slice(0, 8)}`);
        if (s.sessions.length > 0) {
          lines.push(`  Sessions:`);
          for (const sess of s.sessions) {
            lines.push(`    - ${sess.sessionId}${sess.task ? ` (${sess.task.slice(0, 60)}${sess.task.length > 60 ? "..." : ""})` : ""}`);
          }
        }
        lines.push(``);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "generate_session_id",
  {
    description: "Generate a new UUID v4 session ID for use with sandbox_exec. " +
    "Call this before the first sandbox_exec for a sandbox to get a valid session ID " +
    "that can be reused across multiple exec calls to maintain conversation context.",
    inputSchema: {},
  },
  async () => {
    return {
      content: [{ type: "text" as const, text: randomUUID() }],
    };
  },
);

server.registerTool(
  "orchestration_create",
  {
    description: "Create a new orchestration session to group related sandbox tasks.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      description: z.string().describe("Description of the orchestration session"),
      id: z.string().optional().describe("Optional ID for the orchestration (auto-generated if not provided)"),
    },
  },
  async ({ dir, description, id }) => {
    try {
      const store = getStore(dir);
      const orchestration = store.createOrchestration({ id, description });

      const lines = [
        `Orchestration created successfully.`,
        `ID: ${orchestration.id}`,
        `Description: ${orchestration.description}`,
        `Status: ${orchestration.status}`,
        `Created: ${orchestration.createdAt}`,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "orchestration_list",
  {
    description: "List all orchestration sessions and their task summaries.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
    },
  },
  async ({ dir }) => {
    try {
      const store = getStore(dir);
      const orchestrations = store.listOrchestrations();

      if (orchestrations.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No orchestrations found." }],
        };
      }

      const lines = [`Orchestrations (${orchestrations.length}):\n`];
      for (const orch of orchestrations) {
        const tasks = store.listTasks({ orchestrationId: orch.id });
        const statusCounts = tasks.reduce((acc, t) => {
          acc[t.status] = (acc[t.status] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        lines.push(`  ID: ${orch.id}`);
        lines.push(`  Description: ${orch.description}`);
        lines.push(`  Status: ${orch.status}`);
        lines.push(`  Tasks: ${tasks.length} total`);
        if (tasks.length > 0) {
          const statusStr = Object.entries(statusCounts)
            .map(([status, count]) => `${status}: ${count}`)
            .join(", ");
          lines.push(`    ${statusStr}`);
        }
        lines.push(`  Created: ${orch.createdAt}`);
        lines.push(`  Updated: ${orch.updatedAt}`);
        lines.push(``);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "task_create",
  {
    description: "Create a task within an orchestration to track sandbox work.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      orchestrationId: z.string().describe("ID of the orchestration this task belongs to"),
      title: z.string().describe("Short title for the task"),
      description: z.string().describe("Detailed description of the task"),
      id: z.string().optional().describe("Optional ID for the task (auto-generated if not provided)"),
      dependencies: z.array(z.string()).optional().describe("Task IDs this task depends on"),
      branch: z.string().optional().describe("Sandbox branch name for this task"),
      sessionId: z.string().optional().describe("Session ID for this task"),
    },
  },
  async ({ dir, orchestrationId, title, description, id, dependencies, branch, sessionId }) => {
    try {
      const store = getStore(dir);
      const task = store.createTask({
        id,
        orchestrationId,
        title,
        description,
        dependencies,
        branch,
        sessionId,
      });

      const lines = [
        `Task created successfully.`,
        `ID: ${task.id}`,
        `Orchestration: ${task.orchestrationId}`,
        `Title: ${task.title}`,
        `Description: ${task.description}`,
        `Status: ${task.status}`,
        `Dependencies: ${task.dependencies.length > 0 ? task.dependencies.join(", ") : "none"}`,
        `Created: ${task.createdAt}`,
      ];
      if (task.branch) lines.push(`Branch: ${task.branch}`);
      if (task.sessionId) lines.push(`Session ID: ${task.sessionId}`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "task_update",
  {
    description: "Update a task's status, branch, session ID, or result.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      id: z.string().describe("Task ID to update"),
      status: z.enum(["pending", "in_progress", "done", "failed", "cancelled"]).optional().describe("New status"),
      branch: z.string().optional().describe("Sandbox branch name"),
      sessionId: z.string().optional().describe("Session ID"),
      reviewSessionId: z.string().optional().describe("Session ID for the code review session"),
      result: z.string().optional().describe("Result or outcome of the task"),
    },
  },
  async ({ dir, id, status, branch, sessionId, reviewSessionId, result }) => {
    try {
      const store = getStore(dir);
      const updates: Record<string, unknown> = {};
      if (status !== undefined) updates.status = status;
      if (branch !== undefined) updates.branch = branch;
      if (sessionId !== undefined) updates.sessionId = sessionId;
      if (reviewSessionId !== undefined) updates.reviewSessionId = reviewSessionId;
      if (result !== undefined) updates.result = result;

      const task = store.updateTask(id, updates);

      const lines = [
        `Task updated successfully.`,
        `ID: ${task.id}`,
        `Title: ${task.title}`,
        `Status: ${task.status}`,
        `Updated: ${task.updatedAt}`,
      ];
      if (task.branch) lines.push(`Branch: ${task.branch}`);
      if (task.sessionId) lines.push(`Session ID: ${task.sessionId}`);
      if (task.reviewSessionId) lines.push(`Review Session ID: ${task.reviewSessionId}`);
      if (task.result) lines.push(`Result: ${task.result}`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "task_list",
  {
    description: "List tasks, optionally filtered by orchestration ID or status.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      orchestrationId: z.string().optional().describe("Filter by orchestration ID"),
      status: z.string().optional().describe("Filter by task status"),
    },
  },
  async ({ dir, orchestrationId, status }) => {
    try {
      const store = getStore(dir);
      const tasks = store.listTasks({ orchestrationId, status });

      if (tasks.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No tasks found." }],
        };
      }

      const lines = [`Tasks (${tasks.length}):\n`];
      for (const task of tasks) {
        lines.push(`  ID: ${task.id}`);
        lines.push(`  Title: ${task.title}`);
        lines.push(`  Status: ${task.status}`);
        lines.push(`  Orchestration: ${task.orchestrationId}`);
        if (task.branch) lines.push(`  Branch: ${task.branch}`);
        if (task.sessionId) lines.push(`  Session ID: ${task.sessionId}`);
        if (task.reviewSessionId) lines.push(`  Review Session ID: ${task.reviewSessionId}`);
        if (task.dependencies.length > 0) {
          lines.push(`  Dependencies: ${task.dependencies.join(", ")}`);
        }
        lines.push(`  Created: ${task.createdAt}`);
        lines.push(`  Updated: ${task.updatedAt}`);
        lines.push(``);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "task_get",
  {
    description: "Get full details of a specific task.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      id: z.string().describe("Task ID to retrieve"),
    },
  },
  async ({ dir, id }) => {
    try {
      const store = getStore(dir);
      const task = store.getTask(id);

      if (!task) {
        return {
          content: [{ type: "text" as const, text: `Task not found: ${id}` }],
          isError: true,
        };
      }

      const lines = [
        `Task Details:`,
        `ID: ${task.id}`,
        `Orchestration: ${task.orchestrationId}`,
        `Title: ${task.title}`,
        `Description: ${task.description}`,
        `Status: ${task.status}`,
        `Dependencies: ${task.dependencies.length > 0 ? task.dependencies.join(", ") : "none"}`,
        `Created: ${task.createdAt}`,
        `Updated: ${task.updatedAt}`,
      ];
      if (task.branch) lines.push(`Branch: ${task.branch}`);
      if (task.sessionId) lines.push(`Session ID: ${task.sessionId}`);
      if (task.reviewSessionId) lines.push(`Review Session ID: ${task.reviewSessionId}`);
      if (task.result) lines.push(`Result: ${task.result}`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "issue_create",
  {
    description: "Create a new issue in the issue tracker.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      title: z.string().describe("Issue title"),
      description: z.string().describe("Detailed description of the issue"),
      priority: z.enum(["high", "medium", "low"]).optional().default("medium").describe("Issue priority (default: medium)"),
      labels: z.array(z.string()).optional().describe("Labels/tags for the issue"),
      id: z.string().optional().describe("Optional ID for the issue (auto-generated if not provided)"),
    },
  },
  async ({ dir, title, description, priority, labels, id }) => {
    try {
      const store = getIssueStore(dir);
      const issue = store.createIssue({ id, title, description, priority, labels });

      const lines = [
        `Issue created successfully.`,
        `ID: ${issue.id}`,
        `Title: ${issue.title}`,
        `Status: ${issue.status}`,
        `Priority: ${issue.priority}`,
        `Labels: ${issue.labels.length > 0 ? issue.labels.join(", ") : "none"}`,
        `Created: ${issue.createdAt}`,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "issue_list",
  {
    description: "List issues with optional filtering by status, priority, or label.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      status: z.enum(["open", "in_progress", "resolved", "closed"]).optional().describe("Filter by status"),
      priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority"),
      label: z.string().optional().describe("Filter by label (issues containing this label)"),
    },
  },
  async ({ dir, status, priority, label }) => {
    try {
      const store = getIssueStore(dir);
      const issues = store.listIssues({ status, priority, label });

      if (issues.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No issues found." }],
        };
      }

      const lines = [`Issues (${issues.length}):\n`];
      for (const issue of issues) {
        lines.push(`  ID: ${issue.id}`);
        lines.push(`  Title: ${issue.title}`);
        lines.push(`  Status: ${issue.status}`);
        lines.push(`  Priority: ${issue.priority}`);
        if (issue.labels.length > 0) {
          lines.push(`  Labels: ${issue.labels.join(", ")}`);
        }
        if (issue.linkedCommits.length > 0) {
          lines.push(`  Linked Commits: ${issue.linkedCommits.length}`);
        }
        if (issue.linkedTasks.length > 0) {
          lines.push(`  Linked Tasks: ${issue.linkedTasks.length}`);
        }
        lines.push(`  Created: ${issue.createdAt}`);
        lines.push(``);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "issue_get",
  {
    description: "Get full details of a specific issue including linked commits and tasks.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      id: z.string().describe("Issue ID to retrieve"),
    },
  },
  async ({ dir, id }) => {
    try {
      const store = getIssueStore(dir);
      const issue = store.getIssue(id);

      if (!issue) {
        return {
          content: [{ type: "text" as const, text: `Issue not found: ${id}` }],
          isError: true,
        };
      }

      const lines = [
        `Issue Details:`,
        `ID: ${issue.id}`,
        `Title: ${issue.title}`,
        `Description: ${issue.description}`,
        `Status: ${issue.status}`,
        `Priority: ${issue.priority}`,
        `Labels: ${issue.labels.length > 0 ? issue.labels.join(", ") : "none"}`,
        `Linked Commits: ${issue.linkedCommits.length > 0 ? issue.linkedCommits.join(", ") : "none"}`,
        `Linked Tasks: ${issue.linkedTasks.length > 0 ? issue.linkedTasks.join(", ") : "none"}`,
        `Created: ${issue.createdAt}`,
        `Updated: ${issue.updatedAt}`,
      ];
      if (issue.resolution) {
        lines.push(`Resolution: ${issue.resolution}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "issue_update",
  {
    description: "Update an issue's status, priority, labels, resolution, or link commits/tasks. " +
    "linkedCommits and linkedTasks are appended to existing arrays. labels replaces the array.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      id: z.string().describe("Issue ID to update"),
      status: z.enum(["open", "in_progress", "resolved", "closed"]).optional().describe("New status"),
      priority: z.enum(["high", "medium", "low"]).optional().describe("New priority"),
      labels: z.array(z.string()).optional().describe("New labels (replaces existing)"),
      resolution: z.string().optional().describe("Resolution summary"),
      linkedCommits: z.array(z.string()).optional().describe("Commit SHAs to link (appends to existing)"),
      linkedTasks: z.array(z.string()).optional().describe("Task IDs to link (appends to existing)"),
    },
  },
  async ({ dir, id, status, priority, labels, resolution, linkedCommits, linkedTasks }) => {
    try {
      const store = getIssueStore(dir);
      const updates: Record<string, unknown> = {};
      if (status !== undefined) updates.status = status;
      if (priority !== undefined) updates.priority = priority;
      if (labels !== undefined) updates.labels = labels;
      if (resolution !== undefined) updates.resolution = resolution;
      if (linkedCommits !== undefined) updates.linkedCommits = linkedCommits;
      if (linkedTasks !== undefined) updates.linkedTasks = linkedTasks;

      const issue = store.updateIssue(id, updates);

      const lines = [
        `Issue updated successfully.`,
        `ID: ${issue.id}`,
        `Title: ${issue.title}`,
        `Status: ${issue.status}`,
        `Priority: ${issue.priority}`,
        `Labels: ${issue.labels.length > 0 ? issue.labels.join(", ") : "none"}`,
        `Linked Commits: ${issue.linkedCommits.length}`,
        `Linked Tasks: ${issue.linkedTasks.length}`,
        `Updated: ${issue.updatedAt}`,
      ];
      if (issue.resolution) {
        lines.push(`Resolution: ${issue.resolution}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "issue_import",
  {
    description: "Import issues from markdown files in a directory. " +
    "Files must match pattern NNN-slug.md. Extracts title from first # heading, " +
    "priority from **Priority:** line, category/labels from **Category:** line. " +
    "Skips issues that already exist in the store.",
    inputSchema: {
      dir: z.string().describe("Path to the git repository"),
      issueDir: z.string().optional().describe("Directory containing markdown files (default: <gitRoot>/issue-tracker)"),
    },
  },
  async ({ dir, issueDir }) => {
    try {
      const store = getIssueStore(dir);
      const { getGitRoot } = await import("./worktree.js");
      const fs = await import("node:fs");
      const path = await import("node:path");
      
      const gitRoot = getGitRoot(dir);
      const scanDir = issueDir ?? path.join(gitRoot, "issue-tracker");

      let files: string[];
      try {
        files = fs.readdirSync(scanDir);
      } catch {
        return {
          content: [{ type: "text" as const, text: `Error: Directory not found: ${scanDir}` }],
          isError: true,
        };
      }

      const markdownFiles = files.filter((f) => /^\d{3}-.*\.md$/.test(f));
      let imported = 0;
      let skipped = 0;

      for (const file of markdownFiles) {
        const match = file.match(/^(\d{3})-/);
        if (!match) continue;

        const id = match[1];
        if (store.getIssue(id)) {
          skipped++;
          continue;
        }

        const filePath = path.join(scanDir, file);
        const content = fs.readFileSync(filePath, "utf-8");

        const titleMatch = content.match(/^# (.+)$/m);
        const title = titleMatch?.[1] ?? file;

        const priorityMatch = content.match(/\*\*Priority:\*\* (High|Medium|Low)/i);
        const priority = (priorityMatch?.[1]?.toLowerCase() as "high" | "medium" | "low") ?? "medium";

        const categoryMatch = content.match(/\*\*Category:\*\* (.+)$/m);
        const labels = categoryMatch?.[1] ? [categoryMatch[1].trim()] : [];

        store.createIssue({
          id,
          title,
          description: content,
          priority,
          labels,
        });

        imported++;
      }

      const lines = [
        `Issue import complete.`,
        `Imported: ${imported}`,
        `Skipped (already exist): ${skipped}`,
        `Total files scanned: ${markdownFiles.length}`,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
