# Feature Request: Combined Execute + Review Workflow

**Priority:** Medium
**Category:** Workflow Optimization

## Problem

Every sandbox task follows the same pattern:

1. `generate_session_id` → implementation session
2. `sandbox_exec` with implementation task
3. `generate_session_id` → review session
4. `sandbox_exec` with review task
5. `task_update` with review session ID
6. If issues found → fix → re-review
7. `sandbox_merge`

Steps 3-5 are identical every single time. The review prompt is nearly the same across all tasks. This is boilerplate that the orchestrator must repeat for every subtask.

## Impact

- Adds 2-3 extra tool calls per subtask (session ID + exec + task update)
- The review prompt is formulaic — same instructions every time with minor variations
- Increases orchestration complexity and the chance of forgetting the review step

## Suggestion

Add a `sandbox_exec_and_review` tool that:

1. Runs the implementation task with a generated session ID
2. Automatically runs a code review with a separate session ID
3. Returns both the implementation result and review result
4. Optionally auto-fixes and re-reviews if issues are found (with a max retry count)

```
sandbox_exec_and_review(
  branch: "fix-login",
  dir: "/repo",
  task: "Fix the login validation...",
  review_focus: "correctness, security",  # optional
  max_fix_cycles: 2  # optional, default 1
)
```

This would reduce 5+ tool calls to 1 for the common case.
