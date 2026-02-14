#!/usr/bin/env node

import * as path from "node:path";
import { sandboxUp, sandboxDown, sandboxList, sandboxExec } from "./sandbox.js";

function printUsage(): void {
  process.stderr.write(`
Usage: copilot-sandbox <command> [options]

Commands:
  up      Create a sandbox (worktree + dev container) and run copilot
  exec    Reconnect to an existing sandbox and run copilot
  down    Tear down a sandbox (stop container, remove worktree)
  list    List active sandboxes

Options for 'up':
  --branch <name>        Branch name for the worktree (default: auto-generated)
  --base <ref>           Base ref to branch from (default: HEAD)
  --dir <path>           Path to the git repo (default: cwd)
  --task <description>   Run copilot non-interactively with this task
  --interactive          Start an interactive copilot session (default)
  --worktree-dir <path>  Where to create worktrees (default: ../<repo>-worktrees/)
  --verbose              Stream devcontainer setup logs in real time

Options for 'exec':
  --branch <name>        Branch/worktree to reconnect to (required)
  --dir <path>           Path to the git repo (default: cwd)
  --task <description>   Run copilot non-interactively with this task
  --interactive          Start an interactive copilot session (default)
  --verbose              Stream devcontainer setup logs in real time

Options for 'down':
  --branch <name>        Branch/worktree to tear down (required)
  --dir <path>           Path to the git repo (default: cwd)

Options for 'list':
  --dir <path>           Path to the git repo (default: cwd)

Examples:
  copilot-sandbox up --task "Fix the login bug"
  copilot-sandbox up --branch feature/new-api --base main --interactive
  copilot-sandbox exec --branch sandbox/2026-02-07T04-30-00
  copilot-sandbox list
  copilot-sandbox down --branch sandbox/2026-02-07T04-30-00
`);
}

interface UpArgs {
  command: "up";
  branch?: string;
  base: string;
  dir: string;
  task?: string;
  interactive: boolean;
  worktreeDir?: string;
  verbose: boolean;
}

interface DownArgs {
  command: "down";
  branch: string;
  dir: string;
}

interface ExecArgs {
  command: "exec";
  branch: string;
  dir: string;
  task?: string;
  interactive: boolean;
  verbose: boolean;
}

interface ListArgs {
  command: "list";
  dir: string;
}

type ParsedArgs = UpArgs | DownArgs | ExecArgs | ListArgs | { command: "help" };

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    return { command: "help" };
  }

  const command = args[0];
  const flags = args.slice(1);

  // Parse flags into a map
  const flagMap = new Map<string, string>();
  const boolFlags = new Set<string>();

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === "--interactive") {
      boolFlags.add("interactive");
    } else if (flag === "--verbose") {
      boolFlags.add("verbose");
    } else if (flag.startsWith("--") && i + 1 < flags.length) {
      flagMap.set(flag.slice(2), flags[++i]);
    } else if (flag === "-h" || flag === "--help") {
      return { command: "help" };
    }
  }

  const dir = flagMap.get("dir") ?? process.cwd();

  switch (command) {
    case "up":
      return {
        command: "up",
        branch: flagMap.get("branch"),
        base: flagMap.get("base") ?? "HEAD",
        dir: path.resolve(dir),
        task: flagMap.get("task"),
        interactive: boolFlags.has("interactive") || !flagMap.has("task"),
        worktreeDir: flagMap.get("worktree-dir")
          ? path.resolve(flagMap.get("worktree-dir")!)
          : undefined,
        verbose: boolFlags.has("verbose"),
      };
    case "down": {
      const branch = flagMap.get("branch");
      if (!branch) {
        process.stderr.write("Error: --branch is required for 'down'\n");
        process.exit(1);
      }
      return {
        command: "down",
        branch,
        dir: path.resolve(dir),
      };
    }
    case "exec": {
      const branch = flagMap.get("branch");
      if (!branch) {
        process.stderr.write("Error: --branch is required for 'exec'\n");
        process.exit(1);
      }
      return {
        command: "exec",
        branch,
        dir: path.resolve(dir),
        task: flagMap.get("task"),
        interactive: boolFlags.has("interactive") || !flagMap.has("task"),
        verbose: boolFlags.has("verbose"),
      };
    }
    case "list":
      return {
        command: "list",
        dir: path.resolve(dir),
      };
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      return { command: "help" };
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  switch (parsed.command) {
    case "help":
      printUsage();
      process.exit(0);
      break;

    case "up":
      await sandboxUp({
        dir: parsed.dir,
        branch: parsed.branch,
        base: parsed.base,
        worktreeDir: parsed.worktreeDir,
        task: parsed.task,
        interactive: parsed.interactive,
        verbose: parsed.verbose,
      });
      break;

    case "down":
      await sandboxDown({
        dir: parsed.dir,
        branch: parsed.branch,
      });
      break;

    case "exec":
      await sandboxExec({
        dir: parsed.dir,
        branch: parsed.branch,
        task: parsed.task,
        interactive: parsed.interactive,
        verbose: parsed.verbose,
      });
      break;

    case "list":
      await sandboxList(parsed.dir);
      break;
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
