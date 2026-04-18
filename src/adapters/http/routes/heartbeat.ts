import { Hono } from "hono";
import type { AppEnv } from "../context-variables";
import type { JobQueue } from "../../../use-cases/ports/job-queue";
import type { HeartbeatJob } from "../../../use-cases/heartbeat-job";
import type { LoggerPort } from "../../../use-cases/ports/logger";

export function createHeartbeatRoute(deps: {
  jobQueue: JobQueue;
  heartbeatJob: HeartbeatJob;
  logger: LoggerPort;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/heartbeat", (c) => {
    deps.logger.info("heartbeat received");
    const accepted = deps.jobQueue.tryEnqueue(() => deps.heartbeatJob.run());
    deps.logger.info("heartbeat enqueued", { accepted });
    return c.json({ status: "accepted" }, 202);
  });

  return app;
}
