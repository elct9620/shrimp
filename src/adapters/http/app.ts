import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import type { AppEnv } from "./context-variables";
import type { JobQueue } from "../../use-cases/ports/job-queue";
import type { HeartbeatJob } from "../../use-cases/heartbeat-job";
import type { BoardRepository } from "../../use-cases/ports/board-repository";
import type { LoggerPort } from "../../use-cases/ports/logger";
import type { ChannelJob } from "../../use-cases/channel-job";
import type { StartNewSession } from "../../use-cases/start-new-session";
import type { ChannelGateway } from "../../use-cases/ports/channel-gateway";
import { createHealthRoute } from "./routes/health";
import { createHeartbeatRoute } from "./routes/heartbeat";
import { createTelegramRoute } from "./routes/channels/telegram";

export type CreateAppDeps = {
  pinoInstance: Logger;
  jobQueue: JobQueue;
  heartbeatJob: HeartbeatJob;
  board: BoardRepository;
  logger: LoggerPort;
  heartbeatToken?: string;
  channels?: {
    channelJob: ChannelJob;
    startNewSession: StartNewSession;
    channelGateway: ChannelGateway;
    webhookSecret: string;
  };
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
      board: deps.board,
      logger: deps.logger,
      heartbeatToken: deps.heartbeatToken,
    }),
  );

  if (deps.channels) {
    app.route(
      "/",
      createTelegramRoute({
        jobQueue: deps.jobQueue,
        channelJob: deps.channels.channelJob,
        startNewSession: deps.channels.startNewSession,
        channelGateway: deps.channels.channelGateway,
        webhookSecret: deps.channels.webhookSecret,
        logger: deps.logger,
      }),
    );
  }

  return app;
}
