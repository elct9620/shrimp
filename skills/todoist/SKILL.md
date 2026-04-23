---
name: todoist
description: Use this skill when interacting with the Todoist board — pulling tasks, reading comment history, posting progress comments, or moving tasks between Backlog, In Progress, and Done sections.
---

## Purpose

The Shrimp Agent interacts with a Todoist project configured as a Kanban board. This skill covers how to use the four Built-in Todoist tools to read task state, inspect comment history, report progress, and advance tasks through the board lifecycle.

Use this skill whenever the agent needs to:

- Fetch tasks from a board section to understand what work is available or in flight
- Read the comment history on a task to understand prior execution context
- Post a progress comment to report what was done or what remains
- Move a task to a different section to reflect its current state

## Board Structure

The Board is a Todoist project with exactly three sections:

| Section     | Meaning                                                |
| ----------- | ------------------------------------------------------ |
| Backlog     | Tasks waiting to be started                            |
| In Progress | Tasks currently being worked on                        |
| Done        | Tasks that are fully complete; no further action taken |

Tasks flow in one direction: Backlog → In Progress → Done. The Job Worker promotes a Backlog task to In Progress before handing it to the Shrimp Agent. The Shrimp Agent is responsible for moving the task to Done only when the work is fully complete.

A task in In Progress may have been worked on in prior execution cycles. The comment history is the authoritative record of what has already been attempted.

## Comment History Labels

Comments on a task are prefixed with a label that identifies their source:

- `[Bot]` — posted by a prior Shrimp Agent execution
- `[User]` — posted by the task owner

Read both label types to understand full context. Do not repeat work already described in `[Bot]` comments unless the prior attempt failed.

## Typical Workflow

When executing a task, follow this sequence:

1. **Inspect the task** — the task title, description, and assignee are provided by the Job Worker in the user prompt. No `getTasks` call is needed to retrieve the current task.
2. **Read comment history** — call `getComments(taskId)` to retrieve prior progress notes and understand what has already been done.
3. **Execute** — use available tools (MCP or other built-in tools) to work toward completing the task.
4. **Report progress** — call `postComment(taskId, text)` to summarize what was done this cycle and what remains. Always post a comment before finishing, even if the task is complete.
5. **Update status** — if the task is complete, call `moveTask(taskId, "Done")`. If the task is not yet complete, leave it in In Progress; the next Job cycle will continue from the comment history.

If at any point the remaining execution budget is low, prioritize posting a progress comment over continuing execution.

## Tool Reference

### `getTasks`

Lists tasks in the specified board section.

- **Input**: `section` — one of `"Backlog"`, `"InProgress"`, or `"Done"`
- **Returns**: array of task objects for that section
- **Typical use**: check which tasks are waiting in Backlog or currently In Progress when you need an overview of board state. Not needed to retrieve the currently assigned task, which is already provided in the user prompt.

### `getComments`

Lists all comments on a task by its Todoist task ID.

- **Input**: `taskId` — the Todoist task ID string
- **Returns**: array of comment objects, each with the comment body and timestamp
- **Typical use**: always call this at the start of execution on an In Progress task to understand previous progress. The comment body includes the `[Bot]` or `[User]` label prefix.

### `postComment`

Posts a comment on a task to report progress or summarize results.

- **Input**: `taskId` — the Todoist task ID string; `text` — the comment body (the `[Bot]` prefix is added automatically by the tool)
- **Returns**: `{ ok: true }` on success
- **Typical use**: post at least one comment per execution cycle. The comment should summarize what was done, what succeeded, what failed, and what remains. If the task is blocked or unclear, the comment should explain what information or action is needed.

### `moveTask`

Moves a task to a different board section.

- **Input**: `taskId` — the Todoist task ID string; `section` — one of `"Backlog"`, `"InProgress"`, or `"Done"`
- **Returns**: `{ ok: true }` on success
- **Typical use**: call with `"Done"` only after the work is verified as complete and a progress comment has been posted. Do not move a task to Done unless the outcome has been confirmed. Do not delete tasks; only move them.

## Guardrails

- **Always post a progress comment before ending execution**, regardless of whether the task is complete or not. This is the primary mechanism for continuity across cycles.
- **Do not move a task to Done unless the work is verified as complete.** If uncertain, leave the task in In Progress and describe the uncertainty in a comment.
- **Do not repeat prior work.** Read `[Bot]` comments from previous cycles to understand what was already attempted and avoid duplicating effort.
- **If a tool call fails**, post a comment describing the failure and what was attempted. Do not silently discard errors.
- **If the task is unclear or blocked**, post a comment explaining what information or action is needed. Do not guess at intent.
- **If running low on remaining steps**, prioritize posting a progress comment over continuing execution. An incomplete task with a good progress comment is better than an incomplete task with no record.
