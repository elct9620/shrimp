# Shrimp

An ultra-minimal background agent that automatically processes Todoist tasks in an event-driven manner.

## Purpose

Shrimp keeps a Todoist task board moving forward without human supervision: each time it is woken by a Heartbeat, a Job selects the highest-priority task, dispatches it to the Shrimp Agent for execution, and reports progress back as task comments.

Because the Shrimp Agent is a black-box tool-calling loop, operators have no visibility into what the agent actually did inside a single Job — which tools it called, how many steps it took, or where it spent time. Distributed tracing via OpenTelemetry closes that gap by recording the agent's activity as structured, correlated spans that can be inspected after the fact. This makes Shrimp's background processing auditable and diagnosable without adding any synchronous overhead to the heartbeat path.

## Users

Developers or individual users who deploy a Shrimp instance, configure a Todoist Board (a designated Todoist project used as the task source) and an OpenAI-compatible endpoint, and let background tasks be processed automatically.

## Success Criteria

| Criterion                         | Pass Condition                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Heartbeat triggers task selection | Calling `/heartbeat` returns `202 Accepted` immediately; a background Job is dispatched to select and process one task   |
| Priority order is correct         | If an In Progress task exists, it is continued first; otherwise a new task is taken from Backlog                         |
| Progress reporting                | After each execution attempt, the agent posts a non-empty Todoist comment on the selected task summarizing what was done |
| Task completion                   | When the agent determines a task is done, it updates the task status to Done                                             |
| Health check                      | `/health` returns OK; the Docker container stays healthy                                                                 |
| Trace emission                    | A completed Job produces an OTel trace whose spans cover task selection, Shrimp Agent execution, and each tool call      |

## Non-goals

- No parallel processing of multiple tasks
- No Web UI or dashboard
- No management of Todoist Project structure (only reads from a designated Board)
- No cross-Board or multi-Board integration
- No persistent or distributed task queue (in-memory only; lost on restart)

## Glossary

| Term               | Definition                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board              | The designated Todoist project configured as a Kanban board; the single task source for this Shrimp instance                                                                                                                                                                                                                 |
| Heartbeat          | An external `POST /heartbeat` call that triggers a Job                                                                                                                                                                                                                                                                       |
| Supervisor         | An internal component of Shrimp (not Shrimp itself) that owns the heartbeat-reception lifecycle: receives Heartbeats, manages the Job Queue, and controls Job Worker lifecycle                                                                                                                                               |
| Job Queue          | Concurrency gate managed by the Supervisor that limits how many Jobs run simultaneously (currently one)                                                                                                                                                                                                                      |
| Job                | One complete orchestration unit triggered by a Heartbeat: select one task (In Progress first, then Backlog), promote a Backlog task to In Progress if needed, retrieve comment history, assemble prompts, dispatch to the Shrimp Agent, and release the Job Queue slot when done                                             |
| Job Worker         | The executor that takes one Job from the Job Queue and runs its full lifecycle: task selection, promotion, comment retrieval, prompt assembly, Shrimp Agent dispatch, and slot release                                                                                                                                       |
| Shrimp Agent       | The AI execution engine invoked once per Job. Given a system prompt, a user prompt, and a tool set, it runs the tool-calling loop against the configured AI provider until the task is done, the maximum step limit is reached, or an error occurs. It does not select tasks or assemble prompts — those belong to the Job   |
| Job ID             | A UUID v7 generated by the Supervisor at the start of each Job; used as a domain-scoped correlation key to group all spans and logs produced by that Job. Specifically the source of `gen_ai.conversation.id` on the `shrimp.job` span. Not a session identifier, not persisted, and not correlated across Jobs or restarts. |
| Built-in Tools     | Todoist tools compiled into the agent: Get tasks, Get comments, Post comment, Move task                                                                                                                                                                                                                                      |
| MCP Tools          | Supplementary tools provided by external MCP servers, discovered from `.mcp.json` at startup                                                                                                                                                                                                                                 |
| Comment Tag        | A prefix marker (`[Shrimp]`) prepended to every comment posted by the agent, used to distinguish bot-authored comments from user-authored comments                                                                                                                                                                           |
| Fail-Open Recovery | The standard failure pattern: release the Job Queue slot, leave the task in its current Todoist section, and let the next Heartbeat retry it                                                                                                                                                                                 |
| Trace              | The complete record of one Job's causally-related work, represented as a tree of Spans sharing a single trace identifier                                                                                                                                                                                                     |
| Span               | One named, timed unit of work within a Trace — such as task selection, a Shrimp Agent run, or a single tool call — carrying attributes and a reference to its parent Span except at the root                                                                                                                                 |
| Telemetry Exporter | The component that serializes completed Spans and delivers them to an external observability backend (e.g., Jaeger, Tempo, or an OTLP collector); configured entirely through the OpenTelemetry SDK environment, not by Shrimp                                                                                               |

