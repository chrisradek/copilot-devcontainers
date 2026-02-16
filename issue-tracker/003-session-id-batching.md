# Session ID Generation Cannot Be Batched

**Priority:** Low
**Category:** Ergonomics

## Problem

`generate_session_id` returns a single UUID per call. When creating multiple sandboxes in parallel (a common pattern), the orchestrator needs one session ID per sandbox, requiring N sequential calls before it can start delegating work.

In practice, when spinning up 3 parallel sandboxes, the flow is:

```
generate_session_id → id1
generate_session_id → id2
generate_session_id → id3
```

This adds 2 extra round-trips that provide no value — they're just UUID generation.

## Workaround Used

Called `generate_session_id` three separate times. The calls are fast but add latency to the orchestration startup.

## Suggestions

1. **Add a `count` parameter** to `generate_session_id` — `generate_session_ids(count=3)` returns an array of UUIDs.
2. **Auto-generate session IDs** — if `sandbox_exec` is called without a `sessionId`, generate one automatically and return it in the response. The orchestrator can then use it for subsequent calls on the same sandbox.
3. **Return session ID from `sandbox_up`** — since every sandbox needs a session ID, generate one at creation time and include it in the response.
