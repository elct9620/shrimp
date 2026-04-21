---
goal: Update SPEC.md and docs/architecture.md to add Agent Skill support following agentskills.io conventions. Plan A — existing Built-in Todoist tools and MCP tools remain globally registered in the AI SDK tool set; System Prompt no longer enumerates tool capabilities and instead presents a Skill catalog (name + description). Two new tools `skill(name)` and `read(path)` gate progressive disclosure. Built-in skills are packaged alongside `dist/` and deployed at `/app/skills/` in Docker; custom skills live under `SHRIMP_HOME/skills/`. Todoist tool docs are reorganised into a built-in `todoist` skill using /skill-creator knowledge. SKILL.md frontmatter must be parseable; unparseable skills are warn+skip at startup to reduce operator friction. Relative file references inside SKILL.md (e.g. `./references/x.md`) are rewritten to absolute paths on load so `read(path)` can consume them directly.
language: en
current_phase: execute
started_at: 2026-04-21T00:00:00Z
interval: 10m
cron_id: ca3a924f
execute_skills: /spec:spec-write -> /spec:spec-review -> /spec:spec-write -> /git:commit
review_skills: /spec:spec-review -> /spec:spec-write -> /git:commit
sample_passes: 0/10
review_cycles: 0
---

# Agent Skill Spec — powerloop notes

## Context (must read before every cycle)

Future cycles start as fresh conversations with only this file as context. Do NOT re-derive these decisions; apply them.

### Why this change

Today the System Prompt enumerates every Built-in and MCP tool's name + capability. As the tool set grows this bloats the prompt and does not scale. Adopting **agentskills.io** progressive disclosure lets the System Prompt carry just a Skill catalog; the model loads detail via `skill(name)` only when relevant.

### Confirmed decisions (do not relitigate)

1. **Plan A**: Built-in Todoist tools and MCP tools remain globally registered in AI SDK's tool set. The AI SDK `ToolLoopAgent` tool list is fixed at run start — dynamic unlock would require restructuring the agent loop and is out of scope. What changes is the **System Prompt text**: it no longer enumerates tool capabilities; it lists skills instead.
2. **Custom skill root**: `SHRIMP_HOME/skills/`. Same operator-provided directory as `AGENTS.md` and `sessions/`. No new env var. Honor existing `SHRIMP_STATE_DIR` deprecated fallback via the `SHRIMP_HOME` resolution rule already in SPEC.
3. **Built-in skill packaging**: bundled with `dist/`. At runtime resolved relative to the app root. In Docker the image mounts them at `/app/skills/`; dev-mode container mount to `/app/skills` is acceptable. No operator-facing env var to override the built-in root (kept simple; can be added later if needed).
4. **Reorganise Todoist tool docs into a built-in `todoist` skill**. The four Todoist tools (Get Tasks, Get Comments, Post Comment, Move Task) continue to be registered as tools; their human-readable usage docs move from System Prompt into the `todoist` SKILL.md. Use `/skill-creator` conventions when shaping the skill structure.
5. **Invalid SKILL.md handling**: if frontmatter parses successfully and satisfies `name` + `description`, treat the skill as valid. Otherwise **warn on stderr at startup and skip that skill** — same pattern as single-MCP-server failure (see SPEC §Failure Handling). Missing built-in skills root is a packaging bug → fail fast.

### agentskills.io summary (authoritative for shape, not behaviour)

- A skill is a directory; `SKILL.md` is required with YAML frontmatter (`name`, `description` required; `license`, `compatibility`, `metadata`, `allowed-tools` optional).
- `name`: 1–64 chars, lowercase `a-z` / digits / hyphens, must match parent directory name.
- `description`: 1–1024 chars; should describe both what it does and when to use it.
- Body is free-form Markdown; spec recommends <500 lines.
- Progressive disclosure: Catalog (name+description, always in prompt) → Instructions (SKILL.md body, loaded on activation) → Resources (files referenced from SKILL.md, loaded on demand).
- File references inside SKILL.md are relative paths from skill root (e.g. `references/x.md`, `scripts/y.py`); keep one level deep.
- URL: https://agentskills.io/specification

### Catalog format in System Prompt

