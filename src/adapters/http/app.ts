import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { pinoHttp } from 'pino-http'
import type { Logger } from 'pino'
import type { AppEnv } from './context-variables'
import type { TaskQueue } from '../../use-cases/ports/task-queue'
import type { ProcessingCycle } from '../../use-cases/processing-cycle'
import type { LoggerPort } from '../../use-cases/ports/logger'
import { createHealthRoute } from './routes/health'
import { createHeartbeatRoute } from './routes/heartbeat'

export type CreateAppDeps = {
  pinoInstance: Logger
  taskQueue: TaskQueue
  processingCycle: ProcessingCycle
  logger: LoggerPort
}

export function createApp(deps: CreateAppDeps): Hono<AppEnv> {
  const httpLogger = pinoHttp({ logger: deps.pinoInstance })
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
      taskQueue: deps.taskQueue,
      processingCycle: deps.processingCycle,
      logger: deps.logger,
    }),
  )

  return app
}
