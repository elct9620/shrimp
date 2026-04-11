import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGetTasksTool } from '../../../../src/adapters/tools/built-in/get-tasks'
import type { BoardRepository } from '../../../../src/use-cases/ports/board-repository'
import { Section } from '../../../../src/entities/section'
import { Priority } from '../../../../src/entities/priority'
import { makeFakeRepo, makeFakeLogger } from './helpers'

type ParseableSchema = { safeParse: (data: unknown) => { success: boolean } }

const sampleTasks = [
  { id: '1', title: 'Task A', priority: Priority.p1, section: Section.Backlog },
]

describe('createGetTasksTool', () => {
  let repo: BoardRepository

  beforeEach(() => {
    repo = makeFakeRepo()
  })

  it('should have a description string', () => {
    const t = createGetTasksTool(repo, makeFakeLogger())
    expect(typeof t.description).toBe('string')
    expect(t.description!.length).toBeGreaterThan(0)
  })

  it('should accept valid Backlog section input', () => {
    const schema = createGetTasksTool(repo, makeFakeLogger()).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ section: 'Backlog' }).success).toBe(true)
  })

  it('should accept InProgress section', () => {
    const schema = createGetTasksTool(repo, makeFakeLogger()).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ section: 'InProgress' }).success).toBe(true)
  })

  it('should accept Done section', () => {
    const schema = createGetTasksTool(repo, makeFakeLogger()).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ section: 'Done' }).success).toBe(true)
  })

  it('should reject missing section field', () => {
    const schema = createGetTasksTool(repo, makeFakeLogger()).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('should reject invalid enum value', () => {
    const schema = createGetTasksTool(repo, makeFakeLogger()).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ section: 'NotASection' }).success).toBe(false)
  })

  it('should call repo.getTasks with Section.Backlog when section is Backlog', async () => {
    vi.mocked(repo.getTasks).mockResolvedValue(sampleTasks)
    const t = createGetTasksTool(repo, makeFakeLogger())
    await t.execute!({ section: 'Backlog' }, { toolCallId: 'test', messages: [] })
    expect(repo.getTasks).toHaveBeenCalledWith(Section.Backlog)
  })

  it('should call repo.getTasks with Section.InProgress when section is InProgress', async () => {
    vi.mocked(repo.getTasks).mockResolvedValue([])
    const t = createGetTasksTool(repo, makeFakeLogger())
    await t.execute!({ section: 'InProgress' }, { toolCallId: 'test', messages: [] })
    expect(repo.getTasks).toHaveBeenCalledWith(Section.InProgress)
  })

  it('should call repo.getTasks with Section.Done when section is Done', async () => {
    vi.mocked(repo.getTasks).mockResolvedValue([])
    const t = createGetTasksTool(repo, makeFakeLogger())
    await t.execute!({ section: 'Done' }, { toolCallId: 'test', messages: [] })
    expect(repo.getTasks).toHaveBeenCalledWith(Section.Done)
  })

  it('should return array of tasks', async () => {
    vi.mocked(repo.getTasks).mockResolvedValue(sampleTasks)
    const t = createGetTasksTool(repo, makeFakeLogger())
    const result = await t.execute!({ section: 'Backlog' }, { toolCallId: 'test', messages: [] })
    expect(result).toEqual(sampleTasks)
  })

  it('should propagate errors from repo', async () => {
    vi.mocked(repo.getTasks).mockRejectedValue(new Error('API failure'))
    const t = createGetTasksTool(repo, makeFakeLogger())
    await expect(
      t.execute!({ section: 'Backlog' }, { toolCallId: 'test', messages: [] })
    ).rejects.toThrow('API failure')
  })

  describe('logging', () => {
    it('should log debug on invocation with the input section', async () => {
      vi.mocked(repo.getTasks).mockResolvedValue([])
      const logger = makeFakeLogger()
      const t = createGetTasksTool(repo, logger)

      await t.execute!({ section: 'Backlog' }, { toolCallId: 'test', messages: [] })

      expect(logger.debug).toHaveBeenCalledWith(
        'tool invoked',
        expect.objectContaining({ input: { section: 'Backlog' } }),
      )
    })

    it('should log warn with the error message and rethrow when repo throws', async () => {
      vi.mocked(repo.getTasks).mockRejectedValue(new Error('upstream down'))
      const logger = makeFakeLogger()
      const t = createGetTasksTool(repo, logger)

      await expect(
        t.execute!({ section: 'Backlog' }, { toolCallId: 'test', messages: [] })
      ).rejects.toThrow('upstream down')

      expect(logger.warn).toHaveBeenCalledWith(
        'tool failed',
        expect.objectContaining({ error: 'upstream down' }),
      )
    })
  })
})