Each skill surfaces as a triple of `name`, `description`, and **absolute** `SKILL.md` path (so the model can optionally `read` it directly without needing to know the skills root). The catalog replaces the current per-tool capability paragraphs. The User Agents Appendix (`AGENTS.md`) placement is unchanged — still appended last.

### Path rewrite rule (for `skill(name)`)

When `skill(name)` returns SKILL.md content, rewrite every **relative** resource reference so the model receives absolute paths, e.g.:

- Source in SKILL.md: `see [example](./references/example.md)` or `references/example.md` or `scripts/extract.py`
- Returned to model: `see [example](/app/skills/todoist/references/example.md)` etc.

Base = absolute path of the skill's own directory (parent of its SKILL.md). Rewriting covers Markdown links, bare backtick paths, and common prose references. Absolute paths and non-local URLs (`http`, `https`, `mailto:`, etc.) are left untouched. Out-of-skill relative paths (`../other-skill/...`) are left as-is — the `read(path)` sandbox will still gate access.

### `read(path)` sandbox rule

Allowed: paths whose resolved absolute form is under the Built-in skills root OR the Custom skills root. Any other path → tool returns an error result (not a throw) so the agent loop can recover. Symlink resolution must be applied before the prefix check to prevent escape.

### Minimum tool set exposed by default (Plan A)

Still all four categories, same as today PLUS two new tools:

| Category | Tools | Change |
|----------|-------|--------|
| Skill (new) | `skill(name)`, `read(path)` | NEW — always registered |
| Built-in Todoist | Get Tasks, Get Comments, Post Comment, Move Task | Unchanged in registration; usage docs relocated to `todoist` SKILL.md |
| MCP | All tools from `.mcp.json` servers | Unchanged |

SummarizePort is unaffected (has no tools).

### SPEC sections to touch

- Glossary (add terms; cluster with existing Session/Channel rows)
- Scope § IS (add row)
- Scope § IS-NOT (add rows)
- Behavior — add § Skill Layer
- Behavior § Event-Driven Trigger Flow (no change expected; verify)
- Design § Architecture Overview (add Skill Layer component)
- Design § Request Flow (insert Skill catalog assembly into System Prompt construction)
- Design § Job — Prompt rules (System Prompt content change)
- Design § Shrimp Agent — Tool integration (add `skill` / `read` rows)
- Deployment & Configuration (built-in vs custom skill roots; Docker mount)
- Failure Handling (new rules)
- Telemetry Emission (verify no change — `ai.toolCall` spans still emitted for `skill`/`read`)

### docs/architecture.md sections to touch

- §5 Key Ports — add skill-related ports
- §6 Component Contracts — add module rows (SkillRegistry, SkillTool, ReadTool, FileSkillRepository)
- §8 Failure Handling Placement — add skill rules
- Keep high-level per user feedback memory (`feedback_architecture_high_level.md`, `feedback_architecture_no_duplication.md`) — prefer table rows; no duplication of SPEC decisions

### Guardrails (no scope expansion — per `feedback_no_spec_expansion.md`)

Out of scope for this loop — do NOT add:

- Hot reload / file watching of skills
- Per-Session or per-Channel skill customisation
- Skill signing / trust model beyond the sandboxed path check
- `allowed-tools` enforcement (accept the frontmatter field but behavior is not specified here)
- Remote skill fetching
- Skill dependencies / version resolution
- Telemetry attributes beyond what AI SDK already emits for `ai.toolCall`
- Any logging/observability enhancement unrelated to skill loading

### Conventions to preserve

- SPEC in English (`feedback_spec_english.md`)
- Notes in English (`feedback_notes_english.md`)
- SPEC terminology first in class/port names (e.g. `SkillRegistry`, not `SkillManager`)
- Plain `git` only — no `git -C` (`feedback_plain_git_no_dash_c.md`)
- Commit powerloop notes to git on completion (`feedback_commit_powerloop_notes.md`)
- Prompt templates as `.md` imported via `unplugin-raw` is the existing convention — SKILL.md is NOT loaded via that mechanism (it is discovered and read at runtime, not at build time); this is the intended distinction

## Progress Table

