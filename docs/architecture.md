# Shrimp Architecture

## 1. Purpose

This document defines **how Shrimp's code is organized**: the layers, directory layout, dependency direction, core abstractions (ports), and the mapping from SPEC components to concrete modules. It serves as the blueprint for ongoing implementation, ensuring every new module lands in the correct layer and depends in the correct direction from day one.

This document does **not** restate behavioral rules. All endpoint contracts, Processing Cycle steps, failure recovery rules, and environment variables are defined in `SPEC.md`. The two documents divide responsibility as follows:

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

| Layer                    | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                           | May depend on                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| **Entities**             | Core domain types used throughout Shrimp: Task, Section, Priority, Comment, and pure policy objects such as TaskSelector. Because Shrimp does not own the write path for any of this data (Todoist is the authoritative state), entities here act as **read models** and **pure domain logic**, not as DDD write-side aggregates.                                                                                                                                  | Nothing                                  |
| **Use Cases**            | Application orchestration: `ProcessingCycle` (the orchestrator that selects a task, prepares prompt context, and invokes the Main Agent once per heartbeat), `PromptAssembler`, and the **port interfaces** for every external dependency (`BoardRepository`, `MainAgent`, `TaskQueue`, `ToolProvider`). This layer has no knowledge of Hono, AI SDK, the Todoist client, or MCP implementations.                                                                  | Entities                                 |
| **Interface Adapters**   | Boundary converters in two directions. **Inbound from HTTP**: Hono route handlers for `/health` and `/heartbeat`. **Inbound from the agent loop**: each built-in tool (Get Tasks, Get Comments, Post Comment, Move Task) is an inbound adapter that the agent invokes during its loop — the tool validates arguments, calls `BoardRepository`, and formats the result back for the AI SDK. The Tool Registry merges built-in and MCP tools into a single provider. | Use Cases, Entities                      |
| **Frameworks & Drivers** | Integration with the outside world: Hono server, Todoist REST client, AI SDK provider, MCP client, tsyringe registrations, dotenv, environment variable validation, in-memory Task Queue implementation. This is the only layer allowed to import third-party SDKs directly.                                                                                                                                                                                       | Use Cases (to implement ports), Entities |

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

  use-cases/
    ports/
      board-repository.ts      # Todoist Board abstraction (outbound)
      main-agent.ts             # Main Agent port: black-box tool-calling loop invocation (outbound)
      task-queue.ts             # Concurrency gate abstraction (inbound, used by HTTP)
      tool-provider.ts          # Merged tool-list provider (outbound)
    processing-cycle.ts         # Processing Cycle orchestrator (SPEC §Processing Cycle)
    prompt-assembler.ts         # Builds system prompt + user prompt

  adapters/
    http/
      routes/
        health.ts               # GET /health
        heartbeat.ts            # POST /heartbeat
    tools/
      built-in/
        get-tasks.ts            # Inbound adapter → BoardRepository.getTasks
        get-comments.ts         # Inbound adapter → BoardRepository.getComments
        post-comment.ts         # Inbound adapter → BoardRepository.postComment
        move-task.ts            # Inbound adapter → BoardRepository.moveTask
      tool-registry.ts          # Merges built-in + MCP tools (ToolProvider impl)

  infrastructure/
    queue/
      in-memory-task-queue.ts   # Single-slot TaskQueue implementation
    todoist/
      todoist-client.ts         # Raw Todoist REST client
      todoist-board-repository.ts  # BoardRepository implementation
    ai/
      ai-provider-factory.ts    # Creates an OpenAI-compatible provider
      ai-sdk-main-agent.ts      # MainAgent implementation (AI SDK tool loop)
    mcp/
      mcp-tool-loader.ts        # Parses .mcp.json, starts MCP clients, exposes tools
    config/
      env.ts                    # Environment variable loading and validation
      mcp-config.ts             # .mcp.json parsing
    telemetry/
      noop-telemetry.ts         # NoopTelemetry adapter (TELEMETRY_ENABLED=false path)
      otel-telemetry.ts         # OtelTelemetry adapter (NodeSDK + OTLP HTTP exporter)
      telemetry-factory.ts      # createTelemetry(env, logger): selects Noop vs Otel

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

