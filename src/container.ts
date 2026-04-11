import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { pinoHttp } from 'pino-http'
import type { DestinationStream } from 'pino'
import type { LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { loadEnvConfig } from './infrastructure/config/env-config'
import { loadMcpConfig, type McpConfig } from './infrastructure/config/mcp-config'
import { TodoistClient } from './infrastructure/todoist/todoist-client'
import { TodoistBoardRepository } from './infrastructure/todoist/todoist-board-repository'
import { AiSdkMainAgent } from './infrastructure/ai/ai-sdk-main-agent'
import { McpToolLoader } from './infrastructure/mcp/mcp-tool-loader'
import { InMemoryTaskQueue } from './infrastructure/queue/in-memory-task-queue'
import { ToolRegistry } from './adapters/tools/tool-registry'
import { createBuiltInTools, createBuiltInToolDescriptions } from './adapters/tools/built-in/index'
import { createHealthRoute } from './adapters/http/routes/health'
import { createHeartbeatRoute } from './adapters/http/routes/heartbeat'
import type { AppEnv } from './adapters/http/context-variables'
import { ProcessingCycle } from './use-cases/processing-cycle'
import { createPinoLogger } from './infrastructure/logger/pino-logger'
import type { BoardRepository } from './use-cases/ports/board-repository'
import type { LoggerPort } from './use-cases/ports/logger'
import type { ToolDescription } from './use-cases/ports/tool-description'

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type ComposedApp = {
  app: Hono<AppEnv>
  mcpToolLoader: McpToolLoader
  port: number
  logger: LoggerPort
}

/**
 * Optional overrides for test injection. Each field independently replaces
 * the corresponding real implementation when provided.
 */
export type ComposeOverrides = {
  languageModel?: LanguageModel
  boardRepository?: BoardRepository
  mcpToolLoader?: McpToolLoader
  logDestination?: DestinationStream
}

// ---------------------------------------------------------------------------
// composeApp
// ---------------------------------------------------------------------------

export async function composeApp(overrides: ComposeOverrides = {}): Promise<ComposedApp> {
  // 1. Load and validate environment — fails fast with EnvConfigError if required vars are missing
  const env = loadEnvConfig()

  // 1a. Root logger — single factory call produces both LoggerPort (for non-HTTP
  // modules) and the underlying pino instance (shared with pino-http middleware).
  const { logger, pino: pinoInstance } = createPinoLogger({
    level: env.logLevel,
    pretty: process.env.NODE_ENV !== 'production' && !overrides.logDestination,
    destination: overrides.logDestination,
  })
  logger.info('env config loaded', {
    logLevel: env.logLevel,
    port: env.port,
    aiMaxSteps: env.aiMaxSteps,
  })

  // 2. Load MCP config — absent file is explicitly allowed per SPEC §Deployment §Rules
  let mcpConfig: McpConfig = { mcpServers: {} }
  if (!overrides.mcpToolLoader) {
    try {
      mcpConfig = loadMcpConfig('.mcp.json')
      logger.info('mcp config loaded', {
        serverCount: Object.keys(mcpConfig.mcpServers).length,
      })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('failed to load mcp config', {
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
      logger.debug('no .mcp.json found — continuing without mcp servers')
    }
  }

  // 3. BoardRepository — Todoist client + repository
  const boardRepository: BoardRepository =
    overrides.boardRepository ??
    new TodoistBoardRepository(
      new TodoistClient(
        'https://api.todoist.com/rest/v2',
        env.todoistApiToken,
        logger.child({ module: 'TodoistClient' }),
      ),
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

  // 8. MainAgent (AI execution engine)
  const mainAgent = new AiSdkMainAgent(model)

  // 9. ProcessingCycle (orchestrates one heartbeat-triggered unit of work)
  const processingCycle = new ProcessingCycle({
    board: boardRepository,
    mainAgent,
    toolProvider,
    maxSteps: env.aiMaxSteps,
  })

  // 10. TaskQueue
  const taskQueue = new InMemoryTaskQueue()

  // 11. Hono app — wires request-id and pino-http per the official pino+Hono recipe.
  // The pino-http bridge relies on @hono/node-server bindings (c.env.incoming/outgoing)
  // that are only populated at runtime via serve(). Hono's in-process app.request()
  // used by tests leaves c.env empty, so the bridge short-circuits there instead of
  // crashing; the request still flows through to the handlers.
  const httpLogger = pinoHttp({ logger: pinoInstance })
  const app = new Hono<AppEnv>()
  app.use(requestId())
  app.use(async (c, next) => {
    if (!c.env?.incoming || !c.env?.outgoing) {
      await next()
      return
    }
    c.env.incoming.id = c.var.requestId
    await new Promise<void>((resolve) =>
      httpLogger(c.env.incoming, c.env.outgoing, () => resolve())
    )
    c.set('logger', c.env.incoming.log)
    await next()
  })
  app.route('/', createHealthRoute())
  app.route('/', createHeartbeatRoute({ taskQueue, processingCycle }))

  return { app, mcpToolLoader, port: env.port, logger }
}
