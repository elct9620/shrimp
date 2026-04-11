import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MainAgent } from '../../src/use-cases/main-agent'
import { BoardSectionMissingError } from '../../src/use-cases/ports/board-repository'
import type { BoardRepository } from '../../src/use-cases/ports/board-repository'
import type { AgentLoop, AgentLoopInput, AgentLoopResult } from '../../src/use-cases/ports/agent-loop'
import type { ToolProvider } from '../../src/use-cases/ports/tool-provider'
import type { ToolDescription } from '../../src/use-cases/ports/tool-description'
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

function makeAgentLoop(result: AgentLoopResult = { reason: 'finished' }): AgentLoop & { capturedInput?: AgentLoopInput } {
  const loop: AgentLoop & { capturedInput?: AgentLoopInput } = {
    run: vi.fn().mockImplementation(async (input: AgentLoopInput) => {
      loop.capturedInput = input
      return result
    }),
  }
  return loop
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

// --- Tests ---

describe('MainAgent.run', () => {
  let board: ReturnType<typeof makeBoardRepository>
  let agentLoop: ReturnType<typeof makeAgentLoop>
  let toolProvider: ReturnType<typeof makeToolProvider>
  let agent: MainAgent

  beforeEach(() => {
    board = makeBoardRepository()
    agentLoop = makeAgentLoop()
    toolProvider = makeToolProvider()
    agent = new MainAgent({ board, agentLoop, toolProvider, maxSteps: 10 })
  })

  describe('when no tasks exist in either section', () => {
    it('should end immediately without calling agent loop', async () => {
      board.getTasks = vi.fn().mockResolvedValue([])

      await agent.run()

      expect(agentLoop.run).not.toHaveBeenCalled()
    })

    it('should end immediately without moving any task', async () => {
      board.getTasks = vi.fn().mockResolvedValue([])

      await agent.run()

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

    it('should call agent loop exactly once', async () => {
      await agent.run()

      expect(agentLoop.run).toHaveBeenCalledTimes(1)
    })

    it('should not move the In Progress task before execution', async () => {
      await agent.run()

      expect(board.moveTask).not.toHaveBeenCalled()
    })

    it('should retrieve comments for the selected task', async () => {
      await agent.run()

      expect(board.getComments).toHaveBeenCalledWith('ip-1')
    })

    it('should pass tool set to agent loop', async () => {
      await agent.run()

      expect(agentLoop.capturedInput?.tools).toBe(toolSet)
    })

    it('should pass maxSteps to agent loop', async () => {
      await agent.run()

      expect(agentLoop.capturedInput?.maxSteps).toBe(10)
    })

    it('should pass non-empty systemPrompt to agent loop', async () => {
      await agent.run()

      expect(agentLoop.capturedInput?.systemPrompt).toBeTruthy()
    })

    it('should include task id in user prompt', async () => {
      await agent.run()

      expect(agentLoop.capturedInput?.userPrompt).toContain('ip-1')
    })

    it('should include comment text in user prompt', async () => {
      board.getComments = vi.fn().mockResolvedValue([makeComment('prior progress note')])

      await agent.run()

      expect(agentLoop.capturedInput?.userPrompt).toContain('prior progress note')
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

    it('should move the Backlog task to In Progress before calling agent loop', async () => {
      const callOrder: string[] = []
      board.moveTask = vi.fn().mockImplementation(async () => { callOrder.push('move') })
      agentLoop.run = vi.fn().mockImplementation(async () => { callOrder.push('agent'); return { reason: 'finished' } })

      await agent.run()

      expect(callOrder).toEqual(['move', 'agent'])
    })

    it('should move the task to In Progress section', async () => {
      await agent.run()

      expect(board.moveTask).toHaveBeenCalledWith('bl-1', Section.InProgress)
    })

    it('should call agent loop exactly once', async () => {
      await agent.run()

      expect(agentLoop.run).toHaveBeenCalledTimes(1)
    })
  })

  describe('when BoardSectionMissingError is thrown', () => {
    it('should end the cycle cleanly without calling agent loop', async () => {
      board.getTasks = vi.fn().mockRejectedValue(new BoardSectionMissingError('In Progress'))

      await agent.run()

      expect(agentLoop.run).not.toHaveBeenCalled()
    })

    it('should not throw', async () => {
      board.getTasks = vi.fn().mockRejectedValue(new BoardSectionMissingError('Backlog'))

      await expect(agent.run()).resolves.toBeUndefined()
    })

    it('should not move any task', async () => {
      board.getTasks = vi.fn().mockRejectedValue(new BoardSectionMissingError('Done'))

      await agent.run()

      expect(board.moveTask).not.toHaveBeenCalled()
    })
  })

  describe('when an unexpected error is thrown', () => {
    it('should propagate the error', async () => {
      const unexpectedError = new Error('network failure')
      board.getTasks = vi.fn().mockRejectedValue(unexpectedError)

      await expect(agent.run()).rejects.toThrow('network failure')
    })

    it('should not call agent loop', async () => {
      board.getTasks = vi.fn().mockRejectedValue(new Error('unexpected'))

      await expect(agent.run()).rejects.toThrow()
      expect(agentLoop.run).not.toHaveBeenCalled()
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

      await agent.run()

      expect(agentLoop.capturedInput?.systemPrompt).toContain('special_tool')
    })
  })
})