The five components defined in `SPEC.md` §Architecture Overview are abstracted in code via four ports (Processing Cycle is a use-case class, not a port):

| Port              | File                                  | Direction                                                     | Responsibility                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BoardRepository` | `use-cases/ports/board-repository.ts` | Outbound                                                      | Encapsulates the four built-in Todoist operations: list tasks by section, list comments, post comment, move task. Hides REST API details.                                                                                                                                                                              |
| `MainAgent`       | `use-cases/ports/main-agent.ts`       | Outbound                                                      | A single black-box invocation of the AI tool-calling loop. The caller (ProcessingCycle) hands over assembled prompts and the full tool set; the adapter runs the loop internally (AI SDK or equivalent) and returns the model's final state when the loop terminates. Shrimp does not control iterations from outside. |
| `TaskQueue`       | `use-cases/ports/task-queue.ts`       | Inbound (used by HTTP handlers)                               | Single-slot concurrency gate: tries to accept a run, releases the slot when the cycle completes or fails. Encapsulates the synchronization primitive.                                                                                                                                                                  |
| `ToolProvider`    | `use-cases/ports/tool-provider.ts`    | Outbound                                                      | Supplies the currently available tool set (built-in Todoist tools + MCP tools). Consumed by the `MainAgent` implementation.                                                                                                                                                                                            |
| `TelemetryPort`   | `use-cases/ports/telemetry.ts`        | Outbound (consumed by `ProcessingCycle` and `AiSdkMainAgent`) | Exposes an OpenTelemetry `Tracer` plus the `recordInputs` / `recordOutputs` flags and a `shutdown()` for graceful flush. Two infrastructure adapters: `NoopTelemetry` (no-op tracer when telemetry is disabled) and `OtelTelemetry` (NodeSDK with OTLP HTTP exporter).                                                 |

Every port has at least one infrastructure implementation and can be substituted with a fake during testing.

## 7. Component Contracts

SPEC.md §Architecture Overview lists five components: HTTP Layer, Task Queue, Processing Cycle, Main Agent, and Tool Layer. This section maps those components to concrete modules.

| SPEC component             | Module                                                               | Layer             | Responsibility                                                                                                                                                                                                                                                                                    | Key dependencies                                                                                               |
| -------------------------- | -------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| HTTP Layer                 | `HealthRoute`                                                        | Interface Adapter | Returns `200 OK` with `{"status":"ok"}`                                                                                                                                                                                                                                                           | —                                                                                                              |
| HTTP Layer                 | `HeartbeatRoute`                                                     | Interface Adapter | Accepts `POST /heartbeat`, delegates to `TaskQueue`, responds `202 Accepted`                                                                                                                                                                                                                      | `TaskQueue`, `ProcessingCycle`                                                                                 |
| Task Queue                 | `InMemoryTaskQueue`                                                  | Infrastructure    | Single-slot concurrency gate implementation; bracket pattern guarantees slot release                                                                                                                                                                                                              | —                                                                                                              |
| Processing Cycle           | `ProcessingCycle`                                                    | Use Case          | Orchestrates one heartbeat-triggered unit of work. Selects a task via `TaskSelector` and `BoardRepository`, promotes Backlog→InProgress, assembles prompts via `PromptAssembler`, and invokes `MainAgent` **once**. Everything the AI does during its loop happens inside that single invocation. | `BoardRepository`, `MainAgent`, `ToolProvider`, `TaskSelector`, `PromptAssembler`                              |
| Processing Cycle (support) | `TaskSelector`                                                       | Entities          | Pure selection policy from SPEC §Task selection rules                                                                                                                                                                                                                                             | —                                                                                                              |
| Processing Cycle (support) | `PromptAssembler`                                                    | Use Case          | Builds the system prompt (goal + tool descriptions) and user prompt (task content + comment history)                                                                                                                                                                                              | Entities                                                                                                       |
| Main Agent                 | `AiSdkMainAgent`                                                     | Infrastructure    | Implements the `MainAgent` port via the AI SDK; wires in tools from `ToolProvider` and runs the agentic loop to completion internally                                                                                                                                                             | AI SDK, `ToolProvider`                                                                                         |
| Tool Layer (Built-in)      | `GetTasksTool`, `GetCommentsTool`, `PostCommentTool`, `MoveTaskTool` | Interface Adapter | Inbound adapters from the agent loop. Each defines an AI SDK tool schema, validates arguments, calls the corresponding `BoardRepository` method, and formats the result for the model                                                                                                             | `BoardRepository`                                                                                              |
| Tool Layer (Registry)      | `ToolRegistry`                                                       | Interface Adapter | Implements the `ToolProvider` port; merges built-in tool definitions with MCP tools                                                                                                                                                                                                               | Built-in tools, `McpToolLoader`                                                                                |
| Tool Layer (MCP)           | `McpToolLoader`                                                      | Infrastructure    | Parses `.mcp.json`, starts MCP clients, exports AI SDK tool defs; a failing server is excluded                                                                                                                                                                                                    | MCP SDK                                                                                                        |
| Todoist integration        | `TodoistBoardRepository`                                             | Infrastructure    | Implements the `BoardRepository` port; wraps the raw Todoist client                                                                                                                                                                                                                               | `TodoistClient`                                                                                                |
| Todoist integration        | `TodoistClient`                                                      | Infrastructure    | Raw Todoist REST HTTP client                                                                                                                                                                                                                                                                      | —                                                                                                              |
| Config                     | `EnvConfig`                                                          | Infrastructure    | Loads and validates environment variables; fails fast if required values are missing                                                                                                                                                                                                              | —                                                                                                              |
| Config                     | `McpConfig`                                                          | Infrastructure    | Parses `.mcp.json`; fails fast on malformed input                                                                                                                                                                                                                                                 | —                                                                                                              |
| Telemetry (Noop adapter)   | `NoopTelemetry`                                                      | Infrastructure    | Implements `TelemetryPort` for the disabled path; returns the OTel API's default no-op tracer; `shutdown()` is a no-op                                                                                                                                                                            | `@opentelemetry/api`                                                                                           |
| Telemetry (OTel adapter)   | `OtelTelemetry`                                                      | Infrastructure    | Implements `TelemetryPort` via `NodeSDK` + `OTLPTraceExporter`; calls `sdk.start()` in the constructor so the tracer is immediately usable; `shutdown()` flushes spans and swallows exporter errors (fail-open)                                                                                   | `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `LoggerPort` |
| Telemetry (selector)       | `createTelemetry`                                                    | Infrastructure    | Factory that returns `NoopTelemetry` or `OtelTelemetry` based on `EnvConfig.telemetryEnabled`                                                                                                                                                                                                     | `EnvConfig`, `LoggerPort`                                                                                      |
| DI                         | `Container`                                                          | Composition Root  | Wires all ports to their implementations via tsyringe                                                                                                                                                                                                                                             | Everything                                                                                                     |
| HTTP composition           | `app.ts`                                                             | Composition Root  | Creates the Hono app and mounts routes                                                                                                                                                                                                                                                            | `adapters/http/*`                                                                                              |
| Entry point                | `server.ts`                                                          | Composition Root  | Loads dotenv, builds the container, starts the server                                                                                                                                                                                                                                             | Everything                                                                                                     |

