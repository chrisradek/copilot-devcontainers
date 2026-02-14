import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

export interface ContainerUpResult {
  outcome: "success" | "error";
  containerId?: string;
  remoteUser?: string;
  remoteWorkspaceFolder?: string;
  message?: string;
}

/**
 * Resolve the path to the devcontainer CLI binary.
 * Prefers a locally installed version, falls back to global.
 */
function getDevcontainerBin(): string {
  // Check for locally installed binary in this package's node_modules
  const localBin = path.resolve(
    import.meta.dirname,
    "../node_modules/.bin/devcontainer",
  );
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  // Fall back to global
  return "devcontainer";
}

/**
 * Get a GitHub token from the host's gh CLI to forward into the container.
 * Returns undefined if gh is not installed or not authenticated.
 */
export function getHostGitHubToken(): string | undefined {
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Verify that the workspace has a devcontainer configuration.
 */
export function hasDevcontainerConfig(workspaceFolder: string): boolean {
  const locations = [
    path.join(workspaceFolder, ".devcontainer", "devcontainer.json"),
    path.join(workspaceFolder, ".devcontainer.json"),
  ];
  return locations.some((loc) => fs.existsSync(loc));
}

const COPILOT_CLI_FEATURE = "ghcr.io/devcontainers/features/copilot-cli:1";
const SAFE_DIRECTORY_CMD = "git config --global --add safe.directory '*'";

/**
 * Strip single-line (//) and multi-line comments from JSONC content,
 * plus trailing commas before } or ], so it can be parsed by JSON.parse().
 */
function stripJsonComments(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;

  while (i < text.length) {
    if (inString) {
      if (text[i] === "\\" && i + 1 < text.length) {
        result += text[i] + text[i + 1];
        i += 2;
      } else {
        if (text[i] === '"') inString = false;
        result += text[i++];
      }
    } else if (text[i] === '"') {
      inString = true;
      result += text[i++];
    } else if (text[i] === "/" && text[i + 1] === "/") {
      // Skip to end of line
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += text[i++];
    }
  }

  // Remove trailing commas before } or ]
  return result.replace(/,\s*([}\]])/g, "$1");
}

/**
 * Ensure the devcontainer config includes the copilot CLI feature and
 * marks all directories as safe for git. Modifies the config in-place
 * (the worktree is a disposable branch, so this won't affect the main repo).
 */
export function ensureCopilotFeature(workspaceFolder: string): void {
  const locations = [
    path.join(workspaceFolder, ".devcontainer", "devcontainer.json"),
    path.join(workspaceFolder, ".devcontainer.json"),
  ];

  const configPath = locations.find((loc) => fs.existsSync(loc));
  if (!configPath) return;

  const raw = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(stripJsonComments(raw));

  let modified = false;

  // Add copilot-cli feature if not present
  if (!config.features) {
    config.features = {};
  }
  if (!config.features[COPILOT_CLI_FEATURE]) {
    config.features[COPILOT_CLI_FEATURE] = {};
    modified = true;
  }

  // Ensure git safe.directory is configured via postCreateCommand
  const existing = config.postCreateCommand;
  if (!existing) {
    config.postCreateCommand = SAFE_DIRECTORY_CMD;
    modified = true;
  } else if (typeof existing === "string") {
    if (!existing.includes("safe.directory")) {
      config.postCreateCommand = `${existing} && ${SAFE_DIRECTORY_CMD}`;
      modified = true;
    }
  } else if (Array.isArray(existing)) {
    if (!existing.some((c: string) => c.includes("safe.directory"))) {
      config.postCreateCommand = {
        "original": existing,
        "_copilot_safe_dir": SAFE_DIRECTORY_CMD,
      };
      modified = true;
    }
  } else if (typeof existing === "object") {
    const values = Object.values(existing as Record<string, unknown>);
    const hasSafeDir = values.some((v) =>
      typeof v === "string" ? v.includes("safe.directory") : false,
    );
    if (!hasSafeDir) {
      (existing as Record<string, string>)["_copilot_safe_dir"] = SAFE_DIRECTORY_CMD;
      modified = true;
    }
  }

  // Remove docker.sock bind mounts — the host socket may not be accessible
  // (e.g. rootful podman) and docker-in-docker provides its own daemon.
  if (Array.isArray(config.mounts)) {
    const filtered = config.mounts.filter((m: unknown) => {
      const str = typeof m === "string" ? m : typeof m === "object" && m !== null ? (m as Record<string, string>).source ?? "" : "";
      return !str.includes("docker.sock");
    });
    if (filtered.length !== config.mounts.length) {
      config.mounts = filtered;
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, "\t") + "\n", "utf-8");
  }
}

/**
 * Resolve the main .git directory for a worktree.
 * Returns undefined if not a worktree (i.e. regular repo with .git directory).
 */
