import { selectTask } from '../entities/task-selector'
import { Section } from '../entities/section'
import { assemble } from './prompt-assembler'
import { BoardSectionMissingError } from './ports/board-repository'
import type { BoardRepository } from './ports/board-repository'
import type { MainAgent } from './ports/main-agent'
import type { ToolProvider } from './ports/tool-provider'

export type ProcessingCycleConfig = {
  board: BoardRepository
  mainAgent: MainAgent
  toolProvider: ToolProvider
  maxSteps: number
}

export class ProcessingCycle {
  private readonly board: BoardRepository
  private readonly mainAgent: MainAgent
  private readonly toolProvider: ToolProvider
  private readonly maxSteps: number

  constructor({ board, mainAgent, toolProvider, maxSteps }: ProcessingCycleConfig) {
    this.board = board
    this.mainAgent = mainAgent
    this.toolProvider = toolProvider
    this.maxSteps = maxSteps
  }

  async run(): Promise<void> {
    let inProgressTasks, backlogTasks

    try {
      inProgressTasks = await this.board.getTasks(Section.InProgress)
      backlogTasks = await this.board.getTasks(Section.Backlog)
    } catch (error) {
      if (error instanceof BoardSectionMissingError) return
      throw error
    }

    const task = selectTask(inProgressTasks, backlogTasks)
    if (task === null) return

    if (task.section === Section.Backlog) {
      await this.board.moveTask(task.id, Section.InProgress)
    }

    const comments = await this.board.getComments(task.id)
    const tools = this.toolProvider.getToolDescriptions()

    const { systemPrompt, userPrompt } = assemble({ task, comments, tools })

    await this.mainAgent.run({
      systemPrompt,
      userPrompt,
      tools: this.toolProvider.getTools(),
      maxSteps: this.maxSteps,
    })
  }
}
