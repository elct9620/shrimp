import 'dotenv/config'
import { serve } from '@hono/node-server'
import { composeApp } from './container'

async function main() {
  const { app, mcpToolLoader, port } = await composeApp()

  const server = serve({ fetch: app.fetch, port })

  const shutdown = async () => {
    server.close()
    await mcpToolLoader.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
