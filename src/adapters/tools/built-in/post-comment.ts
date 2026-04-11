import { tool } from 'ai'
import { z } from 'zod'
import type { BoardRepository } from '../../../use-cases/ports/board-repository'

export const POST_COMMENT_TOOL_NAME = 'postComment'

export function createPostCommentTool(repo: BoardRepository) {
  return tool({
    description: 'Post a comment on a Todoist task to report progress or summarize results.',
    inputSchema: z.object({
      taskId: z.string(),
      text: z.string(),
    }),
    execute: async ({ taskId, text }) => {
      await repo.postComment(taskId, text)
      return { ok: true } as const
    },
  })
}
