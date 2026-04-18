# Shrimp Architecture

## 1. Purpose

This document defines **how Shrimp's code is organized**: the layers, directory layout, dependency direction, core abstractions (ports), and the mapping from SPEC components to concrete modules. It serves as the blueprint for ongoing implementation, ensuring every new module lands in the correct layer and depends in the correct direction from day one.

This document does **not** restate behavioral rules. All endpoint contracts, Job lifecycle steps, failure recovery rules, and environment variables are defined in `SPEC.md`. The two documents divide responsibility as follows:

| Document               | Concerned with                                     | Used when                                                                          |
| ---------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `SPEC.md`              | What & Why — behavior, contracts, success criteria | Designing requirements, acceptance testing, answering "what should the system do?" |
| `docs/architecture.md` | How (structure) — modules, layers, dependencies    | Implementation, code review, answering "where does this code belong?"              |

## 2. Scope

- **In scope**: layer structure, directory mapping, dependency rules, key ports, component contracts, naming conventions, failure handling placement.
- **Out of scope**: concrete algorithms, API signatures, database schemas (Shrimp owns no persistence), deployment details (see `SPEC.md` §Deployment).

`SPEC.md` is the source of truth. If this document and the SPEC disagree, the SPEC wins — update this document to match.

## 3. Layer Structure

Shrimp follows the four-layer Clean Architecture model. Each layer has a clear responsibility and a strict dependency direction.

| Layer                    | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                              | May depend on                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Entities**             | Core domain types used throughout Shrimp: Task, Section, Priority, Comment, and pure policy objects such as TaskSelector. Because Shrimp does not own the write path for any of this data (Todoist is the authoritative state), entities here act as **read models** and **pure domain logic**, not as DDD write-side aggregates.                                                                                                                                     | Nothing                                  |
| **Use Cases**            | Application orchestration: `HeartbeatJob` and `ChannelJob` (the two Job Worker variants that assemble prompts and invoke the Shrimp Agent once per triggering event), `PromptAssembler`, `StartNewSession`, and the **port interfaces** for every external dependency (`BoardRepository`, `ShrimpAgent`, `JobQueue`, `ToolProvider`, `SessionRepository`, `ChannelGateway`). This layer has no knowledge of Hono, AI SDK, the Todoist client, or MCP implementations. | Entities                                 |
| **Interface Adapters**   | Boundary converters in two directions. **Inbound from HTTP**: Hono route handlers for `/health` and `/heartbeat`. **Inbound from the agent loop**: each built-in tool (Get Tasks, Get Comments, Post Comment, Move Task) is an inbound adapter that the agent invokes during its loop — the tool validates arguments, calls `BoardRepository`, and formats the result back for the AI SDK. The Tool Registry merges built-in and MCP tools into a single provider.    | Use Cases, Entities                      |
| **Frameworks & Drivers** | Integration with the outside world: Hono server, Todoist REST client, AI SDK provider, MCP client, tsyringe registrations, dotenv, environment variable validation, in-memory Job Queue implementation. This is the only layer allowed to import third-party SDKs directly.                                                                                                                                                                                           | Use Cases (to implement ports), Entities |

**Naming choice**: the two inner layers use the literal Clean Architecture names (`entities/`, `use-cases/`) for precision; the two outer layers use the most common community conventions (`adapters/`, `infrastructure/`), since the literal names ("Interface Adapters", "Frameworks & Drivers") are awkward or ambiguous as directory names.

## 4. Directory Mapping