export function resolveWorktreeMainGitDir(workspaceFolder: string): string | undefined {
  const dotGitPath = path.join(workspaceFolder, ".git");
  try {
    const stat = fs.statSync(dotGitPath);
    if (stat.isDirectory()) return undefined;
  } catch {
    return undefined;
  }

  const content = fs.readFileSync(dotGitPath, "utf-8").trim();
  const match = content.match(/^gitdir:\s*(.+)$/);
  if (!match) return undefined;

  const worktreeGitDir = path.resolve(workspaceFolder, match[1]);

  const commondirPath = path.join(worktreeGitDir, "commondir");
  try {
    const commondir = fs.readFileSync(commondirPath, "utf-8").trim();
    return path.resolve(worktreeGitDir, commondir);
  } catch {
    return undefined;
  }
}

export interface ContainerUpOptions {
  verbose?: boolean;
}

/**
 * Start a dev container for the given workspace folder.
 */
export async function containerUp(
  workspaceFolder: string,
  remoteEnvs?: Record<string, string>,
  options?: ContainerUpOptions,
): Promise<ContainerUpResult> {
  const bin = getDevcontainerBin();
  const args = [
    "up",
    "--workspace-folder",
    workspaceFolder,
    "--log-format",
    "json",
    // Don't mount the git root as workspace — keep the worktree as the workspace
    // so that exec resolves the correct working directory.
    "--mount-workspace-git-root",
    "false",
  ];

  // Mount the main .git directory so git operations work inside the container.
  // The worktree's .git file uses relative paths that resolve correctly when
  // the main .git dir is mounted at the matching container path.
  const mainGitDir = resolveWorktreeMainGitDir(workspaceFolder);
  if (mainGitDir) {
    const containerGitDir = path.posix.join(
      "/workspaces",
      path.relative(path.resolve(workspaceFolder, ".."), mainGitDir),
    );
    args.push(
      "--mount",
      `type=bind,source=${mainGitDir},target=${containerGitDir}`,
    );
  }

  if (remoteEnvs) {
    for (const [key, value] of Object.entries(remoteEnvs)) {
      args.push("--remote-env", `${key}=${value}`);
    }
  }

  const output = await execDevcontainer(bin, args, options?.verbose);

  // The last JSON line with "outcome" is the result
  const lines = output.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed.outcome) {
        return parsed as ContainerUpResult;
      }
    } catch {
      // Not JSON, skip
    }
  }

  throw new Error(`Failed to parse devcontainer up output:\n${output}`);
}

/**
 * Execute a command inside a running dev container (non-interactive).
 * Returns the exit code.
 */
export async function containerExec(
  workspaceFolder: string,
  cmd: string[],
  remoteEnvs?: Record<string, string>,
): Promise<number> {
  const bin = getDevcontainerBin();
  const args = [
    "exec",
    "--workspace-folder",
    workspaceFolder,
  ];

  if (remoteEnvs) {
    for (const [key, value] of Object.entries(remoteEnvs)) {
      args.push("--remote-env", `${key}=${value}`);
    }
  }

  args.push(...cmd);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: "inherit",
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to exec in container: ${err.message}`));
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

/**
 * Execute a command inside a running dev container (interactive, with TTY).
 * Returns the child process so the caller can manage it.
 */
export function containerExecInteractive(
  workspaceFolder: string,
  cmd: string[],
  remoteEnvs?: Record<string, string>,
): ChildProcess {
  const bin = getDevcontainerBin();
  const args = [
    "exec",
    "--workspace-folder",
    workspaceFolder,
  ];

  if (remoteEnvs) {
    for (const [key, value] of Object.entries(remoteEnvs)) {
      args.push("--remote-env", `${key}=${value}`);
    }
  }

  args.push(...cmd);

  return spawn(bin, args, {
    stdio: "inherit",
  });
}

/**
 * Stop and remove a dev container for the given workspace folder.
 */
export async function containerDown(
  workspaceFolder: string,
): Promise<void> {
  const containerId = await findContainerForWorkspace(workspaceFolder);
  if (containerId) {
    await execCommand("docker", ["rm", "-f", containerId]);
  }
}

/**
 * Find a running container associated with a workspace folder.
 */
async function findContainerForWorkspace(
  workspaceFolder: string,
): Promise<string | undefined> {
  try {
    const absPath = path.resolve(workspaceFolder);
    // Devcontainers label containers with the workspace folder
    const output = await execCommand("docker", [
      "ps",
      "-a",
      "--filter",
      `label=devcontainer.local_folder=${absPath}`,
      "--format",
      "{{.ID}}",
    ]);
    const id = output.trim().split("\n")[0];
    return id || undefined;
  } catch {
    return undefined;
  }
}

function execDevcontainer(bin: string, args: string[], verbose?: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: string[] = [];

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      chunks.push(line);
      if (verbose) {
        try {
          const parsed = JSON.parse(line);
          if (typeof parsed.text === "string") {
            process.stderr.write(parsed.text);
          }
        } catch {
          process.stderr.write(line + "\n");
        }
      }
    });

    let stderrData = "";
    child.stderr.on("data", (data: Buffer) => {
      stderrData += data.toString();
      if (verbose) {
        process.stderr.write(data);
      }
    });

    child.on("error", (err) => {
      reject(new Error(`devcontainer ${args[0]} failed: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`devcontainer ${args[0]} failed: ${stderrData || `exit code ${code}`}`));
      } else {
        resolve(chunks.join("\n"));
      }
    });
  });
}

function execCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf-8" }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}
