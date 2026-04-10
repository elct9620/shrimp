# Shrimp

An ultra-minimal background agent that automatically processes Todoist tasks in an event-driven manner.

## Purpose

Shrimp keeps a Todoist task board moving forward without human supervision: each time it is woken by a Heartbeat, the Main Agent selects the highest-priority task, executes it, and reports progress back as task comments.

## Users

Developers or individual users who deploy a Shrimp instance, configure a Todoist Board (a designated Todoist project used as the task source) and an OpenAI-compatible endpoint, and let background tasks be processed automatically.

## Success Criteria

| Criterion | Pass Condition |
|-----------|---------------|
| Heartbeat triggers task selection | Calling `/heartbeat` returns `202 Accepted` immediately; a background cycle is dispatched to select and process one task |
| Priority order is correct | If an In Progress task exists, it is continued first; otherwise a new task is taken from Backlog |
| Progress reporting | After each execution attempt, the agent posts a non-empty Todoist comment on the selected task summarizing what was done |
| Task completion | When the agent determines a task is done, it updates the task status to Done |
| Health check | `/health` returns OK; the Docker container stays healthy |

## Non-goals

- No parallel processing of multiple tasks
- No Web UI or dashboard
- No management of Todoist Project structure (only reads from a designated Board)
- No cross-Board or multi-Board integration
- No persistent or distributed task queue (in-memory only; lost on restart)

## Glossary

| Term | Definition |
|------|------------|
| Board | The designated Todoist project configured as a Kanban board; the single task source for this Shrimp instance |
| Heartbeat | An external `POST /heartbeat` call that triggers a processing cycle |
| Processing Cycle | One complete run of the Main Agent: select a task, execute it, report progress, update task status |
| Main Agent | The AI execution engine that owns the entire task processing lifecycle — from task selection through completion |
| Task Queue | Concurrency gate that limits how many Processing Cycles run simultaneously (currently one) |
| Built-in Tools | Todoist tools compiled into the agent: Get tasks, Get comments, Post comment, Move task |
| MCP Tools | Supplementary tools provided by external MCP servers, discovered from `.mcp.json` at startup |
| Fail-Open Recovery | The standard failure pattern: release the queue slot, leave the task in its current Todoist section, and let the next heartbeat retry it |

## Scope

### IS

| Feature | Description |
|---------|-------------|
| In-memory task queue | A single-slot in-memory queue that serializes task processing; one task at a time |
| Heartbeat-triggered task selection | On `/heartbeat`, enqueue a processing cycle: select one task (In Progress first, then Backlog) |
| AI-driven task execution | The Main Agent executes the selected task via built-in and MCP tools until the task is complete or no further progress is possible |
| Progress reporting via comments | Agent posts a Todoist comment with status after each execution |
| Task completion | Agent marks the task Done when it determines the task is finished |
| Health check endpoint | `/health` returns a liveness signal for Docker health check |
| Built-in Todoist tools | Core Todoist operations (get tasks, get comments, post comment, move task) are built-in to the agent |
| MCP-based tool extension | Additional capabilities can be added via MCP servers without modifying the agent |

### IS NOT

| Excluded | Reason |
|----------|--------|
| Parallel task processing | Queue processes one task at a time; concurrent execution is out of scope |
| Persistent or distributed queue | Queue is in-memory only; tasks are lost on restart (Todoist is the source of truth) |
| Proactive scheduling | No cron or timer inside Shrimp; heartbeat is always externally triggered |
| Todoist Project/Board management | Shrimp reads from and writes to the configured Board only; it does not create or modify Board structure |
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
| Queue slot is free — cycle enqueued | `202 Accepted` | `{ "status": "accepted" }` |
| Queue slot is busy — cycle dropped | `202 Accepted` | `{ "status": "accepted" }` |

**Behavior rules:**

- Always returns `202 Accepted` immediately, regardless of whether the background cycle was enqueued or dropped. The caller cannot distinguish the two cases; this is intentional fire-and-forget semantics.
- Returns immediately after enqueuing; does not wait for task processing to complete.
- The Main Agent selects at most one task per Processing Cycle: an In Progress task takes priority over a Backlog task.
- If no actionable task is found, the cycle ends immediately with no side effects.
- Task progress reporting and status updates happen asynchronously within the background Processing Cycle.

### In-Memory Task Queue

Concurrency gate that ensures only one Processing Cycle runs at a time. The queue does not select tasks, execute them, or report progress — all of that is the Main Agent's responsibility.

**Behavior rules:**

