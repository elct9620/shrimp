import { Hono } from 'hono'
import type { AppEnv } from '../context-variables'
import type { TaskQueue } from '../../../use-cases/ports/task-queue'
import type { ProcessingCycle } from '../../../use-cases/processing-cycle'

export function createHeartbeatRoute(deps: {
  taskQueue: TaskQueue
  processingCycle: ProcessingCycle
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/heartbeat', (c) => {
    deps.taskQueue.tryEnqueue(() => deps.processingCycle.run())
    return c.json({ status: 'accepted' }, 202)
  })

  return app
}
