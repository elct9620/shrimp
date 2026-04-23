# Item #18 — Restructure System Prompt per revised SPEC (commit 346ff7b)

## Status: PASS

## Commit

`0b3f39b` — refactor(prompt): add Tools section and drop path from Skills catalog

## Files Modified

- `src/use-cases/prompt-assembler.ts` — dropped `Path:` line from `buildSkillCatalogSection`; added `buildToolsSection()`; wired Tools section after Skills in `buildSystemPrompt`.
- `tests/use-cases/prompt-assembler.test.ts` — updated/added 51 total tests (was 45).

## Skills Section (final output)

```
## Skills

The following skills are available. Use the `skill(name)` tool to load full instructions.

- **deploy** — Handles deployment workflows
```

No `Path:` line. Empty catalog still emits `## Skills\n\n(none)`.

## Tools Section (verbatim)

```
## Tools

Skills are loaded progressively — the Skills section above tells you which skills exist; the tools below let you fetch their content on demand.

- `skill(name)`: Load a skill's full instructions. Returns the SKILL.md content with relative paths rewritten to absolute.
- `read(path)`: Read a resource file referenced from a skill's content. Pass an absolute path obtained from a `skill(name)` return value. Paths outside the skills roots are refused.
```

## Placement Order

`base → variant → Skills → Tools → User Agents Appendix`

Rationale: Skills first so the model knows what exists; Tools immediately after to explain how to access them — they form a cohesive progressive-disclosure unit before any operator override content.

## Test Counts

- Tests before: 45 (prompt-assembler file), 668 (full suite)
- Tests after: 51 (prompt-assembler file), 674 (full suite)
- Net new: 6 new tests in prompt-assembler; all 674 green

## Self-Review Checklist

- [x] `## Skills` no longer contains absolute paths
- [x] `## Tools` present in heartbeat + channel prompts; absent in summarize
- [x] `## Tools` describes `skill(name)` and `read(path)` and progressive disclosure
- [x] No tool-name enumeration or tool descriptions from `createBuiltInToolDescriptions` surfaced
- [x] Empty catalog still emits `## Skills` header + `(none)`
- [x] Placement order documented and matches SPEC L728
- [x] Tests updated, not just deleted
- [x] typecheck + tests green + formatted + committed
- [x] `SkillCatalogEntry.skillFilePath` untouched (still on the interface)
