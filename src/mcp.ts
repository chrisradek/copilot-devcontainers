#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  sandboxUpCore,
  sandboxDownCore,
  sandboxListCore,
  sandboxExecCore,
  sandboxMergeCore,
} from "./sandbox.js";

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

const server = new McpServer(
  { name: "copilot-sandbox", version: "0.1.0" },
);

server.tool(
  "sandbox_up",
  "Create a new sandbox (git worktree + dev container). " +
  "Each sandbox is fully isolated with its own branch and container. " +
  "Use sandbox_exec to run copilot tasks in the sandbox after creation.",
  {
    dir: z.string().describe("Path to the git repository"),
    branch: z.string().optional().describe("Branch name for the worktree (default: auto-generated)"),
    base: z.string().default("HEAD").describe("Base ref to branch from (default: HEAD)"),
    worktreeDir: z.string().optional().describe("Where to create worktrees (default: ../<repo>-worktrees/)"),
  },
  async ({ dir, branch, base, worktreeDir }, extra) => {
    const stopHeartbeat = startProgressHeartbeat(extra);
    try {
      const result = await sandboxUpCore({
        dir,
        branch,
        base,
        worktreeDir,
        interactive: false,
        verbose: false,
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
      stopHeartbeat();
    }
  },
);

server.tool(
  "sandbox_exec",
  "Run a copilot agent with a task in an existing sandbox. The container will be started if not already running.",
  {
    dir: z.string().describe("Path to the git repository"),
    branch: z.string().describe("Branch name of the existing sandbox"),
    task: z.string().describe("Task description for copilot to work on"),
    sessionId: z.string().describe("Session ID for the copilot session. Pass the same ID returned from sandbox_up to resume, or generate a new UUID for a fresh session."),
  },
  async ({ dir, branch, task, sessionId }, extra) => {
    const stopHeartbeat = startProgressHeartbeat(extra);
    try {
      const result = await sandboxExecCore({ dir, branch, task, sessionId, verbose: false });

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
      stopHeartbeat();
    }
  },
);

server.tool(
  "sandbox_down",
  "Stop the dev container for a sandbox. The worktree and branch are preserved " +
  "so work is not lost. Use sandbox_merge to merge changes and clean up, or " +
  "pass removeWorktree: true to fully tear down the sandbox.",
  {
    dir: z.string().describe("Path to the git repository"),
    branch: z.string().describe("Branch name of the sandbox to stop"),
    removeWorktree: z.boolean().optional().default(false).describe("If true, also remove the worktree and delete the branch (full teardown). Default: false (container-only)."),
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

server.tool(
  "sandbox_merge",
  "Merge a sandbox branch into the current branch of the main repository. " +
  "Rebases the sandbox branch onto the current branch, then fast-forward merges. " +
  "On success, stops the container and cleans up the worktree and branch. " +
  "On conflict, leaves the rebase in-progress — use sandbox_exec to have the agent " +
  "resolve conflicts and run 'git rebase --continue', then retry sandbox_merge.",
  {
    dir: z.string().describe("Path to the git repository"),
    branch: z.string().describe("Branch name of the sandbox to merge"),
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

server.tool(
  "List all active sandboxes (worktrees) for a git repository.",
  {
    dir: z.string().describe("Path to the git repository"),
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
