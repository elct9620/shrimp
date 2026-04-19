import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Task } from "../entities/task";
import { Comment } from "../entities/comment";
import type { ToolDescription } from "./ports/tool-description";
import systemBaseTemplate from "./prompts/system-base.md?raw";
import systemHeartbeatTemplate from "./prompts/system-heartbeat.md?raw";
import systemChannelTemplate from "./prompts/system-channel.md?raw";
import userHeartbeatTemplate from "./prompts/user-heartbeat.md?raw";

export type { ToolDescription };

export type HeartbeatAssembleInput = {
  task: Task;
  comments: Comment[];
  tools: ToolDescription[];
};

export type HeartbeatAssembleOutput = {
  systemPrompt: string;
  userPrompt: string;
};

export function assembleHeartbeatPrompts({
  task,
  comments,
  tools,
}: HeartbeatAssembleInput): HeartbeatAssembleOutput {
  const systemPrompt = buildSystemPrompt(systemHeartbeatTemplate, tools);
  const userPrompt = buildHeartbeatUserPrompt(task, comments);
  return { systemPrompt, userPrompt };
}

export function assembleChannelSystemPrompt({
  tools,
}: {
  tools: ToolDescription[];
}): string {
  return buildSystemPrompt(systemChannelTemplate, tools);
}

function buildSystemPrompt(
  variantTemplate: string,
  tools: ToolDescription[],
): string {
  const toolList =
    tools.length > 0
      ? tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
      : "(none)";

  const base = systemBaseTemplate.trimEnd();
  const variant = variantTemplate.trimEnd();
  const toolsSection = `## Tools\n\n${toolList}`;

  const prompt = `${base}\n\n${variant}\n\n${toolsSection}`;
  const userAgents = readUserAgentsFile();
  return userAgents ? `${prompt}\n\n${userAgents}` : prompt;
}

function readUserAgentsFile(): string | null {
  try {
    return readFileSync(join(homedir(), ".shrimp", "AGENTS.md"), "utf8").trim();
  } catch {
    return null;
  }
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
