import { tool } from "ai";
import { z } from "zod";
import type { BoardRepository } from "../../../use-cases/ports/board-repository";
import type { LoggerPort } from "../../../use-cases/ports/logger";

export const GET_COMMENTS_TOOL_NAME = "getComments";

export function createGetCommentsTool(
  repo: BoardRepository,
  logger: LoggerPort,
) {
  return tool({
    description: "List comments on a Todoist task by its ID.",
    inputSchema: z.object({
      taskId: z.string(),
    }),
    execute: async ({ taskId }) => {
      logger.debug("tool invoked", { input: { taskId } });
      try {
        return await repo.getComments(taskId);
      } catch (err) {
        logger.warn("tool failed", { err });
        throw err;
      }
    },
  });
}