## 8. Naming & File Conventions

| Aspect                      | Rule                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File names                  | kebab-case (`task-selector.ts`, `in-memory-task-queue.ts`)                                                                                                      |
| Exported types              | PascalCase (`TaskSelector`, `InMemoryTaskQueue`)                                                                                                                |
| Exported functions / values | camelCase                                                                                                                                                       |
| Port naming                 | Named after the role, never the implementation (`BoardRepository` not `TodoistApi`; `MainAgent` not `OpenAiClient`)                                             |
| SPEC terminology            | Class names in code follow SPEC terms first (`ProcessingCycle` not `MainAgentOrchestrator`; `AiSdkMainAgent` not `ToolLoopAgent`; `Board` not `TodoistProject`) |
| Directory names             | Singular (`entities/`, `use-cases/`); subdirectories grouped by feature (`queue/`, `todoist/`, `ai/`)                                                           |
| Imports                     | Relative paths; never import from an outer layer into an inner one                                                                                              |

## 9. Failure Handling Placement

The failure modes listed in `SPEC.md` are handled at the layer that is closest to their cause.

| Failure (SPEC reference)                                                          | Handling layer                                             | Behavior                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing required environment variables (§Deployment Rules)                        | Infrastructure (`EnvConfig`)                               | Fail fast at startup: log to stderr and exit with a non-zero code                                                                                                                                             |
| `.mcp.json` malformed (§Failure Handling)                                         | Infrastructure (`McpConfig` / `McpToolLoader`)             | Fail fast at startup                                                                                                                                                                                          |
| Individual MCP server connection failure (§Failure Handling)                      | Infrastructure (`McpToolLoader`)                           | Exclude the failed server and continue; if every server fails, run with built-in tools only                                                                                                                   |
| Todoist API failure (§Todoist Integration API failure handling)                   | Use Case (`ProcessingCycle` top-level catch)               | Fail-Open Recovery: release the slot, log, let the next heartbeat retry                                                                                                                                       |
| AI SDK / MCP runtime error (§Main Agent Error)                                    | Use Case (`ProcessingCycle` top-level catch)               | Same as above                                                                                                                                                                                                 |
| Individual tool call failure during the agent loop (e.g. Post Comment, Move Task) | Interface Adapter (the specific tool)                      | The tool returns the error to the agent via the AI SDK tool result so the model can react, retry, or summarize the failure. Only if the entire loop throws does `ProcessingCycle`'s top-level catch take over |
| Board missing required sections (§Prerequisites)                                  | Use Case (`ProcessingCycle` selection phase)               | Cycle ends immediately with no side effects                                                                                                                                                                   |
| No actionable tasks (§Task selection rule 4)                                      | Use Case (`ProcessingCycle` selection phase)               | Cycle ends immediately                                                                                                                                                                                        |
| Telemetry exporter failure (§Exporter failure is fail-open)                       | Infrastructure (`OtelTelemetry.shutdown` + AI SDK runtime) | Errors during span export or shutdown are caught and logged at warn; never propagated into the Processing Cycle                                                                                               |

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
- **`container.ts` is introduced when tsyringe lands**, together with the `/heartbeat` or Main Agent work.
- Prefer **one kind of migration per PR** so structural moves are never bundled with behavioral changes.

