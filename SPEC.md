# Shrimp

An ultra-minimal background agent that automatically processes Todoist tasks in an event-driven manner.

## Purpose

Shrimp keeps a Todoist task board moving forward without human supervision: each time it is woken by a Heartbeat, it picks the highest-priority task, delegates execution to an AI Agent, and reports progress back as task comments.

## Users

Developers or individual users who deploy a Shrimp instance, configure a Todoist Board (a designated Todoist project used as the agent's work queue) and AI Provider, and let background tasks be processed automatically.

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

## Scope

### IS

| Feature | Description |
|---------|-------------|
| Heartbeat-triggered task selection | On `/heartbeat`, select one task: In Progress first, then Backlog |
| AI-driven task execution | Delegate the selected task to an AI Agent; agent runs until the task is complete or the agent cannot make further progress |
| Progress reporting via comments | Agent posts a Todoist comment with status after each execution |
| Task completion | Agent marks the task Done when it determines the task is finished |
| Health check endpoint | `/health` returns a liveness signal for Docker health check |
| MCP-based tool extension | All agent capabilities are provided through MCP tools; no hard-coded tool logic |

### IS NOT

| Excluded | Reason |
|----------|--------|
| Parallel task processing | One task per heartbeat; concurrency is out of scope |
| Proactive scheduling | No cron or timer inside Shrimp; heartbeat is always externally triggered |
| Todoist Project/Board management | Shrimp reads tasks only; it does not create, move, or delete projects |
| Multi-Board or multi-account support | Single configured board per instance |
| Web UI or dashboard | No user-facing interface beyond the two API endpoints |
| Authentication / multi-tenancy | Single-instance deployment; no user accounts |
