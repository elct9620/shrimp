import type { BoardRepository } from '../../../use-cases/ports/board-repository'
import { createGetTasksTool } from './get-tasks'
import { createGetCommentsTool } from './get-comments'
import { createPostCommentTool } from './post-comment'
import { createMoveTaskTool } from './move-task'

export function createBuiltInTools(repo: BoardRepository) {
  return {
    getTasks: createGetTasksTool(repo),
    getComments: createGetCommentsTool(repo),
    postComment: createPostCommentTool(repo),
    moveTask: createMoveTaskTool(repo),
  }
}
