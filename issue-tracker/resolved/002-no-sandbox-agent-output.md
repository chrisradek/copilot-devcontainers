# Cannot Read Sandbox Agent Output

**Priority:** High
**Category:** Observability

## Problem

When `sandbox_exec` completes, the only information returned is:

```
Copilot finished in sandbox "activate-diff-scorer".
Worktree: /home/cjradek/.../activate-diff-scorer
Exit code: 0
Session ID: 075a3d01-...
```

There is no way to see:
- What the agent actually did
- Whether tests passed
- What files were modified
- Any warnings or issues the agent encountered
- The agent's final summary or response

The orchestrator is effectively flying blind. A successful exit code doesn't mean the agent did the right thing — it just means it didn't crash.

## Impact

- Forces the orchestrator to always run a separate review step just to discover what happened
- Review agents must redundantly re-discover the work by running `git log` and `git diff`
- If the agent partially completed the task or made incorrect assumptions, the orchestrator has no signal until after the review
- Debugging failures requires spinning up another sandbox_exec just to inspect state

## Workaround Used

Relied entirely on the code review step (separate `sandbox_exec` with a new session) to understand what each agent did. This works but doubles the number of `sandbox_exec` calls.

## Suggestions

1. **Return the agent's final message** in the `sandbox_exec` response — even a truncated version (last 2000 chars) would be invaluable.
2. **Return a structured summary** — files changed, tests run (pass/fail), commits made, any errors encountered.
3. **Add `sandbox_log`** — a tool to retrieve the full conversation log from a completed session.
4. **Add `sandbox_status`** — show what files were modified, what commits exist, test results if available.

## Resolution

**Status:** Resolved
**Date:** 2026-02-16T21:13:46.819Z

sandbox_exec now captures and returns the last 50 lines of agent output in its response, using a ring buffer in createOutputNotifier.

**Tasks:** task-return-output
