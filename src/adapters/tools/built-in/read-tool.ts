import { tool } from "ai";
import { z } from "zod";
import type { SkillCatalog } from "../../../use-cases/ports/skill-catalog";
import type { LoggerPort } from "../../../use-cases/ports/logger";

export const READ_TOOL_NAME = "read";

export function createReadTool(skillCatalog: SkillCatalog, logger: LoggerPort) {
  return tool({
    description:
      "Read the content of a file under the Built-in or Custom skills root. Pass an absolute path obtained from the Skill Catalog or from a skill(name) return value. Paths outside both skill roots are refused with an error result.",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "Absolute path to the file to read. Use paths obtained from the Skill Catalog or from a skill(name) return value.",
        ),
    }),
    execute: async ({ path }) => {
      logger.debug("tool invoked", { input: { path } });
      try {
        const content = await skillCatalog.readFile(path);
        return { ok: true as const, content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("tool failed", { error: message });
        return { ok: false as const, error: message };
      }
    },
  });
}
