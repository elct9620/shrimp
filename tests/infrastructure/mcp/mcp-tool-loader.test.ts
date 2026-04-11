import { describe, it, expect, vi } from 'vitest'
import type { McpClient, McpClientFactory } from '../../../src/infrastructure/mcp/mcp-tool-loader'
import { McpToolLoader } from '../../../src/infrastructure/mcp/mcp-tool-loader'
import type { McpConfig } from '../../../src/infrastructure/config/mcp-config'
import { jsonSchema, tool } from 'ai'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(toolDefs: Array<{ name: string; description: string }>): McpClient {
  return {
    tools: vi.fn().mockResolvedValue(
      Object.fromEntries(
        toolDefs.map(({ name, description }) => [
          name,
          tool({
            description,
            inputSchema: jsonSchema({ type: 'object', properties: {} }),
            execute: vi.fn().mockResolvedValue({}),
          }),
        ])
      )
    ),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function makeConfig(servers: Record<string, { command: string; args?: string[] }>): McpConfig {
  return { mcpServers: servers }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpToolLoader', () => {
  describe('load()', () => {
    it('should return empty result when mcpServers is empty', async () => {
      const factory: McpClientFactory = vi.fn()
      const loader = new McpToolLoader(factory)
      const config = makeConfig({})

      const result = await loader.load(config)

      expect(result.tools).toEqual({})
      expect(result.descriptions).toEqual([])
      expect(factory).not.toHaveBeenCalled()
    })

    it('should return both tools and descriptions when one server has two tools', async () => {
      const client = makeClient([
        { name: 'readFile', description: 'Read a file' },
        { name: 'writeFile', description: 'Write a file' },
      ])
      const factory: McpClientFactory = vi.fn().mockResolvedValue(client)
      const loader = new McpToolLoader(factory)
      const config = makeConfig({ fs: { command: 'node', args: ['fs-server.js'] } })

      const result = await loader.load(config)

      expect(Object.keys(result.tools)).toEqual(expect.arrayContaining(['readFile', 'writeFile']))
      expect(result.descriptions).toHaveLength(2)
      expect(result.descriptions).toEqual(
        expect.arrayContaining([
          { name: 'readFile', description: 'Read a file' },
          { name: 'writeFile', description: 'Write a file' },
        ])
      )
    })

    it('should merge tools from two servers each with one tool', async () => {
      const clientA = makeClient([{ name: 'searchWeb', description: 'Search the web' }])
      const clientB = makeClient([{ name: 'runCode', description: 'Execute code' }])
      const factory: McpClientFactory = vi
        .fn()
        .mockResolvedValueOnce(clientA)
        .mockResolvedValueOnce(clientB)
      const loader = new McpToolLoader(factory)
      const config = makeConfig({
        search: { command: 'node', args: ['search.js'] },
        runner: { command: 'node', args: ['runner.js'] },
      })

      const result = await loader.load(config)

      expect(Object.keys(result.tools)).toEqual(expect.arrayContaining(['searchWeb', 'runCode']))
      expect(result.descriptions).toHaveLength(2)
    })

    it('should exclude the failed server but still load others when one server fails to start', async () => {
      const goodClient = makeClient([{ name: 'goodTool', description: 'A good tool' }])
      const factory: McpClientFactory = vi
        .fn()
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValueOnce(goodClient)
      const loader = new McpToolLoader(factory)
      const config = makeConfig({
        bad: { command: 'bad-server' },
        good: { command: 'good-server' },
      })

      const result = await loader.load(config)

      expect(result.tools).toHaveProperty('goodTool')
      expect(Object.keys(result.tools)).not.toContain('badTool')
      expect(result.descriptions).toHaveLength(1)
      expect(result.descriptions[0].name).toBe('goodTool')
    })

    it('should return empty result when all servers fail to start', async () => {
      const factory: McpClientFactory = vi.fn().mockRejectedValue(new Error('all down'))
      const loader = new McpToolLoader(factory)
      const config = makeConfig({
        serverA: { command: 'a' },
        serverB: { command: 'b' },
      })

      const result = await loader.load(config)

      expect(result.tools).toEqual({})
      expect(result.descriptions).toEqual([])
    })

    it('should call the factory with the server name and its definition', async () => {
      const client = makeClient([{ name: 'tool1', description: 'Tool one' }])
      const factory: McpClientFactory = vi.fn().mockResolvedValue(client)
      const loader = new McpToolLoader(factory)
      const config = makeConfig({ myServer: { command: 'myCmd', args: ['--flag'] } })

      await loader.load(config)

      expect(factory).toHaveBeenCalledWith('myServer', { command: 'myCmd', args: ['--flag'] })
    })
  })

  describe('close()', () => {
    it('should close every client that was successfully loaded', async () => {
      const clientA = makeClient([{ name: 'toolA', description: 'Tool A' }])
      const clientB = makeClient([{ name: 'toolB', description: 'Tool B' }])
      const factory: McpClientFactory = vi
        .fn()
        .mockResolvedValueOnce(clientA)
        .mockResolvedValueOnce(clientB)
      const loader = new McpToolLoader(factory)
      const config = makeConfig({
        serverA: { command: 'a' },
        serverB: { command: 'b' },
      })

      await loader.load(config)
      await loader.close()

      expect(clientA.close).toHaveBeenCalledOnce()
      expect(clientB.close).toHaveBeenCalledOnce()
    })

    it('should not throw when a client close throws (best-effort cleanup)', async () => {
      const client = makeClient([{ name: 'tool1', description: 'Tool' }])
      ;(client.close as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('close failed'))
      const factory: McpClientFactory = vi.fn().mockResolvedValue(client)
      const loader = new McpToolLoader(factory)
      const config = makeConfig({ server: { command: 'cmd' } })

      await loader.load(config)

      await expect(loader.close()).resolves.toBeUndefined()
    })

    it('should resolve immediately if no clients were loaded', async () => {
      const factory: McpClientFactory = vi.fn()
      const loader = new McpToolLoader(factory)

      await expect(loader.close()).resolves.toBeUndefined()
    })
  })
})
