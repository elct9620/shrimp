import { Hono } from "hono";
import type { AppEnv } from "../context-variables";
import type { JobQueue } from "../../../use-cases/ports/job-queue";
import type { HeartbeatJob } from "../../../use-cases/heartbeat-job";
import type { LoggerPort } from "../../../use-cases/ports/logger";
import { timingSafeEqualStr } from "../timing-safe-compare";

const BEARER_PREFIX = "Bearer ";

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  if (!header.startsWith(BEARER_PREFIX)) return undefined;
  return header.slice(BEARER_PREFIX.length);
}

export function createHeartbeatRoute(deps: {
  jobQueue: JobQueue;
  heartbeatJob: HeartbeatJob;
  logger: LoggerPort;
  heartbeatToken?: string;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/heartbeat", (c) => {
    if (deps.heartbeatToken) {
      const provided = extractBearerToken(c.req.header("authorization"));
      if (!provided || !timingSafeEqualStr(provided, deps.heartbeatToken)) {
        deps.logger.warn("heartbeat rejected");
        return c.body(null, 401);
      }
    }

    deps.logger.info("heartbeat received");
    const accepted = deps.jobQueue.tryEnqueue(() => deps.heartbeatJob.run());
    deps.logger.info("heartbeat enqueued", { accepted });
    return c.json({ status: "accepted" }, 202);
  });

  return app;
}
