import { describe, expect, it } from "vitest";
import {
  buildAgentTaskCommand,
  getAgentCommand,
  isAgentType,
} from "../src/agent.js";

describe("agent", () => {
  it("recognizes supported agents", () => {
    expect(isAgentType("copilot")).toBe(true);
    expect(isAgentType("claude")).toBe(true);
    expect(isAgentType("other")).toBe(false);
    expect(isAgentType(undefined)).toBe(false);
  });

  it("builds the existing Copilot task command", () => {
    expect(buildAgentTaskCommand("copilot", "Fix a bug", "session-1", false)).toEqual([
      "copilot",
      "-p",
      "Fix a bug",
      "--resume=session-1",
      "--allow-all",
      "--no-ask-user",
    ]);
  });

  it("starts Claude Code tasks with a new session ID", () => {
    expect(buildAgentTaskCommand("claude", "Fix a bug", "session-1", false)).toEqual([
      "claude",
      "-p",
      "Fix a bug",
      "--session-id",
      "session-1",
      "--dangerously-skip-permissions",
    ]);
  });

  it("resumes Claude Code tasks when a session ID is provided", () => {
    expect(buildAgentTaskCommand("claude", "Continue work", "session-1", true)).toEqual([
      "claude",
      "-p",
      "Continue work",
      "--resume",
      "session-1",
      "--dangerously-skip-permissions",
    ]);
  });

  it("returns the interactive command for each agent", () => {
    expect(getAgentCommand("copilot")).toBe("copilot");
    expect(getAgentCommand("claude")).toBe("claude");
  });
});
