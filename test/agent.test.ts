import { describe, expect, it } from "vitest";
import {
  getAgentDefinition,
  getAgentExecutionEnvs,
  isAgentName,
} from "../src/agent.js";

describe("agent providers", () => {
  it("recognizes supported agent names", () => {
    expect(isAgentName("copilot")).toBe(true);
    expect(isAgentName("codex")).toBe(true);
    expect(isAgentName("other")).toBe(false);
  });

  it("builds the existing Copilot task command", () => {
    expect(
      getAgentDefinition("copilot").buildTaskCommand("Fix tests", "session-1"),
    ).toEqual([
      "copilot",
      "-p",
      "Fix tests",
      "--resume=session-1",
      "--allow-all",
      "--no-ask-user",
    ]);
  });

  it("builds new and resumed Codex task commands", () => {
    const codex = getAgentDefinition("codex");
    expect(codex.buildTaskCommand("Fix tests")).toEqual([
      "sh",
      "-lc",
      'exec "$HOME/.local/bin/codex" "$@"',
      "codex",
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "Fix tests",
    ]);
    expect(codex.buildTaskCommand("Continue", "thread-1")).toContain("resume");
    expect(codex.buildTaskCommand("Continue", "thread-1")).toContain("thread-1");
  });

  it("extracts Codex thread IDs from JSONL output", () => {
    const codex = getAgentDefinition("codex");
    expect(codex.parseSessionId(
      '{"type":"thread.started","thread_id":"thread-1"}',
    )).toBe("thread-1");
    expect(codex.parseSessionId("diagnostic output")).toBeUndefined();
  });

  it("forwards Codex credentials only for Codex execution", () => {
    const hostEnv = {
      OPENAI_API_KEY: "openai-key",
      CODEX_ACCESS_TOKEN: "access-token",
    };
    expect(getAgentExecutionEnvs("copilot", hostEnv)).toEqual({});
    expect(getAgentExecutionEnvs("codex", hostEnv)).toEqual({
      CODEX_API_KEY: "openai-key",
      CODEX_ACCESS_TOKEN: "access-token",
    });
  });
});
