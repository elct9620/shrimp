import { Hono } from "hono";
import type { AppEnv } from "../context-variables";
import type { TaskQueue } from "../../../use-cases/ports/task-queue";
import type { ProcessingCycle } from "../../../use-cases/processing-cycle";
import type { LoggerPort } from "../../../use-cases/ports/logger";

export function createHeartbeatRoute(deps: {
  taskQueue: TaskQueue;
  processingCycle: ProcessingCycle;
  logger: LoggerPort;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/heartbeat", (c) => {
    deps.logger.info("heartbeat received");
    const accepted = deps.taskQueue.tryEnqueue(() =>
      deps.processingCycle.run(),
    );
    deps.logger.info("heartbeat enqueued", { accepted });
    return c.json({ status: "accepted" }, 202);
  });

  return app;
}
