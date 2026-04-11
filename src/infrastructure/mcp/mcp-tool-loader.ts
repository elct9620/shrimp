import { tool, jsonSchema } from 'ai'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpConfig, McpServerDefinition } from '../config/mcp-config'
import type { ToolSet } from '../../use-cases/ports/tool-set'
import type { ToolDescription } from '../../use-cases/ports/tool-description'
import type { LoggerPort } from '../../use-cases/ports/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpClient = {
  tools(): Promise<ToolSet>
  close(): Promise<void>
}

export type McpClientFactory = (
  serverName: string,
  definition: McpServerDefinition
) => Promise<McpClient>

export type McpLoadResult = {
  tools: ToolSet
  descriptions: ToolDescription[]
}

// ---------------------------------------------------------------------------
// Default factory: uses @modelcontextprotocol/sdk with stdio transport
// ---------------------------------------------------------------------------

const defaultFactory: McpClientFactory = async (
  _serverName: string,
  definition: McpServerDefinition
): Promise<McpClient> => {
  const transport = new StdioClientTransport({
    command: definition.command,
    args: definition.args,
  })

  const client = new Client({ name: 'shrimp', version: '1.0.0' })
  await client.connect(transport)

  return {
    async tools(): Promise<ToolSet> {
      const { tools } = await client.listTools()
      return Object.fromEntries(
        tools.map((mcpTool) => [
          mcpTool.name,
          tool({
            description: mcpTool.description ?? '',
            inputSchema: jsonSchema(mcpTool.inputSchema as Parameters<typeof jsonSchema>[0]),
            execute: async (input: unknown) => {
              const result = await client.callTool({
                name: mcpTool.name,
                arguments: input as Record<string, unknown>,
              })
              return result
            },
          }),
        ])
      )
    },

    async close(): Promise<void> {
      await client.close()
    },
  }
}

// ---------------------------------------------------------------------------
// McpToolLoader
// ---------------------------------------------------------------------------

export class McpToolLoader {
  private clients: McpClient[] = []

  constructor(
    private readonly logger: LoggerPort,
    private readonly factory: McpClientFactory = defaultFactory,
  ) {}

  async load(config: McpConfig): Promise<McpLoadResult> {
    const mergedTools: ToolSet = {}
    const descriptions: ToolDescription[] = []

    for (const [serverName, definition] of Object.entries(config.mcpServers)) {
      let client: McpClient
      try {
        client = await this.factory(serverName, definition)
      } catch (err) {
        // Per SPEC §Failure Handling: exclude failed server, continue with others
        this.logger.warn('mcp server failed to start', {
          serverName,
          command: definition.command,
          error: err instanceof Error ? err.message : String(err),
        })
        continue
      }

      this.clients.push(client)

      let serverTools: ToolSet
      try {
        serverTools = await client.tools()
      } catch (err) {
        this.logger.warn('mcp server failed to list tools', {
          serverName,
          error: err instanceof Error ? err.message : String(err),
        })
        continue
      }

      const toolNames: string[] = []
      for (const [name, toolDef] of Object.entries(serverTools)) {
        mergedTools[name] = toolDef
        const desc = (toolDef as { description?: string }).description ?? ''
        descriptions.push({ name, description: desc })
        toolNames.push(name)
      }

      this.logger.info('mcp server connected', {
        serverName,
        toolCount: toolNames.length,
        toolNames,
      })
    }

    return { tools: mergedTools, descriptions }
  }

  async close(): Promise<void> {
    this.logger.debug('mcp close', { clientCount: this.clients.length })
    const results = await Promise.allSettled(this.clients.map((c) => c.close()))
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        this.logger.warn('mcp client failed to close', {
          clientIndex: i,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        })
      }
    })
  }
}
