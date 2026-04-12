import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { pinoHttp } from 'pino-http'
import type { DestinationStream } from 'pino'
import type { LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { container as rootContainer } from 'tsyringe'
import { TOKENS } from './infrastructure/container/tokens'
import { loadEnvConfig } from './infrastructure/config/env-config'
import { loadMcpConfig, type McpConfig } from './infrastructure/config/mcp-config'
import { TodoistClient } from './infrastructure/todoist/todoist-client'
import { TodoistBoardRepository } from './infrastructure/todoist/todoist-board-repository'
import { AiSdkMainAgent } from './infrastructure/ai/ai-sdk-main-agent'
import { McpToolLoader } from './infrastructure/mcp/mcp-tool-loader'
import { InMemoryTaskQueue } from './infrastructure/queue/in-memory-task-queue'
import { BuiltInToolFactory } from './adapters/tools/built-in-tool-factory'
import { ToolProviderFactoryImpl } from './adapters/tools/tool-provider-factory-impl'
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
  // 1. Env + logger — fails fast with EnvConfigError if required vars are missing
  const env = loadEnvConfig()
  const { logger, pino: pinoInstance } = createPinoLogger({
    level: env.logLevel,
    pretty: process.env.NODE_ENV !== 'production' && !overrides.logDestination,
    destination: overrides.logDestination,
  })
  logger.info('env config loaded', { logLevel: env.logLevel, port: env.port, aiMaxSteps: env.aiMaxSteps })

  // 2. MCP config — absent file is explicitly allowed per SPEC §Deployment §Rules
  let mcpConfig: McpConfig = { mcpServers: {} }
  if (!overrides.mcpToolLoader) {
    try {
      mcpConfig = loadMcpConfig('.mcp.json')
      logger.info('mcp config loaded', { serverCount: Object.keys(mcpConfig.mcpServers).length })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('failed to load mcp config', { error: err instanceof Error ? err.message : String(err) })
        throw err
      }
      logger.debug('no .mcp.json found — continuing without mcp servers')
    }
  }

  // 3. Child container for isolation per compose call
  const child = rootContainer.createChildContainer()

  // 4. Register value providers
  child.registerInstance(TOKENS.EnvConfig, env)
  child.registerInstance(TOKENS.Logger, logger)

  // 5. Language model
  child.register(TOKENS.LanguageModel, {
    useFactory: () =>
      overrides.languageModel ??
      createOpenAICompatible({ name: 'shrimp', baseURL: env.openAiBaseUrl, apiKey: env.openAiApiKey })
        .chatModel(env.aiModel),
  })

  // 6. BoardRepository — scalar deps prevent decorator-only resolution
  child.register(TOKENS.BoardRepository, {
    useFactory: () =>
      overrides.boardRepository ??
      new TodoistBoardRepository(
        new TodoistClient('https://api.todoist.com/rest/v2', env.todoistApiToken, logger.child({ module: 'TodoistClient' })),
        env.todoistProjectId,
        logger.child({ module: 'TodoistBoardRepository' }),
      ),
  })

  // 7. McpToolLoader — useFactory to preserve logger child-binding
  child.register(McpToolLoader, {
    useFactory: () =>
      overrides.mcpToolLoader ?? new McpToolLoader(logger.child({ module: 'McpToolLoader' })),
  })

  // 8. Load MCP tools eagerly (async result consumed by ToolProviderFactory)
  const mcpToolLoader = child.resolve(McpToolLoader)
  let mcpTools: Record<string, unknown> = {}
  let mcpDescriptions: ToolDescription[] = []
  try {
    const result = await mcpToolLoader.load(mcpConfig)
    mcpTools = result.tools
    mcpDescriptions = result.descriptions
  } catch {
    // Per SPEC §Failure Handling: if loading fails entirely, run with built-in tools only
  }

  // 9. MainAgent — useFactory to bind logger child
  child.register(TOKENS.MainAgent, {
    useFactory: (c) =>
      new AiSdkMainAgent(
        c.resolve<LanguageModel>(TOKENS.LanguageModel),
        logger.child({ module: 'AiSdkMainAgent' }),
      ),
  })

  // 10. TaskQueue — useFactory to bind logger child
  child.register(TOKENS.TaskQueue, {
    useFactory: () => new InMemoryTaskQueue(logger.child({ module: 'InMemoryTaskQueue' })),
  })

  // 11. ToolProviderFactory — resolves BuiltInToolFactory from container, injects MCP results
  child.register(TOKENS.ToolProviderFactory, {
    useFactory: (c) =>
      new ToolProviderFactoryImpl(
        c.resolve(BuiltInToolFactory),
        mcpTools,
        mcpDescriptions,
        logger.child({ module: 'ToolRegistry' }),
      ),
  })

  // 12. ProcessingCycle — Use Case: manual construction, no DI decorators
  const processingCycle = new ProcessingCycle({
    board: child.resolve<BoardRepository>(TOKENS.BoardRepository),
    mainAgent: child.resolve(TOKENS.MainAgent),
    toolProviderFactory: child.resolve(TOKENS.ToolProviderFactory),
    maxSteps: env.aiMaxSteps,
    logger: logger.child({ module: 'ProcessingCycle' }),
  })

  // 13. Hono app — HTTP framework wiring; manual construction stays here
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
  app.route(
    '/',
    createHeartbeatRoute({
      taskQueue: child.resolve(TOKENS.TaskQueue),
      processingCycle,
      logger: logger.child({ module: 'http.heartbeat' }),
    }),
  )

  return { app, mcpToolLoader, port: env.port, logger }
}
