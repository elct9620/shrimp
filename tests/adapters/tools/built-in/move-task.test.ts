import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMoveTaskTool } from '../../../../src/adapters/tools/built-in/move-task'
import type { BoardRepository } from '../../../../src/use-cases/ports/board-repository'
import { Section } from '../../../../src/entities/section'

type ParseableSchema = { safeParse: (data: unknown) => { success: boolean } }

function makeFakeRepo(): BoardRepository {
  return {
    getTasks: vi.fn(),
    getComments: vi.fn(),
    postComment: vi.fn(),
    moveTask: vi.fn(),
  }
}

describe('createMoveTaskTool', () => {
  let repo: BoardRepository

  beforeEach(() => {
    repo = makeFakeRepo()
  })

  it('should have a description string', () => {
    const t = createMoveTaskTool(repo)
    expect(typeof t.description).toBe('string')
    expect(t.description!.length).toBeGreaterThan(0)
  })

  it('should accept valid taskId and Backlog section', () => {
    const schema = createMoveTaskTool(repo).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ taskId: 'task-123', section: 'Backlog' }).success).toBe(true)
  })

  it('should accept InProgress section', () => {
    const schema = createMoveTaskTool(repo).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ taskId: 'task-123', section: 'InProgress' }).success).toBe(true)
  })

  it('should accept Done section', () => {
    const schema = createMoveTaskTool(repo).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ taskId: 'task-123', section: 'Done' }).success).toBe(true)
  })

  it('should reject missing taskId', () => {
    const schema = createMoveTaskTool(repo).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ section: 'Backlog' }).success).toBe(false)
  })

  it('should reject missing section', () => {
    const schema = createMoveTaskTool(repo).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ taskId: 'task-123' }).success).toBe(false)
  })

  it('should reject raw Todoist section name "In Progress"', () => {
    const schema = createMoveTaskTool(repo).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ taskId: 'task-123', section: 'In Progress' }).success).toBe(false)
  })

  it('should call repo.moveTask with taskId and Section.Backlog when section is Backlog', async () => {
    vi.mocked(repo.moveTask).mockResolvedValue(undefined)
    const t = createMoveTaskTool(repo)
    await t.execute!({ taskId: 'task-123', section: 'Backlog' }, { toolCallId: 'test', messages: [] })
    expect(repo.moveTask).toHaveBeenCalledWith('task-123', Section.Backlog)
  })

  it('should call repo.moveTask with Section.InProgress when section is InProgress', async () => {
    vi.mocked(repo.moveTask).mockResolvedValue(undefined)
    const t = createMoveTaskTool(repo)
    await t.execute!({ taskId: 'task-123', section: 'InProgress' }, { toolCallId: 'test', messages: [] })
    expect(repo.moveTask).toHaveBeenCalledWith('task-123', Section.InProgress)
  })

  it('should call repo.moveTask with Section.Done when section is Done', async () => {
    vi.mocked(repo.moveTask).mockResolvedValue(undefined)
    const t = createMoveTaskTool(repo)
    await t.execute!({ taskId: 'task-123', section: 'Done' }, { toolCallId: 'test', messages: [] })
    expect(repo.moveTask).toHaveBeenCalledWith('task-123', Section.Done)
  })

  it('should return { ok: true }', async () => {
    vi.mocked(repo.moveTask).mockResolvedValue(undefined)
    const t = createMoveTaskTool(repo)
    const result = await t.execute!({ taskId: 'task-123', section: 'Done' }, { toolCallId: 'test', messages: [] })
    expect(result).toEqual({ ok: true })
  })

  it('should propagate errors from repo', async () => {
    vi.mocked(repo.moveTask).mockRejectedValue(new Error('Move failed'))
    const t = createMoveTaskTool(repo)
    await expect(
      t.execute!({ taskId: 'task-123', section: 'Done' }, { toolCallId: 'test', messages: [] })
    ).rejects.toThrow('Move failed')
  })
})
