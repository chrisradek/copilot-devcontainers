export const AGENT_NAMES = ["copilot", "codex"] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export interface AgentDefinition {
  name: AgentName;
  displayName: string;
  buildInteractiveCommand(sessionId?: string): string[];
  buildTaskCommand(task: string, sessionId?: string): string[];
  parseSessionId(line: string): string | undefined;
}

function buildCopilotTaskCommand(task: string, sessionId?: string): string[] {
  if (!sessionId) {
    throw new Error("A session ID is required to run a Copilot task.");
  }

  return [
    "copilot",
    "-p",
    task,
    `--resume=${sessionId}`,
    "--allow-all",
    "--no-ask-user",
  ];
}

function buildCodexCommand(args: string[]): string[] {
  return [
    "sh",
    "-lc",
    'exec "$HOME/.local/bin/codex" "$@"',
    "codex",
    ...args,
  ];
}

function buildCodexTaskCommand(task: string, sessionId?: string): string[] {
  const args = [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
  ];

  if (sessionId) {
    args.push("resume", sessionId);
  }

  args.push(task);
  return buildCodexCommand(args);
}

function parseCodexSessionId(line: string): string | undefined {
  try {
    const event = JSON.parse(line) as {
      type?: unknown;
      thread_id?: unknown;
    };
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      return event.thread_id;
    }
  } catch {
    // Codex may emit human-readable diagnostics alongside JSONL events.
  }
  return undefined;
}

const AGENTS: Record<AgentName, AgentDefinition> = {
  copilot: {
    name: "copilot",
    displayName: "Copilot",
    buildInteractiveCommand: (sessionId) => (
      sessionId ? ["copilot", `--resume=${sessionId}`] : ["copilot"]
    ),
    buildTaskCommand: buildCopilotTaskCommand,
    parseSessionId: () => undefined,
  },
  codex: {
    name: "codex",
    displayName: "Codex",
    buildInteractiveCommand: (sessionId) => buildCodexCommand(
      sessionId ? ["resume", sessionId] : [],
    ),
    buildTaskCommand: buildCodexTaskCommand,
    parseSessionId: parseCodexSessionId,
  },
};

export function isAgentName(value: string): value is AgentName {
  return AGENT_NAMES.includes(value as AgentName);
}

export function getAgentDefinition(name: AgentName): AgentDefinition {
  return AGENTS[name];
}

export function getAgentExecutionEnvs(
  agent: AgentName,
  hostEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (agent !== "codex") {
    return {};
  }

  const remoteEnvs: Record<string, string> = {};
  const apiKey = hostEnv.CODEX_API_KEY ?? hostEnv.OPENAI_API_KEY;
  if (apiKey) {
    remoteEnvs.CODEX_API_KEY = apiKey;
  }
  if (hostEnv.CODEX_ACCESS_TOKEN) {
    remoteEnvs.CODEX_ACCESS_TOKEN = hostEnv.CODEX_ACCESS_TOKEN;
  }
  return remoteEnvs;
}
