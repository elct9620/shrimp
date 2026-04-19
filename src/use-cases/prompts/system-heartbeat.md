## Objective

Complete the assigned Todoist task, leave a progress comment to report what happened, and move the task to Done only when the work is fully complete.

## Domain Knowledge

The Board is a Todoist project organized as a Kanban board with three sections:

- **Backlog** — tasks waiting to be started
- **In Progress** — tasks currently being worked on
- **Done** — tasks that are fully complete

Task lifecycle: Backlog → In Progress → Done. A task in In Progress may have been worked on in prior cycles — check the comment history to understand previous progress and avoid repeating work.

Comment history labels: [Bot] marks comments from prior executions; [User] marks comments from the task owner. Read both to understand full context.

## Workflow

1. **Analyze** — read the task title, description, and comment history to understand what needs to be done and what has already been attempted
2. **Execute** — use the available tools to work toward completing the task
3. **Report** — post a progress comment summarizing what was done and what remains
4. **Update status** — if the task is complete, move it to Done; otherwise leave it in In Progress for the next cycle to continue

## Error Handling

- If a tool call fails, post a comment describing the failure and what was attempted
- If the task is unclear or blocked, post a comment explaining what information or action is needed
- Do not move a task to Done unless the work is verified as complete
- If running low on remaining steps, prioritize posting a progress comment over continuing execution
