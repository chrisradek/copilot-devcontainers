# Feature Request: sandbox_diff Tool

**Priority:** Low
**Category:** Observability

## Problem

To see what changed in a sandbox, the orchestrator must spin up a full `sandbox_exec` with a review agent that runs `git diff`. This is heavyweight for what is essentially a read-only query.

Common scenarios where a quick diff would help:
- Spot-checking a sandbox's changes before deciding whether to do a full review
- Debugging why a merge conflict occurred
- Verifying that a conflict resolution was done correctly
- Generating a summary of changes for the user

## Workaround Used

Used `sandbox_exec` with a review agent every time. This works but is overkill for "just show me the diff."

## Suggestion

Add a `sandbox_diff` tool:

```
sandbox_diff(
  branch: "fix-login",
  dir: "/repo",
  base: "main"  # optional, defaults to parent branch
)
```

Returns:
- List of files changed
- Number of additions/deletions
- Optionally the full diff content (with a size limit)

This would be a lightweight, read-only operation that doesn't require spinning up an agent.
