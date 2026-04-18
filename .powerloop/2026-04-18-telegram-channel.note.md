---
goal: Add Telegram Channel support per SPEC.md, following the implementation direction discussed in the spawning conversation. Every implementation step and every check must be verified against SPEC.md. Tests should prefer integration coverage (MSW at HTTP boundary, tmpdir for filesystem) over fine-grained unit tests and the dead code they produce.
language: en
current_phase: execute
started_at: 2026-04-18T00:00:00Z
interval: 10m
cron_id: 82934375
execute_skills: /coding:write → /coding:review → /coding:refactor → /git:commit
review_skills: /coding:review → /coding:refactor → /git:commit
sample_passes: 0/10
review_cycles: 0
---

# Telegram Channel Implementation

## Implementation Direction (from spawning conversation)

### Endpoint
- `POST /channels/telegram` — validates `X-Telegram-Bot-Api-Secret-Token`; 401 on mismatch, 400 on malformed payload, 200 on accept.
- Only mounted when `CHANNELS_ENABLED=true`.
- Slash commands parsed by adapter; non-command messages enqueue a ChannelJob.

### Refactor of existing code
- Split `src/use-cases/job.ts` Job into `HeartbeatJob` + `ChannelJob` sharing a Job Worker skeleton.
- `HeartbeatRoute` dispatches `HeartbeatJob`; `JobQueue` stays variant-agnostic.
- `JobInput` (ports/shrimp-agent.ts) gains `history: ConversationMessage[]`; `AiSdkShrimpAgent` maps it to AI SDK messages and emits `gen_ai.conversation.id = sessionId` on `shrimp.job` span for ChannelJob only.

### New entities / value objects
- `ConversationMessage` (role + content)
- `ConversationRef` (opaque; Telegram interprets as chatId etc.)
- `Session` (id + messages or handled by repository)

### New ports + use cases
- Port: `SessionRepository` (getCurrent, createNew, append)
- Port: `ChannelGateway` (reply)
- Use case: `ChannelJob`
- Use case: `StartNewSession` (for `/new`, bypasses JobQueue)

### New adapters
- `adapters/http/routes/channels/telegram.ts` — webhook entry, secret validation, slash parsing
- `adapters/tools/built-in/reply.ts` — ReplyTool; no-op when ConversationRef is null (HeartbeatJob compatibility)

### New infrastructure
- `infrastructure/telegram/telegram-channel.ts` — ChannelGateway via Bot API sendMessage
- `infrastructure/session/jsonl-session-repository.ts` — state.json + per-session JSONL under SHRIMP_STATE_DIR
- `infrastructure/config/env-config.ts` — add CHANNELS_ENABLED, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SHRIMP_STATE_DIR (validated only when Channels enabled)
- `container.ts` — Channels-gated registration of Telegram/Session/Reply/ChannelJob

### Filesystem layout
- `~/.shrimp/state.json` — current session pointer
- `~/.shrimp/sessions/<uuid>.jsonl` — append-only per-session
- state.json malformed → fail fast; JSONL corrupt → discard and start fresh; missing state.json → treated as "no current session"

## SPEC.md alignment checklist
- Channel concept (§Channel Integration) generic; Telegram is the first implementation
- Slash Commands bypass Job Queue (§Slash Commands); only `/new` supported
- Single global Session, lazy creation on first non-command message (§Session Lifecycle)
- ChannelJob flow steps 1-7 (§Event-Driven Trigger Flow)
- gen_ai.conversation.id = Session ID on ChannelJob; absent on HeartbeatJob (§Telemetry Emission)
- Fail-Open Recovery for reply failures, JSONL append failures (§Session Lifecycle)
- Fail-fast for state.json malformed, missing required env vars when Channels enabled
- Env vars: CHANNELS_ENABLED, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SHRIMP_STATE_DIR

## Progress Table

