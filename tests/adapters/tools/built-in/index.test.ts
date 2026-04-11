import { describe, it, expect, vi } from 'vitest'
import { createBuiltInTools } from '../../../../src/adapters/tools/built-in/index'
import type { BoardRepository } from '../../../../src/use-cases/ports/board-repository'

function makeFakeRepo(): BoardRepository {
  return {
    getTasks: vi.fn(),
    getComments: vi.fn(),
    postComment: vi.fn(),
    moveTask: vi.fn(),
  }
}

describe('createBuiltInTools', () => {
  it('should return an object with all four tool keys', () => {
    const tools = createBuiltInTools(makeFakeRepo())
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(['getTasks', 'getComments', 'postComment', 'moveTask'])
    )
  })

  it('should return getTasks as a tool object with description and inputSchema', () => {
    const tools = createBuiltInTools(makeFakeRepo())
    expect(typeof tools.getTasks.description).toBe('string')
    expect(tools.getTasks.inputSchema).toBeDefined()
    expect(typeof tools.getTasks.execute).toBe('function')
  })

  it('should return getComments as a tool object with description and inputSchema', () => {
    const tools = createBuiltInTools(makeFakeRepo())
    expect(typeof tools.getComments.description).toBe('string')
    expect(tools.getComments.inputSchema).toBeDefined()
    expect(typeof tools.getComments.execute).toBe('function')
  })

  it('should return postComment as a tool object with description and inputSchema', () => {
    const tools = createBuiltInTools(makeFakeRepo())
    expect(typeof tools.postComment.description).toBe('string')
    expect(tools.postComment.inputSchema).toBeDefined()
    expect(typeof tools.postComment.execute).toBe('function')
  })

  it('should return moveTask as a tool object with description and inputSchema', () => {
    const tools = createBuiltInTools(makeFakeRepo())
    expect(typeof tools.moveTask.description).toBe('string')
    expect(tools.moveTask.inputSchema).toBeDefined()
    expect(typeof tools.moveTask.execute).toBe('function')
  })

  it('should inject the same repo into all tools', async () => {
    const repo = makeFakeRepo()
    vi.mocked(repo.getTasks).mockResolvedValue([])
    const tools = createBuiltInTools(repo)
    await tools.getTasks.execute!({ section: 'Backlog' }, { toolCallId: 'test', messages: [] })
    expect(repo.getTasks).toHaveBeenCalled()
  })
})
