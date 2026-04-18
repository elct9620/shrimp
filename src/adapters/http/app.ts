import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import type { AppEnv } from "./context-variables";
import type { JobQueue } from "../../use-cases/ports/job-queue";
import type { HeartbeatJob } from "../../use-cases/heartbeat-job";
import type { LoggerPort } from "../../use-cases/ports/logger";
import { createHealthRoute } from "./routes/health";
import { createHeartbeatRoute } from "./routes/heartbeat";

export type CreateAppDeps = {
  pinoInstance: Logger;
  jobQueue: JobQueue;
  heartbeatJob: HeartbeatJob;
  logger: LoggerPort;
};

export function createApp(deps: CreateAppDeps): Hono<AppEnv> {
  const httpLogger = pinoHttp({
    logger: deps.pinoInstance,
    autoLogging: {
      ignore: (req) => req.url === "/health",
    },
  });
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(async (c, next) => {
    if (!c.env?.incoming || !c.env?.outgoing) {
      await next();
      return;
    }
    c.env.incoming.id = c.var.requestId;
    await new Promise<void>((resolve) =>
      httpLogger(c.env.incoming, c.env.outgoing, () => resolve()),
    );
    c.set("logger", c.env.incoming.log);
    await next();
  });

  app.route("/", createHealthRoute());
  app.route(
    "/",
    createHeartbeatRoute({
      jobQueue: deps.jobQueue,
      heartbeatJob: deps.heartbeatJob,
      logger: deps.logger,
    }),
  );

  return app;
}
