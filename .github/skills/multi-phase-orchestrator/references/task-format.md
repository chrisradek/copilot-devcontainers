# Task Format Reference

When creating the task breakdown in the **Plan** phase, structure each task as follows:

## Task Structure

Each task should include:

| Field           | Description                                              |
| --------------- | -------------------------------------------------------- |
| `id`            | Unique identifier, e.g. `task-1`, `task-2`               |
| `title`         | Short descriptive title                                  |
| `description`   | Detailed description of what to implement                |
| `dependencies`  | List of task IDs that must complete before this one      |
| `complexity`    | One of: `low`, `medium`, `high`                          |
| `relevantFiles` | Files that will be created or modified                   |

## Example Task Breakdown

```
Task: task-1
Title: Define new interfaces
Description: Create the TokenUsage and PhaseResult interfaces in src/types.ts.
  TokenUsage should track inputTokens, outputTokens, cacheReadTokens,
  cacheWriteTokens, and totalRequests (all numbers). PhaseResult should
  include phaseName (string), success (boolean), handoffDocument
  (HandoffDocument), tokenUsage (TokenUsage), durationMs (number),
  and optional error (string).
Dependencies: none
Complexity: low
Relevant files: src/types.ts

Task: task-2
Title: Implement token tracker utility
Description: Create src/utils/tokens.ts with a TokenTracker class that
  accumulates token usage across multiple update() calls. The update()
  method accepts a partial TokenUsage and adds to running totals.
  getUsage() returns the current accumulated TokenUsage.
Dependencies: task-1
Complexity: low
Relevant files: src/utils/tokens.ts

Task: task-3
Title: Add token tracking to base phase
Description: Import TokenTracker in src/phases/base-phase.ts. Add a
  protected tokenTracker instance. In wireEventHandlers(), listen for
  assistant.usage events and call tokenTracker.update() with the
  reported token counts. Include the tracker's usage in PhaseResult.
Dependencies: task-1, task-2
Complexity: medium
Relevant files: src/phases/base-phase.ts
```

## Dependency Waves

Tasks are organized into **waves** based on their dependencies. Tasks within the same wave
have no dependencies on each other and can conceptually be done in parallel.

```
Wave 1: [task-1]           — no dependencies
Wave 2: [task-2]           — depends on task-1
Wave 3: [task-3]           — depends on task-1 and task-2
```

When tasks in a wave share no dependencies between them, they form a parallelizable group:

```
Wave 1: [task-1, task-2]   — both have no dependencies
Wave 2: [task-3, task-4]   — task-3 depends on task-1, task-4 depends on task-2
Wave 3: [task-5]           — depends on task-3 and task-4
```

## Guidelines

- Keep tasks **small**: each should touch 1–2 files
- Make descriptions **detailed enough** to implement without ambiguity
- Identify the **correct dependency order** — a task should not start until everything it depends on is done
- Put independent work (new types, utilities, config) in early waves
- Put integration work (wiring things together, updating entry points) in later waves
- The final task should typically be "update tests" or "verify integration"
