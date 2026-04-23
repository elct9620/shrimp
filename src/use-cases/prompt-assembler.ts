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
  return buildSystemPrompt(systemChannelTemplate, skills, userAgents);
}

export function assembleSummarizeSystemPrompt(): string {
  return buildSystemPrompt(systemSummarizeTemplate);
}

function buildSkillCatalogSection(
  skills: readonly SkillCatalogEntry[],
): string {
  const header =
    "## Skills\n\nThe following skills are available. Use the `skill(name)` tool to load full instructions.";

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
    "Skills are loaded progressively — the Skills section above tells you which skills exist; the tools below let you fetch their content on demand.",
    "",
    "- `skill(name)`: Load a skill's full instructions. Returns the SKILL.md content with relative paths rewritten to absolute.",
    "- `read(path)`: Read a resource file referenced from a skill's content. Pass an absolute path obtained from a `skill(name)` return value. Paths outside the skills roots are refused.",
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