| # | Item | Execute | Review | Sample | Notes |
|---|------|---------|--------|--------|-------|
| 1 | Add Glossary entries: Agent Skill, Built-in Skill, Custom Skill, Skill Catalog, SKILL.md, `skill` tool, `read` tool | done | pending | pending | Cluster placement near Session/Channel per existing SPEC convention |
| 2 | Extend Scope IS with Agent Skill mechanism (progressive tool-usage disclosure via SKILL.md); keep row short (<25 words), feature-level not impl-level | done | pending | pending | |
| 3 | Extend Scope IS-NOT: no auto-activation, no hot-reload, no cross-skill state, skills are not MCP servers, no per-Session skill customisation, no remote fetch | done | pending | pending | |
| 4 | Update Architecture Overview to add Skill Layer as a first-class component parallel to Tool Layer; update Request Flow diagram and component table | done | pending | pending | |
| 5 | Add Behavior § Skill Layer subsection: discovery at startup, catalog assembly (name+description+absolute SKILL.md path), SKILL.md frontmatter parse rules, relative→absolute path rewrite on `skill(name)` return, `read(path)` sandbox | pending | pending | pending | Reference agentskills.io §frontmatter fields; state required = name + description |
| 6 | Update Job § Prompt rules: System Prompt replaces per-tool capability paragraphs with the Skill Catalog; User Agents Appendix placement unchanged (still last) | pending | pending | pending | Clarify that tool *registration* is unchanged — only System Prompt text differs |
| 7 | Update Shrimp Agent § Tool integration: add Skill category row (`skill`, `read`) alongside Built-in and MCP; note both are always registered | pending | pending | pending | |
| 8 | Add built-in `todoist` skill to the spec (directory layout, required files, what its SKILL.md must document — Get Tasks/Get Comments/Post Comment/Move Task usage). Spec references the file; does not inline its body | pending | pending | pending | Use /skill-creator conventions; keep the SPEC entry short — actual SKILL.md content authoring is out of scope for this loop |
| 9 | Deployment & Configuration: document built-in skills root (packaged with dist/, mounted `/app/skills/` in Docker; dev mount acceptable) and custom skills root (`SHRIMP_HOME/skills/`); no new env var; clarify optional directory | pending | pending | pending | |
| 10 | Failure Handling: unparseable SKILL.md frontmatter → warn on stderr + skip; duplicate skill names (built-in wins, custom skipped with warn) — or decide collision rule during Execute; `skill(name)` unknown → error returned to model; `read(path)` outside sandbox or missing → error returned to model; built-in skills root absent → fail fast | pending | pending | pending | If collision rule undecided, ESCALATE in Log Table rather than silently picking |
| 11 | Update docs/architecture.md: add Skill ports + module rows (`SkillRegistry`, `SkillTool`, `ReadTool`, `FileSkillRepository`); update §8 Failure Handling Placement with skill rules; stay high-level, prefer table rows, do NOT duplicate SPEC content | pending | pending | pending | |

## Log Table

