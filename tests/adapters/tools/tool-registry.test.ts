import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../../../src/adapters/tools/tool-registry'
import type { ToolProvider } from '../../../src/use-cases/ports/tool-provider'
import type { ToolSet } from '../../../src/use-cases/ports/tool-set'
import type { ToolDescription } from '../../../src/use-cases/ports/tool-description'

function makeTools(...names: string[]): ToolSet {
  return Object.fromEntries(names.map((n) => [n, { fake: n }]))
}

function makeDescriptions(...names: string[]): ToolDescription[] {
  return names.map((name) => ({ name, description: `desc for ${name}` }))
}

describe('ToolRegistry', () => {
  it('implements ToolProvider interface', () => {
    const registry: ToolProvider = new ToolRegistry({
      builtInTools: {},
      builtInDescriptions: [],
      mcpTools: {},
      mcpDescriptions: [],
    })
    expect(typeof registry.getTools).toBe('function')
    expect(typeof registry.getToolDescriptions).toBe('function')
  })

  it('returns merged map with all built-in and MCP tool names as keys', () => {
    const registry = new ToolRegistry({
      builtInTools: makeTools('getTasks', 'postComment'),
      builtInDescriptions: makeDescriptions('getTasks', 'postComment'),
      mcpTools: makeTools('searchWeb', 'readPage'),
      mcpDescriptions: makeDescriptions('searchWeb', 'readPage'),
    })

    const tools = registry.getTools()
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(['getTasks', 'postComment', 'searchWeb', 'readPage'])
    )
    expect(Object.keys(tools)).toHaveLength(4)
  })

  it('returns built-in descriptions first in getToolDescriptions', () => {
    const registry = new ToolRegistry({
      builtInTools: makeTools('getTasks'),
      builtInDescriptions: makeDescriptions('getTasks'),
      mcpTools: makeTools('searchWeb'),
      mcpDescriptions: makeDescriptions('searchWeb'),
    })

    const descriptions = registry.getToolDescriptions()
    expect(descriptions[0].name).toBe('getTasks')
    expect(descriptions[1].name).toBe('searchWeb')
  })

  it('returns only built-in tools when MCP tools are empty', () => {
    const registry = new ToolRegistry({
      builtInTools: makeTools('getTasks', 'postComment'),
      builtInDescriptions: makeDescriptions('getTasks', 'postComment'),
      mcpTools: {},
      mcpDescriptions: [],
    })

    const tools = registry.getTools()
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(['getTasks', 'postComment']))
    expect(Object.keys(tools)).toHaveLength(2)

    const descriptions = registry.getToolDescriptions()
    expect(descriptions).toHaveLength(2)
    expect(descriptions.map((d) => d.name)).toEqual(['getTasks', 'postComment'])
  })

  it('built-in wins on name collision in getTools', () => {
    const builtInValue = { source: 'built-in' }
    const mcpValue = { source: 'mcp' }
    const registry = new ToolRegistry({
      builtInTools: { collision: builtInValue },
      builtInDescriptions: [{ name: 'collision', description: 'built-in version' }],
      mcpTools: { collision: mcpValue },
      mcpDescriptions: [{ name: 'collision', description: 'mcp version' }],
    })

    const tools = registry.getTools()
    expect(tools['collision']).toBe(builtInValue)
  })

  it('built-in wins on name collision in getToolDescriptions', () => {
    const registry = new ToolRegistry({
      builtInTools: { collision: {} },
      builtInDescriptions: [{ name: 'collision', description: 'built-in version' }],
      mcpTools: { collision: {} },
      mcpDescriptions: [{ name: 'collision', description: 'mcp version' }],
    })

    const descriptions = registry.getToolDescriptions()
    expect(descriptions).toHaveLength(1)
    expect(descriptions[0].description).toBe('built-in version')
  })

  it('returns empty set when both built-in and MCP are empty', () => {
    const registry = new ToolRegistry({
      builtInTools: {},
      builtInDescriptions: [],
      mcpTools: {},
      mcpDescriptions: [],
    })

    expect(registry.getTools()).toEqual({})
    expect(registry.getToolDescriptions()).toEqual([])
  })
})
