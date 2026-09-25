export type AgentType = "copilot" | "claude";

export const DEFAULT_AGENT: AgentType = "copilot";

export function isAgentType(value: unknown): value is AgentType {
  return value === "copilot" || value === "claude";
}

export function getAgentCommand(agent: AgentType): string {
  return agent === "claude" ? "claude" : "copilot";
}

export function buildAgentTaskCommand(
  agent: AgentType,
  task: string,
  sessionId: string,
  resume: boolean,
): string[] {
  if (agent === "claude") {
    return [
      "claude",
      "-p",
      task,
      ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
      "--dangerously-skip-permissions",
    ];
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