- The queue holds at most one pending job. If a heartbeat arrives while a Processing Cycle is already running, the new request is silently dropped (no error, no queuing).
- The slot is occupied from the moment a job is accepted until the Main Agent's Processing Cycle completes or fails. Any heartbeat arriving during this window is dropped.
- On acceptance, the queue starts the Main Agent; on completion or failure, it releases the slot. The queue has no knowledge of what the Main Agent does during the cycle.
- If the Main Agent fails for any reason, Fail-Open Recovery applies.
- The queue lives in process memory. On container restart, any in-flight work is lost; Todoist remains the source of truth and the task will be picked up again on the next heartbeat.
- No retry logic inside the queue. A failed cycle is retried naturally on the next heartbeat.

### Event-Driven Trigger Flow

End-to-end sequence from external trigger to task completion. Each step references the component that owns the detail.

| Step | Actor | Action | Outcome |
|------|-------|--------|---------|
| 1 | External caller | `POST /heartbeat` | Request accepted; see [`POST /heartbeat`](#post-heartbeat) for response rules |
| 2 | Task Queue | Accept or drop the heartbeat | If queue slot is free, start a Processing Cycle; if busy, silently drop; see [In-Memory Task Queue](#in-memory-task-queue) |
| 3 | Main Agent | Select one task | Check for an In Progress task first; if none, take one Backlog task; if no actionable task exists, cycle ends immediately |
| 4 | Main Agent | Execute the task | Agent runs via built-in and MCP tools until the task is complete or no further progress is possible |
| 5 | Main Agent | Report progress and update status | Agent posts a comment on the Todoist task and, if task is complete, moves it to Done; otherwise leaves it in current section |
| 6 | Task Queue | Release queue slot | Processing Cycle is finished; queue is ready to accept the next heartbeat |

**Flow invariants:**

- Only one Processing Cycle occupies the queue at any time; step 2 enforces mutual exclusion.
- Steps 3–6 run entirely in the background; the external caller at step 1 never waits for them.
- A task not completed in one cycle is retried naturally when the next heartbeat triggers step 3 again.
- The queue slot (step 6) is released regardless of whether steps 3–5 succeed or fail; Fail-Open Recovery ensures no failure path can leave the slot occupied.

### Todoist Integration

Shrimp reads from and writes to a single designated Todoist project configured as a Kanban board (the "Board"). Sections on the Board represent task statuses.

**Prerequisites:**

- The Board must contain three sections named Backlog, In Progress, and Done. If any required section is missing at task selection time, the cycle ends immediately with no side effects.

**Section-to-status mapping:**

| Todoist Section | Status Meaning |
|-----------------|---------------|
| Backlog | Task is waiting, not yet started |
| In Progress | Task has been picked up and is being worked on |
| Done | Task is complete; no further action taken |

**Task selection rules:**

Multiple tasks may exist in the In Progress section (e.g., due to manual user moves or prior cycle interruptions). This is a valid state; the selection rules below handle it by choosing the highest-priority task.

1. Query the Board for tasks in the In Progress section.
2. If one or more In Progress tasks exist, select the one with the highest Todoist priority (p1 > p2 > p3 > p4); among tasks with equal priority, select the one appearing first in the Todoist API response order for that section.
3. If no In Progress tasks exist, query the Backlog section and select the task with the highest Todoist priority; among tasks with equal priority, select the one appearing first in the Todoist API response order for that section.
4. If both sections are empty, no task is selected; the cycle ends immediately.

**Backlog task promotion:**

- When a Backlog task is selected, it is moved to In Progress before execution begins.

**API failure handling:**

- If any Todoist API call fails during a cycle, Fail-Open Recovery applies.

**Progress reporting:**

- After each execution attempt, the Main Agent posts a comment on the selected Todoist task summarizing what was done and what remains. The comment content and format are determined by the AI model; no fixed template is imposed.
- The comment is always posted, whether the task completed or not.
- If the Post Comment call itself fails, the cycle continues; Fail-Open Recovery applies after the cycle ends. The missing comment does not block task processing.

**Task completion:**

- When the Main Agent determines the task is done, it moves the task to the Done section.
- Shrimp does not delete tasks; it only moves them to Done.

**Source of truth:**

- Todoist is the authoritative state of all tasks. On restart, the next heartbeat re-reads Todoist to determine the current task.

### `GET /health`

Liveness check used by Docker `HEALTHCHECK`.

**Request:** no body or parameters.

**Response:**

| Scenario | Status | Body |
|----------|--------|------|
| Service is running | `200 OK` | `{ "status": "ok" }` |

**Behavior rules:**

- Always returns `200` as long as the process is alive; no dependency checks performed.

## Design

### Architecture Overview

Shrimp is a single-process service composed of four collaborating components. tsyringe wires them together at startup; no component constructs its own dependencies.

| Component | Responsibility |
|-----------|---------------|
| HTTP Layer (Hono) | Accepts inbound requests, validates route contracts, delegates to Task Queue |
| Task Queue | Concurrency gate; limits simultaneous Processing Cycles to one |
| Main Agent | Owns the entire Processing Cycle: selects a task, executes it via built-in and MCP tools, reports progress, and updates task status |
| Tool Layer | Built-in Todoist tools for core operations; MCP servers for extensible capabilities |

### System Boundary

| Dimension | Inside | Outside |
|-----------|--------|---------|
| Responsibility | HTTP routing, task serialization, AI execution loop, progress reporting | Scheduling heartbeats, Todoist project structure, AI model selection |
| Interaction | Receives `POST /heartbeat` and `GET /health`; returns JSON responses | Caller's scheduling mechanism; Todoist API; AI provider endpoint |
| Control | Task state transitions (Backlog → In Progress → Done), comment posting | Todoist data model; AI model behavior; MCP tool implementations |

### Component Dependencies

Key runtime dependencies: Hono (HTTP), tsyringe (DI), AI SDK (AI provider abstraction), MCP (tool extension).

### Request Flow

Each heartbeat traverses the following component chain:

```
POST /heartbeat
  → Hono route handler
  → Task Queue (accept or drop)
    → Main Agent: select task, execute, report progress, update status
      → Built-in Tools + MCP Tools
    → Task Queue: release slot
```

`GET /health` is handled entirely within the Hono layer; it does not touch the queue or agent.

### Extension Model

The agent has two categories of tools: built-in tools for core Todoist operations, and MCP tools for extensible capabilities. Built-in tools (get tasks, get comments, post comment, move task) are always available and do not require MCP. Additional tools (file access, web search, code execution) are added by registering MCP servers via a `.mcp.json` configuration file; no changes to the agent are required.

### Failure Handling

- **`.mcp.json` invalid format**: if the file exists but contains invalid JSON, is missing the `mcpServers` key, or has values that do not conform to the server definition structure, the process fails at startup (fail fast). An empty servers object (`{"mcpServers": {}}`) is valid and equivalent to no servers configured.
- **MCP server connection failure at startup**: the failed MCP server is excluded; the agent continues startup with the remaining servers. If no MCP servers connect successfully, the agent runs with Built-in Tools only.
- **Runtime AI/MCP failure during task processing**: Fail-Open Recovery applies.

### Main Agent

The Main Agent is the AI execution engine that owns the entire Processing Cycle. It is intentionally minimal: a single tool-calling loop against the configured AI provider, with no orchestration layers, planning steps, or internal retry logic beyond what the loop itself provides. The agent autonomously selects a task, executes it, reports progress, and updates task status. The loop runs until the task is done, the maximum step limit is reached, or an error occurs.

**Role contract:**

| Contract | Description |
|----------|-------------|
| Input | The Board's project ID and access to Built-in Tools and MCP Tools |
| Output | Processing Cycle complete; the agent is responsible for posting progress comments and updating task status before returning |
| Completion | The agent determines task completion when the model invokes the Move Task tool to move the task to Done. If the model's final response contains no tool calls and the task was not moved to Done, the task is considered incomplete. If the loop terminates for any reason and the task has not been moved to Done, the task is considered incomplete. |
| Maximum steps | Configurable via `AI_MAX_STEPS` environment variable (default: `50`). When reached, the tool loop terminates. The agent is responsible for completing its work within the step limit, including posting progress comments. |
| Error | Any error during the tool loop halts the loop immediately. Fail-Open Recovery applies. |
| Failure | On failure, comments already posted remain in Todoist. Fail-Open Recovery applies. |

**Provider abstraction:**

The agent uses AI SDK's provider interface with OpenAI-compatible conventions (`OPENAI_BASE_URL`, `OPENAI_API_KEY`). A different provider is used by pointing these variables to another OpenAI-compatible endpoint. The agent has no knowledge of which provider is active — it calls AI SDK, and AI SDK calls the provider. The configured model must support tool calling (function calling); if it does not, the agent cannot execute tasks.

| Dimension | Inside the agent | Outside the agent |
|-----------|-----------------|------------------|
| Model selection | No — reads from configuration | Provider endpoint and model name are environment configuration |
| Prompt construction | Yes — assembles task context into the system and user prompts | Task content originates in Todoist |
| Tool execution | Yes — invokes tool calls returned by the model | Built-in tools are internal; MCP tools live in external servers |
| Result interpretation | Yes — decides whether the task is done based on model output | Model judgment drives the decision |

**Prompt structure:**

The Main Agent assembles two prompts before invoking the AI SDK tool loop.

| Prompt | Assembly | Content |
|--------|----------|---------|
| System prompt | Dynamic, per execution | Goal setting (complete the task, report progress) + available tools description (built-in and MCP tool names and capabilities) |
| User prompt | Fixed template | Task context: id, title, description, current section, and comment history from prior executions |

**Prompt rules:**

- The system prompt is assembled at each task execution. It describes the agent's goal and lists all available tools so the model knows what actions it can take.
- The user prompt uses a fixed template to present Todoist task content in a structured format. It includes the task's comment history to provide execution context — this allows the agent to understand prior progress and avoid repeating work.
- Comments are retrieved via the built-in Get Comments tool before prompt assembly.

**Execution lifecycle per Processing Cycle:**

| Step | Action |
|------|--------|
| 1 | Select one task: In Progress first by priority, then Backlog by priority; if none, cycle ends immediately |
| 2 | If task is in Backlog, move to In Progress via Built-in Move Task tool |
| 3 | Retrieve task comments via Built-in Get Comments tool for execution context |
| 4 | Assemble system prompt (goal + tools) and user prompt (task context + comment history) |
| 5 | Invoke the AI SDK tool loop with the assembled prompt and all available tools (Built-in + MCP); loop continues until done, max steps reached, or error |
| 6 | Post a progress comment via Built-in Post Comment tool; if task is complete (moved to Done by model), leave it in Done; otherwise leave it in current section |

All steps are performed by the Main Agent. The Task Queue only starts the cycle and releases the slot when the agent returns.

**Tool integration:**

The agent uses two categories of tools:

| Category | Tools | Source |
|----------|-------|--------|
| Built-in | Get tasks, Get comments, Post comment, Move task | Compiled into the agent; always available |
| MCP | Any tools from registered MCP servers | Discovered from `.mcp.json` at process startup |

Built-in tools handle core Todoist operations. MCP tools extend the agent's capabilities without code changes.

## Deployment & Configuration

### Environment Variables

Runtime configuration is supplied through environment variables and a `.mcp.json` configuration file.

| Variable | Purpose | Required |
|----------|---------|----------|
| `OPENAI_BASE_URL` | Base URL of the OpenAI-compatible AI provider | Yes |
| `OPENAI_API_KEY` | API key for the AI provider | Yes |
| `AI_MODEL` | Model identifier to use (e.g., `gpt-4o`) | Yes |
| `AI_MAX_STEPS` | Maximum tool-loop steps per task execution; if absent or not a valid positive integer, falls back to default | No (default: `50`) |
| `TODOIST_API_TOKEN` | Todoist personal API token | Yes |
| `TODOIST_PROJECT_ID` | ID of the Todoist project used as the Board | Yes |
| `PORT` | HTTP port the service listens on | No (default: `3000`) |

**Rules:**

- Fail at startup: the process logs the error to stderr and exits with a non-zero exit code before accepting any HTTP requests.
- Missing required variables cause the process to fail at startup; no partial startup allowed.
- Supplementary MCP servers are configured via a `.mcp.json` file in the project root. The file follows the standard MCP configuration format: a JSON object with a `mcpServers` key mapping server names to their definitions (`command`, `args`).
- If `.mcp.json` is absent or contains no servers, the agent runs with built-in tools only.
- The built-in Todoist tools (Get tasks, Get comments, Post comment, Move task) are compiled into the agent and always available. `.mcp.json` adds supplementary tools only.

### Docker Deployment

Shrimp runs as a single container. There is no multi-instance or multi-tenant deployment.

| Aspect | Value |
|--------|-------|
| Deployment unit | Single Docker container |
| Health check | `GET /health` — returns `200 OK` while the process is alive |
| Build tool | `tsdown` bundles the application before the Docker image is built |
| Environment injection | All variables passed via `docker run --env` or `--env-file` |

**Container invariants:**

- One container, one Todoist Board, one AI provider.
- Container restart causes in-flight task work to be lost; Todoist remains the source of truth and the task is retried on the next heartbeat.
- In Docker deployments, `dotenv` is not active; all variables are supplied via Docker's env injection mechanisms.

### Development Setup

For local development, configuration is loaded from a `.env` file in the project root via `dotenv`.
