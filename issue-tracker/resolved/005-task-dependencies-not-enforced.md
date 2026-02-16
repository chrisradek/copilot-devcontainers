# Task Dependencies Are Not Enforced

**Priority:** Medium
**Category:** Task Tracking

## Problem

The `task_create` tool accepts a `dependencies` array of task IDs, but these dependencies are purely informational. Nothing prevents the orchestrator from:

- Starting a dependent task before its dependencies are complete
- Merging a task whose dependencies haven't been merged yet
- Creating a sandbox for a task with unmet dependencies

In my orchestration, `task-4-update-docs` declared dependencies on tasks 1, 2, and 3. But there was no enforcement — I could have started it immediately. The orchestrator must manually track and respect dependencies.

## Impact

- Easy to accidentally start work that depends on unmerged changes
- Dependency tracking is aspirational rather than functional
- Could lead to subtle bugs where a sandbox agent works against an outdated codebase

## Workaround Used

Manually ensured tasks 1-3 were merged before creating the sandbox for task 4. This worked fine for a small orchestration but would be error-prone at scale.

## Suggestions

1. **Warn on dependency violations** — if `sandbox_up` or `sandbox_exec` is called for a task with pending dependencies, return a warning (not a hard block, since the orchestrator might have good reasons).
2. **Add a `ready_tasks` query** — `task_list` with a filter for tasks whose dependencies are all `done`, making it easy to find what to work on next.
3. **Block `sandbox_merge` for unmet dependencies** — this is the most important enforcement point. Merging a task before its dependencies are merged could cause real problems.

## Resolution

**Status:** Resolved
**Date:** 2026-02-16T21:13:46.822Z

Added getUnmetDependencies and findTaskByBranch to OrchestratorStore. sandbox_merge warns about unmet dependencies. task_list supports a ready filter for tasks with all deps done.

**Tasks:** task-dependency-enforcement
