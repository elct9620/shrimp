import { tool } from 'ai'
import { z } from 'zod'
import type { BoardRepository } from '../../../use-cases/ports/board-repository'

export const GET_COMMENTS_TOOL_NAME = 'getComments'

export function createGetCommentsTool(repo: BoardRepository) {
  return tool({
    description: 'List comments on a Todoist task by its ID.',
    inputSchema: z.object({
      taskId: z.string(),
    }),
    execute: async ({ taskId }) => {
      return repo.getComments(taskId)
    },
  })
}
