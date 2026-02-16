# No Async Execution or Progress Monitoring for sandbox_exec

**Priority:** Medium
**Category:** Sandbox Lifecycle

## Problem

`sandbox_exec` is fully synchronous — the orchestrator blocks until the agent finishes. There is no way to:

- Check if a sandbox agent is still working vs. stuck in a loop
- Set a timeout on agent execution
- Run multiple sandbox agents concurrently (the tool calls happen in parallel, but there's no way to monitor individual progress)
- Cancel a sandbox agent that's taking too long

For complex tasks that may take several minutes, the orchestrator has no visibility into progress.

## Impact

- If an agent gets stuck or enters an infinite loop, the orchestrator waits indefinitely
- No ability to implement a "check on the slowest agent" pattern
- Can't provide progress updates to the user during long-running orchestrations

## Workaround Used

Relied on the parallel tool-calling behavior — all 3 `sandbox_exec` calls were made simultaneously and all completed before the orchestrator received results. This works for the happy path but provides no ability to handle hangs or check progress.

## Suggestions

1. **Add a `timeout` parameter** to `sandbox_exec` — fail the execution if the agent doesn't complete within the specified time.
2. **Add a non-blocking mode** — `sandbox_exec` returns immediately with a handle, and a separate `sandbox_poll` or `sandbox_wait` tool checks for completion.
3. **Add `sandbox_status`** — show the current state of a running sandbox (idle, executing, completed, failed).
