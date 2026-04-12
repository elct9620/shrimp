import 'reflect-metadata'
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { composeApp } from './container'

async function main() {
  const { app, mcpToolLoader, port, logger } = await composeApp()

  const server = serve({ fetch: app.fetch, port })
  logger.info('server listening', { port })

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
  // Bootstrap failure: logger is not yet available because composeApp threw
  // before creating it. Fall back to stderr so the failure is still visible.
  console.error('failed to start server:', err)
  process.exit(1)
})
