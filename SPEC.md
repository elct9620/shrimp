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
- Persistent or distributed Job Queue — current implementation uses in-memory only; in-flight Jobs are lost on restart. Future extension remains open. Session conversation history is separately persisted (see Session Lifecycle).

## Glossary

| Term                 | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board                | The designated Todoist project configured as a Kanban board; the single task source for this Shrimp instance                                                                                                                                                                                                                                                                                                                                      |
| Heartbeat            | An external `POST /heartbeat` call that triggers a Job                                                                                                                                                                                                                                                                                                                                                                                            |
| Heartbeat Token      | A shared secret configured on the Shrimp instance that external heartbeat callers must present to authorize a `POST /heartbeat` request. Opt-in: when no token is configured, `/heartbeat` accepts unauthenticated requests                                                                                                                                                                                                                       |
| Supervisor           | An internal component of Shrimp (not Shrimp itself) that owns the heartbeat-reception lifecycle: receives Heartbeats, manages the Job Queue, and controls Job Worker lifecycle                                                                                                                                                                                                                                                                    |
| Job Queue            | Concurrency gate managed by the Supervisor that limits how many Jobs run simultaneously (currently one)                                                                                                                                                                                                                                                                                                                                           |
| Job                  | An agent invocation unit triggered by either a Heartbeat or a Channel message event. Two variants: **HeartbeatJob** — selects a Todoist task, promotes Backlog→In Progress, assembles prompts from task context and comment history; **ChannelJob** — loads the current Session, assembles prompts from conversation history and the incoming message. Both variants share one Job Queue slot and invoke the Shrimp Agent exactly once.           |
| Job Worker           | The executor that takes one Job from the Job Queue and runs its full lifecycle. Shared responsibilities: prompt assembly and Shrimp Agent dispatch. Variant-specific responsibilities (Todoist task selection for HeartbeatJob; Session loading for ChannelJob) are defined in the relevant Behavior sections.                                                                                                                                    |
| Shrimp Agent         | The AI execution engine invoked once per Job. Given a system prompt, a user prompt, and a tool set, it runs the tool-calling loop against the configured AI provider until the task is done, the maximum step limit is reached, or an error occurs. It does not select tasks or assemble prompts — those belong to the Job                                                                                                                        |
| Job ID               | A UUID v7 generated by the Supervisor at the start of each Job; used as a domain-scoped correlation key to group all spans and logs produced by that Job. Recorded on the `invoke_agent shrimp.job` span as a per-invocation identifier. Not persisted and not correlated across Jobs. Cross-Job conversation correlation is provided by **Session ID** (not Job ID), which is the source of `gen_ai.conversation.id` when a Session is in scope. |
| Built-in Tools       | Todoist tools compiled into the agent: Get tasks, Get comments, Post comment, Move task                                                                                                                                                                                                                                                                                                                                                           |
| MCP Tools            | Supplementary tools provided by external MCP servers, discovered from `.mcp.json` at startup                                                                                                                                                                                                                                                                                                                                                      |
| Comment Tag          | A prefix marker (`[Shrimp]`) prepended to every comment posted by the agent, used to distinguish bot-authored comments from user-authored comments                                                                                                                                                                                                                                                                                                |
| Fail-Open Recovery   | The standard failure pattern: release the Job Queue slot, leave the task in its current Todoist section, and let the next Heartbeat retry it                                                                                                                                                                                                                                                                                                      |
| Channel              | An abstract inbound source of user-initiated events (messages and Slash Commands). Telegram (via webhook) is the first implementation. A Channel both delivers inbound events to the Supervisor and accepts outbound replies from the agent                                                                                                                                                                                                       |
| Session              | A single global, persistent conversation archive used by Channel-driven Jobs. Created lazily on the user's first non-command message. Identified by a UUID. Stored as an append-only JSONL file; `state.json` records the current Session ID                                                                                                                                                                                                      |
| Auto Compact         | The mechanism that compresses an active Session's conversation history when its context token usage approaches the model's limit. Triggered by the Job Worker at the start of the next ChannelJob after the Compaction Threshold is exceeded; replaces older ConversationMessage entries with a Conversation Summary                                                                                                                              |
| Compaction Threshold | The token-count boundary above which Auto Compact triggers on the next ChannelJob. Evaluated against the last-turn prompt token usage reported by the AI provider; when usage exceeds this value the Job Worker invokes the SummarizePort before assembling the next prompt                                                                                                                                                                       |
| Conversation Summary | The textual output produced by the SummarizePort representing older conversation turns in condensed form. Passed to the Shrimp Agent as a prepended summary entry in the conversation history in place of the compacted ConversationMessage entries                                                                                                                                                                                               |
| ConversationMessage  | Shrimp's own value object representing one entry in a Session's message history (role + content). Not an AI SDK type; translation to the provider's message format happens at the Infrastructure boundary                                                                                                                                                                                                                                         |
| ConversationRef      | An opaque value-object pointer to the reply destination for a given Channel event. Carried on each Channel-driven Job so the Job Worker knows where to deliver the response via ChannelGateway. Meaning is Channel-specific and is only interpreted by the Channel implementation                                                                                                                                                                 |
| SummarizePort        | A dedicated port, distinct from Shrimp Agent, invoked by the Job Worker to produce a Conversation Summary from a list of ConversationMessage entries. Decouples summarization from the main agent execution loop                                                                                                                                                                                                                                  |
| Slash Command        | A message starting with `/` (e.g., `/new`) received through a Channel. Parsed and handled by the Channel adapter before any Job is enqueued; does not reach the Shrimp Agent                                                                                                                                                                                                                                                                      |
| Trace                | The complete record of one Job's causally-related work, represented as a tree of Spans sharing a single trace identifier                                                                                                                                                                                                                                                                                                                          |
| Span                 | One named, timed unit of work within a Trace — such as task selection, a Shrimp Agent run, or a single tool call — carrying attributes and a reference to its parent Span except at the root                                                                                                                                                                                                                                                      |
| Telemetry Exporter   | The component that serializes completed Spans and delivers them to an external observability backend (e.g., Jaeger, Tempo, or an OTLP collector); configured entirely through the OpenTelemetry SDK environment, not by Shrimp                                                                                                                                                                                                                    |

## Scope

### IS

| Feature                             | Description                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-memory Job Queue                 | Single-slot concurrency gate; admits one Job at a time                                                                                                                                                                                                                                                           |
| Heartbeat-triggered task selection  | On `/heartbeat`, dispatch a HeartbeatJob that selects one task (In Progress first, then Backlog)                                                                                                                                                                                                                 |
| Heartbeat authentication            | When a Heartbeat Token is configured, `/heartbeat` requires a matching bearer token on every request; unauthenticated requests rejected                                                                                                                                                                          |
| AI-driven task execution            | The Shrimp Agent executes the selected task via built-in and MCP tools until the task is complete, max steps reached, or an error occurs                                                                                                                                                                         |
| Progress reporting via comments     | Agent posts a Todoist comment with status after each execution                                                                                                                                                                                                                                                   |
| Task completion                     | Agent marks the task Done when it determines the task is finished                                                                                                                                                                                                                                                |
| Health check endpoint               | `/health` returns a liveness signal for Docker health check                                                                                                                                                                                                                                                      |
| Built-in Todoist tools              | Core Todoist operations (get tasks, get comments, post comment, move task) are built-in to the agent                                                                                                                                                                                                             |
| MCP-based tool extension            | Additional capabilities can be added via MCP servers without modifying the agent                                                                                                                                                                                                                                 |
| Distributed tracing                 | The Job, Shrimp Agent execution, and each tool call emit OpenTelemetry spans that downstream collectors can consume                                                                                                                                                                                              |
| Channel-triggered Jobs              | External Channels (e.g., Telegram) can push messages that produce Jobs in the same Job Queue as Heartbeat-triggered Jobs                                                                                                                                                                                         |
| Session-scoped conversation history | Single global Session persisted as append-only JSONL; provides conversation history to the Shrimp Agent on each Channel-triggered Job                                                                                                                                                                            |
| Auto Compact                        | When the last-turn prompt token usage reported by the AI provider exceeds the Compaction Threshold, the current Channel Session's conversation history is compacted via SummarizePort into a Conversation Summary; the result is stored in a new Session (new Session ID), replacing the active Session pointer. |
| Slash Commands                      | `/`-prefixed messages received through a Channel are parsed by the Channel adapter; `/new` starts a new Session                                                                                                                                                                                                  |