```
src/
  entities/
    task.ts                    # Task read model: id / title / description / priority / section
    section.ts                 # Section enum: Backlog / InProgress / Done
    priority.ts                # Priority value object: p1–p4 with ordering
    comment.ts                 # Comment value object: text + timestamp
    task-selector.ts           # Pure selection policy: In Progress first, then Backlog, by Priority
    session.ts                 # Session read model: id + ordered messages
    conversation-message.ts    # ConversationMessage value object: role + content
    channel-message.ts         # ChannelMessage value object: ConversationRef + text
    conversation-ref.ts        # ConversationRef value object: channel identity for routing

  use-cases/
    ports/
      board-repository.ts      # Todoist Board abstraction (outbound)
      shrimp-agent.ts           # Shrimp Agent port: black-box tool-calling loop invocation (outbound)
      job-queue.ts              # Concurrency gate abstraction (inbound, used by HTTP)
      telemetry.ts              # Telemetry port: runInSpan + shutdown (outbound)
      tool-provider.ts          # Merged tool-list provider (outbound)
      session-repository.ts     # Session read/write abstraction (outbound)
      channel-gateway.ts        # Outbound reply-delivery abstraction
    jobs/
      heartbeat-job.ts          # HeartbeatJob: selects task, invokes ShrimpAgent
      channel-job.ts            # ChannelJob: loads Session, invokes ShrimpAgent
    start-new-session.ts        # Rotates current Session; invoked by Channel adapter on /new
    prompt-assembler.ts         # Builds system prompt + user prompt

  adapters/
    http/
      routes/
        health.ts               # GET /health
        heartbeat.ts            # POST /heartbeat
        telegram-webhook.ts     # POST /telegram/webhook — routes to ChannelJob or Slash Command handler
    tools/
      built-in/
        get-tasks.ts            # Inbound adapter → BoardRepository.getTasks
        get-comments.ts         # Inbound adapter → BoardRepository.getComments
        post-comment.ts         # Inbound adapter → BoardRepository.postComment
        move-task.ts            # Inbound adapter → BoardRepository.moveTask
        reply.ts                # Inbound adapter → ChannelGateway.send; no-op when ConversationRef is null
      tool-registry.ts          # Merges built-in + MCP tools (ToolProvider impl)

  infrastructure/
    queue/
      in-memory-job-queue.ts    # Single-slot JobQueue implementation
    todoist/
      todoist-client.ts         # Raw Todoist REST client
      todoist-board-repository.ts  # BoardRepository implementation
    ai/
      ai-provider-factory.ts    # Creates an OpenAI-compatible provider
      ai-sdk-shrimp-agent.ts    # ShrimpAgent implementation (AI SDK tool loop)
    mcp/
      mcp-tool-loader.ts        # Parses .mcp.json, starts MCP clients, exposes tools
    config/
      env.ts                    # Environment variable loading and validation
      mcp-config.ts             # .mcp.json parsing
    telemetry/
      noop-telemetry.ts              # NoopTelemetry adapter (TELEMETRY_ENABLED=false path)
      otel-telemetry.ts              # OtelTelemetry adapter (NodeSDK + OTLP HTTP exporter)
      gen-ai-bridge-span-processor.ts # Translates ai.* attrs → gen_ai semconv on span end
      telemetry-factory.ts           # createTelemetry(env, logger): selects Noop vs Otel
    session/
      jsonl-session-repository.ts  # SessionRepository: JSONL per session + state.json pointer
    channel/
      telegram-channel.ts          # ChannelGateway: Telegram Bot API send

  container.ts                  # tsyringe bindings (composition root)
  app.ts                        # Hono app composition
  server.ts                     # Process entry (loads dotenv, starts server)
```

Maximum depth is three levels (`src/<layer>/<sub-module>/<file>`) to avoid excessive nesting.

## 5. Dependency Rules

Dependencies always point inward:

```
Frameworks & Drivers ──▶ Interface Adapters ──▶ Use Cases ──▶ Entities
                                     │
                                     └──▶ Entities
```

Specific rules:

| From                                  | May import                                   | Must not import                                                                                                          |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `entities/`                           | Other files under `entities/` only           | Any other layer, any third-party package                                                                                 |
| `use-cases/`                          | `entities/`                                  | `adapters/`, `infrastructure/`, Hono, AI SDK, Todoist client, MCP SDK                                                    |
| `adapters/`                           | `use-cases/`, `entities/`                    | `infrastructure/` (must go through a port), though boundary-style third-party types such as Hono's `Context` are allowed |
| `infrastructure/`                     | `use-cases/` (port definitions), `entities/` | `adapters/`                                                                                                              |
| `container.ts`, `app.ts`, `server.ts` | Every layer                                  | —                                                                                                                        |