## 11. Decision Log

### D1. No persistence → Entities are read models

**Decision**: Types under `entities/` — Task, Section, Priority, etc. — expose no setters, perform no mutation, and enforce no write-side invariants.

**Rationale**: Shrimp never owns the write path for any of this data. Every state transition is pushed back to Todoist via `BoardRepository`. Forcing DDD aggregate semantics on top of read-only data would create dual state (local vs. Todoist) without solving any actual problem. Keeping entities as plain data plus pure-function policies matches reality.

**Consequence**: Pure logic like `TaskSelector` lives naturally in `entities/`; any orchestration that touches I/O moves up to `use-cases/`.

### D2. ProcessingCycle orchestrates; the Main Agent is a black box

**Decision**: SPEC's "Processing Cycle" is realized in code as a `ProcessingCycle` use case that selects a task, assembles prompts, and invokes the `MainAgent` port **exactly once** per heartbeat. SPEC's "Main Agent" is the `MainAgent` port (implemented by `AiSdkMainAgent`). Everything the model does — calling tools, deciding when the task is done, iterating — happens inside that single adapter call. Shrimp does not interject between tool calls and does not re-enter the loop.

**Rationale**: The AI SDK (and most agent libraries in the same shape) exposes the tool-calling loop as a single function: you pass prompts and a tool set, it runs to completion internally. Trying to model the SPEC steps as a step-by-step orchestration inside the AI execution engine would fight the library and make the code diverge from what's actually possible at runtime. The honest framing is: the loop is an adapter we invoke, not a state machine we drive. Separating `ProcessingCycle` (orchestrator) from `MainAgent` (executor) makes the split explicit in code.

**Consequence**: `ProcessingCycle` stays small (select a task, prepare prompt context, invoke once) and the real work lives inside the tools the agent can call. The use case becomes easy to unit-test with a fake `MainAgent` that simply records what it was given. Swapping AI providers means replacing the `MainAgent` implementation; the `ProcessingCycle` is untouched.

