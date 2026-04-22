import { Task } from "../entities/task";
import { Comment } from "../entities/comment";
import type { ToolDescription } from "./ports/tool-description";
import type { SkillCatalogEntry } from "./ports/skill-catalog";
import systemBaseTemplate from "./prompts/system-base.md?raw";
import systemHeartbeatTemplate from "./prompts/system-heartbeat.md?raw";
import systemChannelTemplate from "./prompts/system-channel.md?raw";
import systemSummarizeTemplate from "./prompts/system-summarize.md?raw";
import userHeartbeatTemplate from "./prompts/user-heartbeat.md?raw";

export type { ToolDescription };

export type HeartbeatAssembleInput = {
  task: Task;
  comments: Comment[];
  tools: ToolDescription[];
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
  tools,
  skills,
  userAgents,
}: HeartbeatAssembleInput): HeartbeatAssembleOutput {
  const systemPrompt = buildSystemPrompt(
    systemHeartbeatTemplate,
    tools,
    skills,
    userAgents,
  );
  const userPrompt = buildHeartbeatUserPrompt(task, comments);
  return { systemPrompt, userPrompt };
}

export function assembleChannelSystemPrompt({
  tools,
  skills,
  userAgents,
}: {
  tools: ToolDescription[];
  skills?: readonly SkillCatalogEntry[];
  userAgents?: string | null;
}): string {
  return buildSystemPrompt(systemChannelTemplate, tools, skills, userAgents);
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
    .map(
      (s) => `- **${s.name}** — ${s.description}\n  Path: ${s.skillFilePath}`,
    )
    .join("\n");

  return `${header}\n\n${entries}`;
}

function buildSystemPrompt(
  variantTemplate: string,
  tools?: ToolDescription[],
  skills?: readonly SkillCatalogEntry[],
  userAgents?: string | null,
): string {
  const base = systemBaseTemplate.trimEnd();
  const variant = variantTemplate.trimEnd();

  let prompt = `${base}\n\n${variant}`;

  if (skills !== undefined) {
    prompt = `${prompt}\n\n${buildSkillCatalogSection(skills)}`;
  }

  if (tools !== undefined) {
    const toolList =
      tools.length > 0
        ? tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
        : "(none)";
    prompt = `${prompt}\n\n## Tools\n\n${toolList}`;
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
