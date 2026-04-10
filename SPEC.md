# Shrimp

An ultra-minimal background agent that automatically processes Todoist tasks in an event-driven manner.

## Purpose

Shrimp keeps a Todoist task board moving forward without human supervision: each time it is woken by a Heartbeat, it picks the highest-priority task, delegates execution to an AI Agent, and reports progress back as task comments.

## Users

Developers or individual users who deploy a Shrimp instance, configure a Todoist Board and AI Provider, and let background tasks be processed automatically.

## Success Criteria

| Criterion | Pass Condition |
|-----------|---------------|
| Heartbeat triggers task selection | Calling `/heartbeat` causes the agent to select one task and begin execution |
| Priority order is correct | If an In Progress task exists, it is continued first; otherwise a new task is taken from Backlog |
| Progress reporting | The agent comments on the task with its current status |
| Task completion | When the agent determines a task is done, it updates the task status to Done |
| Health check | `/health` returns OK; the Docker container stays healthy |

## Non-goals

- No parallel processing of multiple tasks
- No Web UI or dashboard
- No management of Todoist Project structure (only reads from a designated Board)
- No cross-Board or multi-Board integration
