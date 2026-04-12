import 'reflect-metadata'
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { pinoHttp } from 'pino-http'
import { container, bootstrap } from './container'
import { TOKENS } from './infrastructure/container/tokens'
import { McpToolLoader } from './infrastructure/mcp/mcp-tool-loader'
import { ProcessingCycle } from './use-cases/processing-cycle'
import { createHealthRoute } from './adapters/http/routes/health'
import { createHeartbeatRoute } from './adapters/http/routes/heartbeat'
import type { AppEnv } from './adapters/http/context-variables'

async function main() {
  await bootstrap()

  const logger = container.resolve<import('./use-cases/ports/logger').LoggerPort>(TOKENS.Logger)
  const env = container.resolve<import('./infrastructure/config/env-config').EnvConfig>(TOKENS.EnvConfig)
  const mcpToolLoader = container.resolve(McpToolLoader)
  const processingCycle = container.resolve(ProcessingCycle)
  // Raw pino instance registered during bootstrap for pino-http middleware
  const pinoInstance = container.resolve<import('pino').Logger>('PinoInstance')

  // Hono app — HTTP framework wiring; manual construction stays here.
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
      httpLogger(c.env.incoming, c.env.outgoing, () => resolve()),
    )
    c.set('logger', c.env.incoming.log)
    await next()
  })
  app.route('/', createHealthRoute())
  app.route(
    '/',
    createHeartbeatRoute({
      taskQueue: container.resolve(TOKENS.TaskQueue),
      processingCycle,
      logger: logger.child({ module: 'http.heartbeat' }),
    }),
  )

  const server = serve({ fetch: app.fetch, port: env.port })
  logger.info('server listening', { port: env.port })

  const shutdown = async (signal: string) => {
    logger.info('shutdown signal received', { signal })
    server.close()
    await mcpToolLoader.close()
    logger.info('server stopped')
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  // Bootstrap failure: logger is not yet available. Fall back to stderr.
  console.error('failed to start server:', err)
  process.exit(1)
})
