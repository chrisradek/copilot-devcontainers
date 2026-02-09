# copilot-sandbox

A standalone CLI tool for running coding agents inside isolated dev containers on git worktrees. This keeps agents from modifying your main working tree — all changes happen in a disposable worktree+container sandbox.

## Prerequisites

- **Git** 2.45.0+ (required for `--relative-paths` worktree support)
- **Node.js** 18+
- **Docker** installed and running
- **GitHub CLI** (`gh`) installed and authenticated (for automatic token forwarding)
- A **`.devcontainer/devcontainer.json`** in the target project

## Installation

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

# Reconnect to an existing sandbox
copilot-sandbox exec --branch sandbox/2026-02-07T04-30-00

# List active sandboxes
copilot-sandbox list

# Tear down a sandbox when done
copilot-sandbox down --branch sandbox/2026-02-07T04-30-00
```

## Commands

### `copilot-sandbox up`

Creates a git worktree, starts a dev container, and runs `copilot` inside it.

| Flag | Default | Description |
|---|---|---|
| `--branch <name>` | Auto-generated (`sandbox/<timestamp>`) | Branch name for the worktree |
| `--base <ref>` | `HEAD` | Base ref to branch from |
| `--dir <path>` | Current directory | Path to the git repo |
| `--task <description>` | — | Run copilot non-interactively with this task |
| `--interactive` | Default when no `--task` | Start an interactive copilot session |
| `--worktree-dir <path>` | `../<repo>-worktrees/` | Where to create worktrees |

### `copilot-sandbox exec`

Reconnects to an existing sandbox (ensures container is running, then launches copilot).

| Flag | Default | Description |
|---|---|---|
| `--branch <name>` | *required* | Branch/worktree to reconnect to |
| `--dir <path>` | Current directory | Path to the git repo |
| `--task <description>` | — | Run copilot non-interactively with this task |
| `--interactive` | Default when no `--task` | Start an interactive copilot session |

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

## How It Works

1. **Worktree creation** — Creates a new git worktree and branch from the specified base ref, isolating changes from your main working tree.
2. **Auth forwarding** — Automatically runs `gh auth token` on the host and passes the token as `GH_TOKEN` into the container, so copilot is pre-authenticated.
3. **Container startup** — Uses the `@devcontainers/cli` to spin up a dev container using the project's `.devcontainer/devcontainer.json`. The main `.git` directory is bind-mounted so git operations work inside the container.
4. **Agent execution** — Runs `copilot` inside the container, either interactively or with a specified task.
5. **Cleanup** — `copilot-sandbox down` stops the container, removes the worktree, and deletes the branch.

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
├── sandbox.ts      # High-level sandbox operations (up, down, exec, list)
├── container.ts    # Dev container lifecycle (up, exec, down via @devcontainers/cli)
└── worktree.ts     # Git worktree management
```

## License

ISC
