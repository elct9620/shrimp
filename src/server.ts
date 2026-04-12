import 'reflect-metadata'
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { container, bootstrap } from './container'
import { TOKENS } from './infrastructure/container/tokens'
import { McpToolLoader } from './infrastructure/mcp/mcp-tool-loader'
import { ProcessingCycle } from './use-cases/processing-cycle'
import { createApp } from './adapters/http/app'

async function main() {
  await bootstrap()

  const logger = container.resolve<import('./use-cases/ports/logger').LoggerPort>(TOKENS.Logger)
  const env = container.resolve<import('./infrastructure/config/env-config').EnvConfig>(TOKENS.EnvConfig)
  const mcpToolLoader = container.resolve(McpToolLoader)
  const processingCycle = container.resolve(ProcessingCycle)
  // Raw pino instance registered during bootstrap for pino-http middleware
  const pinoInstance = container.resolve<import('pino').Logger>('PinoInstance')

  const app = createApp({
    pinoInstance,
    taskQueue: container.resolve(TOKENS.TaskQueue),
    processingCycle,
    logger: logger.child({ module: 'http.heartbeat' }),
  })

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
