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
  return buildSystemPrompt(
    systemChannelTemplate,
    skills,
    userAgents,
    buildChannelReplyFormatSection(),
  );
}

export function assembleSummarizeSystemPrompt(): string {
  return buildSystemPrompt(systemSummarizeTemplate);
}

function buildSkillCatalogSection(
  skills: readonly SkillCatalogEntry[],
): string {
  const header =
    "## Skills\n\nThese are your primary playbooks. Scan the list first — when any entry matches the user's request, call `skill(name)` before doing anything else. Treat each skill as the authoritative procedure for its scope.";

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
    "Additional tools (function-call definitions provided separately) are reached through skills. When a loaded skill instructs you to call a specific tool, call it.",
  ].join("\n");
}

function buildChannelReplyFormatSection(): string {
  return [
    "## Reply Format",
    "",
    "Reply in plain text. Plain text means running prose: ordinary sentences separated by line breaks and punctuated normally. Show URLs as bare text.",
    "",
    "The channel delivers your reply as-is, with no Markdown or HTML rendering. Markup symbols appear as literal characters and hurt readability.",
    "",
    'Do not use Markdown or any other markup — including hash signs, asterisks, backticks, hyphen-bullets, numbered lists like "1.", "2.", "3.", blockquotes, or bracket-parenthesis link syntax.',
    "",
    "When replying with multiple items, weave them into running sentences rather than listing them.",
    "",
    'For example: "Hakodate has three great spots: the morning market, the cable car up Mt. Hakodate at sunset, and the old brick warehouses in Motomachi. Let me know if you want more detail on any of them."',
    "",
    'Another example: "I checked with the search skill. The Hakodate ropeway closes at 10pm from October through April."',
    "",
    'For a longer reply covering several topics: "Hakodate suits a two-day trip. The morning market and brick warehouses in Motomachi cover the harbour in an afternoon, and the cable car up Mt. Hakodate is the classic finish for the night view. Squid sashimi at the market and Lucky Pierrot burgers are the local staples. Day two pairs Goryokaku Park with a hot spring at Yunokawa."',
    "",
    "When a skill guided your work, put the outcome into your own words for the user.",
  ].join("\n");
}

function buildSystemPrompt(
  variantTemplate: string,
  skills?: readonly SkillCatalogEntry[],
  userAgents?: string | null,
  variantPostTools?: string,
): string {
  const base = systemBaseTemplate.trimEnd();
  const variant = variantTemplate.trimEnd();

  let prompt = `${base}\n\n${variant}`;

  if (skills !== undefined) {
    prompt = `${prompt}\n\n${buildSkillCatalogSection(skills)}`;
    prompt = `${prompt}\n\n${buildToolsSection()}`;
  }

  if (variantPostTools !== undefined) {
    prompt = `${prompt}\n\n${variantPostTools}`;
  }

  const extra = userAgents?.trim();
  return extra ? `${prompt}\n\n${extra}` : prompt;
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
