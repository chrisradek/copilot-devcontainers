#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { IssueStore, getIssueStorePath } from "./issue-store.js";

function getIssueStore(dir: string): IssueStore {
  return new IssueStore(getIssueStorePath(dir));
}

export function createIssueMcpServer(): McpServer {
  const server = new McpServer(
    { name: "issue-tracker", version: "0.1.0" },
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

        // If status changed to "resolved" and we have a source file, update and move it
        if (issue.status === "resolved" && issue.sourceFile) {
          try {
            const fs = await import("node:fs");
            const path = await import("node:path");

            if (fs.existsSync(issue.sourceFile)) {
              // Read the current content
              let content = fs.readFileSync(issue.sourceFile, "utf-8");

              // Append ## Resolution section
              const resolutionLines = [
                "",
                "## Resolution",
                "",
                `**Status:** Resolved`,
                `**Date:** ${issue.updatedAt}`,
              ];
              if (issue.resolution) {
                resolutionLines.push("", issue.resolution);
              }
              if (issue.linkedCommits.length > 0) {
                resolutionLines.push("", `**Commits:** ${issue.linkedCommits.join(", ")}`);
              }
              if (issue.linkedTasks.length > 0) {
                resolutionLines.push("", `**Tasks:** ${issue.linkedTasks.join(", ")}`);
              }
              resolutionLines.push("");

              content = content.trimEnd() + "\n" + resolutionLines.join("\n");
              fs.writeFileSync(issue.sourceFile, content, "utf-8");

              // Move to resolved/ subdirectory
              const dir = path.dirname(issue.sourceFile);
              const resolvedDir = path.join(dir, "resolved");
              fs.mkdirSync(resolvedDir, { recursive: true });
              const destPath = path.join(resolvedDir, path.basename(issue.sourceFile));
              fs.renameSync(issue.sourceFile, destPath);

              // Update the sourceFile in the store to point to new location
              store.updateIssue(id, { sourceFile: destPath });
            }
          } catch {
            // File operations are best-effort — don't fail the status update
          }
        }

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
            sourceFile: filePath,
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

  return server;
}

async function main(): Promise<void> {
  const server = createIssueMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
