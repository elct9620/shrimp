import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGetCommentsTool } from '../../../../src/adapters/tools/built-in/get-comments'
import type { BoardRepository } from '../../../../src/use-cases/ports/board-repository'
import { makeFakeRepo, makeFakeLogger } from './helpers'

type ParseableSchema = { safeParse: (data: unknown) => { success: boolean } }

const sampleComments = [
  { text: 'Did some work', timestamp: new Date('2025-01-01'), author: 'user' as const },
]

describe('createGetCommentsTool', () => {
  let repo: BoardRepository

  beforeEach(() => {
    repo = makeFakeRepo()
  })

  it('should have a description string', () => {
    const t = createGetCommentsTool(repo, makeFakeLogger())
    expect(typeof t.description).toBe('string')
    expect(t.description!.length).toBeGreaterThan(0)
  })

  it('should accept valid taskId input', () => {
    const schema = createGetCommentsTool(repo, makeFakeLogger()).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ taskId: 'task-123' }).success).toBe(true)
  })

  it('should reject missing taskId', () => {
    const schema = createGetCommentsTool(repo, makeFakeLogger()).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('should reject non-string taskId', () => {
    const schema = createGetCommentsTool(repo, makeFakeLogger()).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ taskId: 42 }).success).toBe(false)
  })

  it('should call repo.getComments with taskId', async () => {
    vi.mocked(repo.getComments).mockResolvedValue(sampleComments)
    const t = createGetCommentsTool(repo, makeFakeLogger())
    await t.execute!({ taskId: 'task-123' }, { toolCallId: 'test', messages: [] })
    expect(repo.getComments).toHaveBeenCalledWith('task-123')
  })

  it('should return array of comments', async () => {
    vi.mocked(repo.getComments).mockResolvedValue(sampleComments)
    const t = createGetCommentsTool(repo, makeFakeLogger())
    const result = await t.execute!({ taskId: 'task-123' }, { toolCallId: 'test', messages: [] })
    expect(result).toEqual(sampleComments)
  })

  it('should propagate errors from repo', async () => {
    vi.mocked(repo.getComments).mockRejectedValue(new Error('Network error'))
    const t = createGetCommentsTool(repo, makeFakeLogger())
    await expect(
      t.execute!({ taskId: 'task-123' }, { toolCallId: 'test', messages: [] })
    ).rejects.toThrow('Network error')
  })

  describe('logging', () => {
    it('should log debug on invocation with the input taskId', async () => {
      vi.mocked(repo.getComments).mockResolvedValue([])
      const logger = makeFakeLogger()
      const t = createGetCommentsTool(repo, logger)

      await t.execute!({ taskId: 'task-42' }, { toolCallId: 'test', messages: [] })

      expect(logger.debug).toHaveBeenCalledWith(
        'tool invoked',
        expect.objectContaining({ input: { taskId: 'task-42' } }),
      )
    })

    it('should log warn when repo throws and rethrow', async () => {
      vi.mocked(repo.getComments).mockRejectedValue(new Error('boom'))
      const logger = makeFakeLogger()
      const t = createGetCommentsTool(repo, logger)

      await expect(
        t.execute!({ taskId: 'task-42' }, { toolCallId: 'test', messages: [] })
      ).rejects.toThrow('boom')

      expect(logger.warn).toHaveBeenCalledWith(
        'tool failed',
        expect.objectContaining({ error: 'boom' }),
      )
    })
  })
})
