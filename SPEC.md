# Shrimp

An ultra-minimal background agent that automatically processes Todoist tasks in an event-driven manner.

## Purpose

Shrimp keeps a Todoist task board moving forward without human supervision: each time it is woken by a Heartbeat, it picks the highest-priority task, delegates execution to an AI Agent, and reports progress back as task comments.

## Users

Developers or individual users who deploy a Shrimp instance, configure a Todoist Board (a designated Todoist project used as the agent's work queue) and AI Provider, and let background tasks be processed automatically.

## Success Criteria

| Criterion | Pass Condition |
|-----------|---------------|
| Heartbeat triggers task selection | Calling `/heartbeat` enqueues a background cycle that selects one task and begins execution |
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
| In-memory task queue | A single-slot in-memory queue that serializes task processing; one task at a time |
| Heartbeat-triggered task selection | On `/heartbeat`, enqueue a processing cycle: select one task (In Progress first, then Backlog) |
| AI-driven task execution | Delegate the selected task to an AI Agent; agent runs until the task is complete or the agent cannot make further progress |
| Progress reporting via comments | Agent posts a Todoist comment with status after each execution |
| Task completion | Agent marks the task Done when it determines the task is finished |
| Health check endpoint | `/health` returns a liveness signal for Docker health check |
| MCP-based tool extension | All agent capabilities are provided through MCP tools; no hard-coded tool logic |

### IS NOT

| Excluded | Reason |
|----------|--------|
| Parallel task processing | Queue processes one task at a time; concurrent execution is out of scope |
| Persistent or distributed queue | Queue is in-memory only; tasks are lost on restart (Todoist is the source of truth) |
| Proactive scheduling | No cron or timer inside Shrimp; heartbeat is always externally triggered |
| Todoist Project/Board management | Shrimp reads tasks only; it does not create, move, or delete projects |
| Multi-Board or multi-account support | Single configured board per instance |
| Web UI or dashboard | No user-facing interface beyond the two API endpoints |
| Authentication / multi-tenancy | Single-instance deployment; no user accounts |

## Behavior

### `POST /heartbeat`

Enqueues one task-processing cycle in the background.

**Request:** no body required.

**Response:**

| Scenario | Status | Body |
|----------|--------|------|
| Accepted | `202 Accepted` | `{ "status": "accepted" }` |

**Behavior rules:**

- Returns immediately after enqueuing; does not wait for task processing to complete.
- The queue worker selects at most one task: an In Progress task takes priority over a Backlog task.
- If no actionable task is found, the enqueued cycle completes silently with no side effects.
- Task progress reporting and status updates happen asynchronously via the background queue.

### In-Memory Task Queue

Serializes task processing to ensure only one task runs at a time.

**Behavior rules:**

- The queue holds at most one pending job. If a heartbeat arrives while a task is already being processed, the new request is silently dropped (no error, no queuing).
- Processing sequence per job: select task → execute via AI Agent → report progress → update status.
- The queue lives in process memory. On container restart, any in-flight work is lost; Todoist remains the source of truth and the task will be picked up again on the next heartbeat.
- No retry logic inside the queue. If the AI Agent fails, the task stays in its current Todoist state and will be retried on the next heartbeat cycle.

### Event-Driven Trigger Flow

End-to-end sequence from external trigger to task completion. Each step references the component that owns the detail.

| Step | Actor | Action | Outcome |
|------|-------|--------|---------|
| 1 | External caller | `POST /heartbeat` | Request accepted; see [`POST /heartbeat`](#post-heartbeat) for response rules |
| 2 | Heartbeat handler | Enqueue a processing job | If queue slot is free, job is accepted; if busy, job is silently dropped; see [In-Memory Task Queue](#in-memory-task-queue) |
| 3 | Queue worker | Select one task | Check for an In Progress task first; if none, take one Backlog task; if no actionable task exists, cycle ends with no side effects |
| 4 | Queue worker | Delegate task to AI Agent | Agent receives the selected task and executes via MCP tools until the task is complete or no further progress is possible |
| 5 | AI Agent | Report progress | Agent posts a comment on the Todoist task with current status |
| 6 | AI Agent | Update task status | If task is complete, agent marks it Done in Todoist; otherwise task remains in its current state for the next heartbeat cycle |
| 7 | Queue worker | Release queue slot | Processing job is removed; queue is ready to accept the next heartbeat |

**Flow invariants:**

- Only one job occupies the queue at any time; step 2 enforces mutual exclusion.
- Steps 3–7 run entirely in the background; the external caller at step 1 never waits for them.
- A task not completed in one cycle is retried naturally when the next heartbeat triggers step 3 again.

### Todoist Integration

Shrimp reads from and writes to a single designated Todoist project configured as a Kanban board (the "Board"). Sections on the Board represent task statuses.

**Section-to-status mapping:**

| Todoist Section | Status Meaning |
|-----------------|---------------|
| Backlog | Task is queued, not yet started |
| In Progress | Task has been picked up and is being worked on |
| Done | Task is complete; no further action taken |

**Task selection rules:**

1. Query the Board for tasks in the In Progress section.
2. If one or more In Progress tasks exist, select one.
3. If no In Progress tasks exist, query the Backlog section and select one task.
4. If both sections are empty, no task is selected and the cycle ends silently.

**Progress reporting:**

- After each execution attempt, the AI Agent posts a comment on the selected Todoist task summarizing what was done and what remains.
- The comment is always posted, whether the task completed or not.

**Task completion:**

- When the AI Agent determines the task is done, it moves the task to the Done section.
- Shrimp does not delete tasks; it only moves them to Done.

**Source of truth:**

- Todoist is the authoritative state of all tasks. The in-memory queue holds a reference to the selected task ID only; on restart, the next heartbeat re-reads Todoist to select the current task.

### `GET /health`

Liveness check used by Docker `HEALTHCHECK`.

**Request:** no body or parameters.

**Response:**

| Scenario | Status | Body |
|----------|--------|------|
| Service is running | `200 OK` | `{ "status": "ok" }` |

**Behavior rules:**

- Always returns `200` as long as the process is alive; no dependency checks performed.
