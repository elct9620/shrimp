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
| 7 | Use case: StartNewSession — archives previous Session, creates new, updates state.json; bypasses JobQueue; used by /new | in_progress | pending | pending | SPEC §Slash Commands, §Session Lifecycle |
| 8 | Adapter (tool): ReplyTool under adapters/tools/built-in/ — calls ChannelGateway with ConversationRef; no-op when ref is null (HeartbeatJob path) | pending | pending | pending | SPEC §Channel Integration dispatch; architecture.md row 88 |
| 9 | Infrastructure: TelegramChannel — implements ChannelGateway via Bot API sendMessage; Fail-Open on reply errors | pending | pending | pending | SPEC §Telegram Channel |
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

| Cycle | Phase | Summary | Decision | Handoff |
|-------|-------|---------|----------|---------|
| 1 | plan | Decomposed goal into 14 items ordered dependency-root-first (env/ports/entities → session repo → job split → outbound adapters → inbound route → DI/telemetry → test consolidation → doc alignment). Mapped every SPEC.md Channel/Session/Slash-Command/Telemetry clause to at least one item. | Treat test consolidation (item 13) as a parallel concern: consolidate tests as each earlier item lands rather than as a separate big-bang pass, so dead-code tests get removed as their subjects change. | Next cycle enters execute phase with item 1 (env config). Spawn SubAgent (Sonnet) with /coding:write → /coding:review → /coding:refactor → /git:commit cadence. Remind SubAgent: SHRIMP_STATE_DIR validation is conditional on CHANNELS_ENABLED; fail-fast only when Channels enabled; creation failure is fail-fast per SPEC §Deployment Rules. Do NOT touch container.ts wiring for Channels yet (item 11) — env validation lands first so later items can rely on it. |
| 7 | execute | Item 6 complete. Deleted src/use-cases/job.ts, added heartbeat-job.ts (+190 test LOC) and channel-job.ts (+179 test LOC). JobInput extended with `history` and optional `sessionId`; ShrimpAgentResult extended with `newMessages`. AiSdkShrimpAgent converts history to ModelMessage and prepends; TODO(item 12) comment for sessionId stamping. TOKENS.Job → TOKENS.HeartbeatJob; heartbeat.ts + app.ts + server.ts updated. 52-case job.test.ts consolidated into 10 integration cases across two files. ChannelJob NOT registered in container yet (item 11 will gate on channelsEnabled). typecheck clean, 430/430 pass. Commit 85a8575. | Preferred duplication over abstract base class (each Job's unique work dominates the shared boilerplate); no shared helper added. ChannelJob appends incoming user msg to Session *before* agent call so transcript is preserved even if agent fails. history passed to agent is the pre-append snapshot; userPrompt carries the incoming message (per SPEC: "ChannelJob: the user prompt contains the incoming Channel message"). | Next cycle: item 7 (StartNewSession use case). Thin class under src/use-cases/start-new-session.ts with one method (e.g. `execute(): Promise<Session>`) that calls `sessionRepository.createNew()`. SessionRepository.createNew() already archives by overwriting state.json; no extra archive logic needed. Invoked by the Telegram webhook adapter when `/new` arrives — item 10 wires it. Keep trivial; no tests unless there's branching logic (there shouldn't be). Note: StartNewSession is listed in architecture.md §Component Contracts as a Use Case, so honor that placement. |
| 6 | execute | Item 5 complete. JsonlSessionRepository with state.json + sessions/<id>.jsonl; write-then-rename atomicity for state.json; append() is Fail-Open; getCurrent handles missing/malformed/corrupt variants per SPEC matrix. 6-case tmpdir integration test (107 lines). 450/450 pass. Commit fe02922. | Chose constructor-injection of `{ stateDir, logger }` (plain class, no tsyringe decorators) consistent with repo DI convention. Chose write-then-rename for state.json to protect fail-fast on malformed from partial writes. | Next cycle: item 6 — the big structural refactor. Split src/use-cases/job.ts Job into two variants sharing a worker skeleton: HeartbeatJob (current behavior; history stays empty) + ChannelJob (loads current Session or creates via createNew on first message, appends incoming user msg, runs agent with history input, appends new assistant entries back). Extend ports/shrimp-agent.ts `JobInput` with `history: readonly ConversationMessage[]` AND optional `sessionId?: string` (needed in item 12 to stamp gen_ai.conversation.id). Extend ShrimpAgentResult if needed to surface new ConversationMessage entries the agent produced (assistant's final text reply) so ChannelJob can append them — or have ChannelJob just append a single assistant message reconstructed from the agent's final text output. AiSdkShrimpAgent must not break HeartbeatJob — history: [] is equivalent to today. HeartbeatRoute should wire HeartbeatJob. Keep TaskSelector/PromptAssembler logic inside HeartbeatJob; ChannelJob has its own prompt assembly (incoming message + system prompt). Don't touch container.ts wiring for Channels yet (item 11) — keep the existing container.ts registration of `Job` working with HeartbeatJob renamed or aliased so tests still pass. SubAgent should consolidate the job.test.ts tests during this cycle (per user's test-consolidation goal): the existing tests.job.test or use-cases/job.test.ts likely have fine-grained unit cases that can be folded into two integration tests — one per variant. Expect ~200-400 LOC of churn; single commit. |
| 5 | execute | Item 4 complete. ChannelGateway port with single `reply(ref, text)` method; Fail-Open semantics in JSDoc. 444/444 pass. Commit c1bb916. | — | Next cycle: item 5 (Infrastructure: JsonlSessionRepository). Real implementation of SessionRepository under src/infrastructure/session/. Reads/writes `<SHRIMP_STATE_DIR>/state.json` and `<SHRIMP_STATE_DIR>/sessions/<uuid>.jsonl`. SPEC failure matrix (§Session Lifecycle): state.json missing → treat as no current (getCurrent returns null); state.json malformed → fail fast (throw at construction / getCurrent); JSONL missing/unreadable → discard + getCurrent returns null, broken file left on disk; append I/O failure during Job → log + swallow (Fail-Open). createNew() generates UUID (use crypto.randomUUID; v7 preferred when available, v4 fallback per SPEC), writes empty JSONL, updates state.json atomically enough (write-then-rename is fine; SPEC doesn't mandate strict atomicity). Use node:fs/promises. Integration test under tests/infrastructure/session/ with tmpdir setup — exercise the full failure matrix (no more than ~6 focused cases). Also require LoggerPort injected so append failure logs follow existing logger pattern. |
| 4 | execute | Item 3 complete. SessionRepository port with Session type and three methods (getCurrent / createNew / append). JSDoc encodes SPEC failure semantics so adapters don't need to re-read the spec. 444/444 pass. Commit d976f16. | Kept `append` returning void (Promise<void>) even though SPEC says Fail-Open on append failure — the intent "append must not throw" is documented, not typed. Alternative was a Result<void> shape but existing ports (BoardRepository) throw normally; we'll let the adapter swallow I/O errors and the ChannelJob top-level catch handle anything that leaks. | Next cycle: item 4 (Port: ChannelGateway). Single method `reply(ref: ConversationRef, text: string): Promise<void>`. Fail-Open on reply failures (SPEC §Channel Integration): the adapter should log and swallow delivery errors so a missing reply never fails the Job. Lives in use-cases/ports/channel-gateway.ts. Imports only ConversationRef from entities. No tests. |
| 3 | execute | Item 2 complete. Added ConversationMessage (role: "user"|"assistant" + content: string) and ConversationRef ({channel, payload} with opacity comment). No tests — pure types. 444/444 pass, typecheck clean. Commit 3a7d3f0. | Chose role union of user/assistant only (SPEC says "message history"; system/tool entries live inside AI SDK loop per Prompt Assembly rules, not in Session archive). Chose ConversationRef shape (A) channel+payload over branded opaque string — Telegram needs multi-field payload (chatId + optional message_thread_id); branding a JSON-encoded string would force redundant encode/decode. | Next cycle: item 3 (Port: SessionRepository). Thin interface under use-cases/ports/session-repository.ts. Methods per SPEC §Session Lifecycle: getCurrent() returns current Session or null (missing state.json = no current), createNew() creates+persists+becomes current, append(sessionId, msgs) appends ConversationMessage entries. Session shape: { id: string; messages: ConversationMessage[] }. No infrastructure code yet (item 5). Remind SubAgent: ports live in use-cases/ and depend only on entities. |
| 2 | execute | Item 1 complete. Added channelsEnabled + telegramBotToken? + telegramWebhookSecret? + shrimpStateDir to EnvConfig; mkdirSync on enable with fail-fast; telemetry-factory test fixture updated; 444/444 tests pass, typecheck clean. Commit 0351b62. Post-commit IDE diagnostics were stale (TS reported missing props + unused mkdirSync) — `pnpm typecheck` confirms clean. | Kept shrimpStateDir always-present (with default) rather than optional — downstream code simpler; one-line comment explains the choice. SubAgent flagged test fixture brittleness (telemetry-factory test constructs EnvConfig literal); noted but not addressed — will become worth a helper only if item 3/4/5 duplicate the same fix. | Next cycle: item 2 (entities — ConversationMessage + ConversationRef). Pure value objects under src/entities/; no runtime deps; the shapes should satisfy what SPEC.md §Glossary says and what items 5/6/8/10 will need: ConversationMessage has role + content at minimum (translate to AI SDK messages happens at infra boundary, not here); ConversationRef is opaque to use-cases (only Telegram interprets it). Keep types thin — no logic. Remind SubAgent: do NOT add premature fields (timestamps, ids) unless SPEC mandates. |