Ordering rationale: dependency-root first (env + value objects + ports), then leaf infra (SessionRepository), then core refactor (Job split + ShrimpAgent history), then outbound (ChannelGateway impl + ReplyTool), then inbound (HTTP route + slash dispatch), then wiring + cross-cutting (DI + telemetry conversation.id), then test consolidation and doc alignment. Each Execute row = one /coding:write cycle ending with /git:commit per user's cadence.

| # | Item | Execute | Review | Sample | Notes |
|---|------|---------|--------|--------|-------|
| 1 | Env config: add CHANNELS_ENABLED, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SHRIMP_STATE_DIR with conditional validation (only when Channels enabled); create SHRIMP_STATE_DIR at startup, fail-fast on creation failure | done | pending | pending | 0351b62; 444/444 tests pass |
| 2 | Entities / value objects: ConversationMessage (role + content) and ConversationRef (opaque value object) under src/entities/ | done | pending | pending | 3a7d3f0; pure types, no tests |
| 3 | Port: SessionRepository (getCurrent, createNew, append) under use-cases/ports/ | done | pending | pending | d976f16; no tests |
| 4 | Port: ChannelGateway (reply(ref, text)) under use-cases/ports/ | done | pending | pending | c1bb916; no tests |
| 5 | Infrastructure: JsonlSessionRepository — state.json + sessions/<uuid>.jsonl under SHRIMP_STATE_DIR; handles missing/malformed state.json per SPEC (fail-fast on malformed; treat missing as no-session; JSONL corruption → discard + start fresh) | done | pending | pending | fe02922; 6-case integ test; 450/450 pass |
| 6 | Refactor Job: split into abstract Job Worker skeleton + HeartbeatJob (current behavior, empty history) + ChannelJob (load Session → assemble prompt with incoming msg → invoke Agent with history → append new ConversationMessage entries); extend JobInput with history: ConversationMessage[]; HeartbeatRoute wires HeartbeatJob | done | pending | pending | 85a8575; job.test.ts 52→10 cases; 430/430 |
| 7 | Use case: StartNewSession — archives previous Session, creates new, updates state.json; bypasses JobQueue; used by /new | done | pending | pending | 96db748; no tests (delegates to tested createNew) |
| 8 | Adapter (tool): ReplyTool under adapters/tools/built-in/ — calls ChannelGateway with ConversationRef; no-op when ref is null (HeartbeatJob path) | done | pending | pending | 029c439; +NoopChannelGateway stub; 434/434 pass |
| 9 | Infrastructure: TelegramChannel — implements ChannelGateway via Bot API sendMessage; Fail-Open on reply errors | in_progress | pending | pending | SPEC §Telegram Channel |
| 10 | Adapter (http): POST /channels/telegram — validates X-Telegram-Bot-Api-Secret-Token (401 on mismatch), validates payload (400 on malformed), 200 on accept; parses slash commands → StartNewSession / unknown-reply; non-command → ChannelJob enqueue; construct ConversationRef from update | pending | pending | pending | SPEC §Telegram Channel response table, §Slash Commands |
| 11 | DI wiring: container.ts Channels-gated registration of SessionRepository, ChannelGateway, ReplyTool, ChannelJob, StartNewSession; route mounted only when CHANNELS_ENABLED | pending | pending | pending | SPEC §Deployment Rules |
| 12 | Telemetry: ChannelJob sets gen_ai.conversation.id = Session ID on shrimp.job span via AiSdkShrimpAgent; HeartbeatJob omits it | pending | pending | pending | SPEC §Telemetry Emission |
| 13 | Test consolidation — before/during/after implementation: audit tests/ for bloat, merge fine-grained unit tests into integration tests (MSW at HTTP boundary, tmpdir for filesystem, real ChannelJob + JsonlSessionRepository end-to-end), remove dead code paths; ensure Telegram webhook, Session lifecycle, Slash Command, ChannelJob flow all covered by integration tests | pending | pending | pending | User goal: integration coverage > fine-grained units |
| 14 | Documentation: verify docs/architecture.md Component Contracts rows for TelegramChannel / JsonlSessionRepository / ReplyTool / ChannelJob / StartNewSession match implementation; touch up only if drift appears (keep high-level per memory) | pending | pending | pending | Architecture already names these; no prose additions |

