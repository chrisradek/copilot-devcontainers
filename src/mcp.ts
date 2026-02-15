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
  "Tear down a sandbox: stop its container, remove the worktree, and delete the branch.",
  {
    dir: z.string().describe("Path to the git repository"),
    branch: z.string().describe("Branch name of the sandbox to tear down"),
  },
  async ({ dir, branch }) => {
    try {
      await sandboxDownCore({ dir, branch });

      return {
        content: [{ type: "text" as const, text: `Sandbox "${branch}" has been torn down.` }],
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
  "sandbox_list",
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
