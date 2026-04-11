import { tool } from 'ai'
import { z } from 'zod'
import type { BoardRepository } from '../../../use-cases/ports/board-repository'
import type { LoggerPort } from '../../../use-cases/ports/logger'
import { sectionMap } from './section-map'

export const GET_TASKS_TOOL_NAME = 'getTasks'

export function createGetTasksTool(repo: BoardRepository, logger: LoggerPort) {
  return tool({
    description: 'List tasks in the specified board section (Backlog, In Progress, or Done).',
    inputSchema: z.object({
      section: z.enum(['Backlog', 'InProgress', 'Done']),
    }),
    execute: async ({ section }) => {
      logger.debug('tool invoked', { input: { section } })
      try {
        return await repo.getTasks(sectionMap[section])
      } catch (err) {
        logger.warn('tool failed', {
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },
  })
}