## Scope

### IS

| Feature                            | Description                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| In-memory task queue               | A single-slot in-memory queue that serializes task processing; one task at a time                                                      |
| Heartbeat-triggered task selection | On `/heartbeat`, enqueue a processing cycle: select one task (In Progress first, then Backlog)                                         |
| AI-driven task execution           | The Main Agent executes the selected task via built-in and MCP tools until the task is complete, max steps reached, or an error occurs |
| Progress reporting via comments    | Agent posts a Todoist comment with status after each execution                                                                         |
| Task completion                    | Agent marks the task Done when it determines the task is finished                                                                      |
| Health check endpoint              | `/health` returns a liveness signal for Docker health check                                                                            |
| Built-in Todoist tools             | Core Todoist operations (get tasks, get comments, post comment, move task) are built-in to the agent                                   |
| MCP-based tool extension           | Additional capabilities can be added via MCP servers without modifying the agent                                                       |
| Distributed tracing                | The Processing Cycle, Main Agent execution, and each tool call emit OpenTelemetry spans that downstream collectors can consume         |

### IS NOT

| Excluded                             | Reason                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Parallel task processing             | Queue processes one task at a time; concurrent execution is out of scope                                                         |
| Persistent or distributed queue      | Queue is in-memory only; tasks are lost on restart (Todoist is the source of truth)                                              |
| Proactive scheduling                 | No cron or timer inside Shrimp; heartbeat is always externally triggered                                                         |
| Todoist Project/Board management     | Shrimp reads from and writes to the configured Board only; it does not create or modify Board structure                          |
| Multi-Board or multi-account support | Single configured board per instance                                                                                             |
| Web UI or dashboard                  | No user-facing interface beyond the two API endpoints                                                                            |
| Authentication / multi-tenancy       | Single-instance deployment; no user accounts                                                                                     |
| Metrics and log export               | Shrimp emits traces only; RED metrics, histograms, and log shipping are not produced                                             |
| Custom sampler or exporter plugins   | Sampler and exporter are configured entirely through the OpenTelemetry SDK environment; Shrimp ships no pluggable override       |
| Trace visualization UI               | Shrimp does not host a trace viewer; an external backend (e.g., Jaeger, Tempo, or a vendor collector) is required to view traces |

## Behavior

### `POST /heartbeat`

Enqueues one Job in the background.

**Request:** no body required.

**Response:**

| Scenario                              | Status         | Body                       |
| ------------------------------------- | -------------- | -------------------------- |
| Job Queue slot is free — Job enqueued | `202 Accepted` | `{ "status": "accepted" }` |
| Job Queue slot is busy — Job dropped  | `202 Accepted` | `{ "status": "accepted" }` |

**Behavior rules:**

- Always returns `202 Accepted` immediately, regardless of whether the background Job was enqueued or dropped. The caller cannot distinguish the two cases; this is intentional fire-and-forget semantics.
- Returns immediately after enqueuing; does not wait for task processing to complete.
- Each Job selects at most one task: an In Progress task takes priority over a Backlog task.
- If no actionable task is found, the Job ends immediately with no side effects.
- Task progress reporting and status updates happen asynchronously within the background Job.

### In-Memory Job Queue

Concurrency gate that ensures only one Job runs at a time. The Job Queue does not select tasks, execute them, or report progress — all of that belongs to the Job (orchestrated by a Job Worker) and the Shrimp Agent.

**Behavior rules:**

- The Job Queue holds at most one pending Job. If a Heartbeat arrives while a Job is already running, the new request is silently dropped (no error, no queuing).
- The slot is occupied from the moment a Job is accepted until the Job completes or fails. Any Heartbeat arriving during this window is dropped.
- On acceptance, the Job Queue starts a Job (executed by a Job Worker); on completion or failure, it releases the slot. The Job Queue has no knowledge of what happens during the Job.
- If the Job fails for any reason, Fail-Open Recovery applies.
- The Job Queue lives in process memory. On container restart, any in-flight work is lost; Todoist remains the source of truth and the task will be picked up again on the next Heartbeat.
- No retry logic inside the Job Queue. A failed Job is retried naturally on the next Heartbeat.

