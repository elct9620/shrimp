import { Hono } from 'hono'
import type { TaskQueue } from '../../../use-cases/ports/task-queue'
import type { MainAgent } from '../../../use-cases/main-agent'

export function createHeartbeatRoute(deps: {
  taskQueue: TaskQueue
  mainAgent: MainAgent
}): Hono {
  const app = new Hono()

  app.post('/heartbeat', (c) => {
    deps.taskQueue.tryEnqueue(() => deps.mainAgent.run())
    return c.json({ status: 'accepted' }, 202)
  })

  return app
}