**The rule of ports**: every cross-layer dependency goes through an interface under `use-cases/ports/`. `infrastructure/` provides the implementation; `use-cases/` sees only the interface; the three are wired in `container.ts` via tsyringe.

`server.ts`, `app.ts`, and `container.ts` are the three composition roots — the only files allowed to reach into every layer.

## 6. Key Ports

The components defined in `SPEC.md` §Architecture Overview are abstracted in code via ports. The Job (Job Worker) is not among them — it is a use-case class that orchestrates these ports. `TelemetryPort` is not itself a SPEC component either, but is listed here because it is the contract that use-cases depend on to emit spans without taking any third-party dependency:

| Port                | File                                    | Direction                                           | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BoardRepository`   | `use-cases/ports/board-repository.ts`   | Outbound                                            | Encapsulates the four built-in Todoist operations: list tasks by section, list comments, post comment, move task. Hides REST API details.                                                                                                                                                                                                                                                                                               |
| `ShrimpAgent`       | `use-cases/ports/shrimp-agent.ts`       | Outbound                                            | A single black-box invocation of the AI tool-calling loop. The caller (Job Worker) hands over assembled prompts and the full tool set; the adapter runs the loop internally (AI SDK or equivalent) and returns the model's final state when the loop terminates. Shrimp does not control iterations from outside.                                                                                                                       |
| `JobQueue`          | `use-cases/ports/job-queue.ts`          | Inbound (used by HTTP handlers)                     | Single-slot concurrency gate: tries to accept a run, releases the slot when the cycle completes or fails. Encapsulates the synchronization primitive.                                                                                                                                                                                                                                                                                   |
| `ToolProvider`      | `use-cases/ports/tool-provider.ts`      | Outbound                                            | Supplies the currently available tool set (built-in Todoist tools + MCP tools). Consumed by the `ShrimpAgent` implementation.                                                                                                                                                                                                                                                                                                           |
| `TelemetryPort`     | `use-cases/ports/telemetry.ts`          | Outbound (consumed by `Job` and `AiSdkShrimpAgent`) | Exposes `runInSpan(name, fn)` for wrapping work in a named span (the adapter owns the full span lifecycle: start, exception recording, end) and a `shutdown()` for graceful flush. The port surface carries no `@opentelemetry/api` types — use-cases stay dependency-free. Two infrastructure adapters: `NoopTelemetry` (runInSpan is a passthrough when telemetry is disabled) and `OtelTelemetry` (NodeSDK with OTLP HTTP exporter). |
| `SessionRepository` | `use-cases/ports/session-repository.ts` | Outbound                                            | Loads, creates, and appends to the single global Session; abstracts `state.json` + per-Session JSONL from use-cases.                                                                                                                                                                                                                                                                                                                    |
| `ChannelGateway`    | `use-cases/ports/channel-gateway.ts`    | Outbound                                            | Delivers outbound replies to the originating Channel conversation via a ConversationRef.                                                                                                                                                                                                                                                                                                                                                |

Every port has at least one infrastructure implementation and can be substituted with a fake during testing.

## 7. Component Contracts

SPEC.md §Architecture Overview lists six components: HTTP Layer, Supervisor, Job Queue, Job Worker, Shrimp Agent, and Tool Layer. This section maps those components to concrete modules.

| SPEC component           | Module                                                                       | Layer             | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                 | Key dependencies                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| HTTP Layer               | `HealthRoute`                                                                | Interface Adapter | Returns `200 OK` with `{"status":"ok"}`                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                              |
| HTTP Layer               | `HeartbeatRoute`                                                             | Interface Adapter | Accepts `POST /heartbeat`, delegates to `JobQueue`, responds `202 Accepted`                                                                                                                                                                                                                                                                                                                                                                    | `JobQueue`, `Job`                                                                                              |
| Supervisor               | (implemented across the HTTP layer + DI container; no single dedicated file) | Composition Root  | Internal component that receives heartbeats, owns the Job Queue, and dispatches Job Workers; realized by `HeartbeatRoute`, `InMemoryJobQueue`, and the DI wiring in `container.ts`                                                                                                                                                                                                                                                             | `JobQueue`, `Job`                                                                                              |
| Job Queue                | `InMemoryJobQueue`                                                           | Infrastructure    | Single-slot concurrency gate implementation; bracket pattern guarantees slot release                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                              |
| Job Worker               | `Job` (`HeartbeatJob` / `ChannelJob`)                                        | Use Case          | Orchestrates one Job per event: `HeartbeatJob` selects a Todoist task and passes empty history; `ChannelJob` loads the current Session and appends `ConversationMessage` entries. Both invoke `ShrimpAgent` once through the shared Job Worker slot.                                                                                                                                                                                           | `BoardRepository`, `SessionRepository`, `ShrimpAgent`, `ToolProvider`, `PromptAssembler`                       |
| `/new` command handler   | `StartNewSession`                                                            | Use Case          | Archives the previous Session and makes a fresh one current; invoked by the Channel adapter on `/new`.                                                                                                                                                                                                                                                                                                                                         | `SessionRepository`                                                                                            |
| Channel (Telegram)       | `TelegramChannel`                                                            | Infrastructure    | Implements `ChannelGateway`; validates webhook callbacks, normalizes updates into `ChannelMessage` or Slash Command events, and sends replies via the Telegram Bot API.                                                                                                                                                                                                                                                                        | Telegram Bot API client                                                                                        |
| Session persistence      | `JsonlSessionRepository`                                                     | Infrastructure    | Implements `SessionRepository` via per-Session JSONL + `state.json` under `SHRIMP_STATE_DIR`; discards and starts fresh on JSONL corruption.                                                                                                                                                                                                                                                                                                   | filesystem                                                                                                     |
| Built-in Reply tool      | `ReplyTool`                                                                  | Interface Adapter | Sends the agent's reply via `ChannelGateway` using the Job's `ConversationRef`; no-op when `ConversationRef` is null (`HeartbeatJob`).                                                                                                                                                                                                                                                                                                         | `ChannelGateway`                                                                                               |
| Job Worker (support)     | `TaskSelector`                                                               | Entities          | Pure selection policy from SPEC §Task selection rules                                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                              |
| Job Worker (support)     | `PromptAssembler`                                                            | Use Case          | Builds the system prompt (goal + tool descriptions) and user prompt (task content + comment history)                                                                                                                                                                                                                                                                                                                                           | Entities                                                                                                       |
| Shrimp Agent             | `AiSdkShrimpAgent`                                                           | Infrastructure    | Implements the `ShrimpAgent` port via the AI SDK; wires in tools from `ToolProvider` and runs the agentic loop to completion internally; annotates the `shrimp.job` span with agent-level gen_ai attrs (`invoke_agent`, `agent.id`, `agent.version`, `provider.name`, `conversation.id`, `error.type`, plus input/output messages)                                                                                                             | AI SDK, `ToolProvider`                                                                                         |
| Tool Layer (Built-in)    | `GetTasksTool`, `GetCommentsTool`, `PostCommentTool`, `MoveTaskTool`         | Interface Adapter | Inbound adapters from the agent loop. Each defines an AI SDK tool schema, validates arguments, calls the corresponding `BoardRepository` method, and formats the result for the model                                                                                                                                                                                                                                                          | `BoardRepository`                                                                                              |
| Tool Layer (Registry)    | `ToolRegistry`                                                               | Interface Adapter | Implements the `ToolProvider` port; merges built-in tool definitions with MCP tools                                                                                                                                                                                                                                                                                                                                                            | Built-in tools, `McpToolLoader`                                                                                |
| Tool Layer (MCP)         | `McpToolLoader`                                                              | Infrastructure    | Parses `.mcp.json`, starts MCP clients, exports AI SDK tool defs; a failing server is excluded                                                                                                                                                                                                                                                                                                                                                 | MCP SDK                                                                                                        |
| Todoist integration      | `TodoistBoardRepository`                                                     | Infrastructure    | Implements the `BoardRepository` port; wraps the raw Todoist client                                                                                                                                                                                                                                                                                                                                                                            | `TodoistClient`                                                                                                |
| Todoist integration      | `TodoistClient`                                                              | Infrastructure    | Raw Todoist REST HTTP client                                                                                                                                                                                                                                                                                                                                                                                                                   | —                                                                                                              |
| Config                   | `EnvConfig`                                                                  | Infrastructure    | Loads and validates environment variables; fails fast if required values are missing                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                              |
| Config                   | `McpConfig`                                                                  | Infrastructure    | Parses `.mcp.json`; fails fast on malformed input                                                                                                                                                                                                                                                                                                                                                                                              | —                                                                                                              |
| Telemetry (Noop adapter) | `NoopTelemetry`                                                              | Infrastructure    | Implements `TelemetryPort` for the disabled path; returns the OTel API's default no-op tracer; `shutdown()` is a no-op                                                                                                                                                                                                                                                                                                                         | `@opentelemetry/api`                                                                                           |
| Telemetry (OTel adapter) | `OtelTelemetry`                                                              | Infrastructure    | Implements `TelemetryPort` via `NodeSDK` + `OTLPTraceExporter`; calls `sdk.start()` in the constructor so the tracer is immediately usable; `shutdown()` flushes spans and swallows exporter errors (fail-open). Configures `NodeSDK` with `spanProcessors: [GenAiBridgeSpanProcessor, BatchSpanProcessor(exporter)]` so the bridge runs before export.                                                                                        | `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `LoggerPort` |
| Telemetry (bridge)       | `GenAiBridgeSpanProcessor`                                                   | Infrastructure    | A `SpanProcessor` whose `onEnd` hook translates AI SDK's `ai.*` span attributes to OTel gen_ai semconv (`gen_ai.*`): `ai.toolCall` → `execute_tool` operation with `gen_ai.tool.*` attrs; `ai.generateText.doGenerate` / `ai.streamText.doStream` → `chat` operation with structured `gen_ai.input.messages` / `gen_ai.output.messages`. Single translation point; avoids duplication with AI SDK's own `gen_ai.*` emission on LLM-call spans. | `@opentelemetry/sdk-trace-base`                                                                                |
| Telemetry (selector)     | `createTelemetry`                                                            | Infrastructure    | Factory that returns `NoopTelemetry` or `OtelTelemetry` based on `EnvConfig.telemetryEnabled`                                                                                                                                                                                                                                                                                                                                                  | `EnvConfig`, `LoggerPort`                                                                                      |
| DI                       | `Container`                                                                  | Composition Root  | Wires all ports to their implementations via tsyringe                                                                                                                                                                                                                                                                                                                                                                                          | Everything                                                                                                     |
| HTTP composition         | `app.ts`                                                                     | Composition Root  | Creates the Hono app and mounts routes                                                                                                                                                                                                                                                                                                                                                                                                         | `adapters/http/*`                                                                                              |
| Entry point              | `server.ts`                                                                  | Composition Root  | Loads dotenv, builds the container, starts the server                                                                                                                                                                                                                                                                                                                                                                                          | Everything                                                                                                     |

