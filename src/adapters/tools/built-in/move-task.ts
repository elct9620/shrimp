import { tool } from 'ai'
import { z } from 'zod'
import type { BoardRepository } from '../../../use-cases/ports/board-repository'
import type { LoggerPort } from '../../../use-cases/ports/logger'
import { sectionMap } from './section-map'

export const MOVE_TASK_TOOL_NAME = 'moveTask'

export function createMoveTaskTool(repo: BoardRepository, logger: LoggerPort) {
  return tool({
    description: 'Move a Todoist task to a different board section (Backlog, In Progress, or Done).',
    inputSchema: z.object({
      taskId: z.string(),
      section: z.enum(['Backlog', 'InProgress', 'Done']),
    }),
    execute: async ({ taskId, section }) => {
      logger.debug('tool invoked', { input: { taskId, section } })
      try {
        await repo.moveTask(taskId, sectionMap[section])
        return { ok: true } as const
      } catch (err) {
        logger.warn('tool failed', {
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },
  })
}