### IS NOT

| Excluded                             | Reason                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parallel Job processing              | Job Queue admits one Job at a time; concurrent execution is out of scope                                                                                                     |
| Persistent or distributed Job Queue  | Job Queue is in-memory only; in-flight Jobs are lost on restart (Todoist is the source of truth)                                                                             |
| Proactive scheduling                 | No cron or timer inside Shrimp; heartbeat is always externally triggered                                                                                                     |
| Todoist Project/Board management     | Shrimp reads from and writes to the configured Board only; it does not create or modify Board structure                                                                      |
| Multi-Board or multi-account support | Single configured board per instance                                                                                                                                         |
| Web UI or dashboard                  | No user-facing interface beyond the two API endpoints                                                                                                                        |
| Multi-user authentication            | No user accounts or per-user authorization; endpoint-level shared-secret protection (Heartbeat Token, Telegram secret) is in scope, but identity-based access control is not |
| Metrics and log export               | Shrimp emits traces only; RED metrics, histograms, and log shipping are not produced                                                                                         |
| Custom sampler or exporter plugins   | Sampler and exporter are configured entirely through the OpenTelemetry SDK environment; Shrimp ships no pluggable override                                                   |
| Trace visualization UI               | Shrimp does not host a trace viewer; an external backend (e.g., Jaeger, Tempo, or a vendor collector) is required to view traces                                             |
| Per-user or per-chat Sessions        | Single global Session only; multi-session support is out of scope                                                                                                            |
| Channel polling                      | Channels receive events via push (e.g., webhook for Telegram); long-polling is not supported                                                                                 |
| Slash Command extensibility          | Only `/new` is provided; user-defined or dynamically-registered Slash Commands are out of scope                                                                              |
| Cross-Session summarization          | Conversation Summary covers only the compacted Session's own prior turns; content from earlier archived Sessions is not re-summarized or carried into the new Session        |
| Manual compact command               | No Slash Command or API endpoint triggers compaction; compaction is entirely automatic based on the Compaction Threshold                                                     |
| Auto Compact for HeartbeatJob        | HeartbeatJob has no Session and is not subject to Auto Compact; compaction applies only to ChannelJob                                                                        |

## Behavior

### `POST /heartbeat`

