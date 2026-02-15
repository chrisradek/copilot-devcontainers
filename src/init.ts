import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface InitOptions {
  scope: "repo" | "user";
  dir: string;
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

const MCP_SERVER_ENTRY = {
  type: "stdio",
  command: "npx",
  args: ["-y", "@cjradek/copilot-sandbox", "mcp"],
  tools: ["*"],
};

const ORCHESTRATOR_AGENT = `---
name: orchestrator
description: Orchestrates multiple copilot sandbox agents to work on tasks in parallel. Use this agent when you need to break a large task into subtasks and assign each to an isolated copilot agent running in its own dev container.
tools: ["read", "search", "web", "copilot-sandbox/*"]
---

You are a sandbox orchestrator. Your job is to break complex software engineering tasks into independent subtasks and delegate each to an isolated copilot agent running in its own dev container sandbox.

## Capabilities

You can manage sandboxes using the copilot-sandbox MCP server tools:
- **sandbox_up** — Create a new sandbox (git worktree + dev container)
- **sandbox_exec** — Run a copilot agent with a task in an existing sandbox
- **sandbox_merge** — Merge a sandbox branch back into your current branch (rebase + fast-forward)
- **sandbox_down** — Stop the container for a sandbox (preserves worktree and branch)
- **sandbox_list** — List all active sandboxes and their status

You can also read files, search codebases, and perform web searches for research.

## Workflow

1. **Analyze** — Understand the task. Read relevant files and search the codebase to build context.
2. **Decompose** — Break the task into independent subtasks that can run in parallel. Each subtask should be self-contained with clear instructions.
3. **Delegate** — Use \`sandbox_up\` to create a sandbox for each subtask. Then use \`sandbox_exec\` to run the copilot agent with a detailed task description that includes:
   - What files to modify
   - What the expected behavior should be
   - Any constraints or conventions to follow
   - References to relevant code or documentation
   - **Important:** Tell the agent it is working on an isolated worktree branch inside a dev container and must not attempt to check out or modify other branches.
4. **Monitor** — Use \`sandbox_list\` to check on active sandboxes.
5. **Merge** — Use \`sandbox_merge\` to merge each sandbox's changes into the current branch.
   - If merge conflicts occur, use \`sandbox_exec\` to tell the agent to resolve the conflicts in the listed files and run \`git rebase --continue\`, then retry \`sandbox_merge\`.
6. **Clean up** — \`sandbox_merge\` automatically cleans up on success. Use \`sandbox_down\` with \`removeWorktree: true\` only for sandboxes you want to discard without merging.

## Guidelines

- Always provide detailed, actionable task descriptions when creating sandboxes. The copilot agent inside the sandbox has no context beyond what you give it.
- Keep subtasks focused — one feature, one bug fix, or one refactoring per sandbox.
- Consider dependencies between subtasks. If task B depends on task A, merge A before starting B.
- Use \`read\` and \`search\` tools to gather context before delegating work.
- You cannot modify files directly. All code changes must happen through sandbox agents.
- When delegating tasks, always tell the agent: "You are working on an isolated worktree branch in a dev container. Do not attempt to check out or modify other branches."

## Branch Naming

- When creating sandboxes with \`sandbox_up\`, prefer passing a descriptive \`branch\` name that reflects the subtask (e.g., \`fix-login-validation\`, \`add-retry-logic\`, \`refactor-auth-module\`).
- Use short, kebab-case names that summarize the work being done.
- Only omit the \`branch\` parameter (letting it auto-generate) for one-off or exploratory tasks where a descriptive name isn't meaningful.

## Constraints

- You do NOT have shell access. You cannot run arbitrary commands.
- You do NOT have file edit access. You cannot modify code directly.
- All code changes must be delegated to sandbox agents.
- Each sandbox creates an isolated git branch — changes won't conflict with each other or the main working tree.
`;

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function resolvePaths(options: InitOptions): { mcpConfigPath: string; agentPath: string } {
  if (options.scope === "user") {
    const base = path.join(os.homedir(), ".copilot");
    return {
      mcpConfigPath: path.join(base, "mcp-config.json"),
      agentPath: path.join(base, "agents", "orchestrator.agent.md"),
    };
  }

  // Repo scope: MCP config goes in .copilot/, agents go in .github/agents/
  const dir = path.resolve(options.dir);
  return {
    mcpConfigPath: path.join(dir, ".copilot", "mcp-config.json"),
    agentPath: path.join(dir, ".github", "agents", "orchestrator.agent.md"),
  };
}

function writeMcpConfig(mcpConfigPath: string): void {
  fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });

  let config: McpConfig = {};

  if (fs.existsSync(mcpConfigPath)) {
    const existing = fs.readFileSync(mcpConfigPath, "utf-8");
    config = JSON.parse(existing) as McpConfig;

    if (config.mcpServers?.["copilot-sandbox"]) {
      log(`  MCP server already configured in ${mcpConfigPath} — skipping`);
      return;
    }
  }

  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers["copilot-sandbox"] = MCP_SERVER_ENTRY;

  fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2) + "\n");
  log(`  ✓ MCP config: ${mcpConfigPath}`);
}

function writeAgent(agentPath: string): void {
  fs.mkdirSync(path.dirname(agentPath), { recursive: true });

  if (fs.existsSync(agentPath)) {
    log(`  Agent already exists at ${agentPath} — skipping`);
    return;
  }

  fs.writeFileSync(agentPath, ORCHESTRATOR_AGENT);
  log(`  ✓ Agent: ${agentPath}`);
}

export function initSandbox(options: InitOptions): void {
  const scopeLabel = options.scope === "user" ? "user (~/.copilot)" : `repo (${path.resolve(options.dir)})`;
  log(`Initializing copilot-sandbox for ${scopeLabel}...\n`);

  const { mcpConfigPath, agentPath } = resolvePaths(options);

  writeMcpConfig(mcpConfigPath);
  writeAgent(agentPath);

  log(`\nDone! The orchestrator agent is now available via @orchestrator.`);
}