### Event-Driven Trigger Flow

End-to-end sequence from external trigger to task completion. Each step references the component that owns the detail.

| Step | Actor           | Action                            | Outcome                                                                                                                                                                                       |
| ---- | --------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | External caller | `POST /heartbeat`                 | Request accepted; see [`POST /heartbeat`](#post-heartbeat) for response rules                                                                                                                 |
| 2    | Job Queue       | Accept or drop the heartbeat      | If queue slot is free, start a Job; if busy, silently drop; see [In-Memory Job Queue](#in-memory-job-queue)                                                                                   |
| 3    | Job Worker      | Select one task                   | Check for an In Progress task first; if none, take one Backlog task; if no actionable task exists, Job ends immediately                                                                       |
| 4    | Job Worker      | Promote task and assemble prompts | If task is in Backlog, move to In Progress; retrieve comment history; assemble system prompt and user prompt                                                                                  |
| 5    | Shrimp Agent    | Execute the task                  | Runs the tool-calling loop with the assembled prompts and full tool set; continues until task is done, max steps reached, or error; posts progress comment and moves task to Done if complete |
| 6    | Job Queue       | Release queue slot                | Job is finished; queue is ready to accept the next heartbeat                                                                                                                                  |

**Flow invariants:**

- Only one Job occupies the Job Queue at any time; step 2 enforces mutual exclusion.
- Steps 3–6 run entirely in the background; the external caller at step 1 never waits for them.
- A task not completed in one Job is retried naturally when the next Heartbeat triggers step 3 again.
- The queue slot (step 6) is released regardless of whether steps 3–5 succeed or fail; Fail-Open Recovery ensures no failure path can leave the slot occupied.
- Steps 3–4 are the Job Worker's orchestration responsibility; step 5 is the Shrimp Agent's execution responsibility. The Shrimp Agent is not involved in task selection or prompt assembly.

### Todoist Integration

Shrimp reads from and writes to a single designated Todoist project configured as a Kanban board (the "Board"). Sections on the Board represent task statuses.

**Prerequisites:**

- The Board must contain three sections named Backlog, In Progress, and Done. If any required section is missing at task selection time, the Job ends immediately with no side effects.

**Section-to-status mapping:**

| Todoist Section | Status Meaning                                 |
| --------------- | ---------------------------------------------- |
| Backlog         | Task is waiting, not yet started               |
| In Progress     | Task has been picked up and is being worked on |
| Done            | Task is complete; no further action taken      |

**Task selection rules:**

Multiple tasks may exist in the In Progress section (e.g., due to manual user moves or prior Job interruptions). This is a valid state; the selection rules below handle it by choosing the highest-priority task.

1. Query the Board for tasks in the In Progress section.
2. If one or more In Progress tasks exist, select the one with the highest Todoist priority (p1 > p2 > p3 > p4); among tasks with equal priority, select the one appearing first in the Todoist API response order for that section.
3. If no In Progress tasks exist, query the Backlog section and select the task with the highest Todoist priority; among tasks with equal priority, select the one appearing first in the Todoist API response order for that section.
4. If both sections are empty, no task is selected; the Job ends immediately.

**Backlog task promotion:**

- When a Backlog task is selected, it is moved to In Progress before execution begins.

**API failure handling:**

- If any Todoist API call fails during a Job, Fail-Open Recovery applies.

**Progress reporting:**

- After each execution attempt, the Shrimp Agent posts a comment on the selected Todoist task summarizing what was done and what remains. The comment content and format are determined by the AI model; no fixed template is imposed.
- The comment is always posted by the Shrimp Agent during its tool-calling loop, whether the task completed or not.
- If the Post Comment call itself fails, the Job continues; Fail-Open Recovery applies after the Job ends. The missing comment does not block task processing.

**Comment tagging:**

- Every comment posted through the Post Comment tool is automatically prefixed with the Comment Tag (`[Shrimp]`) by the tool itself. The AI model does not add the tag; it is applied at the tool boundary.
- The tag is a structural marker, not part of the AI-generated content.
- Comments without the Comment Tag are treated as user-authored when reading comment history.

**Task completion:**

- When the Shrimp Agent determines the task is done, it moves the task to the Done section via the Move Task tool.
- Shrimp does not delete tasks; it only moves them to Done.

**Source of truth:**

- Todoist is the authoritative state of all tasks. On restart, the next heartbeat re-reads Todoist to determine the current task.

### Telemetry Emission

Every Processing Cycle that runs produces one OTel trace. Spans within that trace expose task selection, agent execution, and each tool call as separately timed, attributable units of work that downstream collectors and dashboards can query.

**Trace lifecycle rules:**

- A Processing Cycle that is dropped by the Task Queue (slot busy) does not produce a trace; no spans are emitted for dropped cycles.
- A Processing Cycle that runs but finds no actionable task still produces a trace containing only the root span. This makes "nothing to do" observable and distinguishable from a cycle that was never triggered.
- A Processing Cycle that selects and executes a task produces a full trace: root span plus all nested AI SDK spans for that execution.

**Root span:**

The Processing Cycle owns the root span. It begins when the cycle starts and ends when the cycle completes or fails, covering the full lifecycle: task selection, prompt assembly, Main Agent execution, and queue slot release. All AI SDK spans emitted during Main Agent execution are nested under this root span via OpenTelemetry context propagation.

**Nested AI SDK spans:**

When the Main Agent executes, AI SDK emits spans following its own telemetry conventions. Shrimp enables these spans and does not alter their structure. The spans consumers will see are:

| Span name                    | Emitted                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `ai.generateText`            | Once per Processing Cycle — the full Main Agent invocation |
| `ai.generateText.doGenerate` | Once per provider round-trip within the agent loop         |
| `ai.toolCall`                | Once per tool invocation (Built-in and MCP tools)          |

AI SDK's own span schema and nesting conventions apply; Shrimp does not define or alter them.

**Span attributes:**

Each span carries attributes sourced from two overlapping conventions that AI SDK emits together:

| Attribute group                 | Example attributes                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| AI SDK native                   | `ai.model.id`, `ai.model.provider`, `ai.usage.promptTokens`, `ai.usage.completionTokens`, `ai.response.finishReason`                 |
| OTel GenAI semantic conventions | `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons` |

Tool call spans additionally carry: `ai.toolCall.name`, `ai.toolCall.id`, `ai.toolCall.args`, and `ai.toolCall.result` (present only when the call succeeds and the result is serializable).

`GenAiBridgeSpanProcessor` supplements AI SDK's native emission with full OTel gen_ai semconv coverage: LLM-call spans receive `gen_ai.operation.name=chat`, structured `gen_ai.input.messages` and `gen_ai.output.messages`; tool-call spans receive `gen_ai.operation.name=execute_tool` and `gen_ai.tool.*` attrs. The `shrimp.main-agent` span carries `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.name`, `gen_ai.provider.name`, and `error.type` on failure.

**Function identification:**

Shrimp sets a stable `ai.telemetry.functionId` on the Main Agent invocation so operators can filter traces by logical operation. The assigned identifier is `shrimp.main-agent`.

**Input and output recording:**

By default, the agent's assembled prompt and the model's generated text are recorded on spans. Both inputs and outputs are captured unless explicitly disabled — that configuration knob is covered separately under Deployment & Configuration.

### Telemetry Configuration

Telemetry is controlled at startup. The following rules govern how configuration changes and export failures affect the system.

**Enable / disable semantics:**

- When telemetry is disabled: no spans are emitted, no tracer is initialized, and no exporter connections are opened. The Processing Cycle and Main Agent run identically to a non-tracing deployment — disabling telemetry has no observable effect on task execution.
- When telemetry is enabled: spans are emitted per the [Telemetry Emission](#telemetry-emission) contract.
- The enable/disable decision is fixed at startup and does not change during process lifetime. There is no runtime toggle.

**Input / output recording:**

- By default, both the assembled prompt text and the model's generated text are recorded on spans (as stated in Telemetry Emission).
- Privacy-sensitive deployments may disable input recording, output recording, or both. Disabling either preserves all non-content attributes — model identifier, token usage counts, finish reason, and tool call names, arguments, and results are unaffected.
- This is a deployment-time setting, not a per-request or per-task knob.

**Exporter failure is fail-open:**

- Exporter errors — including network failure, backend unavailability, timeout, and serialization error — must never propagate into the Processing Cycle. The cycle completes its work; task state in Todoist is never affected by telemetry failures.
- This is consistent with the Fail-Open Recovery pattern applied to Todoist and AI provider failures during task processing.
- Dropped spans are lost. Shrimp has no local span buffer beyond what the OpenTelemetry SDK provides internally, and does not retry, persist, or re-queue spans on behalf of a failing exporter.

**Startup validation:**

- If telemetry is enabled but required telemetry configuration is missing or malformed at startup, the process fails fast — consistent with the fail-fast pattern applied to missing required environment variables and malformed `.mcp.json` (see [Failure Handling](#failure-handling) and [Deployment & Configuration](#deployment--configuration)).
- If telemetry is disabled, telemetry-related configuration is not validated.

**Initialization ordering:**

- If telemetry is enabled, the tracer and exporter are initialized before the HTTP server starts accepting heartbeats. This guarantees that the first Processing Cycle can emit spans; no cycle runs before the telemetry infrastructure is ready.

### `GET /health`

Liveness check used by Docker `HEALTHCHECK`.

**Request:** no body or parameters.

**Response:**

| Scenario           | Status   | Body                 |
| ------------------ | -------- | -------------------- |
| Service is running | `200 OK` | `{ "status": "ok" }` |

**Behavior rules:**

- Always returns `200` as long as the process is alive; no dependency checks performed.

## Design

### Architecture Overview

Shrimp is a single-process service composed of five collaborating components. Shrimp itself (the running process) acts as the Supervisor: it receives heartbeats, manages the Task Queue, and runs Processing Cycles. tsyringe wires all components together at startup; no component constructs its own dependencies.

| Component         | Responsibility                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP Layer (Hono) | Accepts inbound requests, validates route contracts, delegates to Task Queue                                                                                                                                  |
| Task Queue        | Concurrency gate; limits simultaneous Processing Cycles to one                                                                                                                                                |
| Processing Cycle  | Orchestrates one heartbeat-triggered unit of work: selects a task, promotes Backlog→In Progress, retrieves comment history, assembles prompts, and dispatches to the Main Agent                               |
| Main Agent        | AI execution engine: given prompts and a tool set, runs the tool-calling loop until the task is done, max steps reached, or an error occurs; posts progress comments and moves the task to Done when complete |
| Tool Layer        | Built-in Todoist tools for core operations; MCP servers for extensible capabilities                                                                                                                           |

### System Boundary

| Dimension      | Inside                                                                  | Outside                                                              |
| -------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Responsibility | HTTP routing, task serialization, AI execution loop, progress reporting | Scheduling heartbeats, Todoist project structure, AI model selection |
| Interaction    | Receives `POST /heartbeat` and `GET /health`; returns JSON responses    | Caller's scheduling mechanism; Todoist API; AI provider endpoint     |
| Control        | Task state transitions (Backlog → In Progress → Done), comment posting  | Todoist data model; AI model behavior; MCP tool implementations      |

### Component Dependencies

Key runtime dependencies: Hono (HTTP), tsyringe (DI), AI SDK (AI provider abstraction), MCP (tool extension).

### Request Flow

Each heartbeat traverses the following component chain:

```
POST /heartbeat
  → Hono route handler
  → Task Queue (accept or drop)
    → Processing Cycle: select task, promote Backlog→InProgress, assemble prompts
      → Main Agent: run tool-calling loop (execute, report progress, update status)
        → Built-in Tools + MCP Tools
    → Task Queue: release slot
```

`GET /health` is handled entirely within the Hono layer; it does not touch the queue or agent.

### Extension Model

The agent has two categories of tools: built-in tools for core Todoist operations, and MCP tools for extensible capabilities. Built-in tools (get tasks, get comments, post comment, move task) are always available and do not require MCP. Additional tools (file access, web search, code execution) are added by registering MCP servers via a `.mcp.json` configuration file; no changes to the agent are required.

### Telemetry

Telemetry is a process-level concern: the OpenTelemetry tracer provider and exporter pipeline are initialized at process startup, alongside HTTP server startup and configuration loading, not inside the Processing Cycle or Main Agent. Once initialized, they participate via the ambient OpenTelemetry context; no component holds or passes tracer handles explicitly. This mirrors how `.mcp.json` loading is handled in the Extension Model — configuration is resolved once at startup, and the result is available to all components without tight coupling.

**Component responsibilities:**

| Component                | Telemetry responsibility                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process startup          | Initialize the tracer provider and exporter pipeline before the HTTP server accepts heartbeats                                                                        |
| Processing Cycle         | Own the root span lifecycle: start the span when the cycle begins, propagate OTel context, end when the cycle ends                                                    |
| Main Agent (port)        | Telemetry-agnostic at the port level; the port contract has no tracing parameters                                                                                     |
| AiSdkMainAgent           | Forward telemetry settings into AI SDK's `experimental_telemetry`; annotate the `shrimp.main-agent` span with agent-level gen_ai attrs (`invoke_agent`, `error.type`) |
| GenAiBridgeSpanProcessor | Translate AI SDK's `ai.*` span attrs to OTel gen_ai semconv (`gen_ai.*`) on span end; single translation point for all LLM-call and tool-call spans                   |
| Tool Layer               | No instrumentation required; AI SDK emits `ai.toolCall` spans for every Built-in and MCP tool call automatically                                                      |

**Inside vs. outside Shrimp:**

| Inside Shrimp                                                  | Outside Shrimp                                  |
| -------------------------------------------------------------- | ----------------------------------------------- |
| Root span lifecycle on Processing Cycle                        | Span transport to a backend collector or vendor |
| Forwarding telemetry settings to AI SDK (via `AiSdkMainAgent`) | Sampling policy and trace retention             |
| Initializing tracer and exporter at process startup            | Trace storage, querying, and visualization      |

Swapping `AiSdkMainAgent` for an alternative implementation requires no port changes and no changes to how `ProcessingCycle` manages the root span.

### Failure Handling

- **`.mcp.json` invalid format**: if the file exists but contains invalid JSON, is missing the `mcpServers` key, or has values that do not conform to the server definition structure, the process fails at startup (fail fast). An empty servers object (`{"mcpServers": {}}`) is valid and equivalent to no servers configured.
- **MCP server connection failure at startup**: the failed MCP server is excluded; the agent continues startup with the remaining servers. If no MCP servers connect successfully, the agent runs with Built-in Tools only.
- **Runtime AI/MCP failure during task processing**: Fail-Open Recovery applies.

### Processing Cycle

The Processing Cycle is the orchestration unit triggered by each heartbeat. It runs inside the Task Queue's single slot and is responsible for everything that happens before and after the Main Agent executes.

**Role contract:**

| Contract            | Description                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Trigger             | Started by the Task Queue when a heartbeat is accepted                                                               |
| Heartbeat ID        | Generates a Heartbeat ID (UUID v7) at cycle start and threads it through to the Main Agent invocation                |
| Task selection      | Selects one task: In Progress first by priority, then Backlog by priority; if none, cycle ends immediately           |
| Backlog promotion   | If the selected task is in Backlog, moves it to In Progress before proceeding                                        |
| Comment retrieval   | Fetches the task's comment history via the Built-in Get Comments tool to provide execution context                   |
| Prompt assembly     | Assembles the system prompt (goal + tool descriptions) and user prompt (task context + comment history)              |
| Main Agent dispatch | Invokes the Main Agent exactly once with the assembled prompts, the full tool set (Built-in + MCP), and Heartbeat ID |
| Completion          | The cycle ends when the Main Agent returns. The Task Queue releases the slot regardless of success or failure        |

**Execution lifecycle:**

| Step | Actor            | Action                                                                                                                                                                                       |
| ---- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Processing Cycle | Select one task: In Progress first by priority, then Backlog by priority; if none, cycle ends immediately                                                                                    |
| 2    | Processing Cycle | If task is in Backlog, move to In Progress via Built-in Move Task tool                                                                                                                       |
| 3    | Processing Cycle | Retrieve task comments via Built-in Get Comments tool                                                                                                                                        |
| 4    | Processing Cycle | Assemble system prompt (goal + tools) and user prompt (task context + comment history)                                                                                                       |
| 5    | Main Agent       | Run the tool-calling loop with the assembled prompts and all available tools; loop continues until done, max steps reached, or error; posts progress comment; moves task to Done if complete |

The Task Queue only starts the cycle and releases the slot when the cycle returns.

**Prompt structure:**

| Prompt        | Assembly                         | Content                                                                                                                            |
| ------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| System prompt | Dynamic, assembled per execution | Goal setting (complete the task, report progress) + available tools description (names and capabilities of built-in and MCP tools) |
| User prompt   | Fixed template                   | Task context: id, title, description, current section, and comment history from prior executions                                   |

**Prompt rules:**

- The system prompt is assembled at each task execution. It describes the agent's goal and lists available tools (names and capabilities) so the model understands what actions it can take. Tool definitions for function calling are provided separately via AI SDK's tools parameter; the system prompt provides the human-readable context that guides tool usage.
- The user prompt uses a fixed template to present Todoist task content in a structured format. It includes the task's comment history to provide execution context — this allows the agent to understand prior progress and avoid repeating work.
- When assembling comment history, comments prefixed with the Comment Tag are labeled as bot-authored; all other comments are labeled as user-authored. The Comment Tag prefix is stripped from the display text so the AI model sees only the original content.

**Heartbeat ID:**

The Processing Cycle generates a Heartbeat ID at the very start of each cycle — before task selection — and carries it through to the Main Agent invocation via `MainAgentInput`.

| Aspect       | Contract                                                                                                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose      | Domain-scoped correlation key that groups all spans and logs produced by a single Processing Cycle; specifically the source of `gen_ai.conversation.id` on the `shrimp.main-agent` span                                                                                                                                                    |
| Generation   | UUID v7 (time-ordered; v4 is an acceptable fallback if the runtime does not expose v7). Generated by Shrimp, not by external callers                                                                                                                                                                                                       |
| Lifetime     | Per-cycle only. A new cycle generates a new ID. The ID is not persisted, not stored in Todoist, and not carried forward to subsequent cycles                                                                                                                                                                                               |
| Propagation  | `ProcessingCycle` generates the ID and passes it to the Main Agent as `MainAgentInput.heartbeatId: string`. The Main Agent implementation writes it to the `gen_ai.conversation.id` span attribute on the `shrimp.main-agent` span                                                                                                         |
| OTel mapping | `gen_ai.conversation.id` (OTel GenAI semconv). This is a business-domain correlation key, not a user conversation or session. Shrimp has no conversation history; each heartbeat is an isolated LLM invocation. The Heartbeat ID satisfies the "group all spans for one invocation" use case that `gen_ai.conversation.id` is designed for |
| Failure      | UUID generation failure is not expected from a standard library; if it occurs, the cycle fails fast. No fallback to empty string or zero UUID — a missing or blank ID would silently corrupt downstream correlation                                                                                                                        |

**IS NOT:**

- Not a user session ID or conversation history identifier
- Not an OTel trace ID — OTel already provides trace IDs for distributed tracing; the Heartbeat ID is the business-domain grouping key
- Not persisted to Todoist or any storage
- Not correlated across Shrimp restarts or across separate Processing Cycles
- Not supplied by external callers (heartbeat callers have no knowledge of it)

### Main Agent

The Main Agent is the AI execution engine invoked once per Processing Cycle. It is intentionally minimal: a single tool-calling loop against the configured AI provider, with no orchestration layers, planning steps, or internal retry logic beyond what the loop itself provides. The loop runs until the task is done, the maximum step limit is reached, or an error occurs.

**Role contract:**

| Contract      | Description                                                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input         | Assembled system prompt, assembled user prompt, the full available tool set (Built-in + MCP), and the Heartbeat ID (`heartbeatId: string`) generated by the Processing Cycle for this invocation                           |
| Output        | Loop terminated; the agent is responsible for posting progress comments and moving the task to Done (if complete) via tool calls during the loop                                                                           |
| Completion    | The agent determines task completion when the model invokes the Move Task tool to move the task to Done. If the loop terminates for any reason and the task has not been moved to Done, the task is considered incomplete. |
| Maximum steps | Configurable via `AI_MAX_STEPS` environment variable (default: `50`). When reached, the tool loop terminates. The agent is responsible for completing its work within the step limit, including posting progress comments. |
| Error         | Any error during the tool loop halts the loop immediately. Fail-Open Recovery applies.                                                                                                                                     |
| Failure       | On failure, comments already posted remain in Todoist. Fail-Open Recovery applies.                                                                                                                                         |

**Provider abstraction:**

The Main Agent uses AI SDK's provider interface with OpenAI-compatible conventions (`OPENAI_BASE_URL`, `OPENAI_API_KEY`). A different provider is used by pointing these variables to another OpenAI-compatible endpoint. The agent has no knowledge of which provider is active — it calls AI SDK, and AI SDK calls the provider. The configured model must support tool calling (function calling); if it does not, the agent cannot execute tasks.

| Dimension             | Inside the Main Agent                                            | Outside the Main Agent                                          |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Model selection       | No — reads from configuration                                    | Provider endpoint and model name are environment configuration  |
| Prompt construction   | No — prompts are assembled by the Processing Cycle and passed in | Task content originates in Todoist                              |
| Tool execution        | Yes — invokes tool calls returned by the model                   | Built-in tools are internal; MCP tools live in external servers |
| Result interpretation | Yes — decides whether the task is done based on model output     | Model judgment drives the decision                              |

**Tool integration:**

The Main Agent uses two categories of tools:

| Category | Tools                                            | Source                                         |
| -------- | ------------------------------------------------ | ---------------------------------------------- |
| Built-in | Get tasks, Get comments, Post comment, Move task | Compiled into the agent; always available      |
| MCP      | Any tools from registered MCP servers            | Discovered from `.mcp.json` at process startup |

Built-in tools handle core Todoist operations. MCP tools extend the agent's capabilities without code changes.

The Post Comment tool is responsible for prepending the Comment Tag to every comment. The AI model's text input is preserved as-is; the tag is added at the tool boundary before the Todoist API call.

## Deployment & Configuration

### Environment Variables

Runtime configuration is supplied through environment variables and a `.mcp.json` configuration file.

| Variable                      | Purpose                                                                                                      | Required                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `OPENAI_BASE_URL`             | Base URL of the OpenAI-compatible AI provider                                                                | Yes                                      |
| `OPENAI_API_KEY`              | API key for the AI provider                                                                                  | Yes                                      |
| `AI_MODEL`                    | Model identifier to use (e.g., `gpt-4o`)                                                                     | Yes                                      |
| `AI_MAX_STEPS`                | Maximum tool-loop steps per task execution; if absent or not a valid positive integer, falls back to default | No (default: `50`)                       |
| `TODOIST_API_TOKEN`           | Todoist personal API token                                                                                   | Yes                                      |
| `TODOIST_PROJECT_ID`          | ID of the Todoist project used as the Board                                                                  | Yes                                      |
| `PORT`                        | HTTP port the service listens on                                                                             | No (default: `3000`)                     |
| `TELEMETRY_ENABLED`           | Master toggle — enables OTel trace emission; when absent or `false`/`0`, telemetry is disabled               | No (default: off)                        |
| `OTEL_SERVICE_NAME`           | Service name resource attribute attached to every emitted span                                               | Yes when telemetry enabled; No otherwise |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector URL to which spans are exported                                                               | Yes when telemetry enabled; No otherwise |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Authentication or routing headers for the OTLP collector (comma-separated `key=value` pairs)                 | No                                       |
| `TELEMETRY_RECORD_INPUTS`     | When `false`/`0`, omits assembled prompt text from span attributes                                           | No (default: on)                         |
| `TELEMETRY_RECORD_OUTPUTS`    | When `false`/`0`, omits model-generated text from span attributes                                            | No (default: on)                         |

**Rules:**

- Fail at startup: the process logs the error to stderr and exits with a non-zero exit code before accepting any HTTP requests.
- Missing required variables cause the process to fail at startup; no partial startup allowed.
- Supplementary MCP servers are configured via a `.mcp.json` file in the project root. The file follows the standard MCP configuration format: a JSON object with a `mcpServers` key mapping server names to their definitions (`command`, `args`).
- If `.mcp.json` is absent or contains no servers, the agent runs with built-in tools only.
- The built-in Todoist tools (Get tasks, Get comments, Post comment, Move task) are compiled into the agent and always available. `.mcp.json` adds supplementary tools only.
- **`OTEL_*` variables are pass-through:** Shrimp reads them and passes them to the OpenTelemetry SDK; they are not re-aliased or duplicated under Shrimp-owned names.
- **Shrimp-owned telemetry variables** (`TELEMETRY_ENABLED`, `TELEMETRY_RECORD_INPUTS`, `TELEMETRY_RECORD_OUTPUTS`) follow the same unprefixed uppercase convention as `AI_*` and `TODOIST_*` variables.
- **When `TELEMETRY_ENABLED` is false or unset**, the `OTEL_*` variables and `TELEMETRY_RECORD_*` variables are neither required nor read. Startup validation is skipped for all telemetry configuration. See [Telemetry Configuration](#telemetry-configuration) for the full enable/disable contract.
- **When telemetry is enabled but a required telemetry variable is missing or malformed**, the process fails fast at startup — consistent with the fail-fast pattern applied to all required variables above. See [Telemetry Configuration](#telemetry-configuration) for startup validation rules.

### Docker Deployment

Shrimp runs as a single container. There is no multi-instance or multi-tenant deployment.

| Aspect                | Value                                                             |
| --------------------- | ----------------------------------------------------------------- |
| Deployment unit       | Single Docker container                                           |
| Health check          | `GET /health` — returns `200 OK` while the process is alive       |
| Build tool            | `tsdown` bundles the application before the Docker image is built |
| Environment injection | All variables passed via `docker run --env` or `--env-file`       |

**Container invariants:**

- One container, one Todoist Board, one AI provider.
- Container restart causes in-flight task work to be lost; Todoist remains the source of truth and the task is retried on the next heartbeat.
- In Docker deployments, `dotenv` is not active; all variables are supplied via Docker's env injection mechanisms.

### Development Setup

For local development, configuration is loaded from a `.env` file in the project root via `dotenv`.
