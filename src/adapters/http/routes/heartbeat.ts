import { Hono } from 'hono'
import type { TaskQueue } from '../../../use-cases/ports/task-queue'
import type { ProcessingCycle } from '../../../use-cases/processing-cycle'

export function createHeartbeatRoute(deps: {
  taskQueue: TaskQueue
  processingCycle: ProcessingCycle
}): Hono {
  const app = new Hono()

  app.post('/heartbeat', (c) => {
    deps.taskQueue.tryEnqueue(() => deps.processingCycle.run())
    return c.json({ status: 'accepted' }, 202)
  })

  return app
}
