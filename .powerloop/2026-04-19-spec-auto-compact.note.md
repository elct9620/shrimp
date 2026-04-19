---
goal: Update SPEC.md to add Auto Compact spec for Channel Sessions — token-threshold trigger, dedicated SummarizePort, generate new Session ID on compaction (switch current pointer), HeartbeatJob unaffected. Spec must be rigorous so downstream implementation does not drift.
language: en
current_phase: execute
started_at: 2026-04-19T00:00:00Z
interval: 10m
cron_id: 3edbb0f5
execute_skills: /spec:spec-write -> /spec:spec-review -> /spec:spec-write -> /git:commit
review_skills: /spec:spec-review -> /spec:spec-write -> /git:commit
sample_passes: 0/5
review_cycles: 0
---

# Auto Compact Spec — powerloop notes

## Progress Table

| # | Item | Execute | Review | Sample | Notes |
|---|------|---------|--------|--------|-------|
| 1 | Add Glossary entries for Auto Compact, Conversation Summary, Compaction Threshold, and SummarizePort | in_progress | pending | pending | Foundational vocabulary used by later items |
| 2 | Extend Scope IS list with Auto Compact (token-threshold triggered, per-Session) | pending | pending | pending | Depends on #1 |
| 3 | Extend Scope IS-NOT to exclude cross-Session summarization, manual compact command, and HeartbeatJob participation | pending | pending | pending | Depends on #1; makes boundaries explicit |
| 4 | Add Auto Compact behavior subsection under Session Lifecycle: token-threshold trigger using last-turn prompt tokens, new Session UUID rotation, state.json pointer switch, previous Session file retained as archive (mirroring /new) | pending | pending | pending | Depends on #1–#2; core behavior |
| 5 | Update Session Lifecycle participation/coverage table to state HeartbeatJob has no Session and is not subject to Auto Compact; confirm ChannelJob is the only participant | pending | pending | pending | Depends on #4; covers requirement 4 |
| 6 | Update Prompt Structure table/notes to describe post-compaction history shape seen by ShrimpAgent (summary prepended, older turns dropped) | pending | pending | pending | Depends on #4 |
| 7 | Add SummarizePort contract to Design layer: role, input (prior history), output (Conversation Summary), provider/model usage, independence from ShrimpAgent | pending | pending | pending | Depends on #1, #4 |
| 8 | Add Deployment & Configuration env vars for Auto Compact (compaction threshold token count; optional summarization model override) following required/optional conventions | pending | pending | pending | Depends on #4, #7 |
| 9 | Add Failure Handling rules: summarization call failure (skip compaction, continue with current Session), new Session file write failure, missing token-usage telemetry from provider | pending | pending | pending | Depends on #4, #7 |
| 10 | Add cross-reference pass: reiterate HeartbeatJob-unaffected in Telemetry and any other affected sections; ensure /new Slash Command section links to shared rotation semantics | pending | pending | pending | Final consistency sweep; depends on #4, #5 |

## Log Table

| Cycle | Phase | Summary | Decision | Handoff |
|-------|-------|---------|----------|---------|
| 1 | plan | Decomposed Auto Compact spec goal into 10 ordered items covering Glossary, Scope, Session Lifecycle behavior, Prompt Structure, SummarizePort Design, env vars, Failure Handling, and cross-reference sweep. | Items ordered so vocabulary (Glossary) precedes Scope, Behavior, Design, Config. Each item is one section or one coherent cross-section change to fit a single 10m cycle. | Execute phase starts next cycle with item #1 (Glossary). Use /spec:spec-write workflow per cycle; self-review before commit. Do NOT expand scope beyond the 4 stated requirements — no manual /compact command, no cross-Session summarization, no user-facing compaction notifications. |
