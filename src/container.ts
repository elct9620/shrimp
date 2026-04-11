import { Hono } from 'hono'
import type { LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { loadEnvConfig } from './infrastructure/config/env-config'
import { loadMcpConfig, type McpConfig } from './infrastructure/config/mcp-config'
import { TodoistClient } from './infrastructure/todoist/todoist-client'
import { TodoistBoardRepository } from './infrastructure/todoist/todoist-board-repository'
import { AiSdkAgentLoop } from './infrastructure/ai/ai-sdk-agent-loop'
import { McpToolLoader } from './infrastructure/mcp/mcp-tool-loader'
import { InMemoryTaskQueue } from './infrastructure/queue/in-memory-task-queue'
import { ToolRegistry } from './adapters/tools/tool-registry'
import { createBuiltInTools, createBuiltInToolDescriptions } from './adapters/tools/built-in/index'
import { createHealthRoute } from './adapters/http/routes/health'
import { createHeartbeatRoute } from './adapters/http/routes/heartbeat'
import { MainAgent } from './use-cases/main-agent'
import type { BoardRepository } from './use-cases/ports/board-repository'
import type { ToolDescription } from './use-cases/ports/tool-description'

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type ComposedApp = {
  app: Hono
  mcpToolLoader: McpToolLoader
  port: number
}

/**
 * Optional overrides for test injection. Each field independently replaces
 * the corresponding real implementation when provided.
 */
export type ComposeOverrides = {
  languageModel?: LanguageModel
  boardRepository?: BoardRepository
  mcpToolLoader?: McpToolLoader
}

// ---------------------------------------------------------------------------
// composeApp
// ---------------------------------------------------------------------------

export async function composeApp(overrides: ComposeOverrides = {}): Promise<ComposedApp> {
  // 1. Load and validate environment — fails fast with EnvConfigError if required vars are missing
  const env = loadEnvConfig()

  // 2. Load MCP config — absent file is explicitly allowed per SPEC §Deployment §Rules
  let mcpConfig: McpConfig = { mcpServers: {} }
  if (!overrides.mcpToolLoader) {
    try {
      mcpConfig = loadMcpConfig('.mcp.json')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      // Absent file is fine; empty config already assigned above
    }
  }

  // 3. BoardRepository — Todoist client + repository
  const boardRepository: BoardRepository =
    overrides.boardRepository ??
    new TodoistBoardRepository(
      new TodoistClient('https://api.todoist.com/rest/v2', env.todoistApiToken),
      env.todoistProjectId,
    )

  // 4. LanguageModel — OpenAI-compatible provider
  const model: LanguageModel =
    overrides.languageModel ??
    (() => {
      const provider = createOpenAICompatible({
        name: 'shrimp',
        baseURL: env.openAiBaseUrl,
        apiKey: env.openAiApiKey,
      })
      return provider.chatModel(env.aiModel)
    })()

  // 5. McpToolLoader — load MCP tools; on failure fall back to empty
  const mcpToolLoader: McpToolLoader = overrides.mcpToolLoader ?? new McpToolLoader()

  let mcpTools = {}
  let mcpDescriptions: ToolDescription[] = []
  try {
    const result = await mcpToolLoader.load(mcpConfig)
    mcpTools = result.tools
    mcpDescriptions = result.descriptions
  } catch {
    // Per SPEC §Failure Handling: if loading fails entirely, run with built-in tools only
  }

  // 6. Built-in tools
  const builtInTools = createBuiltInTools(boardRepository)
  const builtInDescriptions = createBuiltInToolDescriptions()

  // 7. ToolRegistry — merges built-in + MCP tools
  const toolProvider = new ToolRegistry({
    builtInTools,
    builtInDescriptions,
    mcpTools,
    mcpDescriptions,
  })

  // 8. AgentLoop
  const agentLoop = new AiSdkAgentLoop(model)

  // 9. MainAgent
  const mainAgent = new MainAgent({
    board: boardRepository,
    agentLoop,
    toolProvider,
    maxSteps: env.aiMaxSteps,
  })

  // 10. TaskQueue
  const taskQueue = new InMemoryTaskQueue()

  // 11. Hono app
  const app = new Hono()
  app.route('/', createHealthRoute())
  app.route('/', createHeartbeatRoute({ taskQueue, mainAgent }))

  return { app, mcpToolLoader, port: env.port }
}
