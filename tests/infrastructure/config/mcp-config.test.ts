import { afterEach, describe, expect, it } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { McpConfigError, parseMcpConfig, loadMcpConfig } from '../../../src/infrastructure/config/mcp-config'

const TMP_FILE = '.tmp.mcp.json'

afterEach(() => {
  if (existsSync(TMP_FILE)) {
    unlinkSync(TMP_FILE)
  }
})

describe('parseMcpConfig', () => {
  describe('valid configs', () => {
    it('should return correctly shaped object for a single server', () => {
      const raw = JSON.stringify({
        mcpServers: {
          myServer: { command: 'node', args: ['server.js'] },
        },
      })

      const config = parseMcpConfig(raw)

      expect(config).toEqual({
        mcpServers: {
          myServer: { command: 'node', args: ['server.js'] },
        },
      })
    })

    it('should preserve all servers when multiple are defined', () => {
      const raw = JSON.stringify({
        mcpServers: {
          serverA: { command: 'node', args: ['a.js'] },
          serverB: { command: 'python', args: ['-m', 'server'] },
        },
      })

      const config = parseMcpConfig(raw)

      expect(config.mcpServers).toHaveProperty('serverA')
      expect(config.mcpServers).toHaveProperty('serverB')
      expect(config.mcpServers['serverA']).toEqual({ command: 'node', args: ['a.js'] })
      expect(config.mcpServers['serverB']).toEqual({ command: 'python', args: ['-m', 'server'] })
    })

    it('should return empty mcpServers when mcpServers is an empty object', () => {
      const raw = JSON.stringify({ mcpServers: {} })

      const config = parseMcpConfig(raw)

      expect(config).toEqual({ mcpServers: {} })
    })

    it('should preserve the args array on a server definition', () => {
      const raw = JSON.stringify({
        mcpServers: {
          withArgs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
        },
      })

      const config = parseMcpConfig(raw)

      expect(config.mcpServers['withArgs'].args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp'])
    })

    it('should not include args when the server definition omits it', () => {
      const raw = JSON.stringify({
        mcpServers: {
          noArgs: { command: 'some-binary' },
        },
      })

      const config = parseMcpConfig(raw)

      expect(config.mcpServers['noArgs'].command).toBe('some-binary')
      expect(config.mcpServers['noArgs'].args).toBeUndefined()
    })
  })

  describe('fail-fast on invalid JSON', () => {
    it('should throw McpConfigError when input is not valid JSON', () => {
      expect(() => parseMcpConfig('not json')).toThrow(McpConfigError)
    })

    it('should throw McpConfigError on truncated JSON', () => {
      expect(() => parseMcpConfig('{"mcpServers":')).toThrow(McpConfigError)
    })
  })

  describe('fail-fast on wrong root type', () => {
    it('should throw McpConfigError when parsed value is an array', () => {
      expect(() => parseMcpConfig('[]')).toThrow(McpConfigError)
    })

    it('should throw McpConfigError when parsed value is a number', () => {
      expect(() => parseMcpConfig('42')).toThrow(McpConfigError)
    })

    it('should throw McpConfigError when parsed value is null', () => {
      expect(() => parseMcpConfig('null')).toThrow(McpConfigError)
    })
  })

  describe('fail-fast on missing or wrong mcpServers key', () => {
    it('should throw McpConfigError when the mcpServers key is missing', () => {
      expect(() => parseMcpConfig('{}')).toThrow(McpConfigError)
    })

    it('should throw McpConfigError when mcpServers is a string instead of an object', () => {
      expect(() => parseMcpConfig(JSON.stringify({ mcpServers: 'bad' }))).toThrow(McpConfigError)
    })

    it('should throw McpConfigError when mcpServers is null', () => {
      expect(() => parseMcpConfig(JSON.stringify({ mcpServers: null }))).toThrow(McpConfigError)
    })

    it('should throw McpConfigError when mcpServers is an array', () => {
      expect(() => parseMcpConfig(JSON.stringify({ mcpServers: [] }))).toThrow(McpConfigError)
    })
  })

  describe('fail-fast on invalid server definitions', () => {
    it('should throw McpConfigError when a server definition is a string', () => {
      expect(() => parseMcpConfig(JSON.stringify({ mcpServers: { srv: 'bad' } }))).toThrow(McpConfigError)
    })

    it('should throw McpConfigError when a server definition is missing command', () => {
      expect(() => parseMcpConfig(JSON.stringify({ mcpServers: { srv: { args: [] } } }))).toThrow(McpConfigError)
    })

    it('should throw McpConfigError when command is a number instead of a string', () => {
      expect(() => parseMcpConfig(JSON.stringify({ mcpServers: { srv: { command: 123 } } }))).toThrow(McpConfigError)
    })

    it('should throw McpConfigError when args is a plain string instead of an array', () => {
      expect(() =>
        parseMcpConfig(JSON.stringify({ mcpServers: { srv: { command: 'node', args: 'bad' } } }))
      ).toThrow(McpConfigError)
    })

    it('should throw McpConfigError when args contains a non-string element', () => {
      expect(() =>
        parseMcpConfig(JSON.stringify({ mcpServers: { srv: { command: 'node', args: ['ok', 42] } } }))
      ).toThrow(McpConfigError)
    })
  })

  describe('McpConfigError', () => {
    it('should set name to "McpConfigError"', () => {
      let error: McpConfigError | undefined
      try {
        parseMcpConfig('null')
      } catch (e) {
        if (e instanceof McpConfigError) error = e
      }
      expect(error).toBeDefined()
      expect(error!.name).toBe('McpConfigError')
    })

    it('should include a descriptive message on invalid JSON', () => {
      let error: McpConfigError | undefined
      try {
        parseMcpConfig('not json')
      } catch (e) {
        if (e instanceof McpConfigError) error = e
      }
      expect(error).toBeDefined()
      expect(error!.message.length).toBeGreaterThan(0)
    })
  })
})

describe('loadMcpConfig', () => {
  it('should read the file and return the parsed config', () => {
    const content = JSON.stringify({
      mcpServers: {
        fileServer: { command: 'node', args: ['file-server.js'] },
      },
    })
    writeFileSync(TMP_FILE, content, 'utf-8')

    const config = loadMcpConfig(TMP_FILE)

    expect(config).toEqual({
      mcpServers: {
        fileServer: { command: 'node', args: ['file-server.js'] },
      },
    })
  })
})
