# copilot-sandbox

A standalone CLI tool for running GitHub Copilot CLI or OpenAI Codex CLI inside isolated dev containers on git worktrees. This keeps agents from modifying your main working tree — all changes happen in a disposable worktree+container sandbox.

## Prerequisites

- **Git**
- **Node.js** 18+
- **Docker** installed and running
- **GitHub CLI** (`gh`) installed and authenticated when using Copilot (for automatic token forwarding)
- A Codex login or `CODEX_API_KEY`/`OPENAI_API_KEY` when using Codex
- A **`.devcontainer/devcontainer.json`** in the target project (optional — a default config will be used if missing)

## Installation

```bash
# Run directly with npx
npx @cjradek/copilot-sandbox --help

# Or install globally
npm install -g @cjradek/copilot-sandbox
```

### From source

```bash
git clone https://github.com/chrisradek/copilot-sandbox.git
cd copilot-sandbox
npm install
npm run build
```

## Usage

```bash
# Spin up a sandbox with an interactive Copilot session
copilot-sandbox up --dir /path/to/your/project

# Run Codex interactively
copilot-sandbox up --agent codex --dir /path/to/your/project

# Or run a non-interactive Codex task
copilot-sandbox up --agent codex --dir /path/to/your/project --task "Fix the login bug"

# Copilot remains the default for backward compatibility
copilot-sandbox up --dir /path/to/your/project --task "Fix the login bug"

# Reconnect to an existing sandbox
copilot-sandbox exec --branch sandbox/2026-02-07T04-30-00

# List active sandboxes
copilot-sandbox list

# Tear down a sandbox when done
copilot-sandbox down --branch sandbox/2026-02-07T04-30-00
```

## Commands

### `copilot-sandbox init`

Sets up the MCP server config and orchestrator agent for a project or user scope.

| Flag | Default | Description |
|---|---|---|
| `--scope <repo\|user>` | `repo` | Where to install (repo-level or user-level) |
| `--dir <path>` | Current directory | Target directory (used with `--scope repo`) |
| `--force` | — | Overwrite existing files (useful for upgrading) |

### `copilot-sandbox up`

Creates a git worktree, starts a dev container, and runs the selected agent inside it.

| Flag | Default | Description |
|---|---|---|
| `--branch <name>` | Auto-generated (`sandbox/<timestamp>`) | Branch name for the worktree |
| `--base <ref>` | `HEAD` | Base ref to branch from |
| `--dir <path>` | Current directory | Path to the git repo |
| `--agent <copilot\|codex>` | `copilot` | Agent to install and run |
| `--task <description>` | — | Run the agent non-interactively with this task |
| `--interactive` | Default when no `--task` | Start an interactive agent session |
| `--worktree-dir <path>` | `../<repo>-worktrees/` | Where to create worktrees |
| `--verbose` | — | Stream devcontainer setup logs in real time |

### `copilot-sandbox exec`

Reconnects to an existing sandbox, ensures the container is running, and launches its configured agent.

| Flag | Default | Description |
|---|---|---|
| `--branch <name>` | *required* | Branch/worktree to reconnect to |
| `--dir <path>` | Current directory | Path to the git repo |
| `--agent <copilot\|codex>` | Sandbox agent | Override the agent to run |
| `--task <description>` | — | Run the agent non-interactively with this task |
| `--session-id <id>` | — | Resume a specific Copilot session or Codex thread |
| `--interactive` | Default when no `--task` | Start an interactive agent session |
| `--verbose` | — | Stream devcontainer setup logs in real time |

### `copilot-sandbox down`

Stops the container and removes the worktree and branch.

| Flag | Default | Description |
|---|---|---|
| `--branch <name>` | *required* | Branch/worktree to tear down |
| `--dir <path>` | Current directory | Path to the git repo |

### `copilot-sandbox list`

Lists all active sandbox worktrees.

| Flag | Default | Description |
|---|---|---|
| `--dir <path>` | Current directory | Path to the git repo |

## MCP Server

The package provides two MCP servers as separate binaries:

- **`copilot-sandbox-mcp`** — Sandbox management, orchestration, and task tracking tools
- **`issue-tracker-mcp`** — Issue tracking tools (create, list, get, update, import)

### Configuration

Running `copilot-sandbox init` configures the MCP server automatically. To manually configure, add to your `mcp-config.json`:

```json
{
  "mcpServers": {
    "copilot-sandbox": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "@cjradek/copilot-sandbox@latest", "copilot-sandbox-mcp"]
    }
  }
}
```

## How It Works

1. **Worktree creation** — Creates a new git worktree and branch from the specified base ref, isolating changes from your main working tree.
2. **Default config** — If no `.devcontainer/devcontainer.json` exists, a default config is created automatically.
3. **Agent installation** — Copilot uses the official devcontainer feature. Codex is installed for the remote user with OpenAI's official `https://chatgpt.com/codex/install.sh` installer.
4. **Auth forwarding** — Copilot receives `GH_TOKEN`. Codex receives `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, or `OPENAI_API_KEY` only when the Codex process is launched; Codex credentials are not exposed to devcontainer setup commands.
5. **Container startup** — Uses the `@devcontainers/cli` to spin up a dev container using the project's `.devcontainer/devcontainer.json`. The main `.git` directory is bind-mounted so git operations work inside the container.
6. **Agent execution** — Runs Copilot or Codex inside the container, either interactively or with a specified task. Codex tasks use `codex exec --sandbox workspace-write`.
7. **Cleanup** — `copilot-sandbox down` stops the container, removes the worktree, and deletes the branch.

### Codex authentication

For non-interactive runs, set `CODEX_API_KEY` (preferred) or `OPENAI_API_KEY` on the host before launching the sandbox. `CODEX_ACCESS_TOKEN` is also supported for eligible enterprise workflows.

For ChatGPT login, start an interactive Codex sandbox and run:

```bash
codex login --device-auth
```

Codex stores that login inside the disposable container. API and access tokens are forwarded only to Codex execution, but commands run by the agent can inherit its environment; use credentials appropriate for an isolated coding-agent environment.

## Development

```bash
npm install
npm run build          # tsc → dist/
npm run dev            # tsc --watch
```

### Project Structure

```
src/
├── agent.ts        # Agent definitions, commands, credentials, and session parsing
├── cli.ts          # CLI entry point & arg parsing
├── container.ts    # Dev container lifecycle (up, exec, down)
├── init.ts         # Project/user initialization (MCP config + agent setup)
├── issue-mcp.ts    # Issue tracker MCP server entry point
├── issue-store.ts  # Issue data store
├── mcp.ts          # Main MCP server entry point (sandbox + orchestration tools)
├── sandbox.ts      # High-level sandbox operations (up, down, exec, list, merge, diff)
├── store.ts        # Orchestration & task data store
└── worktree.ts     # Git worktree management
```

## License

ISC