| Cycle | Phase | Summary | Decision | Handoff |
|-------|-------|---------|----------|---------|
| 1 | plan | Validated 11-item Progress Table against SPEC.md (826 lines, sections: Glossary L34, Scope IS L67, IS-NOT L87, Behavior L111, Design/Architecture Overview L524, Request Flow L549, Failure Handling L595, Job L602, Shrimp Agent L680, Deployment L753) and docs/architecture.md (§5 Key Ports L58, §6 Component Contracts L75, §8 Failure Handling Placement L119). Every table item maps cleanly to an existing SPEC section; Context section decisions are complete and unambiguous. Invoked /spec:spec-write skill to inform decomposition review. | No new rows appended — the 11 items already cover Glossary, Scope IS/IS-NOT, Architecture Overview + Request Flow, Behavior § Skill Layer, Job Prompt rules, Shrimp Agent tool integration, built-in todoist skill SPEC entry, Deployment & Configuration, Failure Handling, and architecture.md updates. Adding more would risk scope creep (see `feedback_no_spec_expansion.md`). Phase flipped to execute. | Execute Cycle 2 starts with item #1 (Glossary). Place the new terms (Agent Skill, Built-in Skill, Custom Skill, Skill Catalog, SKILL.md, `skill` tool, `read` tool) in SPEC.md § Glossary (starts L34) clustered near the existing Session/Channel rows to match established convention. Gotchas: (a) SPEC.md already uses the `SHRIMP_HOME` resolution rule — reuse that language; do not redefine. (b) Glossary rows are short one-line definitions — keep each new term terse; deeper mechanics belong in Behavior § Skill Layer (item #5). (c) `skill` and `read` tool entries should name-match the exact tool identifiers used later in item #7. |
| 2 | execute | Added 7 Glossary rows to SPEC.md immediately after User Agents Appendix (row-adjacent to Session/Channel/ConversationMessage/SummarizePort cluster): Agent Skill, Built-in Skill, Custom Skill, Skill Catalog, SKILL.md, `skill` tool, `read` tool. Each is a single-sentence definition matching existing row register; no impl leakage (no class names, no AI SDK internals). Reused `SHRIMP_HOME` without redefining. Tool identifiers wrapped in backticks (`skill`, `read`) so item #7's Tool integration rows can name-match exactly. Commit: 2d8938b. | Placed the cluster after User Agents Appendix rather than interleaving with Session rows — Skills are a prompt-layer concern sibling to the Agents Appendix, so grouping them at the end of the prompt/session cluster reads better than splitting Session/Auto Compact/Conversation rows. Chose `(name, description, absolute SKILL.md path)` phrasing for Skill Catalog to match the triple wording in the Context section. | Cycle 3 Execute runs item #2: Extend Scope § IS with one row for the Agent Skill mechanism. Gotchas: (a) keep row <25 words, feature-level not impl-level — match existing IS rows like "User Agents Appendix" or "MCP-based tool extension"; (b) place the new row near the existing "User Agents Appendix" row (end of IS table) since both are prompt-layer extensions; (c) wording should emphasize progressive disclosure / catalog-in-System-Prompt, not the tool names — those are Glossary-level; (d) do NOT introduce out-of-scope concepts (hot reload, per-Session customisation, `allowed-tools` enforcement). |
| 3 | execute | Added one IS row "Agent Skill mechanism" to SPEC.md Scope § IS table, placed immediately after "User Agents Appendix" (end of IS table — prompt-layer extensions clustered). Description: "System Prompt surfaces a catalog of discovered skills (progressive disclosure); the Shrimp Agent loads each skill's full instructions and referenced resources on demand" (23 words). Feature-level phrasing — no class names, no tool names (`skill`/`read` stay Glossary-only), no file paths. Prettier reflowed surrounding column widths (cosmetic). Commit: 47aaa65. | Chose "loads each skill's full instructions and referenced resources on demand" to cover both the SKILL.md body (instructions) and the resource files, mirroring agentskills.io's three-tier disclosure without naming the tiers. Kept "Shrimp Agent" (SPEC term) rather than "agent" for register consistency. | Cycle 4 Execute runs item #3: Extend Scope § IS-NOT with exclusions — no auto-activation, no hot-reload, no cross-skill state, skills are not MCP servers, no per-Session skill customisation, no remote fetch. Gotchas: (a) existing IS-NOT table is two-column "Excluded / Reason" — each exclusion its own row; match terse reason style of existing rows like "Parallel Job processing" or "Channel polling"; (b) cluster the new rows at the end of the IS-NOT table (no existing extensibility-related cluster to slot into — the table is roughly ordered by Job/Queue → Board → UI/auth → telemetry → Channel, so skill exclusions fit at the end as newest concern); (c) "skills are not MCP servers" reason should clarify that MCP remains the code-extension mechanism and Skills are guidance-only; (d) do NOT add exclusions that weren't in the list — keep to the 6 enumerated; (e) feature-level phrasing — no class names. |
| 4 | execute | Added 6 IS-NOT rows to SPEC.md Scope § IS-NOT table, appended at end of table after the two User Agents Appendix exclusions: Automatic skill activation, Skill hot-reload, Cross-skill shared state, Skill-based code extension, Per-Session skill customisation, Remote skill fetching. Each row is atomic (one exclusion), feature-level (no class names, no `skill`/`read` tool identifiers in Excluded column), and the Reason column states what-instead rather than restating the exclusion. MCP distinction stated explicitly: "Skills provide guidance and instructions only; MCP remains the sole mechanism for adding executable tools to the Shrimp Agent". Commit: c299328. | Phrased "Skill-based code extension" for the MCP distinction row (concept-level) rather than "Skills are not MCP servers" (comparative) — reads better in a capability-exclusion register. Reason for Automatic skill activation explicitly contrasts with heuristic/content-based auto-loading to foreclose future "smart activation" ambiguity. Kept "Shrimp Agent" (SPEC term) rather than "agent" for consistency with existing rows. | Cycle 5 Execute runs item #4: Update Architecture Overview to add Skill Layer as a first-class component parallel to Tool Layer; update Request Flow sub-section. Gotchas: (a) update SPEC.md Design § Architecture Overview component list AND the Request Flow sub-section — both need the Skill Layer; (b) Skill Layer is parallel to Tool Layer, not replacing it — existing Tool Layer language stays; (c) catalog assembly happens at System Prompt construction time (per-Job, same lifecycle point as User Agents Appendix injection) — state this in Request Flow; (d) feature-level not impl-level — no class names (no `SkillRegistry`, `SkillTool`, `ReadTool`, `FileSkillRepository` — those belong in docs/architecture.md at item #11); (e) preserve high-level tone; add rows/bullets to existing structures rather than long prose. |
| 5 | execute | Added Skill Layer row to SPEC.md Design § Architecture Overview component table, placed immediately after the Tool Layer row (preserved unchanged). Responsibility text: "Discovered Agent Skills surfaced to the Shrimp Agent as a catalog in the System Prompt; full instructions and referenced resources are loaded on demand via dedicated tools". Request Flow code block updated in two small ways: (1) inserted a parenthetical note under the Job Worker line stating "System Prompt construction includes the Skill catalog and the User Agents Appendix" — making catalog assembly timing visible at the same lifecycle point as the Agents Appendix; (2) appended "+ Skill Tools" to the "Built-in Tools + MCP Tools" arrow so the tool categories list is consistent with the new component. Feature-level phrasing — no class names, no `skill`/`read` tool identifiers, no SKILL.md parsing details. Commit: 9c8aa8c. | Chose to keep Tool Layer row untouched and add a sibling Skill Layer row rather than merge both into a generic "Capability Layer" row — parallelism is more explicit and matches the Context section's framing. Placed the Skill catalog note as an indented parenthetical under the Job Worker step (not a new arrow) because System Prompt construction is an internal detail of prompt assembly, not a separate collaborator in the chain — indentation matches how the existing flow treats sub-steps. Added "+ Skill Tools" (plural category label) to the tool list under Shrimp Agent to keep the arrow consistent with the component table without naming individual tools. | Cycle 6 Execute runs item #5: Add Behavior § Skill Layer subsection — this is the largest behavioral item. Gotchas: (a) new subsection under Behavior § (before Event-Driven Trigger Flow or near existing related subsections — check structure during execute); (b) cover — discovery at startup (scan Built-in skills root + Custom skills root `SHRIMP_HOME/skills/`), catalog assembly (emit triples of name + description + absolute SKILL.md path into System Prompt at Job construction time), SKILL.md frontmatter parse rules (YAML; `name` + `description` required; `name` must match parent directory name, 1–64 chars `[a-z0-9-]`; `description` 1–1024 chars; `license`/`compatibility`/`metadata`/`allowed-tools` accepted but behavior not specified here), relative→absolute path rewrite on `skill(name)` return (applies to Markdown links `[x](./y)`, bare backticked paths, and common prose references; absolute paths + URLs with `http`/`https`/`mailto:` schemes untouched; base = absolute path of the skill's own directory; out-of-skill relative paths `../other/...` left as-is and still gated by read sandbox), `read(path)` sandbox (resolved absolute path MUST be under Built-in OR Custom skills root; symlinks resolved BEFORE prefix check to prevent escape; out-of-sandbox or missing path returns error result to the model, not a throw); (c) be rigorous with MUST/MAY per RFC 2119 tone used elsewhere in SPEC.md, but stay feature-level — no class names (`SkillRegistry`/`SkillTool`/`ReadTool`/`FileSkillRepository` belong to item #11 in docs/architecture.md); (d) reference agentskills.io for shape; (e) do NOT restate Glossary, Scope IS, Scope IS-NOT, or Architecture Overview content — Behavior adds behavioural rules on top of those; (f) do NOT cover unparseable SKILL.md warn+skip / duplicate name collision / missing built-in root fail-fast — those belong to item #10 (Failure Handling); (g) do NOT cover System Prompt text layout details — those belong to item #6 (Job § Prompt rules). |
