---
goal: Update SPEC.md and docs/architecture.md to introduce the Channel concept (Telegram Push path) per prior conversation. Decisions locked in: single global Session, abstract Channel port, universal tool set, simple state.json. Use-case layer stays dependency-free; internal Entity/Aggregate abstractions bridged by Ports. Additional clarifications: (1) Session is created lazily on the user's first message; `/new` slash command starts a new Session — Channel must support a Slash Command mechanism. (2) Telegram uses Webhook delivery; system adopts an Event-based architecture.
language: en
current_phase: execute
started_at: 2026-04-18T00:00:00+08:00
interval: 10m
cron_id: 0d3fcba9
execute_skills: /spec-write → /spec-review → /spec-write → /git:commit
review_skills: /spec-review → /spec-write → /git:commit
sample_passes: 0/10
review_cycles: 0
---

# Channel / Session Spec Update

## Decision Log (Conversation Consensus)

These are the alignment baseline for every edit. Any SubAgent must read D1–D9 before modifying SPEC.md or docs/architecture.md.

### D1. Channel is an abstract Port; Telegram is the first implementation
- SPEC defines the `Channel` concept without coupling to Telegram.
- Telegram implementation uses **Webhook** (not long polling).
- System adopts an **Event-based** architecture: Heartbeat, Channel message, and Slash Command are all events routed by the Supervisor into Jobs.

### D2. Session concept
- **Single global Session** (not per-chat, not per-user) for initial simplicity.
- **Lazy creation**: Session is created on the user's first message. No message = no Session.
- **`/new` Slash Command** creates a new Session (the previous current Session is unlinked; a fresh one becomes current).
- Channels must support a Slash Command mechanism: messages starting with `/` are parsed as commands and handled by the system — they do not reach the ShrimpAgent.
- Persistence: `~/.shrimp/sessions/<id>.jsonl` (append-only conversation) + `~/.shrimp/state.json` (current Session ID only).

### D3. Use-case layer has zero external dependency
- Session, ConversationMessage, ChannelMessage, ConversationRef are Shrimp's own Entities / Value Objects.
- AI SDK `ModelMessage` and Telegram-specific fields (`chat_id`, etc.) MUST NOT leak into use-cases.
- Translation belongs to the Infrastructure layer (`AiSdkShrimpAgent`, `TelegramChannel`).

### D4. Universal tool set
- Todoist built-ins + new `Reply` tool are registered in the **same ToolProvider** for every Job.
- `Reply` needs runtime context (`ConversationRef`) → use DI **Factory Method** (per-Job instantiation), consistent with the existing "tools / session-scoped objects use Factory Method" convention.
- When `HeartbeatJob` runs, `ConversationRef` is null and `Reply` returns a no-op tool result.

### D5. Job polymorphism
- Do NOT split into two classes. Keep a single Job execution skeleton with two context-assembly variants.
- `HeartbeatJob` (current `Job` renamed) and `ChannelJob` (new) share the single JobQueue slot.
- The `ShrimpAgent` port signature gains `history: ConversationMessage[]` (HeartbeatJob passes an empty array).

### D6. Slash Command is a system-level mechanism
- `/new` is the only built-in command for this iteration; future expansion (`/status`, `/reset`, ...) is possible but out of scope now.
- Commands are parsed by the Channel adapter → no Job is enqueued; instead the adapter invokes the matching use-case (e.g., `StartNewSessionUseCase`) and replies via `ChannelGateway`.
- Only non-command messages flow through `ChannelJob`.

### D7. Conflicts with existing SPEC
| Item | Resolution |
|---|---|
| Non-goal "No persistent state" | Rewrite as **"Queue currently supports InMemory only; future extensibility preserved"** — frame as current-implementation scope, not a permanent exclusion. Session is a conversation archive (persisted), separate from the task queue (InMemory). |
| Job definition | Generalize from "task orchestration unit" to "agent invocation unit triggered by Heartbeat or Channel event" |
| Glossary | Add Session, ConversationMessage, Channel, ConversationRef, Slash Command |
| Behavior sections | Add `Channel Integration`, `Session Lifecycle`, `Slash Commands` |
| Shrimp Agent role contract | Input gains `history`; still stateless per call |
| Telemetry | `gen_ai.conversation.id` now maps to Session ID (cross-Job); Job ID remains invocation-scope correlation |
| Failure | `state.json` corruption → fail-fast; a single `<id>.jsonl` corruption → discard and start a new Session |

