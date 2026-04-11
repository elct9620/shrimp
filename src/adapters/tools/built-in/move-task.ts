import { tool } from 'ai'
import { z } from 'zod'
import type { BoardRepository } from '../../../use-cases/ports/board-repository'
import { Section } from '../../../entities/section'

export const MOVE_TASK_TOOL_NAME = 'moveTask'

const sectionMap = {
  Backlog: Section.Backlog,
  InProgress: Section.InProgress,
  Done: Section.Done,
} as const

export function createMoveTaskTool(repo: BoardRepository) {
  return tool({
    description: 'Move a Todoist task to a different board section (Backlog, In Progress, or Done).',
    inputSchema: z.object({
      taskId: z.string(),
      section: z.enum(['Backlog', 'InProgress', 'Done']),
    }),
    execute: async ({ taskId, section }) => {
      await repo.moveTask(taskId, sectionMap[section])
      return { ok: true } as const
    },
  })
}