### D3. Built-in tools are inbound adapters, not use-case classes

**Decision**: Each built-in Todoist operation (Get Tasks, Get Comments, Post Comment, Move Task) is implemented as a single-file **inbound adapter** under `adapters/tools/built-in/`. The adapter defines the AI SDK tool schema, validates arguments, invokes `BoardRepository` directly, and formats the result back for the model. There is no per-operation use case class in between.

**Rationale**: Because the agent loop (D2) is the actual orchestrator of multi-step work, each tool call is a single boundary crossing — "the agent asked for X, do X, return the result." Inserting an intermediate `GetTasksUseCase` / `PostCommentUseCase` layer would be empty pass-through code that adds indirection without encoding any application rule. The tools are inbound adapters in the same sense that HTTP route handlers are: an external caller (the agent, via AI SDK) invokes the application's ports, and the adapter translates between the caller's format and the port's contract.

**Consequence**: Adding a new built-in tool is a one-file change in `adapters/tools/built-in/`. The tool's business-level rules (if any ever appear) can always be promoted into a use case later without touching the adapter boundary.

Note: D3 uses "agent loop" to describe the runtime behavior; the code-level name for this is now `MainAgent` (port) and `AiSdkMainAgent` (implementation).

### D4. TaskQueue port in use-cases, implementation in infrastructure

**Decision**: The `TaskQueue` interface lives in `use-cases/ports/`; `InMemoryTaskQueue` lives in `infrastructure/queue/`. HTTP handlers depend on the port; tsyringe binds the implementation at the composition root.

**Rationale**: SPEC explicitly leaves room for the queue to become something other than in-memory in the future. The HTTP layer should not be coupled to today's implementation. Even with only one implementation in sight, the cost of an interface file is trivial compared with the cost of a future refactor. It also lets `HeartbeatRoute` be tested with a fake queue to verify the "slot busy → still 202" semantics.

**Consequence**: `HeartbeatRoute` does not know about `InMemoryTaskQueue`. Adding a new implementation later (e.g., `RedisTaskQueue`) only requires changing the binding in `container.ts`.

### D5. Telemetry is a process-level port, not a use case

**Decision**: OpenTelemetry support is exposed to `use-cases/` and `infrastructure/ai/` through a single `TelemetryPort` interface (`tracer`, `recordInputs`, `recordOutputs`, `shutdown`) implemented by two infrastructure adapters: `NoopTelemetry` (returns the OTel API's default no-op tracer) and `OtelTelemetry` (wraps `NodeSDK` + `OTLPTraceExporter`). Selection happens once at process startup in `bootstrap()` based on `TELEMETRY_ENABLED`; the same instance is then resolved by `ProcessingCycle` (which owns the root span) and `AiSdkMainAgent` (which forwards `experimental_telemetry` to AI SDK's `ToolLoopAgent`).

**Rationale**: Tracing is a cross-cutting concern with a single, process-wide lifecycle: the tracer provider and exporter pipeline are initialised before the HTTP server accepts traffic and torn down on SIGINT/SIGTERM. Modelling this as a use case would force every consumer to handle enable/disable logic, exporter failure handling, and tracer wiring — none of which is application logic. Using a port instead lets `use-cases/` import only the `Tracer` _type_ from `@opentelemetry/api` (type-only, so the runtime dependency stays in `infrastructure/`) and keeps the dependency direction inward. AI SDK already emits `ai.generateText`, `ai.generateText.doGenerate`, and `ai.toolCall` spans natively when given a tracer via `experimental_telemetry`; nothing further is needed inside `AiSdkMainAgent` beyond forwarding the port's settings.

**Consequence**: Disabling telemetry has zero observable effect on the Processing Cycle — the same code paths run with a no-op tracer, no exporter connections are opened, and no I/O is performed. Enabling it requires only environment variables; no code changes. Swapping the exporter (e.g. to gRPC or to a vendor-specific collector) is a one-file change inside `infrastructure/telemetry/` with no impact on `use-cases/` or any other adapter.