Completeness check against SPEC.md:
- Endpoint POST /channels/telegram with secret + response table → item 10
- Channel concept (generic, Telegram first) → items 4, 9, 10
- Event types (Message vs Slash Command) → items 10, 7
- Slash Commands §/new only, bypass JobQueue → items 7, 10
- Session Lifecycle (lazy creation, rotation, failure matrix) → items 3, 5, 7
- ChannelJob flow (load → assemble → run → append) → item 6
- JobQueue variant-agnostic acceptance → item 6 (no JobQueue change)
- Telemetry gen_ai.conversation.id = Session ID for ChannelJob → item 12
- Fail-Open Recovery for replies / JSONL append → items 5, 8, 9
- Env vars CHANNELS_ENABLED / TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / SHRIMP_STATE_DIR with conditional validation → item 1
- Webhook registration is external (out of scope) — noted, no item
- DI wiring Channels-gated → item 11
- Test consolidation user requirement → item 13
- Architecture doc alignment → item 14

All SPEC.md Channel/Session/Slash-Command/Telemetry clauses and Implementation Direction bullets map to at least one row.

## Log Table

New entries MUST be appended at the bottom (ascending Cycle order). Do not prepend.

| Cycle | Phase | Summary | Decision | Handoff |
|-------|-------|---------|----------|---------|
| 1 | plan | Decomposed goal into 14 items ordered dependency-root-first (env/ports/entities → session repo → job split → outbound adapters → inbound route → DI/telemetry → test consolidation → doc alignment). Mapped every SPEC.md Channel/Session/Slash-Command/Telemetry clause to at least one item. | Treat test consolidation (item 13) as a parallel concern: consolidate tests as each earlier item lands rather than as a separate big-bang pass, so dead-code tests get removed as their subjects change. | Next cycle enters execute phase with item 1 (env config). |
| 2 | execute | Item 1 complete. Added channelsEnabled + telegramBotToken? + telegramWebhookSecret? + shrimpStateDir to EnvConfig; mkdirSync on enable with fail-fast; 444/444 tests pass, typecheck clean. Commit 0351b62. | Kept shrimpStateDir always-present (with default) rather than optional — downstream code simpler; one-line comment explains the choice. | Next cycle: item 2 (entities — ConversationMessage + ConversationRef). Pure value objects under src/entities/; no runtime deps. ConversationMessage has role + content at minimum; ConversationRef is opaque to use-cases. |
| 3 | execute | Item 2 complete. Added ConversationMessage (role: "user"|"assistant" + content: string) and ConversationRef ({channel, payload} with opacity comment). No tests — pure types. 444/444 pass. Commit 3a7d3f0. | Role union of user/assistant only (SPEC says "message history"; system/tool entries live inside AI SDK loop). ConversationRef shape (A) channel+payload over branded opaque string — Telegram needs multi-field payload. | Next cycle: item 3 (Port: SessionRepository). Thin interface. Methods per SPEC §Session Lifecycle: getCurrent/createNew/append. Session shape: { id; messages }. No infrastructure code yet. |
| 4 | execute | Item 3 complete. SessionRepository port with Session type and three methods (getCurrent / createNew / append). JSDoc encodes SPEC failure semantics. 444/444 pass. Commit d976f16. | Kept `append` returning void even though SPEC says Fail-Open; intent documented not typed. | Next cycle: item 4 (Port: ChannelGateway). Single method `reply(ref, text)`. Fail-Open in JSDoc. Imports only ConversationRef. No tests. |
| 5 | execute | Item 4 complete. ChannelGateway port with single `reply(ref, text)` method; Fail-Open semantics in JSDoc. 444/444 pass. Commit c1bb916. | — | Next cycle: item 5 (Infrastructure: JsonlSessionRepository). Real impl under src/infrastructure/session/. Full failure matrix per SPEC §Session Lifecycle. Tmpdir integration test, ~6 focused cases. |
| 6 | execute | Item 5 complete. JsonlSessionRepository with state.json + sessions/<id>.jsonl; write-then-rename atomicity; append() is Fail-Open; getCurrent handles missing/malformed/corrupt per SPEC matrix. 6-case tmpdir integration test (107 lines). 450/450 pass. Commit fe02922. | Constructor-injection of { stateDir, logger } (plain class, no decorators). Write-then-rename for state.json to protect fail-fast on malformed from partial writes. | Next cycle: item 6 — the big structural refactor. Split Job into HeartbeatJob + ChannelJob. Extend JobInput with history + optional sessionId. ChannelJob loads Session, appends user msg, invokes agent, appends assistant newMessages back. Don't touch container.ts Channels wiring yet. Consolidate job.test.ts. |
| 7 | execute | Item 6 complete. Deleted src/use-cases/job.ts, added heartbeat-job.ts and channel-job.ts. JobInput extended with `history` + optional `sessionId`; ShrimpAgentResult extended with `newMessages`. AiSdkShrimpAgent converts history to ModelMessage and prepends; TODO(item 12) comment for sessionId stamping. TOKENS.Job → TOKENS.HeartbeatJob. 52-case job.test.ts consolidated into 10 integration cases across two files. 430/430 pass. Commit 85a8575. | Duplication over abstract base class (each Job's unique work dominates shared boilerplate). ChannelJob appends incoming user msg before agent call so transcript is preserved even if agent fails. history = pre-append snapshot; userPrompt = incoming message. | Next cycle: item 7 (StartNewSession use case). Thin class delegating to SessionRepository.createNew(). Invoked by Telegram webhook on `/new` (item 10 wires it). Keep trivial; no tests. |
| 8 | execute | Item 7 complete. StartNewSession use case: thin class delegating to SessionRepository.createNew(); one info log; returns new Session. No tests — no branching; path is integration-tested by JsonlSessionRepository + to-be item-10 webhook test. 430/430 pass. Commit 96db748. | Method named `execute()` (generic use-case verb) to distinguish from Job Worker `run()`, since StartNewSession bypasses the Job Queue per SPEC §Slash Commands. | Next cycle: item 8 (ReplyTool). Built-in tool under src/adapters/tools/built-in/reply.ts. Calls ChannelGateway.reply(ref, text). No-op when ref is null (HeartbeatJob path). Needs per-invocation ref injection — update ToolProviderFactory.create(context?) to forward ref. |
| 9 | execute | Item 8 complete. ReplyTool built-in tool with message:string input; threads ConversationRef through ToolProviderFactory.create(context?) → BuiltInToolFactory → createBuiltInTools. NoopChannelGateway registered as default stub so BuiltInToolFactory can resolve ChannelGateway unconditionally; item 11 will swap in TelegramChannel when CHANNELS_ENABLED. 3-case reply.test.ts (56 lines) + 1 extension to channel-job.test.ts. 434/434 pass. Commit 029c439. | Option (b) Noop default gateway (precedent: NoopTelemetry in architecture.md) so BuiltInToolFactory stays injection-clean — rejected lazy resolution or conditional injection as extra mechanism for same outcome. | Next cycle: item 9 (TelegramChannel — real ChannelGateway impl). Under src/infrastructure/channel/telegram-channel.ts (co-located with noop-channel-gateway.ts). Constructor: { botToken, logger }. reply(ref, text) calls Telegram Bot API sendMessage with chat_id from ref.payload; Fail-Open: log and swallow on error. Use fetch (no extra deps). MSW integration test ~4 cases: happy path, network error swallowed, upstream 400 swallowed, ref.channel≠"telegram" behavior. ref.payload shape: `{ chatId: number }`. |
