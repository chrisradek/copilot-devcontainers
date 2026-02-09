# AGENTS.md

## Project Overview

**copilot-sandbox** is a CLI tool for running coding agents inside isolated dev containers on git worktrees. It creates a disposable sandbox (worktree + dev container) so agents can make changes without modifying the main working tree.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 18+, ESM (`"type": "module"` in package.json)
- **Module resolution:** Node16 (imports require `.js` extensions)
- **Key dependency:** `@devcontainers/cli` — for managing dev container lifecycle
- **No test framework yet** — validate changes by building (`npm run build`)

## Build & Run

```bash
npm install
npm run build          # tsc → dist/
npm run dev            # tsc --watch

# Run the CLI
node dist/cli.js up --dir /path/to/project --task "description"
node dist/cli.js --help
```

There are no tests or linters configured yet. **Always run `npm run build` to verify changes compile.**

## Architecture

```
src/
├── cli.ts          # CLI entry point, arg parsing, command dispatch
├── sandbox.ts      # High-level sandbox operations (up, down, exec, list)
├── container.ts    # Dev container lifecycle (up, exec, down via @devcontainers/cli)
└── worktree.ts     # Git worktree management (create, remove, list)
```

### Key Patterns

- **Worktree isolation:** Each sandbox creates a git worktree with a new branch, keeping the main repo untouched.
- **Auth forwarding:** The host's `gh auth token` is automatically forwarded as `GH_TOKEN` into the container.
- **Git mount:** The main `.git` directory is bind-mounted into the container so git operations work correctly from worktrees.
- **Container lifecycle:** Uses `@devcontainers/cli` for `up` and `exec`. For `down`, it finds containers by Docker label (`devcontainer.local_folder`) and removes them with `docker rm -f`.

## Conventions

- **ESM imports:** Always use `.js` extensions in import paths (e.g., `import { Foo } from "./bar.js"`)
- **No default exports** — use named exports everywhere
- **Output:** Use `process.stderr.write()` for all user-facing messages
- **Error handling:** Functions throw on failure; the CLI catches and reports errors

## Common Pitfalls

- **devcontainer binary resolution:** `getDevcontainerBin()` checks for a local `node_modules/.bin/devcontainer` first, then falls back to global. The local path is relative to the compiled output (`dist/`), not the source.
- **Worktree `.git` file:** Worktrees use a `.git` file (not directory) that points to the main repo. The `resolveWorktreeMainGitDir()` function parses this to find the main `.git` directory for bind-mounting.
- **`--mount-workspace-git-root false`:** This flag is critical — without it, the devcontainer CLI mounts the git root as the workspace, which would be the main repo instead of the worktree.
