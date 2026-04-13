import { tool } from "ai";
import { z } from "zod";
import { COMMENT_TAG } from "../../../entities/comment";
import type { BoardRepository } from "../../../use-cases/ports/board-repository";
import type { LoggerPort } from "../../../use-cases/ports/logger";

export const POST_COMMENT_TOOL_NAME = "postComment";

export function createPostCommentTool(
  repo: BoardRepository,
  logger: LoggerPort,
) {
  return tool({
    description:
      "Post a comment on a Todoist task to report progress or summarize results.",
    inputSchema: z.object({
      taskId: z.string(),
      text: z.string(),
    }),
    execute: async ({ taskId, text }) => {
      logger.debug("tool invoked", {
        input: { taskId, textLength: text.length },
      });
      try {
        await repo.postComment(taskId, `${COMMENT_TAG}${text}`);
        return { ok: true } as const;
      } catch (err) {
        logger.warn("tool failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  });
}
