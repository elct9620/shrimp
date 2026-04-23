import { Task } from "../entities/task";
import { Comment } from "../entities/comment";
import type { SkillCatalogEntry } from "./ports/skill-catalog";
import systemBaseTemplate from "./prompts/system-base.md?raw";
import systemHeartbeatTemplate from "./prompts/system-heartbeat.md?raw";
import systemChannelTemplate from "./prompts/system-channel.md?raw";
import systemSummarizeTemplate from "./prompts/system-summarize.md?raw";
import userHeartbeatTemplate from "./prompts/user-heartbeat.md?raw";

export type HeartbeatAssembleInput = {
  task: Task;
  comments: Comment[];
  skills?: readonly SkillCatalogEntry[];
  userAgents?: string | null;
};

export type HeartbeatAssembleOutput = {
  systemPrompt: string;
  userPrompt: string;
};

export function assembleHeartbeatPrompts({
  task,
  comments,
  skills,
  userAgents,
}: HeartbeatAssembleInput): HeartbeatAssembleOutput {
  const systemPrompt = buildSystemPrompt(
    systemHeartbeatTemplate,
    skills,
    userAgents,
  );
  const userPrompt = buildHeartbeatUserPrompt(task, comments);
  return { systemPrompt, userPrompt };
}

export function assembleChannelSystemPrompt({
  skills,
  userAgents,
}: {
  skills?: readonly SkillCatalogEntry[];
  userAgents?: string | null;
} = {}): string {
  const base = buildSystemPrompt(systemChannelTemplate, skills, userAgents);
  return `${base}\n\n${buildChannelReplyFormatSection()}`;
}

export function assembleSummarizeSystemPrompt(): string {
  return buildSystemPrompt(systemSummarizeTemplate);
}

function buildSkillCatalogSection(
  skills: readonly SkillCatalogEntry[],
): string {
  const header =
    "## Skills\n\nThese are your primary playbooks. For each task, check whether a skill matches — if so, call `skill(name)` to load its full instructions and follow them. Treat each skill as the authoritative procedure for its scope.";

  if (skills.length === 0) {
    return `${header}\n\n(none)`;
  }

  const entries = skills
    .map((s) => `- **${s.name}** — ${s.description}`)
    .join("\n");

  return `${header}\n\n${entries}`;
}

function buildToolsSection(): string {
  return [
    "## Tools",
    "",
    "The following tools load skill content on demand:",
    "",
    "- `skill(name)`: Load a skill's full instructions. Returns the SKILL.md content with relative resource paths rewritten to absolute.",
    "- `read(path)`: Read a resource file referenced from a skill's content. Pass an absolute path obtained from a `skill(name)` return value. Paths outside the skills roots are refused.",
    "",
    "Additional tools (function-call definitions provided separately) are available for executing skill steps. When no skill matches the task, you may use those tools directly.",
  ].join("\n");
}

function buildSystemPrompt(
  variantTemplate: string,
  skills?: readonly SkillCatalogEntry[],
  userAgents?: string | null,
): string {
  const base = systemBaseTemplate.trimEnd();
  const variant = variantTemplate.trimEnd();

  let prompt = `${base}\n\n${variant}`;

  if (skills !== undefined) {
    prompt = `${prompt}\n\n${buildSkillCatalogSection(skills)}`;
    prompt = `${prompt}\n\n${buildToolsSection()}`;
  }

  const extra = userAgents?.trim();
  return extra ? `${prompt}\n\n${extra}` : prompt;
}

function buildChannelReplyFormatSection(): string {
  return [
    "Reply Format",
    "",
    "Reply in plain running text only — no formatting syntax at all. The channel platform renders such syntax as literal characters, not as formatting.",
    "",
    "Do not use asterisks for emphasis, backticks for code, hash symbols for headings, leading hyphens or asterisks for lists, greater-than signs for quotes, or bracket and parenthesis link syntax. Write URLs as bare text.",
    "",
    "Convey emphasis and structure through wording, line breaks, and ordinary punctuation only.",
    "",
    "Skills content you read via skill(name) is an execution reference, not an output template — do not copy its Markdown structure into your reply.",
  ].join("\n");
}

function buildHeartbeatUserPrompt(task: Task, comments: Comment[]): string {
  const descriptionSection =
    task.description !== undefined ? `\nDescription: ${task.description}` : "";

  const commentSection =
    comments.length > 0
      ? `\n## Comment History\n\n${comments.map((c) => `[${c.author === "bot" ? "Bot" : "User"}] ${c.text}`).join("\n\n")}`
      : "";

  return userHeartbeatTemplate
    .trimEnd()
    .replace("{{id}}", task.id)
    .replace("{{title}}", task.title)
    .replace("{{description}}", descriptionSection)
    .replace("{{section}}", task.section)
    .replace("{{comments}}", commentSection);
}
