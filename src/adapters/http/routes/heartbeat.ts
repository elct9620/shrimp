import { Hono } from "hono";
import type { AppEnv } from "../context-variables";
import type { JobQueue } from "../../../use-cases/ports/job-queue";
import type { Job } from "../../../use-cases/job";
import type { LoggerPort } from "../../../use-cases/ports/logger";

export function createHeartbeatRoute(deps: {
  jobQueue: JobQueue;
  job: Job;
  logger: LoggerPort;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/heartbeat", (c) => {
    deps.logger.info("heartbeat received");
    const accepted = deps.jobQueue.tryEnqueue(() => deps.job.run());
    deps.logger.info("heartbeat enqueued", { accepted });
    return c.json({ status: "accepted" }, 202);
  });

  return app;
}
