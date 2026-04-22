import { tool } from "ai";
import { z } from "zod";
import type { SkillCatalog } from "../../../use-cases/ports/skill-catalog";
import type { LoggerPort } from "../../../use-cases/ports/logger";

export const SKILL_TOOL_NAME = "skill";

export function createSkillTool(
  skillCatalog: SkillCatalog,
  logger: LoggerPort,
) {
  return tool({
    description:
      "Load the full SKILL.md content for a skill by name. Returns the skill body with relative resource paths rewritten to absolute paths. Use the skill name from the Skill Catalog in the system prompt.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("The skill name as listed in the Skill Catalog."),
    }),
    execute: async ({ name }) => {
      logger.debug("tool invoked", { input: { name } });
      try {
        const content = await skillCatalog.getSkillContent(name);
        return { ok: true as const, content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("tool failed", { error: message });
        return { ok: false as const, error: message };
      }
    },
  });
}
