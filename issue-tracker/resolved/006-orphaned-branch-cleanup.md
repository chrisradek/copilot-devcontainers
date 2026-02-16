# No Cleanup for Orphaned Branches

**Priority:** Low
**Category:** Sandbox Lifecycle

## Problem

After the merge conflict workaround (see issue #001), orphaned branches remain in the repository:

- `add-human-eval` — original branch, rebase was in-progress when worktree was removed
- `add-grading-notes` — same situation

These branches serve no purpose but can't be cleaned up through the sandbox tools. `sandbox_down` requires an active worktree, and `sandbox_list` only shows active sandboxes.

Over time, repeated orchestrations with conflict recoveries would accumulate many orphaned branches.

## Workaround Used

None — the branches are still sitting there. Manual `git branch -D` cleanup would be needed outside the sandbox tools.

## Suggestions

1. **Add `sandbox_cleanup`** — a tool that lists and optionally deletes branches that have no associated worktree and are not the current branch.
2. **Clean up branches on conflict** — when `sandbox_merge` fails with conflicts, either keep the worktree alive (preferred, see #001) or clean up both the worktree AND the branch.
3. **Add branch cleanup to `sandbox_down`** — allow `sandbox_down --branch <name> --force` to delete a branch even without an active worktree.

## Resolution

**Status:** Resolved
**Date:** 2026-02-16T21:13:46.828Z

Added sandbox_cleanup MCP tool that finds and deletes orphaned sandbox/ branches with no associated worktree. Supports dryRun mode.

**Tasks:** task-sandbox-cleanup
