# copilot-sandbox

A standalone CLI tool for running Copilot CLI or Claude Code inside isolated dev containers on git worktrees. This keeps agents from modifying your main working tree — all changes happen in a disposable worktree+container sandbox.

## Prerequisites

- **Git**
- **Node.js** 18+
- **Docker** installed and running
- **GitHub CLI** (`gh`) installed and authenticated (for automatic token forwarding)
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
# Spin up a sandbox with an interactive copilot session
copilot-sandbox up --dir /path/to/your/project

# Or run a non-interactive task
copilot-sandbox up --dir /path/to/your/project --task "Fix the login bug"

# Start Claude Code instead of the default Copilot CLI
copilot-sandbox up --dir /path/to/your/project --agent claude

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

Creates a git worktree, starts a dev container, and runs the selected coding agent inside it. Copilot CLI is the default.

| Flag | Default | Description |
|---|---|---|
| `--agent <copilot\|claude>` | `copilot` | Coding agent to install and run |
| `--branch <name>` | Auto-generated (`sandbox/<timestamp>`) | Branch name for the worktree |
| `--base <ref>` | `HEAD` | Base ref to branch from |
| `--dir <path>` | Current directory | Path to the git repo |
| `--task <description>` | — | Run copilot non-interactively with this task |
| `--interactive` | Default when no `--task` | Start an interactive copilot session |
| `--worktree-dir <path>` | `../<repo>-worktrees/` | Where to create worktrees |
| `--verbose` | — | Stream devcontainer setup logs in real time |

### `copilot-sandbox exec`

Reconnects to an existing sandbox (ensures the container is running, then launches the saved agent). Existing sandboxes created before agent selection default to Copilot.

| Flag | Default | Description |
|---|---|---|
| `--agent <copilot\|claude>` | Saved agent | Override the sandbox's saved agent |
| `--branch <name>` | *required* | Branch/worktree to reconnect to |
| `--dir <path>` | Current directory | Path to the git repo |
| `--task <description>` | — | Run copilot non-interactively with this task |
| `--session-id <id>` | — | Resume a specific agent session by ID |
| `--interactive` | Default when no `--task` | Start an interactive copilot session |
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
3. **Agent setup** — Adds the selected agent's Dev Container Feature to the sandbox worktree. Claude Code uses Anthropic's `ghcr.io/anthropics/devcontainer-features/claude-code:1.0` feature; Copilot CLI remains the default.
4. **Auth forwarding** — Passes the host's `gh auth token` into the container as `GH_TOKEN`. If `ANTHROPIC_API_KEY` is set on the host, it is also passed to the container; otherwise, authenticate Claude Code inside the container.
5. **Container startup** — Uses the `@devcontainers/cli` to spin up a dev container using the project's `.devcontainer/devcontainer.json`. The main `.git` directory is bind-mounted so git operations work inside the container.
6. **Agent execution** — Runs Copilot CLI or Claude Code inside the container, either interactively or with a specified task. Selected agent is saved per sandbox and reused by `exec`.
7. **Cleanup** — `copilot-sandbox down` stops the container, removes the worktree, and deletes the branch.

**Automation permissions:** Non-interactive Claude Code tasks use `--dangerously-skip-permissions`, matching the autonomous behavior of Copilot's `--allow-all`. Only use this with repositories and tasks you trust; Claude Code's dev container does not prevent access to secrets available inside the container.

## Development

```bash
npm install
npm run build          # tsc → dist/
npm run dev            # tsc --watch
```

### Project Structure

```
src/
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
