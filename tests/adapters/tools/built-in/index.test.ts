import { describe, it, expect, vi } from 'vitest'
import { createBuiltInTools, createBuiltInToolDescriptions } from '../../../../src/adapters/tools/built-in/index'
import { makeFakeRepo, makeFakeLogger } from './helpers'

describe('createBuiltInTools', () => {
  it('should return an object with all four tool keys', () => {
    const tools = createBuiltInTools(makeFakeRepo(), makeFakeLogger())
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(['getTasks', 'getComments', 'postComment', 'moveTask'])
    )
  })

  it('should return getTasks as a tool object with description and inputSchema', () => {
    const tools = createBuiltInTools(makeFakeRepo(), makeFakeLogger())
    expect(typeof tools.getTasks.description).toBe('string')
    expect(tools.getTasks.inputSchema).toBeDefined()
    expect(typeof tools.getTasks.execute).toBe('function')
  })

  it('should return getComments as a tool object with description and inputSchema', () => {
    const tools = createBuiltInTools(makeFakeRepo(), makeFakeLogger())
    expect(typeof tools.getComments.description).toBe('string')
    expect(tools.getComments.inputSchema).toBeDefined()
    expect(typeof tools.getComments.execute).toBe('function')
  })

  it('should return postComment as a tool object with description and inputSchema', () => {
    const tools = createBuiltInTools(makeFakeRepo(), makeFakeLogger())
    expect(typeof tools.postComment.description).toBe('string')
    expect(tools.postComment.inputSchema).toBeDefined()
    expect(typeof tools.postComment.execute).toBe('function')
  })

  it('should return moveTask as a tool object with description and inputSchema', () => {
    const tools = createBuiltInTools(makeFakeRepo(), makeFakeLogger())
    expect(typeof tools.moveTask.description).toBe('string')
    expect(tools.moveTask.inputSchema).toBeDefined()
    expect(typeof tools.moveTask.execute).toBe('function')
  })

  it('should inject the same repo into all tools', async () => {
    const repo = makeFakeRepo()
    vi.mocked(repo.getTasks).mockResolvedValue([])
    const tools = createBuiltInTools(repo, makeFakeLogger())
    await tools.getTasks.execute!({ section: 'Backlog' }, { toolCallId: 'test', messages: [] })
    expect(repo.getTasks).toHaveBeenCalled()
  })
})

describe('createBuiltInToolDescriptions', () => {
  it('should return an array of ToolDescriptions', () => {
    const descriptions = createBuiltInToolDescriptions()
    expect(Array.isArray(descriptions)).toBe(true)
  })

  it('should return exactly 4 descriptions', () => {
    const descriptions = createBuiltInToolDescriptions()
    expect(descriptions).toHaveLength(4)
  })

  it('should have a non-empty name and description on each entry', () => {
    const descriptions = createBuiltInToolDescriptions()
    for (const d of descriptions) {
      expect(typeof d.name).toBe('string')
      expect(d.name.length).toBeGreaterThan(0)
      expect(typeof d.description).toBe('string')
      expect(d.description.length).toBeGreaterThan(0)
    }
  })

  it('should have names that match the keys returned by createBuiltInTools', () => {
    const toolKeys = Object.keys(createBuiltInTools(makeFakeRepo(), makeFakeLogger()))
    const descriptionNames = createBuiltInToolDescriptions().map((d) => d.name)
    expect(descriptionNames).toEqual(expect.arrayContaining(toolKeys))
    expect(toolKeys).toEqual(expect.arrayContaining(descriptionNames))
  })
})
