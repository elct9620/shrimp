import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPostCommentTool } from '../../../../src/adapters/tools/built-in/post-comment'
import type { BoardRepository } from '../../../../src/use-cases/ports/board-repository'
import { makeFakeRepo } from './helpers'

type ParseableSchema = { safeParse: (data: unknown) => { success: boolean } }

describe('createPostCommentTool', () => {
  let repo: BoardRepository

  beforeEach(() => {
    repo = makeFakeRepo()
  })

  it('should have a description string', () => {
    const t = createPostCommentTool(repo)
    expect(typeof t.description).toBe('string')
    expect(t.description!.length).toBeGreaterThan(0)
  })

  it('should accept valid taskId and text input', () => {
    const schema = createPostCommentTool(repo).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ taskId: 'task-123', text: 'Progress update' }).success).toBe(true)
  })

  it('should reject missing taskId', () => {
    const schema = createPostCommentTool(repo).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ text: 'Progress update' }).success).toBe(false)
  })

  it('should reject missing text', () => {
    const schema = createPostCommentTool(repo).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({ taskId: 'task-123' }).success).toBe(false)
  })

  it('should reject empty input', () => {
    const schema = createPostCommentTool(repo).inputSchema as unknown as ParseableSchema
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('should call repo.postComment with taskId and text', async () => {
    vi.mocked(repo.postComment).mockResolvedValue(undefined)
    const t = createPostCommentTool(repo)
    await t.execute!({ taskId: 'task-123', text: 'Progress update' }, { toolCallId: 'test', messages: [] })
    expect(repo.postComment).toHaveBeenCalledWith('task-123', 'Progress update')
  })

  it('should return { ok: true }', async () => {
    vi.mocked(repo.postComment).mockResolvedValue(undefined)
    const t = createPostCommentTool(repo)
    const result = await t.execute!({ taskId: 'task-123', text: 'Progress update' }, { toolCallId: 'test', messages: [] })
    expect(result).toEqual({ ok: true })
  })

  it('should propagate errors from repo', async () => {
    vi.mocked(repo.postComment).mockRejectedValue(new Error('Post failed'))
    const t = createPostCommentTool(repo)
    await expect(
      t.execute!({ taskId: 'task-123', text: 'text' }, { toolCallId: 'test', messages: [] })
    ).rejects.toThrow('Post failed')
  })
})
