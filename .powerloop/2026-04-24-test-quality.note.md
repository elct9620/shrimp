---
goal: Fix test-quality issues in the Shrimp test suite one item at a time. If Review or Sample uncovers new issues, append them and keep going until all test-quality issues are properly handled. Review/Sample must be blind — scanners receive only the target file(s) + /coding:testing rubric, never prior findings or this note's Notes column.
language: en
current_phase: execute
started_at: 2026-04-24T00:00:00Z
interval: 10m
cron_id: f952c985
execute_skills: /coding:testing, /coding:refactoring
review_skills: /coding:testing, /coding:principles
sample_passes: 0/5
review_cycles: 0
---

# Test Quality Remediation

## Progress Table

| # | Item | Execute | Review | Sample | Notes |
|---|------|---------|--------|--------|-------|
| 1 | Replace module-level `vi.mock()` of OpenTelemetry SDK in `tests/infrastructure/telemetry/otel-telemetry.test.ts` with `InMemorySpanExporter` / real `BasicTracerProvider` so assertions target observable span outcomes, not constructor-arg shapes. | done | pending | pending | 120-/160+; deleted 3 library-testing cases (constructor-arg assertions); full suite 711 PASS |
| 2 | Remove `as unknown as HeartbeatJob` / `ChannelJob` / `StartNewSession` casts in `tests/adapters/http/routes/heartbeat.test.ts`, `tests/adapters/http/routes/channels/telegram.test.ts`, and `tests/adapters/http/app.test.ts`. Narrow the route dependency to a minimal interface (or function type) so fakes are structurally type-checked. | pending | pending | pending | Cast-heavy fake bypasses ISP |
| 3 | Remove the `InspectableAgent` subclass seam in `tests/infrastructure/ai/ai-sdk-shrimp-agent.test.ts` `experimental_telemetry forwarding` block. Assert observable behavior through `MockLanguageModelV3` / the supplied tracer instead of overriding `buildToolLoopAgentOptions`. | pending | pending | pending | Test couples to protected method |
| 4 | Replace the 10-tick `flushAsync()` microtask poll in `tests/adapters/http/routes/heartbeat.test.ts` with a deterministic await path (e.g., expose a `preCheckPromise` seam or resolve the fire-and-forget chain before `res` returns). | pending | pending | pending | Flaky-on-refactor |
| 5 | Add a `ChannelJob` integration test that persists a user message, makes the agent throw, then re-reads the session through the real `JsonlSessionRepository` to assert the user message survives — locks the semantic contract beyond call-ordering. | pending | pending | pending | Semantic-contract coverage gap |
| 6 | Introduce a single source of truth for HTTP/Job log event names (export consts from source, import into tests) and replace exact-string `toHaveBeenCalledWith("heartbeat received")` / `"cycle finished"` / `"heartbeat enqueued"` etc. with the constants. | pending | pending | pending | Typo-drift risk on log copy |
| 7 | Move the compile-time-only `Expect<T extends false>` invariant block in `tests/use-cases/heartbeat-job.test.ts:249-267` into a dedicated `.test-d.ts` (or equivalent ts-expect-error file). Drop the `expect(true).toBe(true)` runtime dummy. | pending | pending | pending | Mixed-mode assertion |
| 8 | Replace the hand-rolled `makeRecordingTracer` (`tests/infrastructure/ai/ai-sdk-shrimp-agent.test.ts:25-88`) with `InMemorySpanExporter` + `BasicTracerProvider` from `@opentelemetry/sdk-trace-base`. | pending | pending | pending | Fake drift risk |

## Log Table

| Cycle | Phase | Summary | Decision | Handoff |
|-------|-------|---------|----------|---------|
| 1 | plan | Seeded 8 items from prior scan: otel mock replacement, `as unknown as` casts, InspectableAgent seam, flushAsync poll, agent-error persistence integration, log event consts, type-level assertion cleanup, recording-tracer replacement. | Seeded Plan with prior findings intentionally; Review/Sample phases will run blind per goal. Ordered highest-leverage first (items 1–5 Medium, 6–8 Low). | Next cycle: Execute phase item #1 (otel-telemetry mock replacement). Fixer runs `pnpm test` after edits and must /git:commit with a single conventional-commit per item. Keep scope to the one item — no drive-by refactors. |
| 2 | execute | Item #1 done. Replaced three module-level `vi.mock()` calls on OTel SDK modules with real `BasicTracerProvider` + `InMemorySpanExporter` + `SimpleSpanProcessor`. Deleted 3 library-testing cases (NodeSDK/OTLPExporter/resource constructor-arg assertions) that had no observable user outcome. Kept targeted `vi.spyOn(NodeSDK.prototype, "shutdown")` for the error-swallow path to avoid needing a production seam. Full suite: 41 files / 711 tests pass. | Deletions justified: each removed test asserted against mock-constructor args of third-party classes; no behavioral coverage lost. | Next cycle: Execute item #2 (remove `as unknown as HeartbeatJob/ChannelJob/StartNewSession` casts in HTTP route tests by narrowing the route dependency types). Scope strictly to the three listed test files plus the minimal source-side interface narrowing needed; no drive-by edits. |