## 8. Naming & File Conventions

| Aspect                      | Rule                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| File names                  | kebab-case (`task-selector.ts`, `in-memory-job-queue.ts`)                                                                                       |
| Exported types              | PascalCase (`TaskSelector`, `InMemoryJobQueue`)                                                                                                 |
| Exported functions / values | camelCase                                                                                                                                       |
| Port naming                 | Named after the role, never the implementation (`BoardRepository` not `TodoistApi`; `ShrimpAgent` not `OpenAiClient`)                           |
| SPEC terminology            | Class names in code follow SPEC terms first (`Job` not `JobOrchestrator`; `AiSdkShrimpAgent` not `ToolLoopAgent`; `Board` not `TodoistProject`) |
| Directory names             | Singular (`entities/`, `use-cases/`); subdirectories grouped by feature (`queue/`, `todoist/`, `ai/`)                                           |
| Imports                     | Relative paths; never import from an outer layer into an inner one                                                                              |

## 9. Failure Handling Placement

The failure modes listed in `SPEC.md` are handled at the layer that is closest to their cause.

| Failure (SPEC reference)                                                              | Handling layer                                             | Behavior                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing required environment variables (§Deployment Rules)                            | Infrastructure (`EnvConfig`)                               | Fail fast at startup: log to stderr and exit with a non-zero code                                                                                                                                          |
| `.mcp.json` malformed (§Failure Handling)                                             | Infrastructure (`McpConfig` / `McpToolLoader`)             | Fail fast at startup                                                                                                                                                                                       |
| Individual MCP server connection failure (§Failure Handling)                          | Infrastructure (`McpToolLoader`)                           | Exclude the failed server and continue; if every server fails, run with built-in tools only                                                                                                                |
| Todoist API failure (§Todoist Integration API failure handling)                       | Use Case (`HeartbeatJob` top-level catch)                  | Fail-Open Recovery: release the slot, log, let the next Heartbeat retry                                                                                                                                    |
| AI SDK / MCP runtime error (§Shrimp Agent Error)                                      | Use Case (Job Worker top-level catch)                      | Same as above; applies to both `HeartbeatJob` and `ChannelJob`                                                                                                                                             |
| Individual tool call failure during the agent loop (e.g. Post Comment, Move Task)     | Interface Adapter (the specific tool)                      | The tool returns the error to the agent via the AI SDK tool result so the model can react, retry, or summarize the failure. Only if the entire loop throws does the Job Worker's top-level catch take over |
| Board missing required sections (§Prerequisites)                                      | Use Case (`HeartbeatJob` selection phase)                  | HeartbeatJob ends immediately with no side effects                                                                                                                                                         |
| No actionable tasks (§Task selection rule 4)                                          | Use Case (`HeartbeatJob` selection phase)                  | HeartbeatJob ends immediately                                                                                                                                                                              |
| Telemetry exporter failure (§Telemetry Configuration → Exporter failure is fail-open) | Infrastructure (`OtelTelemetry.shutdown` + AI SDK runtime) | Errors during span export or shutdown are caught and logged at warn; never propagated into the Job                                                                                                         |

