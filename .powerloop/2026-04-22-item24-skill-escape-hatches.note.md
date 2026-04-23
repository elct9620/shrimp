# Item #24 — Close skill-first escape hatches in Approach and Tools sections

## Status: PASS

## Commit

`0a04e9c` — fix(prompt): close skill-first escape hatches in Approach and Tools sections

## Files Modified

- `src/use-cases/prompts/system-base.md` — rewrote `## Approach` paragraph: removed "reason from the task directly using the available tools" fallback; replaced with two-sentence block that directs the model to state what's missing and ask for clarification, and declares additional tools are "not a path around" skills.
- `src/use-cases/prompt-assembler.ts` — two changes:
  - `buildToolsSection`: last sentence now reads "Additional tools … are reached through skills. When a loaded skill instructs you to call a specific tool, call it." (removed "When no skill matches the task, you may use those tools directly.")
  - `buildSkillCatalogSection` header: added "before doing anything else" ordering directive ("Scan the list first — when any entry matches the user's request, call `skill(name)` before doing anything else.")
- `tests/use-cases/prompt-assembler.test.ts` — replaced one permissive test ("fallback note for direct tool use") with five new assertions; all 5 were red before the prompt edits, all green after.

## Final Text (verbatim)

### ## Approach (system-base.md)

```
## Approach

Begin with the Skills catalog. When a listed skill matches the situation, call `skill(name)` and follow its instructions as your playbook.

When nothing in the catalog matches the task, state what capability is missing and ask for clarification. Additional tools serve skills; they are not a path around them.
```

### ## Tools tail (prompt-assembler.ts buildToolsSection)

```
Additional tools (function-call definitions provided separately) are reached through skills. When a loaded skill instructs you to call a specific tool, call it.
```

### ## Skills header (prompt-assembler.ts buildSkillCatalogSection)

```
## Skills

These are your primary playbooks. Scan the list first — when any entry matches the user's request, call `skill(name)` before doing anything else. Treat each skill as the authoritative procedure for its scope.
```

## Test Counts

- Before: 692 (full suite)
- After: 695 (full suite)
- Net new: 3 net new tests (1 renamed/rephrased + 4 added = 5 touched, net +3)

## Self-Review Checklist

- [x] `## Approach` no longer has "reason from the task directly using the available tools"
- [x] `## Approach` fallback describes positive action ("state what's missing", "ask for clarification")
- [x] `## Tools` no longer has "When no skill matches... you may use those tools directly"
- [x] `## Tools` closes with "reached through skills" / "when a skill instructs you to call" framing
- [x] `## Skills` header contains "before doing anything else"
- [x] Existing positive-framing tests still pass (items #20/#22 — Reply Format block assertions all green)
- [x] Heartbeat/summarize variant outputs inherit new base text (desired, no test breakage)
- [x] typecheck + tests green + formatted + committed

## Negative-Framed Anchor

`## Approach` retains one negative anchor: "they are not a path around them." This is a hard guardrail — the fully-positive alternative ("Reach additional tools only by following skill instructions that invoke them.") was considered but the task spec explicitly permits the negative anchor form when it serves as a guardrail. The phrasing mirrors the spec's own example. No other negative anchors were introduced.
