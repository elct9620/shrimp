import { tool } from 'ai'
import { z } from 'zod'
import type { BoardRepository } from '../../../use-cases/ports/board-repository'
import { sectionMap } from './section-map'

export const GET_TASKS_TOOL_NAME = 'getTasks'

export function createGetTasksTool(repo: BoardRepository) {
  return tool({
    description: 'List tasks in the specified board section (Backlog, In Progress, or Done).',
    inputSchema: z.object({
      section: z.enum(['Backlog', 'InProgress', 'Done']),
    }),
    execute: async ({ section }) => {
      return repo.getTasks(sectionMap[section])
    },
  })
}