**Core principle**: configuration errors at startup are fail-fast in Infrastructure; runtime errors reaching external systems are Fail-Open Recovery in the Use Case layer. Entities and Interface Adapters perform no failure handling — they assume their inputs have already been validated.

## 10. Transitional Notes

`src/` is still in its initialization-phase flat layout:

```
src/
  app.ts
  server.ts
  routes/
    health.ts
```

Migration strategy:

- **New modules start in the target layout.** When implementing `/heartbeat`, create `src/adapters/http/routes/heartbeat.ts` directly and move the existing `src/routes/health.ts` to `src/adapters/http/routes/health.ts` in the same change.
- **`app.ts` and `server.ts` stay at `src/` root.** They are composition roots and do not belong to any single layer.
- **`container.ts` is introduced when tsyringe lands**, together with the `/heartbeat` or Shrimp Agent work.
- Prefer **one kind of migration per PR** so structural moves are never bundled with behavioral changes.

## 11. Decision Log

### D1. No persistence → Entities are read models

**Decision**: Types under `entities/` — Task, Section, Priority, etc. — expose no setters, perform no mutation, and enforce no write-side invariants.

**Rationale**: Shrimp never owns the write path for any of this data. Every state transition is pushed back to Todoist via `BoardRepository`. Forcing DDD aggregate semantics on top of read-only data would create dual state (local vs. Todoist) without solving any actual problem. Keeping entities as plain data plus pure-function policies matches reality.

