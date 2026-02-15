#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  sandboxUpCore,
  sandboxDownCore,
  sandboxListCore,
  sandboxExecCore,
} from "./sandbox.js";

const server = new McpServer(
  { name: "copilot-sandbox", version: "0.1.0" },
);

server.tool(
  "sandbox_up",
  "Create a new sandbox (git worktree + dev container) and optionally run a copilot agent with a task. " +
  "Each sandbox is fully isolated with its own branch and container.",
  {
    dir: z.string().describe("Path to the git repository"),
    branch: z.string().optional().describe("Branch name for the worktree (default: auto-generated)"),
    base: z.string().default("HEAD").describe("Base ref to branch from (default: HEAD)"),
    task: z.string().optional().describe("Task description for copilot to work on non-interactively"),
    worktreeDir: z.string().optional().describe("Where to create worktrees (default: ../<repo>-worktrees/)"),
  },
  async ({ dir, branch, base, task, worktreeDir }) => {
    try {
      const result = await sandboxUpCore({
        dir,
        branch,
        base,
        task,
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

      if (task && result.exitCode !== undefined) {
        lines.push(`Copilot exit code: ${result.exitCode}`);
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

server.tool(
  "sandbox_exec",
  "Run a copilot agent with a task in an existing sandbox. The container will be started if not already running.",
  {
    dir: z.string().describe("Path to the git repository"),
    branch: z.string().describe("Branch name of the existing sandbox"),
    task: z.string().describe("Task description for copilot to work on"),
  },
  async ({ dir, branch, task }) => {
    try {
      const result = await sandboxExecCore({ dir, branch, task, verbose: false });

      return {
        content: [{
          type: "text" as const,
          text: `Copilot finished in sandbox "${branch}".\nWorktree: ${result.worktreePath}\nExit code: ${result.exitCode}`,
        }],
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