Dispatches one **HeartbeatJob** in the background. Channel-triggered Jobs use a separate path; see [Channel Integration](#channel-integration).

**Request:** no body required. When a Heartbeat Token is configured, the caller must present it via the `Authorization: Bearer <token>` header.

**Response:**

| Scenario                               | Status             | Body                       |
| -------------------------------------- | ------------------ | -------------------------- |
| Token required but missing or mismatch | `401 Unauthorized` | no body                    |
| Job Queue slot is free — Job accepted  | `202 Accepted`     | `{ "status": "accepted" }` |
| Job Queue slot is busy — Job dropped   | `202 Accepted`     | `{ "status": "accepted" }` |

**Behavior rules:**

- Always returns `202 Accepted` immediately, regardless of whether the background Job was accepted or dropped. The caller cannot distinguish the two cases; this is intentional fire-and-forget semantics.
- Returns immediately after accepting; does not wait for Job processing to complete.
- Each Job selects at most one task: an In Progress task takes priority over a Backlog task.
- If no actionable task is found, the Job ends immediately with no side effects.
- Task progress reporting and status updates happen asynchronously within the background Job.

**Authentication rules:**

- Authentication is **opt-in**: when no Heartbeat Token is configured, `/heartbeat` accepts all requests without inspecting the `Authorization` header (backward-compatible).
- When a Heartbeat Token is configured, every request must carry `Authorization: Bearer <token>` where `<token>` exactly equals the configured value. Requests without the header, with a non-`Bearer` scheme, or with a mismatched value are rejected with `401 Unauthorized` before the Job Queue is consulted.
- Token comparison is performed in constant time to avoid leaking information through response-time differences.
- `GET /health` is not subject to this authentication — health checks remain unauthenticated so Docker/Coolify liveness probes keep working without token configuration.

### In-Memory Job Queue

Concurrency gate that ensures only one Job runs at a time. The Job Queue accepts both **HeartbeatJob** (from the HTTP heartbeat path) and **ChannelJob** (from the Channel adapter) into the same single slot; it does not distinguish variants when accepting. The Job Queue does not select tasks, load Sessions, assemble prompts, or report progress — all of that belongs to the Job Worker and the Shrimp Agent.

**Behavior rules:**

- The Job Queue admits at most one running Job. If a Heartbeat or Channel message arrives while a Job is already running, the new request is silently dropped (no error, no buffering, no queuing). The drop semantics are identical for both variants.
- The slot is occupied from the moment a Job is accepted until the Job completes or fails. Any Heartbeat or Channel message event arriving during this window is dropped.
- On acceptance, the Job Queue starts a Job (executed by a Job Worker); on completion or failure, it releases the slot. The Job Queue has no knowledge of what happens during the Job, nor which variant is running.
- If the Job fails for any reason, Fail-Open Recovery applies.
- The Job Queue lives in process memory. On container restart, any in-flight work is lost; Todoist remains the source of truth for HeartbeatJobs, and the next Heartbeat or Channel message re-triggers work.
- No retry logic inside the Job Queue. A failed Job is retried naturally on the next triggering event.
- Slash Commands bypass the Job Queue entirely; see [Slash Commands](#slash-commands).

### Event-Driven Trigger Flow

End-to-end sequence from external trigger to agent invocation. Two trigger sources produce two Job variants that share the same Job Queue slot and Shrimp Agent invocation contract. Slash Commands are dispatched by the Channel adapter and do NOT go through this flow; see [Slash Commands](#slash-commands).

**HeartbeatJob flow:**

| Step | Actor           | Action                            | Outcome                                                                                                                                                                                       |
| ---- | --------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | External caller | `POST /heartbeat`                 | Request accepted; see [`POST /heartbeat`](#post-heartbeat) for response rules                                                                                                                 |
| 2    | Job Queue       | Accept or drop the heartbeat      | If queue slot is free, start a HeartbeatJob; if busy, silently drop; see [In-Memory Job Queue](#in-memory-job-queue)                                                                          |
| 3    | Job Worker      | Select one task                   | Check for an In Progress task first; if none, take one Backlog task; if no actionable task exists, Job ends immediately                                                                       |
| 4    | Job Worker      | Promote task and assemble prompts | If task is in Backlog, move to In Progress; retrieve comment history; assemble system prompt and user prompt                                                                                  |
| 5    | Shrimp Agent    | Execute the task                  | Runs the tool-calling loop with the assembled prompts and full tool set; continues until task is done, max steps reached, or error; posts progress comment and moves task to Done if complete |
| 6    | Job Queue       | Release queue slot                | Job is finished; queue is ready to accept the next event                                                                                                                                      |

**ChannelJob flow:**

| Step | Actor           | Action                        | Outcome                                                                                                                                                                           |
| ---- | --------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Channel adapter | Receive inbound message event | Non-command message (see [Channel Integration](#channel-integration)); ConversationRef captured; dispatch a ChannelJob                                                            |
| 2    | Job Queue       | Accept or drop the event      | If queue slot is free, start a ChannelJob; if busy, silently drop; see [In-Memory Job Queue](#in-memory-job-queue)                                                                |
| 3    | Job Worker      | Load Session                  | Read the current Session via the `SessionRepository`, or create a new Session if this is the first message; see [Session Lifecycle](#session-lifecycle)                           |
| 4    | Job Worker      | Assemble prompts              | Assemble the system prompt and a user prompt from the Session's conversation history plus the incoming Channel message                                                            |
| 5    | Shrimp Agent    | Execute the conversation turn | Runs the tool-calling loop with the assembled prompts, Session history input, and full tool set; terminates on done, max steps, or error                                          |
| 5a   | Job Worker      | Deliver replies               | After the agent returns, delivers each assistant ConversationMessage to the originating Channel conversation via ChannelGateway using the ConversationRef; failures are Fail-Open |
| 6    | Job Worker      | Append to Session             | Append the new conversation entries to the current Session                                                                                                                        |
| 7    | Job Queue       | Release queue slot            | Job is finished; queue is ready to accept the next event                                                                                                                          |

**Flow invariants (apply to both variants):**

- Only one Job occupies the Job Queue at any time; step 2 enforces mutual exclusion across both variants.
- All steps after queue acceptance run entirely in the background; the external caller / Channel event never waits for them.
- The queue slot is released regardless of whether intermediate steps succeed or fail; Fail-Open Recovery ensures no failure path can leave the slot occupied.
- Prompt assembly is the Job Worker's responsibility; agent execution is the Shrimp Agent's responsibility. The Shrimp Agent is not involved in task selection, Session loading, or prompt assembly.
- A piece of work not completed in one Job is retried naturally when the next triggering event (Heartbeat or Channel message) arrives.

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

### Channel Integration

Channels are inbound event sources that let users push messages into Shrimp, producing Jobs that run through the same Job Queue as Heartbeat-triggered Jobs.

**Prerequisites:**

When a Channel is enabled, its webhook must be registered with the external provider before Shrimp can receive events; Shrimp does not perform this registration (see [Deployment & Configuration](#deployment--configuration)).

**Channel concept:**

Channel is a generic contract for inbound event delivery. Telegram (via webhook) is the first supported Channel. Additional Channels can be added without changes to the Job Queue or Shrimp Agent.

**Event types:**

| Event type    | Trigger                            | Handling                                                                                           |
| ------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Message       | User message not prefixed with `/` | Produces a `ChannelJob` dispatched through the Job Queue                                           |
| Slash Command | User message prefixed with `/`     | Handled by the Channel adapter directly; no Job is enqueued. See [Slash Commands](#slash-commands) |

**Delivery mode:**

Channels deliver events via push (webhook or equivalent server-initiated mechanism). Long polling is not supported.

**Dispatch rules:**

- Each Channel event carries a ConversationRef so outbound replies can be routed back to the originating Channel conversation.
- Message events compete with Heartbeat for the single Job Queue slot. If the slot is busy, the event is dropped silently — the same drop semantics as `POST /heartbeat`. No retry inside Shrimp.
- A Channel reply is delivered by the Job Worker after the agent returns, routed back to the originating Channel conversation via ChannelGateway using the ConversationRef. Reply failures follow Fail-Open Recovery — the Job is not failed solely because a reply could not be delivered.
- Session creation and conversation history for Channel-driven Jobs are governed by the [Session Lifecycle](#session-lifecycle) section.

**Failure handling:**

Webhook delivery failures (e.g., invalid payload, authentication failure) are the Channel adapter's responsibility and must not affect other Channels or the Heartbeat path.

**Telegram Channel:**

Telegram is the first supported Channel implementation.

**Endpoint:**

- The Telegram Channel accepts webhook callbacks at `POST /channels/telegram`.
- Every inbound callback must carry a shared secret delivered via the external provider's webhook conventions (e.g., Telegram's secret-token header). Requests without a matching secret are rejected with `401 Unauthorized` per the Response table below.
- Inbound request headers and payload shape follow the external provider's webhook specification.

**Response:**

| Scenario                        | Status             | Body    |
| ------------------------------- | ------------------ | ------- |
| Event accepted (secret matches) | `200 OK`           | no body |
| Secret missing or mismatch      | `401 Unauthorized` | no body |
| Malformed payload               | `400 Bad Request`  | no body |

### Session Lifecycle

A **Session** is the single global, persistent conversation archive shared by all Channel-triggered Jobs. It holds the message history that the Shrimp Agent reads at the start of each ChannelJob and appends to after each response.

**Cardinality:**

At most one Session is "current" at any time. A previously-current Session remains on disk as an archive; only one Session is active.

**Lazy creation:**

No Session exists at process startup. The first non-command Channel message creates the first Session. If no Channel message ever arrives, no Session file is created.

**Identity and storage:**

| Item                    | Value                                                                           |
| ----------------------- | ------------------------------------------------------------------------------- |
| Session identifier      | UUID assigned at creation                                                       |
| Session file            | `~/.shrimp/sessions/<id>.jsonl` — append-only; one entry per message exchange   |
| Current Session pointer | `~/.shrimp/state.json` — holds the active Session ID                            |
| Base directory          | `~/.shrimp/` (default; see Deployment & Configuration for the override env var) |

**Session rotation via `/new`:**

When the `/new` Slash Command is received, a new Session is created and becomes current. The previous Session file is retained on disk as an archive. Full Slash Command parsing rules are defined in [Slash Commands](#slash-commands).

**Auto Compact:**

Auto Compact is the mechanism that automatically rotates a ChannelJob Session when its conversation history has grown large enough that the next agent invocation would consume tokens near the model's context limit. It is triggered by the Job Worker based on the prompt token usage reported by the AI provider for the turn just completed — not by message count, not by a client-side estimate. When triggered, Auto Compact invokes the SummarizePort to condense the conversation, then rotates to a new Session whose sole initial entry is the resulting Conversation Summary. The previous Session is archived identically to a `/new` rotation.

_Trigger rule:_

| Property            | Value                                                                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evaluation actor    | Job Worker (not Shrimp Agent)                                                                                                                                                                                                                                         |
| Evaluation timing   | After the ChannelJob's Shrimp Agent invocation completes successfully AND after the new ConversationMessage entries for that turn have been appended to the current Session JSONL file — i.e., the archived Session is always faithful to what was actually exchanged |
| Input to the check  | `promptTokens` from the just-completed Shrimp Agent invocation (the value the AI provider reports as `ai.usage.promptTokens` / `gen_ai.usage.input_tokens` for that turn's last step)                                                                                 |
| Comparison operator | `promptTokens >= Compaction Threshold` ⇒ compaction runs                                                                                                                                                                                                              |
| Missing token count | If the AI provider does not return a token count for the completed turn, compaction is skipped for this turn; the turn's messages remain in the current Session normally; see [Failure Handling](#failure-handling) for the failure rule                              |

_Compaction procedure (ordered):_

1. Take a snapshot of the current Session's full ConversationMessage list as it stands after the just-completed turn's entries have been appended (the current Session JSONL is therefore complete and faithful before any rotation begins).
2. Invoke the SummarizePort with that ConversationMessage list; receive a Conversation Summary string.
3. Generate a new Session UUID.
4. Create a new Session JSONL file at `<SHRIMP_STATE_DIR>/sessions/<new-id>.jsonl` whose first and only entry is a `ConversationMessage` with `role: "system"` carrying the Conversation Summary as its content. (`role: "system"` is the ConversationMessage variant that represents a Conversation Summary; it is the same role field used to carry system-level context in the conversation history.)
5. Atomically update `state.json` to point to the new Session ID.
6. Leave the previous Session JSONL file on disk untouched as an archive — identical semantics to the `/new` Slash Command rotation (see [Session rotation via `/new`](#session-lifecycle) above).

_Effect on the next ChannelJob:_

- The next ChannelJob reads the new Session, whose history contains exactly one entry: the `role: "system"` Conversation Summary. The Shrimp Agent receives this summary in place of the older individual turns.
- Subsequent turns are appended to the new Session JSONL normally.

_HeartbeatJob exclusion:_

- HeartbeatJob has no Session, does not evaluate the Compaction Threshold, and never invokes SummarizePort. Auto Compact applies only to ChannelJob.

_Concurrency and timing invariants:_

- Auto Compact runs inside the Job Worker's Job Queue slot for the same ChannelJob that triggered the threshold evaluation. It is therefore serialized with all other Jobs; no parallel compaction can occur.
- One ChannelJob triggers at most one compaction. If the threshold is met, compaction runs once; the next ChannelJob evaluates the threshold anew against the new Session's prompt token usage.

_Relationship to `/new`:_

- `/new` continues to work as defined: the user can always manually rotate Sessions. Auto Compact performs the same rotation automatically when the token threshold is met.
- If Auto Compact rotated during a ChannelJob and `/new` arrives in a subsequent message, `/new` rotates from the (post-compaction) new Session normally. No interaction hazard exists beyond that.

_Failure handling:_

See [Failure Handling](#failure-handling) for Auto Compact failure rules (item covers SummarizePort errors, missing token counts, and JSONL/state.json write failures).

**Participation in Jobs:**

| Job type     | Session access                                                                        | Auto Compact participation                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ChannelJob   | Reads the current Session before invoking the Shrimp Agent; appends new entries after | Subject to Auto Compact; after new entries are appended, the Job Worker evaluates the Compaction Threshold and, if met, rotates the Session via SummarizePort (see [Auto Compact](#session-lifecycle) above) |
| HeartbeatJob | Does not read or write any Session                                                    | Not subject to Auto Compact; has no Session, never evaluates the Compaction Threshold, never invokes SummarizePort                                                                                           |

**Failure handling:**

| Failure condition                                | Behavior                                                                                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.json` missing                             | Treated as "no current Session"; the next Channel message creates a fresh one                                                                                                                       |
| `state.json` malformed (unparseable)             | Fail fast at startup                                                                                                                                                                                |
| Current Session JSONL file missing or unreadable | Current Session is discarded; the next Channel message creates a fresh one; the broken file is left on disk for inspection                                                                          |
| JSONL append failure during a Job                | Fail-Open Recovery — the Job is not failed solely because a conversation entry could not be persisted; the loss is logged and the next message continues from the last successfully persisted entry |

### Slash Commands

Slash Commands are Channel messages whose text begins with `/`. The Channel adapter intercepts them and handles them directly — no Job is enqueued and the Shrimp Agent is not invoked.

**Parsing rules:**

- A message is a Slash Command if and only if its text begins with `/` as the first character.
- The command name is the token immediately after `/`, up to the first whitespace or end of message; comparison is case-insensitive (normalized to lowercase).
- Text after the first whitespace is accepted as arguments; no current command uses arguments.
- An unrecognised command produces a short reply to the Channel informing the user the command is unknown. No Job is enqueued; no Session is modified.

**Supported commands:**

| Command | Effect                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/new`  | Creates a new Session that becomes current. The previous Session is retained on disk as an archive (see [Session Lifecycle](#session-lifecycle)). The adapter replies to the Channel confirming the new Session started. |

Only `/new` is supported. Additional commands are out of scope (see [IS NOT](#is-not)).

**Dispatch semantics:**

- Slash Commands are handled entirely by the Channel adapter; they do not enter the Job Queue.
- Because they bypass the Job Queue, a Slash Command is processed even when the Job Queue slot is busy.
- The adapter sends its reply back to the originating Channel conversation via the ConversationRef, using ChannelGateway.

**Failure handling:**

If a command handler fails (e.g., `/new` cannot create a new Session), the adapter replies to the Channel with a short failure message and logs the error. No Job is created. Fail-Open Recovery applies — the process remains available for subsequent events.

### Telemetry Emission

Every Job that runs produces one OTel trace. Spans within that trace expose task selection, agent execution, and each tool call as separately timed, attributable units of work that downstream collectors and dashboards can query.

**Trace lifecycle rules:**

- A Job that is dropped by the Job Queue (slot busy) does not produce a trace; no spans are emitted for dropped Jobs.
- A Job that runs but finds no actionable task still produces a trace containing only the root span. This makes "nothing to do" observable and distinguishable from a Job that was never triggered.
- A Job that selects and executes a task produces a full trace: root span plus all nested AI SDK spans for that execution.

**Root span:**

The Job Worker owns the root span. It begins when the Job starts and ends when the Job completes or fails, covering the full lifecycle: task selection, prompt assembly, Shrimp Agent execution, and queue slot release. All AI SDK spans emitted during Shrimp Agent execution are nested under this root span via OpenTelemetry context propagation.

The root span name reflects the HTTP entry point that produced the Job, following OpenTelemetry HTTP semantic conventions (`{method} {route}`):

| Job variant    | Root span name                                               |
| -------------- | ------------------------------------------------------------ |
| `HeartbeatJob` | `POST /heartbeat`                                            |
| `ChannelJob`   | `POST /channels/{channel}` (e.g., `POST /channels/telegram`) |

The root span always carries `http.request.method`, `http.route`, and `url.path` so downstream backends can filter traces by entry point — distinguishing idle Heartbeats from Channel-triggered Jobs by span name alone. The HTTP adapter MAY enrich the root span with additional OpenTelemetry HTTP semantic-convention attributes when the headers are present (e.g., `user_agent.original`, `http.request.body.size`) and with channel-specific attributes when the information is directly available on the incoming request. For the Telegram webhook this includes `telegram.chat.id`, `telegram.update.id`, and `telegram.message.text.length` — diagnostic fields chosen to enable per-chat filtering and duplicate-delivery investigation without persisting the raw message body. The root span is the HTTP-entry-facing identity of the Job; the logical Shrimp Agent identity (`shrimp.job`) is carried on the nested `invoke_agent shrimp.job` span (see [Nested AI SDK spans](#nested-ai-sdk-spans) below), not on the root.

**Nested AI SDK spans:**

When the Shrimp Agent executes, AI SDK emits spans following its own telemetry conventions. Shrimp enables these spans and does not alter their structure. The spans consumers will see are:

| Span name                    | Emitted                                            |
| ---------------------------- | -------------------------------------------------- |
| `ai.generateText`            | Once per Job — the full Shrimp Agent invocation    |
| `ai.generateText.doGenerate` | Once per provider round-trip within the agent loop |
| `ai.toolCall`                | Once per tool invocation (Built-in and MCP tools)  |

AI SDK's own span schema and nesting conventions apply; Shrimp does not define or alter them.

**Span attributes:**

Each span carries attributes sourced from two overlapping conventions that AI SDK emits together:

| Attribute group                 | Example attributes                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| AI SDK native                   | `ai.model.id`, `ai.model.provider`, `ai.usage.promptTokens`, `ai.usage.completionTokens`, `ai.response.finishReason`                 |
| OTel GenAI semantic conventions | `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons` |

Tool call spans additionally carry: `ai.toolCall.name`, `ai.toolCall.id`, `ai.toolCall.args`, and `ai.toolCall.result` (present only when the call succeeds and the result is serializable).

`GenAiBridgeSpanProcessor` supplements AI SDK's native emission with full OTel gen_ai semconv coverage: LLM-call spans receive `gen_ai.operation.name=chat`, structured `gen_ai.input.messages` and `gen_ai.output.messages`; tool-call spans receive `gen_ai.operation.name=execute_tool` and `gen_ai.tool.*` attrs. The `invoke_agent shrimp.job` span (the Shrimp Agent invocation, nested under the HTTP-named root span) carries `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.name="shrimp.job"`, `gen_ai.provider.name`, and `error.type` on failure. For a **ChannelJob**, `gen_ai.conversation.id` is set to the **Session ID** (the UUID of the Session whose history the agent received), enabling cross-Job correlation within a conversation. For a **HeartbeatJob**, `gen_ai.conversation.id` is not emitted — there is no conversation context to correlate.

**Function identification:**

Shrimp sets a stable `ai.telemetry.functionId` on the Shrimp Agent invocation so operators can filter traces by logical operation. The assigned identifier is `shrimp.job`.

**Input and output recording:**

By default, the agent's assembled prompt and the model's generated text are recorded on spans. Both inputs and outputs are captured unless explicitly disabled — that configuration knob is covered separately under Deployment & Configuration.

### Telemetry Configuration

Telemetry is controlled at startup. The following rules govern how configuration changes and export failures affect the system.

**Enable / disable semantics:**

- When telemetry is disabled: no spans are emitted, no tracer is initialized, and no exporter connections are opened. The Job and Shrimp Agent run identically to a non-tracing deployment — disabling telemetry has no observable effect on task execution.
- When telemetry is enabled: spans are emitted per the [Telemetry Emission](#telemetry-emission) contract.
- The enable/disable decision is fixed at startup and does not change during process lifetime. There is no runtime toggle.

**Input / output recording:**

- By default, both the assembled prompt text and the model's generated text are recorded on spans (as stated in Telemetry Emission).
- Privacy-sensitive deployments may disable input recording, output recording, or both. Disabling either preserves all non-content attributes — model identifier, token usage counts, finish reason, and tool call names, arguments, and results are unaffected.
- This is a deployment-time setting, not a per-request or per-task knob.

**Exporter failure is fail-open:**

- Exporter errors — including network failure, backend unavailability, timeout, and serialization error — must never propagate into the Job. The Job completes its work; task state in Todoist is never affected by telemetry failures.
- This is consistent with the Fail-Open Recovery pattern applied to Todoist and AI provider failures during Job processing.
- Dropped spans are lost. Shrimp has no local span buffer beyond what the OpenTelemetry SDK provides internally, and does not retry, persist, or re-queue spans on behalf of a failing exporter.

**Startup validation:**

- If telemetry is enabled but required telemetry configuration is missing or malformed at startup, the process fails fast — consistent with the fail-fast pattern applied to missing required environment variables and malformed `.mcp.json` (see [Failure Handling](#failure-handling) and [Deployment & Configuration](#deployment--configuration)).
- If telemetry is disabled, telemetry-related configuration is not validated.

**Initialization ordering:**

- If telemetry is enabled, the tracer and exporter are initialized before the HTTP server starts accepting heartbeats. This guarantees that the first Job can emit spans; no Job runs before the telemetry infrastructure is ready.

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

Shrimp is a single-process service composed of multiple collaborating components. Within the process, the **Supervisor** is the internal component that receives heartbeats, owns the Job Queue, and dispatches Job Workers. tsyringe wires all components together at startup; no component constructs its own dependencies.

| Component         | Responsibility                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP Layer (Hono) | Accepts inbound requests, validates route contracts, delegates to the Supervisor                                                                                                                              |
| Supervisor        | Internal component of Shrimp; receives accepted heartbeats, owns the Job Queue, and dispatches Job Workers                                                                                                    |
| Job Queue         | Concurrency gate; limits simultaneous Jobs to one                                                                                                                                                             |
| Job Worker        | Orchestrates one Job: selects a task, promotes Backlog→In Progress, retrieves comment history, assembles prompts, and dispatches to the Shrimp Agent                                                          |
| Shrimp Agent      | AI execution engine: given prompts and a tool set, runs the tool-calling loop until the task is done, max steps reached, or an error occurs; posts progress comments and moves the task to Done when complete |
| Tool Layer        | Built-in Todoist tools for core operations; MCP servers for extensible capabilities                                                                                                                           |

### System Boundary

| Dimension      | Inside                                                                                           | Outside                                                              |
| -------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Responsibility | HTTP routing, job serialization, AI execution loop, progress reporting                           | Scheduling heartbeats, Todoist project structure, AI model selection |
| Interaction    | Receives `POST /heartbeat`, `POST /channels/telegram`, and `GET /health`; returns JSON responses | Caller's scheduling mechanism; Todoist API; AI provider endpoint     |
| Control        | Task state transitions (Backlog → In Progress → Done), comment posting                           | Todoist data model; AI model behavior; MCP tool implementations      |

### Component Dependencies

Key runtime dependencies: Hono (HTTP), tsyringe (DI), AI SDK (AI provider abstraction), MCP (tool extension).

### Request Flow

Each heartbeat traverses the following component chain:

```
POST /heartbeat
  → Hono route handler
  → Supervisor: accept or drop heartbeat
  → Job Queue (accept or drop)
    → Job Worker: select task, promote Backlog→InProgress, assemble prompts
      → Shrimp Agent: run tool-calling loop (execute, report progress, update status)
        → Built-in Tools + MCP Tools
    → Job Queue: release slot
```

`GET /health` is handled entirely within the Hono layer; it does not touch the Job Queue or the Shrimp Agent.

### Extension Model

The agent has two categories of tools: built-in tools for core Todoist operations, and MCP tools for extensible capabilities. Built-in tools (get tasks, get comments, post comment, move task) are always available and do not require MCP. Additional tools (file access, web search, code execution) are added by registering MCP servers via a `.mcp.json` configuration file; no changes to the agent are required.

### Telemetry

Telemetry is a process-level concern: the OpenTelemetry tracer provider and exporter pipeline are initialized at process startup, alongside HTTP server startup and configuration loading, not inside the Job Worker or Shrimp Agent. Once initialized, they participate via the ambient OpenTelemetry context; no component holds or passes tracer handles explicitly. This mirrors how `.mcp.json` loading is handled in the Extension Model — configuration is resolved once at startup, and the result is available to all components without tight coupling.

**Component responsibilities:**

| Component                | Telemetry responsibility                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process startup          | Initialize the tracer provider and exporter pipeline before the HTTP server accepts heartbeats                                                                              |
| Job Worker               | Own the root span lifecycle: start the span when the Job begins, propagate OTel context, end when the Job ends                                                              |
| Shrimp Agent (port)      | Telemetry-agnostic at the port level; the port contract has no tracing parameters                                                                                           |
| AiSdkShrimpAgent         | Forward telemetry settings into AI SDK's `experimental_telemetry`; annotate the `invoke_agent shrimp.job` span with agent-level gen_ai attrs (`invoke_agent`, `error.type`) |
| GenAiBridgeSpanProcessor | Translate AI SDK's `ai.*` span attrs to OTel gen_ai semconv (`gen_ai.*`) on span end; single translation point for all LLM-call and tool-call spans                         |
| Tool Layer               | No instrumentation required; AI SDK emits `ai.toolCall` spans for every Built-in and MCP tool call automatically                                                            |

**Inside vs. outside Shrimp:**

| Inside Shrimp                                                    | Outside Shrimp                                  |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| Root span lifecycle on Job Worker                                | Span transport to a backend collector or vendor |
| Forwarding telemetry settings to AI SDK (via `AiSdkShrimpAgent`) | Sampling policy and trace retention             |
| Initializing tracer and exporter at process startup              | Trace storage, querying, and visualization      |

Swapping `AiSdkShrimpAgent` for an alternative implementation requires no port changes and no changes to how `Job` manages the root span.

### Failure Handling

- **`.mcp.json` invalid format**: if the file exists but contains invalid JSON, is missing the `mcpServers` key, or has values that do not conform to the server definition structure, the process fails at startup (fail fast). An empty servers object (`{"mcpServers": {}}`) is valid and equivalent to no servers configured.
- **MCP server connection failure at startup**: the failed MCP server is excluded; the agent continues startup with the remaining servers. If no MCP servers connect successfully, the agent runs with Built-in Tools only.
- **Runtime AI/MCP failure during task processing**: Fail-Open Recovery applies.

### Job

A **Job** is the orchestration unit triggered by either a Heartbeat (**HeartbeatJob**) or a Channel message event (**ChannelJob**), executed by a **Job Worker** inside the **Job Queue's** single slot. Both variants share the same Job Worker skeleton and the same single slot; the Job Worker is responsible for everything that happens before and after the Shrimp Agent executes.

**Role contract:**

| Contract              | Description                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger               | HeartbeatJob: started when a Heartbeat is accepted into the Job Queue. ChannelJob: started when a Channel message event is accepted (after Slash Command filtering by the Channel adapter). Same single slot.             |
| Job ID                | Generates a **Job ID** (UUID v7) at Job start and threads it through to the Shrimp Agent invocation                                                                                                                       |
| Task selection        | HeartbeatJob only: selects one task (In Progress first by priority, then Backlog by priority); if none, Job ends immediately                                                                                              |
| Backlog promotion     | HeartbeatJob only: if the selected task is in Backlog, moves it to In Progress before proceeding                                                                                                                          |
| Comment retrieval     | HeartbeatJob only: fetches the task's comment history via the Built-in Get Comments tool to provide execution context                                                                                                     |
| Prompt assembly       | Assembles system and user prompts; user prompt contents differ by variant (HeartbeatJob: task context + comment history; ChannelJob: incoming Channel message, with Session history passed separately as `history` input) |
| Shrimp Agent dispatch | Invokes the Shrimp Agent exactly once with the assembled prompts, conversation history, the full tool set (Built-in + MCP), and Job ID                                                                                    |
| Completion            | The Job ends when the Shrimp Agent returns. The Job Queue releases the slot regardless of success or failure                                                                                                              |

**HeartbeatJob execution lifecycle:**

| Step | Actor        | Action                                                                                                                                                                                       |
| ---- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Job Worker   | Select one task: In Progress first by priority, then Backlog by priority; if none, Job ends immediately                                                                                      |
| 2    | Job Worker   | If task is in Backlog, move to In Progress via Built-in Move Task tool                                                                                                                       |
| 3    | Job Worker   | Retrieve task comments via Built-in Get Comments tool                                                                                                                                        |
| 4    | Job Worker   | Assemble system prompt (goal + tools) and user prompt (task context + comment history); pass empty `history` to Shrimp Agent                                                                 |
| 5    | Shrimp Agent | Run the tool-calling loop with the assembled prompts and all available tools; loop continues until done, max steps reached, or error; posts progress comment; moves task to Done if complete |

**ChannelJob execution lifecycle:**

| Step | Actor        | Action                                                                                                                                                          |
| ---- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Job Worker   | Load the current Session (or create a new one if none exists — see [Session Lifecycle](#session-lifecycle)); append the incoming Channel message to the Session |
| 2    | Job Worker   | Assemble system prompt (goal + tools) and user prompt (incoming Channel message); pass Session's ConversationMessage entries as `history` to the Shrimp Agent   |
| 3    | Shrimp Agent | Run the tool-calling loop with the assembled prompts, Session history, and all available tools; terminates on done, max steps, or error                         |
| 3a   | Job Worker   | Deliver each assistant ConversationMessage returned by the agent to the originating Channel conversation via ChannelGateway; failures are Fail-Open             |
| 4    | Job Worker   | Append new ConversationMessage entries produced during the invocation back to the Session via the Session Repository                                            |
| 5    | Job Queue    | Job ends; slot released regardless of success or failure                                                                                                        |

The Job Queue only starts the Job and releases the slot when the Job returns.

**Prompt structure:**

| Prompt        | Assembly                         | HeartbeatJob content                                                                                                               | ChannelJob content                                                                                      |
| ------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| System prompt | Dynamic, assembled per execution | Goal setting (complete the task, report progress) + available tools description (names and capabilities of built-in and MCP tools) | Same structure; goal framing reflects conversational context                                            |
| User prompt   | Fixed template                   | Task context: id, title, description, current section, and comment history from prior executions                                   | The incoming Channel message text; Session history is passed as the `history` input, not in this prompt |

**Prompt rules:**

- The system prompt is assembled at each Job execution. It describes the Shrimp Agent's goal and lists available tools (names and capabilities) so the model understands what actions it can take. Tool definitions for function calling are provided separately via AI SDK's tools parameter; the system prompt provides the human-readable context that guides tool usage.
- HeartbeatJob: the user prompt uses a fixed template to present Todoist task content in a structured format. It includes the task's comment history to provide execution context — this allows the Shrimp Agent to understand prior progress and avoid repeating work.
- ChannelJob: the user prompt contains the incoming Channel message. Conversation history is supplied separately as the `history` input to the Shrimp Agent (ordered ConversationMessage entries from the current Session), not embedded in the user prompt text.
- ChannelJob `history` shape after Auto Compact: if the current Session is a post-compaction Session (see [Auto Compact](#session-lifecycle)), its first ConversationMessage entry has `role: "system"` and carries a Conversation Summary of the pre-compaction turns; subsequent entries are normal user/assistant ConversationMessage entries appended after rotation. The Shrimp Agent consumes `history` opaquely and does not distinguish compacted from non-compacted Sessions — Session selection and compaction are the Job Worker's responsibility. HeartbeatJob `history` is always empty (see bullet above).
- When assembling comment history (HeartbeatJob only), comments prefixed with the Comment Tag are labeled as bot-authored; all other comments are labeled as user-authored. The Comment Tag prefix is stripped from the display text so the AI model sees only the original content.

**Job ID:**

The Job Worker generates a **Job ID** at the very start of each Job — before task selection — and carries it through to the Shrimp Agent invocation via `JobInput`.

| Aspect       | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose      | Domain-scoped correlation key that groups all spans and logs produced by a single Job; recorded on the `invoke_agent shrimp.job` span as a per-invocation identifier                                                                                                                                                                                                                                                                                                                                 |
| Generation   | UUID v7 (time-ordered; v4 is an acceptable fallback if the runtime does not expose v7). Generated by Shrimp, not by external callers                                                                                                                                                                                                                                                                                                                                                                 |
| Lifetime     | Per-Job only. A new Job generates a new ID. The ID is not persisted, not stored in Todoist, and not carried forward to subsequent Jobs                                                                                                                                                                                                                                                                                                                                                               |
| Propagation  | The Job Worker generates the ID and passes it to the Shrimp Agent as `JobInput.jobId: string`. The Shrimp Agent implementation records it on the `invoke_agent shrimp.job` span as the per-invocation identifier                                                                                                                                                                                                                                                                                     |
| OTel mapping | Invocation-scope correlation on the `invoke_agent shrimp.job` span — groups every span emitted within one Shrimp Agent invocation. The Job ID is NOT the source of `gen_ai.conversation.id`; cross-Job conversation correlation is provided by **Session ID** on ChannelJobs (see [Telemetry Emission](#telemetry-emission)), because the Shrimp Agent receives history as input rather than holding it as state. HeartbeatJobs emit no `gen_ai.conversation.id` — they have no conversation context |
| Failure      | UUID generation failure is not expected from a standard library; if it occurs, the Job fails fast. No fallback to empty string or zero UUID — a missing or blank ID would silently corrupt downstream correlation                                                                                                                                                                                                                                                                                    |

**IS NOT:**

- Not a user session ID or conversation history identifier
- Not an OTel trace ID — OTel already provides trace IDs for distributed tracing; the **Job ID** is the business-domain grouping key
- Not persisted to Todoist or any storage
- Not correlated across Shrimp restarts or across separate Jobs
- Not supplied by external callers (heartbeat callers have no knowledge of it)

### Shrimp Agent

The **Shrimp Agent** is the AI execution engine invoked once per Job. It is intentionally minimal: a single tool-calling loop against the configured AI provider, with no orchestration layers, planning steps, or internal retry logic beyond what the loop itself provides. The loop runs until the task is done, the maximum step limit is reached, or an error occurs.

**Role contract:**

| Contract      | Description                                                                                                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input         | Assembled system prompt, assembled user prompt, conversation history (an ordered list of ConversationMessage entries; empty for a HeartbeatJob, the current Session's entries for a ChannelJob), the full available tool set (Built-in + MCP), and the Job ID (`jobId: string`) generated by the Job Worker for this invocation |
| Output        | Loop terminated; the agent is responsible for posting progress comments and moving the task to Done (if complete) via tool calls during the loop                                                                                                                                                                                |
| Completion    | The agent determines task completion when the model invokes the Move Task tool to move the task to Done. If the loop terminates for any reason and the task has not been moved to Done, the task is considered incomplete.                                                                                                      |
| Maximum steps | Configurable via `AI_MAX_STEPS` environment variable (default: `50`). When reached, the tool loop terminates. The agent is responsible for completing its work within the step limit, including posting progress comments.                                                                                                      |
| Error         | Any error during the tool loop halts the loop immediately. Fail-Open Recovery applies.                                                                                                                                                                                                                                          |
| Failure       | On failure, comments already posted remain in Todoist. Fail-Open Recovery applies.                                                                                                                                                                                                                                              |

Supplying history as input does not make the Shrimp Agent stateful — loading the Session before invocation and appending new entries after are the Job Worker's responsibilities; the Shrimp Agent simply receives history as part of its input and does not persist anything.

**Provider abstraction:**

The Shrimp Agent uses AI SDK's provider interface with OpenAI-compatible conventions (`OPENAI_BASE_URL`, `OPENAI_API_KEY`). A different provider is used by pointing these variables to another OpenAI-compatible endpoint. The agent has no knowledge of which provider is active — it calls AI SDK, and AI SDK calls the provider. The configured model must support tool calling (function calling); if it does not, the agent cannot execute tasks.

| Dimension             | Inside the Shrimp Agent                                      | Outside the Shrimp Agent                                        |
| --------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| Model selection       | No — reads from configuration                                | Provider endpoint and model name are environment configuration  |
| Prompt construction   | No — prompts are assembled by the Job Worker and passed in   | Task content originates in Todoist                              |
| Tool execution        | Yes — invokes tool calls returned by the model               | Built-in tools are internal; MCP tools live in external servers |
| Result interpretation | Yes — decides whether the task is done based on model output | Model judgment drives the decision                              |

**Tool integration:**

The Shrimp Agent uses two categories of tools:

| Category | Tools                                            | Source                                         |
| -------- | ------------------------------------------------ | ---------------------------------------------- |
| Built-in | Get tasks, Get comments, Post comment, Move task | Compiled into the agent; always available      |
| MCP      | Any tools from registered MCP servers            | Discovered from `.mcp.json` at process startup |

Built-in tools handle core Todoist operations. MCP tools extend the agent's capabilities without code changes.

The Post Comment tool is responsible for prepending the Comment Tag to every comment. The AI model's text input is preserved as-is; the tag is added at the tool boundary before the Todoist API call.

### SummarizePort

**SummarizePort** is the AI port invoked by the Job Worker during a ChannelJob when the Compaction Threshold is met (see [Session Lifecycle § Auto Compact](#session-lifecycle)). It receives the pre-compaction ConversationMessage list and returns a single Conversation Summary string. SummarizePort is **distinct from and independent of** the Shrimp Agent — it is not an agent, has no tool-calling loop, and is not involved in task execution. It exists solely to compress Session history into a summary that the Job Worker can use as the first entry of the new Session.

**Role contract:**

| Contract   | Description                                                                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input      | An ordered list of ConversationMessage entries representing the pre-compaction history of the current Session (the full snapshot taken by the Job Worker in Auto Compact Step 1), and the Job ID from the invoking ChannelJob for correlation purposes               |
| Output     | A single Conversation Summary string. The content is determined by the AI model; no fixed template is imposed by Shrimp. The string becomes the `content` of a `role: "system"` ConversationMessage that the Job Worker places as the first entry of the new Session |
| Invocation | Exactly once per Auto Compact event. Not invoked by HeartbeatJob (see [Session Lifecycle § Auto Compact](#session-lifecycle)). Not invoked by any other component.                                                                                                   |
| Completion | Returns when the model produces the summary. No multi-step loop, no tool calls.                                                                                                                                                                                      |
| Failure    | Any error is returned synchronously to the Job Worker. Failure handling rules are defined in [Failure Handling](#failure-handling).                                                                                                                                  |

**Provider abstraction:**

SummarizePort uses AI SDK's provider interface with OpenAI-compatible conventions (`OPENAI_BASE_URL` / `OPENAI_API_KEY`) in the same style as the Shrimp Agent. The summarization model identifier is configurable independently of the agent model via `AUTO_COMPACT_MODEL` (see [Environment Variables](#environment-variables)). Because SummarizePort does not use tools, the configured summarization model does **not** need to support tool calling (function calling).

| Dimension              | Inside the SummarizePort                                                                                                                                                          | Outside the SummarizePort                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Model selection        | No — reads from configuration                                                                                                                                                     | Provider endpoint and model name are environment configuration |
| Prompt construction    | Yes — the port builds whatever prompt it needs to produce a Conversation Summary from the input ConversationMessage list; the Job Worker does not assemble a summarization prompt | Input ConversationMessage list originates in the Session       |
| Tool execution         | No — SummarizePort has no tools                                                                                                                                                   | N/A                                                            |
| Summary interpretation | No — the Job Worker treats the returned string as opaque content and places it into the new Session as-is                                                                         | Job Worker owns Session construction after compaction          |

**Independence from Shrimp Agent:**

- SummarizePort does **not** share the Shrimp Agent's tool set (Built-in or MCP). It has no tools of any kind.
- SummarizePort does **not** participate in the Job Queue separately — it runs inline inside the ChannelJob that triggered compaction (see [Session Lifecycle § Auto Compact](#session-lifecycle)).
- Swapping the SummarizePort implementation requires no change to the Shrimp Agent; swapping the Shrimp Agent requires no change to SummarizePort.
- HeartbeatJob never invokes SummarizePort (see [Session Lifecycle § Auto Compact](#session-lifecycle)).

## Deployment & Configuration

### Environment Variables

Runtime configuration is supplied through environment variables and a `.mcp.json` configuration file.

| Variable                       | Purpose                                                                                                                                                                                                                                                             | Required                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `OPENAI_BASE_URL`              | Base URL of the OpenAI-compatible AI provider                                                                                                                                                                                                                       | Yes                                                                                    |
| `OPENAI_API_KEY`               | API key for the AI provider                                                                                                                                                                                                                                         | Yes                                                                                    |
| `AI_MODEL`                     | Model identifier to use (e.g., `gpt-4o`)                                                                                                                                                                                                                            | Yes                                                                                    |
| `AI_MAX_STEPS`                 | Maximum tool-loop steps per task execution; if absent or not a valid positive integer, falls back to default                                                                                                                                                        | No (default: `50`)                                                                     |
| `TODOIST_API_TOKEN`            | Todoist personal API token                                                                                                                                                                                                                                          | Yes                                                                                    |
| `TODOIST_PROJECT_ID`           | ID of the Todoist project used as the Board                                                                                                                                                                                                                         | Yes                                                                                    |
| `PORT`                         | HTTP port the service listens on                                                                                                                                                                                                                                    | No (default: `3000`)                                                                   |
| `SHRIMP_HEARTBEAT_TOKEN`       | Shared secret that `POST /heartbeat` callers must present as `Authorization: Bearer <token>`. When unset, `/heartbeat` accepts unauthenticated requests                                                                                                             | No (default: unset — authentication disabled)                                          |
| `TELEMETRY_ENABLED`            | Master toggle — enables OTel trace emission; when absent or `false`/`0`, telemetry is disabled                                                                                                                                                                      | No (default: off)                                                                      |
| `OTEL_SERVICE_NAME`            | Service name resource attribute attached to every emitted span                                                                                                                                                                                                      | Yes when telemetry enabled; No otherwise                                               |
| `OTEL_EXPORTER_OTLP_ENDPOINT`  | OTLP collector URL to which spans are exported                                                                                                                                                                                                                      | Yes when telemetry enabled; No otherwise                                               |
| `OTEL_EXPORTER_OTLP_HEADERS`   | Authentication or routing headers for the OTLP collector (comma-separated `key=value` pairs)                                                                                                                                                                        | No                                                                                     |
| `TELEMETRY_RECORD_INPUTS`      | When `false`/`0`, omits assembled prompt text from span attributes                                                                                                                                                                                                  | No (default: on)                                                                       |
| `TELEMETRY_RECORD_OUTPUTS`     | When `false`/`0`, omits model-generated text from span attributes                                                                                                                                                                                                   | No (default: on)                                                                       |
| `CHANNELS_ENABLED`             | Master toggle — enables Channel-triggered Jobs (Telegram webhook route, Session loading). When absent or `false`/`0`, Channels are disabled and `/heartbeat` remains the only way to trigger Jobs.                                                                  | No (default: off)                                                                      |
| `TELEGRAM_BOT_TOKEN`           | Bot token used by the Telegram Channel adapter to accept webhook callbacks and send replies.                                                                                                                                                                        | Yes when `CHANNELS_ENABLED` is on and the Telegram Channel is configured; No otherwise |
| `TELEGRAM_WEBHOOK_SECRET`      | Shared secret Telegram must present on every webhook callback; requests without a matching secret are rejected.                                                                                                                                                     | Yes when `CHANNELS_ENABLED` is on and the Telegram Channel is configured; No otherwise |
| `SHRIMP_STATE_DIR`             | Filesystem directory holding Session state (`state.json` and `sessions/<id>.jsonl` files).                                                                                                                                                                          | No (default: `~/.shrimp`)                                                              |
| `AUTO_COMPACT_TOKEN_THRESHOLD` | Compaction Threshold — when `CHANNELS_ENABLED` is on and the AI provider reports last-turn prompt token usage `>=` this integer value, Auto Compact runs for the current Session. No default; operators must choose a value that fits their model's context window. | Required when `CHANNELS_ENABLED` is on; not read otherwise                             |
| `AUTO_COMPACT_MODEL`           | Model identifier used by SummarizePort, overriding `AI_MODEL` for summarization calls only. The configured summarization model does not need to support tool calling. Only read when `CHANNELS_ENABLED` is on.                                                      | No (default: falls back to `AI_MODEL`); not read when `CHANNELS_ENABLED` is off        |

**Rules:**

- Fail at startup: the process logs the error to stderr and exits with a non-zero exit code before accepting any HTTP requests.
- Missing required variables cause the process to fail at startup; no partial startup allowed.
- Supplementary MCP servers are configured via a `.mcp.json` file in the project root. The file is a JSON object with a `mcpServers` key mapping server names to their definitions. Only the **Streamable HTTP transport** is supported: each definition has `type: "http"` (default when omitted), a required `url` string, and an optional `headers` object of string values for authentication. Stdio (`command`/`args`) and SSE transports are rejected at startup — Shrimp runs as a long-lived service and does not spawn local subprocesses for tools.
- If `.mcp.json` is absent or contains no servers, the agent runs with built-in tools only.
- The built-in Todoist tools (Get tasks, Get comments, Post comment, Move task) are compiled into the agent and always available. `.mcp.json` adds supplementary tools only.
- **`OTEL_*` variables are pass-through:** Shrimp reads them and passes them to the OpenTelemetry SDK; they are not re-aliased or duplicated under Shrimp-owned names.
- **Shrimp-owned telemetry variables** (`TELEMETRY_ENABLED`, `TELEMETRY_RECORD_INPUTS`, `TELEMETRY_RECORD_OUTPUTS`) follow the same unprefixed uppercase convention as `AI_*` and `TODOIST_*` variables.
- **When `TELEMETRY_ENABLED` is false or unset**, the `OTEL_*` variables and `TELEMETRY_RECORD_*` variables are neither required nor read. Startup validation is skipped for all telemetry configuration. See [Telemetry Configuration](#telemetry-configuration) for the full enable/disable contract.
- **When telemetry is enabled but a required telemetry variable is missing or malformed**, the process fails fast at startup — consistent with the fail-fast pattern applied to all required variables above. See [Telemetry Configuration](#telemetry-configuration) for startup validation rules.
- **When `CHANNELS_ENABLED` is false or unset**, the `TELEGRAM_*` and `SHRIMP_STATE_DIR` variables are neither required nor read; startup validation is skipped for Channel-related configuration. See [Channel Integration](#channel-integration) for runtime rules.
- **When `CHANNELS_ENABLED` is enabled but a required Telegram variable is missing or malformed**, the process fails fast at startup — consistent with the fail-fast pattern applied to other required variables.
- **`SHRIMP_STATE_DIR` is read only when Channels are enabled.** If the directory does not exist at startup, Shrimp creates it; if creation fails, the process fails fast.
- **`SHRIMP_HEARTBEAT_TOKEN` is opt-in.** When unset or empty, heartbeat authentication is disabled and no validation runs. When set to a non-empty string, `/heartbeat` enforces the token on every request (see [`POST /heartbeat`](#post-heartbeat)). The value is treated as an opaque string; Shrimp does not impose a format, length, or rotation policy.
- **Telegram webhook registration is external to Shrimp.** When the Telegram Channel is enabled, the operator registers the webhook with Telegram pointing at the publicly reachable URL for `POST /channels/telegram` and provides the same value as `TELEGRAM_WEBHOOK_SECRET`. Shrimp does not perform this registration.
- **`AUTO_COMPACT_TOKEN_THRESHOLD` is required when `CHANNELS_ENABLED` is on.** A missing value, or a value that is not a positive integer, causes the process to fail fast at startup. The variable is not read when `CHANNELS_ENABLED` is off.
- **`AUTO_COMPACT_MODEL` is optional.** When unset, SummarizePort falls back to `AI_MODEL` as the summarization model identifier. The variable is not read when `CHANNELS_ENABLED` is off.
- **The Compaction Threshold is compared with `>=` against the AI provider's last-turn prompt token usage.** When the reported value meets or exceeds the threshold, Auto Compact runs for the current Session (see [Session Lifecycle § Auto Compact](#session-lifecycle)).

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
- Container restart causes in-flight Job work to be lost; Todoist remains the source of truth and the task is retried on the next heartbeat.
- In Docker deployments, `dotenv` is not active; all variables are supplied via Docker's env injection mechanisms.

### Development Setup

For local development, configuration is loaded from a `.env` file in the project root via `dotenv`.