**Consequence**: Pure logic like `TaskSelector` lives naturally in `entities/`; any orchestration that touches I/O moves up to `use-cases/`.

### D2. Job orchestrates; the Shrimp Agent is a black box

**Decision**: SPEC's "Job" is realized in code as two Job Worker variants — `HeartbeatJob` and `ChannelJob` — each of which assembles prompts and invokes the `ShrimpAgent` port **exactly once** per triggering event. SPEC's "Shrimp Agent" is the `ShrimpAgent` port (implemented by `AiSdkShrimpAgent`). Everything the model does — calling tools, deciding when the task is done, iterating — happens inside that single adapter call. Shrimp does not interject between tool calls and does not re-enter the loop.

**Rationale**: The AI SDK (and most agent libraries in the same shape) exposes the tool-calling loop as a single function: you pass prompts and a tool set, it runs to completion internally. Trying to model the SPEC steps as a step-by-step orchestration inside the AI execution engine would fight the library and make the code diverge from what's actually possible at runtime. The honest framing is: the loop is an adapter we invoke, not a state machine we drive. Separating the Job Worker (orchestrator) from `ShrimpAgent` (executor) makes the split explicit in code.

**Consequence**: Each Job Worker stays small (prepare context, invoke once) and the real work lives inside the tools the agent can call. The use cases become easy to unit-test with a fake `ShrimpAgent` that simply records what it was given. Swapping AI providers means replacing the `ShrimpAgent` implementation; neither Job Worker is touched.