### D8. Architecture additions (for docs/architecture.md)
- Entities: `entities/session.ts`, `entities/conversation-message.ts`, `entities/channel-message.ts`, `entities/conversation-ref.ts`
- Ports: `use-cases/ports/session-repository.ts`, `use-cases/ports/channel-gateway.ts`
- Use cases: `use-cases/jobs/heartbeat-job.ts` (renamed from current `job.ts`), `use-cases/jobs/channel-job.ts`, `use-cases/start-new-session.ts`
- Adapters: `adapters/http/routes/telegram-webhook.ts`, `adapters/tools/built-in/reply.ts`
- Infrastructure: `infrastructure/session/jsonl-session-repository.ts`, `infrastructure/channel/telegram-channel.ts`

### D9. Edit order (Plan phase decomposition reference)
1. SPEC.md Glossary + IS/IS-NOT + Non-goal adjustments
2. SPEC.md new Behavior sections: Channel Integration, Session Lifecycle, Slash Commands
3. SPEC.md amendments to existing Behavior: Job Queue, Shrimp Agent role contract, Telemetry conversation.id
4. SPEC.md Deployment: Telegram webhook env vars (token, webhook secret), session directory env var
5. architecture.md layer mapping: new entities, ports, modules
6. architecture.md component contracts table updates
7. architecture.md decision log additions (Channel Port, Session Repository, Slash Command)
8. Cross-check: SPEC ↔ architecture naming consistency, no orphan references
9. `git commit` granularity (suggested: glossary+non-goal, behavior additions, architecture — in separate commits)

## Guardrails
- Modify only `SPEC.md` and `docs/architecture.md`. Do NOT touch `src/`.
- Follow Shrimp terminology (Session, Channel, ConversationMessage) — never implementation-derived names.
- Use-case layer described as dependency-free.
- Do not expand scope beyond what was discussed (no auth, no multi-user, no metrics, no new observability concerns).
- **docs/architecture.md is a high-level guidance document.** Do NOT bloat it with per-class details, implementation specifics, or long enumerations. Favor table-level additions (new row in existing tables, short Decision Log entry) over new prose sections. If an edit would add more than ~15 lines to architecture.md, reconsider whether the detail belongs in SPEC.md or should be omitted.

## Progress Table

| # | Item | Execute | Review | Sample | Notes |
|---|------|---------|--------|--------|-------|
| 1 | Add Session, Channel, ConversationMessage, ConversationRef, Slash Command to SPEC.md Glossary | done | pending | pending | D2, D7 Glossary row; commit 2993a57 |
| 2 | Update SPEC.md IS / IS-NOT and Non-goals: rewrite "No persistent state" as "No persistent task queue"; add Channel/Session rows to IS | done | done | pending | D7 Non-goal + D1 Channel as IS; commit 0b235b8 |
| 3 | Add new SPEC.md Behavior section: Channel Integration (abstract Channel port, Telegram webhook, event-based dispatch) | done | pending | pending | D1, D6; commit 539d3eb (~30 lines) |
| 4 | Add new SPEC.md Behavior section: Session Lifecycle (single global Session, lazy creation, persistence at ~/.shrimp/sessions + state.json, corruption rules) | in_progress | pending | pending | D2, D7 Failure row |
| 5 | Add new SPEC.md Behavior section: Slash Commands (parsing rules, /new behavior, adapter-level handling without enqueueing a Job) | pending | pending | pending | D2, D6 |
| 6 | Amend SPEC.md existing Behavior: generalize Job definition, split HeartbeatJob vs ChannelJob semantics in Job Queue + Trigger Flow | pending | pending | pending | D5, D7 Job row |
| 7 | Amend SPEC.md Shrimp Agent role contract: add history input (ConversationMessage[]); document HeartbeatJob passes empty history | pending | pending | pending | D5, D7 contract row |
| 8 | Amend SPEC.md Telemetry: remap gen_ai.conversation.id to Session ID (cross-Job); keep Job ID as invocation correlation | pending | pending | pending | D7 Telemetry row |
| 9 | Update SPEC.md Deployment & Configuration: add Telegram webhook token, webhook secret, session directory env vars | pending | pending | pending | D9 step 4 |
| 10 | Update docs/architecture.md Directory Mapping: add entities (session, conversation-message, channel-message, conversation-ref), new ports, use-cases (heartbeat-job, channel-job, start-new-session), adapters (telegram-webhook, reply tool), infrastructure (jsonl-session-repository, telegram-channel) | pending | pending | pending | D8; rename job.ts→heartbeat-job.ts in map |
| 11 | Update docs/architecture.md Key Ports table: add SessionRepository and ChannelGateway rows with direction and responsibility | pending | pending | pending | D8 Ports |
| 12 | Update docs/architecture.md Component Contracts table: add HeartbeatJob, ChannelJob, StartNewSessionUseCase, TelegramChannel, JsonlSessionRepository, ReplyTool rows; update Job row | pending | pending | pending | D5, D8 |
| 13 | Add docs/architecture.md Decision Log entries: Channel as Port (D1), Session Repository / JSONL persistence (D2), Slash Command adapter-level routing (D6), universal Tool set with Factory Method Reply (D4) | pending | pending | pending | D1, D2, D4, D6 |
| 14 | Cross-check SPEC.md ↔ docs/architecture.md naming consistency; fix orphan references and confirm no src/ modification | pending | pending | pending | D9 step 8 |
| 15 | Rephrase SPEC.md Non-goals queue bullet: frame as "current implementation uses in-memory only; future extension remains open" instead of blanket "No persistent or distributed task queue" | done | pending | pending | User clarification mid-cycle 3; commit 3c425da |

