import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ProcessingCycle } from '../../src/use-cases/processing-cycle'
import { BoardSectionMissingError } from '../../src/use-cases/ports/board-repository'
import type { BoardRepository } from '../../src/use-cases/ports/board-repository'
import type { MainAgent, MainAgentInput, MainAgentResult } from '../../src/use-cases/ports/main-agent'
import type { ToolProvider } from '../../src/use-cases/ports/tool-provider'
import type { ToolProviderFactory } from '../../src/use-cases/ports/tool-provider-factory'
import type { ToolDescription } from '../../src/use-cases/ports/tool-description'
import type { LoggerPort } from '../../src/use-cases/ports/logger'
import { Section } from '../../src/entities/section'
import { Priority } from '../../src/entities/priority'
import type { Task } from '../../src/entities/task'
import type { Comment } from '../../src/entities/comment'

// --- Fakes ---

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test task',
  priority: Priority.p2,
  section: Section.InProgress,
  ...overrides,
})

const makeComment = (text: string): Comment => ({
  text,
  timestamp: new Date('2024-01-01T00:00:00Z'),
  author: 'user',
})

function makeBoardRepository(overrides: Partial<BoardRepository> = {}): BoardRepository {
  return {
    getTasks: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue(undefined),
    moveTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeMainAgent(result: MainAgentResult = { reason: 'finished' }): MainAgent & { capturedInput?: MainAgentInput } {
  const agent: MainAgent & { capturedInput?: MainAgentInput } = {
    run: vi.fn().mockImplementation(async (input: MainAgentInput) => {
      agent.capturedInput = input
      return result
    }),
  }
  return agent
}

const toolDescriptions: ToolDescription[] = [
  { name: 'get_tasks', description: 'Get tasks from board' },
]

const toolSet = { get_tasks: {} }

function makeToolProvider(): ToolProvider {
  return {
    getTools: vi.fn().mockReturnValue(toolSet),
    getToolDescriptions: vi.fn().mockReturnValue(toolDescriptions),
  }
}

function makeToolProviderFactory(provider?: ToolProvider): ToolProviderFactory {
  const inner = provider ?? makeToolProvider()
  return { create: vi.fn(() => inner) }
}

function makeFakeLogger(): LoggerPort {
  const logger: LoggerPort = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  }
  return logger
}

// --- Tests ---

describe('ProcessingCycle.run', () => {
  let board: ReturnType<typeof makeBoardRepository>
  let mainAgent: ReturnType<typeof makeMainAgent>
  let toolProvider: ToolProvider
  let toolProviderFactory: ToolProviderFactory
  let logger: LoggerPort
  let cycle: ProcessingCycle

  beforeEach(() => {
    board = makeBoardRepository()
    mainAgent = makeMainAgent()
    toolProvider = makeToolProvider()
    toolProviderFactory = makeToolProviderFactory(toolProvider)
    logger = makeFakeLogger()
    cycle = new ProcessingCycle({ board, mainAgent, toolProviderFactory, maxSteps: 10, logger })
  })

  describe('when no tasks exist in either section', () => {
    it('should end immediately without calling main agent', async () => {
      board.getTasks = vi.fn().mockResolvedValue([])

      await cycle.run()

      expect(mainAgent.run).not.toHaveBeenCalled()
    })

    it('should end immediately without moving any task', async () => {
      board.getTasks = vi.fn().mockResolvedValue([])

      await cycle.run()

      expect(board.moveTask).not.toHaveBeenCalled()
    })
  })

  describe('when an In Progress task is selected', () => {
    const inProgressTask = makeTask({ id: 'ip-1', section: Section.InProgress })

    beforeEach(() => {
      board.getTasks = vi.fn().mockImplementation(async (section: Section) => {
        if (section === Section.InProgress) return [inProgressTask]
        return []
      })
    })

    it('should call main agent exactly once', async () => {
      await cycle.run()

      expect(mainAgent.run).toHaveBeenCalledTimes(1)
    })

    it('should not move the In Progress task before execution', async () => {
      await cycle.run()

      expect(board.moveTask).not.toHaveBeenCalled()
    })

    it('should retrieve comments for the selected task', async () => {
      await cycle.run()

      expect(board.getComments).toHaveBeenCalledWith('ip-1')
    })

    it('should pass tool set to main agent', async () => {
      await cycle.run()

      expect(mainAgent.capturedInput?.tools).toBe(toolSet)
    })

    it('should pass maxSteps to main agent', async () => {
      await cycle.run()

      expect(mainAgent.capturedInput?.maxSteps).toBe(10)
    })

    it('should pass non-empty systemPrompt to main agent', async () => {
      await cycle.run()

      expect(mainAgent.capturedInput?.systemPrompt).toBeTruthy()
    })

    it('should include task id in user prompt', async () => {
      await cycle.run()

      expect(mainAgent.capturedInput?.userPrompt).toContain('ip-1')
    })

    it('should include comment text in user prompt', async () => {
      board.getComments = vi.fn().mockResolvedValue([makeComment('prior progress note')])

      await cycle.run()

      expect(mainAgent.capturedInput?.userPrompt).toContain('prior progress note')
    })
  })

  describe('when a Backlog task is selected (no In Progress tasks)', () => {
    const backlogTask = makeTask({ id: 'bl-1', section: Section.Backlog })

    beforeEach(() => {
      board.getTasks = vi.fn().mockImplementation(async (section: Section) => {
        if (section === Section.Backlog) return [backlogTask]
        return []
      })
    })

    it('should move the Backlog task to In Progress before calling main agent', async () => {
      const callOrder: string[] = []
      board.moveTask = vi.fn().mockImplementation(async () => { callOrder.push('move') })
      mainAgent.run = vi.fn().mockImplementation(async () => { callOrder.push('agent'); return { reason: 'finished' } })

      await cycle.run()

      expect(callOrder).toEqual(['move', 'agent'])
    })

    it('should move the task to In Progress section', async () => {
      await cycle.run()

      expect(board.moveTask).toHaveBeenCalledWith('bl-1', Section.InProgress)
    })

    it('should call main agent exactly once', async () => {
      await cycle.run()

      expect(mainAgent.run).toHaveBeenCalledTimes(1)
    })
  })

  describe('when BoardSectionMissingError is thrown', () => {
    it('should end the cycle cleanly without calling main agent', async () => {
      board.getTasks = vi.fn().mockRejectedValue(new BoardSectionMissingError('In Progress'))

      await cycle.run()

      expect(mainAgent.run).not.toHaveBeenCalled()
    })

    it('should not throw', async () => {
      board.getTasks = vi.fn().mockRejectedValue(new BoardSectionMissingError('Backlog'))

      await expect(cycle.run()).resolves.toBeUndefined()
    })

    it('should not move any task', async () => {
      board.getTasks = vi.fn().mockRejectedValue(new BoardSectionMissingError('Done'))

      await cycle.run()

      expect(board.moveTask).not.toHaveBeenCalled()
    })
  })

  describe('when an unexpected error is thrown', () => {
    it('should propagate the error', async () => {
      const unexpectedError = new Error('network failure')
      board.getTasks = vi.fn().mockRejectedValue(unexpectedError)

      await expect(cycle.run()).rejects.toThrow('network failure')
    })

    it('should not call main agent', async () => {
      board.getTasks = vi.fn().mockRejectedValue(new Error('unexpected'))

      await expect(cycle.run()).rejects.toThrow()
      expect(mainAgent.run).not.toHaveBeenCalled()
    })
  })

  describe('PromptAssembler receives correct inputs', () => {
    it('should pass tool descriptions from ToolProvider to prompt assembler (visible in system prompt)', async () => {
      const task = makeTask({ id: 'task-x', section: Section.InProgress })
      board.getTasks = vi.fn().mockImplementation(async (section: Section) => {
        if (section === Section.InProgress) return [task]
        return []
      })
      toolProvider.getToolDescriptions = vi.fn().mockReturnValue([
        { name: 'special_tool', description: 'Does special things' },
      ])

      await cycle.run()

      expect(mainAgent.capturedInput?.systemPrompt).toContain('special_tool')
    })
  })

  describe('logging', () => {
    it('should log info "cycle started" at the top of every run', async () => {
      await cycle.run()

      expect(logger.info).toHaveBeenCalledWith('cycle started')
    })

    it('should log info "cycle idle" with task counts when no task is selectable', async () => {
      board.getTasks = vi.fn().mockResolvedValue([])

      await cycle.run()

      expect(logger.info).toHaveBeenCalledWith(
        'cycle idle',
        expect.objectContaining({
          reason: 'no tasks available',
          inProgressCount: 0,
          backlogCount: 0,
        }),
      )
    })

    it('should log warn "cycle skipped" with missingSection when BoardSectionMissingError is thrown', async () => {
      board.getTasks = vi.fn().mockRejectedValue(new BoardSectionMissingError('In Progress'))

      await cycle.run()

      expect(logger.warn).toHaveBeenCalledWith(
        'cycle skipped — board section missing',
        expect.objectContaining({ missingSection: expect.stringContaining('In Progress') }),
      )
    })

    it('should log info "cycle task selected" with taskId, section and priority', async () => {
      const task = makeTask({ id: 'task-x', section: Section.InProgress, priority: Priority.p2 })
      board.getTasks = vi.fn().mockImplementation(async (section: Section) => {
        if (section === Section.InProgress) return [task]
        return []
      })

      await cycle.run()

      expect(logger.info).toHaveBeenCalledWith(
        'cycle task selected',
        expect.objectContaining({
          taskId: 'task-x',
          section: Section.InProgress,
          priority: Priority.p2,
        }),
      )
    })

    it('should log debug "cycle task promoted" when a backlog task is moved to In Progress', async () => {
      const task = makeTask({ id: 'bl-1', section: Section.Backlog })
      board.getTasks = vi.fn().mockImplementation(async (section: Section) => {
        if (section === Section.Backlog) return [task]
        return []
      })

      await cycle.run()

      expect(logger.debug).toHaveBeenCalledWith(
        'cycle task promoted',
        expect.objectContaining({ taskId: 'bl-1' }),
      )
    })

    it('should log info "cycle finished" with taskId and reason after main agent completes', async () => {
      const task = makeTask({ id: 'task-x', section: Section.InProgress })
      board.getTasks = vi.fn().mockImplementation(async (section: Section) => {
        if (section === Section.InProgress) return [task]
        return []
      })
      mainAgent.run = vi.fn().mockResolvedValue({ reason: 'maxStepsReached' })

      await cycle.run()

      expect(logger.info).toHaveBeenCalledWith(
        'cycle finished',
        expect.objectContaining({ taskId: 'task-x', reason: 'maxStepsReached' }),
      )
    })

    it('should not log "cycle finished" when an unexpected error propagates', async () => {
      board.getTasks = vi.fn().mockRejectedValue(new Error('unexpected'))

      await expect(cycle.run()).rejects.toThrow()

      const finishedCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0] === 'cycle finished',
      )
      expect(finishedCalls).toHaveLength(0)
    })
  })
})