### D3. Built-in tools are inbound adapters, not use-case classes

**Decision**: Each built-in Todoist operation (Get Tasks, Get Comments, Post Comment, Move Task) is implemented as a single-file **inbound adapter** under `adapters/tools/built-in/`. The adapter defines the AI SDK tool schema, validates arguments, invokes `BoardRepository` directly, and formats the result back for the model. There is no per-operation use case class in between.

**Rationale**: Because the agent loop (D2) is the actual orchestrator of multi-step work, each tool call is a single boundary crossing — "the agent asked for X, do X, return the result." Inserting an intermediate `GetTasksUseCase` / `PostCommentUseCase` layer would be empty pass-through code that adds indirection without encoding any application rule. The tools are inbound adapters in the same sense that HTTP route handlers are: an external caller (the agent, via AI SDK) invokes the application's ports, and the adapter translates between the caller's format and the port's contract.

**Consequence**: Adding a new built-in tool is a one-file change in `adapters/tools/built-in/`. The tool's business-level rules (if any ever appear) can always be promoted into a use case later without touching the adapter boundary.

Note: D3 uses "agent loop" to describe the runtime behavior; the code-level name for this is now `ShrimpAgent` (port) and `AiSdkShrimpAgent` (implementation).

### D4. JobQueue port in use-cases, implementation in infrastructure

**Decision**: The `JobQueue` interface lives in `use-cases/ports/`; `InMemoryJobQueue` lives in `infrastructure/queue/`. HTTP handlers depend on the port; tsyringe binds the implementation at the composition root.

**Rationale**: SPEC explicitly leaves room for the queue to become something other than in-memory in the future. The HTTP layer should not be coupled to today's implementation. Even with only one implementation in sight, the cost of an interface file is trivial compared with the cost of a future refactor. It also lets `HeartbeatRoute` be tested with a fake queue to verify the "slot busy → still 202" semantics.

**Consequence**: `HeartbeatRoute` does not know about `InMemoryJobQueue`. Adding a new implementation later (e.g., `RedisJobQueue`) only requires changing the binding in `container.ts`.

### D5. Telemetry is a process-level port, not a use case

**Decision**: OpenTelemetry support is exposed to `use-cases/` through a `TelemetryPort` interface (`runInSpan`, `shutdown`) that carries no `@opentelemetry/api` types on its surface. Two infrastructure adapters implement it: `NoopTelemetry` (span is a passthrough when telemetry is disabled) and `OtelTelemetry` (wraps `NodeSDK` + `OTLPTraceExporter`; owns the full span lifecycle inside `runInSpan`). The `Tracer` itself — which AI SDK needs via `experimental_telemetry` — is exposed as a separate DI binding (`TOKENS.Tracer`) resolved only by `AiSdkShrimpAgent`, which lives in `infrastructure/ai/` and is allowed to import `@opentelemetry/api` directly. `AiSdkShrimpAgent` also takes the `recordInputs` / `recordOutputs` booleans directly from env via DI — they are AI-SDK-specific switches that have no meaning for other port consumers, so they stay off the port. Selection happens once at process startup in `bootstrap()` based on `TELEMETRY_ENABLED`; both the port and the tracer are registered from the same factory result so their lifecycles stay aligned.

