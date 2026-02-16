# Merge Conflict Recovery Is Fragile

**Priority:** High
**Category:** Sandbox Lifecycle

## Problem

When `sandbox_merge` encounters a rebase conflict, the worktree is cleaned up but the branch persists in a broken rebase state. There is no way to re-attach to the branch or resume the rebase — the worktree is gone but the branch still exists, leaving the orchestrator stuck.

## Reproduction

1. Create two sandboxes that modify the same file (e.g., `tests/test_scorers.py`)
2. Merge the first sandbox successfully
3. Attempt `sandbox_merge` on the second sandbox — it reports conflicts
4. The worktree is removed, but the branch `add-human-eval` still exists
5. Attempting `sandbox_up` with the same branch name fails: `fatal: a branch named 'add-human-eval' already exists`
6. No way to resume the in-progress rebase

## Workaround Used

Created a new branch (`add-human-eval-v2`) based on the original branch, then had the sandbox agent manually run `git rebase main` and resolve conflicts. This required:
- A new `sandbox_up` with a different branch name and `base` set to the old branch
- A new `generate_session_id`
- A full `sandbox_exec` just to do `git rebase main` + conflict resolution
- Then `sandbox_merge` on the new branch

This is clunky and error-prone — I had to do it twice (once for `add-human-eval`, once for `add-grading-notes`).

## Suggestions

1. **Don't remove the worktree on conflict.** Keep the worktree alive so the orchestrator can use `sandbox_exec` on the original branch to resolve conflicts and then `git rebase --continue`.
2. **Add `sandbox_reattach`** — allow re-creating a worktree for an existing branch that lost its worktree.
3. **Add `sandbox_resolve_conflicts`** — a higher-level tool that takes a branch with an in-progress rebase, spins up a sandbox, and lets an agent resolve it.
4. **Clean up orphaned branches** — after the workaround, stale branches like `add-human-eval` and `add-grading-notes` remain. See issue #006.

## Resolution

**Status:** Resolved
**Date:** 2026-02-16T20:55:50.134Z

Already fixed in current code. sandboxMergeCore returns { success: false, conflictFiles } on conflict without removing the worktree or branch, allowing the agent to resolve conflicts and retry.
