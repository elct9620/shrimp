# Shrimp

An ultra-minimal background agent that automatically processes Todoist tasks in an event-driven manner.

## Purpose

Shrimp keeps a Todoist task board moving forward without human supervision: each time it is woken by a Heartbeat, it picks the highest-priority task, delegates execution to the Main Agent, and reports progress back as task comments.

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
- The queue worker selects at most one task: an In Progress task takes priority over a Backlog task.
- If no actionable task is found, the cycle ends immediately with no side effects. The AI Agent is not invoked.
- Task progress reporting and status updates happen asynchronously via the background queue.

### In-Memory Task Queue

Serializes task processing to ensure only one task runs at a time.

**Behavior rules:**

- The queue holds at most one pending job. If a heartbeat arrives while a task is already being processed, the new request is silently dropped (no error, no queuing).
- The slot is occupied from the moment a job is accepted until the queue worker releases it after processing completes or fails. Any heartbeat arriving during this window is dropped.
- Processing sequence per job: select task → execute via AI Agent → report progress → update status.
- If any step in the processing sequence fails, the queue slot is released and the task remains in its current Todoist state.
- The queue lives in process memory. On container restart, any in-flight work is lost; Todoist remains the source of truth and the task will be picked up again on the next heartbeat.
- No retry logic inside the queue. If the AI Agent fails, the task stays in its current Todoist state and will be retried on the next heartbeat cycle.

### Event-Driven Trigger Flow

End-to-end sequence from external trigger to task completion. Each step references the component that owns the detail.