**Rationale**: Tracing is a cross-cutting concern with a single, process-wide lifecycle: the tracer provider and exporter pipeline are initialised before the HTTP server accepts traffic and torn down on SIGINT/SIGTERM. Modelling this as a use case would force every consumer to handle enable/disable logic, exporter failure handling, and tracer wiring — none of which is application logic. Using a port instead keeps the dependency direction inward; hiding the `Tracer` behind a `runInSpan` method means `use-cases/` carries **zero** `@opentelemetry/api` imports (runtime or type), matching the stricter Clean Architecture rule that inner layers own no third-party knowledge. AI SDK already emits `ai.generateText`, `ai.generateText.doGenerate`, and the per-tool-call spans natively when given a tracer via `experimental_telemetry`; `AiSdkShrimpAgent` just forwards the tracer plus the two record-flag booleans it owns.

**Consequence**: Disabling telemetry has zero observable effect on the Job — `runInSpan` becomes a plain passthrough, no exporter connections are opened, and no I/O is performed. Enabling it requires only environment variables; no code changes. Swapping the exporter (e.g. to gRPC or to a vendor-specific collector) is a one-file change inside `infrastructure/telemetry/` with no impact on `use-cases/` or any other adapter. A future change that needs richer span attributes (e.g. per-task metadata) extends the port method rather than leaking the `Span` type into `use-cases/`.

### D6. Channel is an abstract Port; Slash Commands are dispatched at the adapter level

**Decision**: The `Channel` concept is defined at the port level (`ChannelGateway`); Telegram (webhook) is the first concrete adapter. Messages prefixed with `/` are parsed by the Channel adapter and routed directly to matching use-cases (e.g., `StartNewSession` for `/new`) — they do not enter the Job Queue and do not invoke the Shrimp Agent.

**Rationale**: Coupling use-cases to Telegram types would leak third-party concerns inward; an abstract port keeps use-cases dependency-free and makes the Telegram path pluggable. Slash Commands are synchronous control-plane actions that must respond even when the Queue slot is busy, so routing them through the Queue would serialize them behind model-driven work with no benefit.

**Consequence**: Channel-specific concerns live in `infrastructure/channel/`; use-cases see only `ChannelGateway`. Adding a second Channel or a new command requires adapter changes only — no port, Job, or Queue changes.

### D7. Session persistence uses JSONL + state.json, behind SessionRepository

**Decision**: The single global Session is stored as an append-only JSONL file under `SHRIMP_STATE_DIR/sessions/<id>.jsonl`; the current Session ID is recorded in `SHRIMP_STATE_DIR/state.json`. All persistence details are hidden behind the `SessionRepository` port.

**Rationale**: Conversation history is inherently append-only; JSONL matches those semantics and a separate `state.json` keeps the current-pointer update atomic. Hiding both files behind a port preserves the dependency-free use-case rule — filesystem APIs do not leak past `infrastructure/session/`.

**Consequence**: Swapping persistence (e.g., to SQLite) is a new `SessionRepository` implementation with no use-case changes; corruption handling is encapsulated inside `JsonlSessionRepository`.

### D8. Reply tool uses DI Factory Method for per-Job ConversationRef

**Decision**: `ReplyTool` is part of the universal tool set and constructed per-Job via a DI Factory Method that injects the current `ConversationRef`; when `ConversationRef` is null (`HeartbeatJob`), `Reply` returns a no-op result.

**Rationale**: Tools need per-invocation context that a process-level singleton cannot carry; a Factory Method is the established convention for session-scoped objects in this codebase.

**Consequence**: The AI SDK sees one stable tool schema regardless of Job variant; adding new Channel-aware tools follows the same Factory Method pattern.