## Log Table

| Cycle | Phase | Summary | Decision | Handoff |
|-------|-------|---------|----------|---------|
| 1 | plan | Decomposed D1–D9 into 14 Progress Table items covering SPEC.md Glossary/IS/Behavior/Amendments/Deployment and architecture.md Directory/Ports/Contracts/Decision Log, ending with a cross-check pass. | Split D9 step 2 into three separate items (Channel Integration, Session Lifecycle, Slash Commands) because each is a distinct Behavior section with independent review criteria. Split D9 step 5 into Directory Mapping (item 10) and Key Ports table (item 11) for the same reason. Merged D9 step 9 (commit granularity) into Execute phase guidance rather than its own item — commits are naturally aligned to item boundaries. | Execute starts at item 1 (Glossary additions in SPEC.md). Constraints: English-only, no src/ edits, follow Shrimp terminology, avoid scope expansion. Items 10–13 touch docs/architecture.md only; items 1–9 touch SPEC.md only; item 14 is a validation pass across both. |
| 2 | execute | Added five Glossary rows (Session, Channel, ConversationMessage, ConversationRef, Slash Command) to SPEC.md. Self-review via /spec-review passed (no Must Fix / Suggested Fix). Committed as 2993a57. | None — definitions aligned directly with D1/D2/D3/D6 without trade-offs. | Next item: #2 (IS / IS-NOT + Non-goal rewrite). Mid-cycle user guidance added to Guardrails: **docs/architecture.md must stay high-level — favor table-row additions and short Decision Log entries over new prose sections.** This applies to items 10–13. Review-phase scanners should flag architecture.md edits that look bloated. Known forward references from item 1 that later items must resolve: (a) "Channel-driven Job" term used in ConversationRef definition — resolved by item 6; (b) Job ID's "no conversation history" claim in SPEC — resolved by item 7; (c) Non-goal "persistent" wording — resolved by item 2; (d) POST /heartbeat section silent on Channel trigger — resolved by item 3. |
| 3 | execute | Item 2 complete: rewrote Non-goals "persistent task queue" bullet (scoped to task queue only, acknowledged Session persistence with forward ref to Session Lifecycle); added 3 IS rows (Channel-triggered Jobs, Session-scoped conversation history, Slash Commands) and 3 IS NOT rows (Per-user/per-chat Sessions, Channel polling, Slash Command extensibility). /spec-review passed — no Must Fix or Suggested Fix. Committed as 0b235b8. | IS row for Session-scoped history includes JSONL persistence detail — kept as a design decision (user-visible, affects module contracts) per spec-principles Specify vs Leave Open table. | Next item: #3 (Channel Integration Behavior section). Forward reference "see Session Lifecycle" in Non-goals resolves when item 4 executes. |
| 4 | execute | Item 15 (mid-cycle user amendment) complete: queue Non-goal bullet rephrased to frame in-memory as current-implementation scope with future extension explicitly left open. Committed as 3c425da on top of 0b235b8. | Adopted SubAgent's own style refinement (`in-memory` lowercase hyphenated) to match existing IS-NOT row wording. Clarification captured in D7 Non-goal row. | Next item: #3 (Channel Integration Behavior section). The framing rule "prefer current-implementation scoping over permanent exclusion" should be applied whenever future items touch Non-goals. |
| 5 | execute | Item 3 complete: added `### Channel Integration` Behavior section to SPEC.md (~30 lines, within budget). Covers abstract Channel concept, Telegram webhook as first implementation, two event types (Message → ChannelJob, Slash Command → adapter-handled), push-only delivery, ConversationRef routing, Job Queue slot contention with Heartbeat, Fail-Open for reply failures, webhook failure isolation. Forward references to Session Lifecycle (item 4), Slash Commands (item 5), Deployment env vars (item 9), Reply tool. Committed as 539d3eb. | Positioned the new section adjacent to Todoist Integration (sibling inbound-source sections). Kept section concise and delegated scope overlaps to later items. | Next item: #4 (Session Lifecycle Behavior section). The Channel Integration section forward-references Session Lifecycle and Slash Commands; item 4 should define Session semantics (single global, lazy create, JSONL + state.json paths, corruption rules from D7) and item 5 should define Slash Command parsing and `/new` behavior. |