| Step | Actor | Action | Outcome |
|------|-------|--------|---------|
| 1 | External caller | `POST /heartbeat` | Request accepted; see [`POST /heartbeat`](#post-heartbeat) for response rules |
| 2 | Heartbeat handler | Enqueue a processing job | If queue slot is free, job is accepted; if busy, job is silently dropped; see [In-Memory Task Queue](#in-memory-task-queue) |
| 3 | Queue worker | Select one task | Check for an In Progress task first; if none, take one Backlog task; if no actionable task exists, cycle ends immediately — AI Agent is not invoked |
| 4 | Queue worker | Delegate task to AI Agent | Agent receives the selected task and executes via built-in and MCP tools until the task is complete or no further progress is possible |
| 5 | AI Agent | Report progress | Agent posts a comment on the Todoist task with current status |
| 6 | AI Agent | Update task status | If task is complete, agent marks it Done in Todoist; otherwise task remains in its current state for the next heartbeat cycle |
| 7 | Queue worker | Release queue slot | Processing job is removed; queue is ready to accept the next heartbeat |

**Flow invariants:**

- Only one job occupies the queue at any time; step 2 enforces mutual exclusion.
- Steps 3–7 run entirely in the background; the external caller at step 1 never waits for them.
- A task not completed in one cycle is retried naturally when the next heartbeat triggers step 3 again.
- The queue slot (step 7) is released regardless of whether steps 4–6 succeed or fail; no failure path can leave the slot occupied.

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

1. Query the Board for tasks in the In Progress section.
2. If one or more In Progress tasks exist, select the one with the highest Todoist priority (p1 > p2 > p3 > p4); among tasks with equal priority, select the one appearing first in the Todoist API response order for that section.
3. If no In Progress tasks exist, query the Backlog section and select the task with the highest Todoist priority; among tasks with equal priority, select the one appearing first in the Todoist API response order for that section.
4. If both sections are empty, no task is selected; the cycle ends immediately and the AI Agent is not invoked.

**Backlog task promotion:**

- When a Backlog task is selected, it is moved to In Progress before execution begins.

**API failure handling:**

- If any Todoist API call fails during a cycle, the task remains in its current section; the queue slot is released and the task is retried on the next heartbeat.

**Progress reporting:**

- After each execution attempt, the AI Agent posts a comment on the selected Todoist task summarizing what was done and what remains. The comment content and format are determined by the AI model; no fixed template is imposed.
- The comment is always posted, whether the task completed or not.

**Task completion:**

- When the AI Agent determines the task is done, it moves the task to the Done section.
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
| HTTP Layer (Hono) | Accepts inbound requests, validates route contracts, delegates to Queue |
| Task Queue | Serializes background work; enforces the single-slot invariant |
| Main Agent | Drives task execution by invoking built-in and MCP tools in a loop until done or stuck |
| Tool Layer | Built-in Todoist tools for core operations; MCP servers for extensible capabilities |

### System Boundary

| Dimension | Inside | Outside |
|-----------|--------|---------|
| Responsibility | HTTP routing, task serialization, AI execution loop, progress reporting | Scheduling heartbeats, Todoist project structure, AI model selection |
| Interaction | Receives `POST /heartbeat` and `GET /health`; returns JSON responses | Caller's scheduling mechanism; Todoist API; AI provider endpoint |
| Control | Task state transitions (Backlog → In Progress → Done), comment posting | Todoist data model; AI model behavior; MCP tool implementations |

### Component Dependencies

See [CLAUDE.md](CLAUDE.md) for the full tech stack. Key runtime dependencies: Hono (HTTP), tsyringe (DI), AI SDK (AI provider abstraction), MCP (tool extension).

### Request Flow

Each heartbeat traverses the following component chain:

```
POST /heartbeat
  → Hono route handler
  → Task Queue (enqueue; drop if busy)
    → Queue worker: select task via built-in Todoist tools
    → Main Agent: execute task via built-in + MCP tools in a loop
      → Built-in Todoist tools: post comment, move task to Done
    → Queue worker: release slot
```

`GET /health` is handled entirely within the Hono layer; it does not touch the queue or agent.

### Extension Model

The agent has two categories of tools: built-in tools for core Todoist operations, and MCP tools for extensible capabilities. Built-in tools (get tasks, get comments, post comment, move task) are always available and do not require MCP. Additional tools (file access, web search, code execution) are added by registering MCP servers via a `.mcp.json` configuration file; no changes to the agent are required.

### Failure Handling

- **`.mcp.json` invalid format**: if the file exists but contains invalid JSON or does not conform to the expected structure (`mcpServers` key with server definitions), the process fails at startup (fail fast).
- **MCP server connection failure at startup**: the failed MCP server is excluded; the agent continues startup with the remaining servers. If no MCP servers connect successfully, the agent runs with built-in tools only.
- **Runtime AI/MCP failure during task processing**: queue worker releases slot; task stays in its current Todoist state.

### Main Agent

The Main Agent is the AI execution engine that processes a single Todoist task to completion. It is intentionally minimal: a single tool-calling loop against the configured AI provider, with no orchestration layers, planning steps, or internal retry logic beyond what the loop itself provides. The loop runs until the task is done, the maximum step limit is reached, or an error occurs.

**Role contract:**

| Contract | Description |
|----------|-------------|
| Input | A Todoist task (id, title, description, current section, comment history) |
| Output | Execution complete; progress comment posted; task moved to Done if finished |
| Completion | The agent determines task completion when the model invokes the Move Task tool to move the task to Done. If the model's final response contains no tool calls and the task was not moved to Done, the task is considered incomplete. If the loop terminates for any reason and the task has not been moved to Done, the task is considered incomplete. |
| Maximum steps | Configurable via `AI_MAX_STEPS` environment variable (default: `50`). When reached: post a progress comment indicating incomplete execution, leave task in current section, return control to queue. |
| Error | Any error during the tool loop halts the loop immediately. The task stays in its current section; the queue retries on the next heartbeat. |
| Failure | On failure, the task section is not moved; comments already posted remain in Todoist. The task stays in its current section for retry on the next heartbeat. |

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

**Execution lifecycle per task:**

| Step | Actor | Action |
|------|-------|--------|
| 1 | Queue worker | Passes task to Main Agent |
| 2 | Main Agent | If task is in Backlog, move to In Progress via built-in Move Task tool |
| 3 | Main Agent | Retrieves task comments via built-in Get Comments tool for execution context |
| 4 | Main Agent | Assembles system prompt (goal + tools) and user prompt (task context + comment history) |
| 5 | Main Agent | Invokes the AI SDK tool loop with the assembled prompt and all available tools (built-in + MCP); loop continues until done, max steps reached, or error |
| 6 | Main Agent | Posts a progress comment via built-in Post Comment tool; if task is complete (moved to Done by model), leaves it in Done; otherwise leaves it in current section |
| 7 | Queue worker | Receives control back; releases queue slot |

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
| `AI_MAX_STEPS` | Maximum tool-loop steps per task execution (must be a positive integer) | No (default: `50`) |
| `TODOIST_API_TOKEN` | Todoist personal API token | Yes |
| `TODOIST_PROJECT_ID` | ID of the Todoist project used as the Board | Yes |
| `PORT` | HTTP port the service listens on | No (default: `3000`) |

**Rules:**

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

For local development, configuration is loaded from a `.env` file in the project root via `dotenv`. See [CLAUDE.md](CLAUDE.md) for development tools and rules.
