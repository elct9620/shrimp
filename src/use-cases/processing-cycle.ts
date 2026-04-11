import { selectTask } from '../entities/task-selector'
import { Section } from '../entities/section'
import { assemble } from './prompt-assembler'
import { BoardSectionMissingError } from './ports/board-repository'
import type { BoardRepository } from './ports/board-repository'
import type { MainAgent } from './ports/main-agent'
import type { ToolProvider } from './ports/tool-provider'
import type { LoggerPort } from './ports/logger'

export type ProcessingCycleConfig = {
  board: BoardRepository
  mainAgent: MainAgent
  toolProvider: ToolProvider
  maxSteps: number
  logger: LoggerPort
}

export class ProcessingCycle {
  private readonly board: BoardRepository
  private readonly mainAgent: MainAgent
  private readonly toolProvider: ToolProvider
  private readonly maxSteps: number
  private readonly logger: LoggerPort

  constructor({ board, mainAgent, toolProvider, maxSteps, logger }: ProcessingCycleConfig) {
    this.board = board
    this.mainAgent = mainAgent
    this.toolProvider = toolProvider
    this.maxSteps = maxSteps
    this.logger = logger
  }

  async run(): Promise<void> {
    this.logger.info('cycle started')

    let inProgressTasks, backlogTasks

    try {
      inProgressTasks = await this.board.getTasks(Section.InProgress)
      backlogTasks = await this.board.getTasks(Section.Backlog)
    } catch (error) {
      if (error instanceof BoardSectionMissingError) {
        this.logger.warn('cycle skipped — board section missing', {
          missingSection: error.message,
        })
        return
      }
      throw error
    }

    const task = selectTask(inProgressTasks, backlogTasks)
    if (task === null) {
      this.logger.info('cycle idle', {
        reason: 'no tasks available',
        inProgressCount: inProgressTasks.length,
        backlogCount: backlogTasks.length,
      })
      return
    }

    this.logger.info('cycle task selected', {
      taskId: task.id,
      section: task.section,
      priority: task.priority,
    })

    if (task.section === Section.Backlog) {
      await this.board.moveTask(task.id, Section.InProgress)
      this.logger.debug('cycle task promoted', { taskId: task.id })
    }

    const comments = await this.board.getComments(task.id)
    const tools = this.toolProvider.getToolDescriptions()

    const { systemPrompt, userPrompt } = assemble({ task, comments, tools })

    this.logger.debug('cycle invoking main agent', { taskId: task.id })
    const result = await this.mainAgent.run({
      systemPrompt,
      userPrompt,
      tools: this.toolProvider.getTools(),
      maxSteps: this.maxSteps,
    })

    this.logger.info('cycle finished', {
      taskId: task.id,
      reason: result.reason,
    })
  }
}
