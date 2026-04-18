import "reflect-metadata";
import "dotenv/config";
import { serve } from "@hono/node-server";
import { container, bootstrap } from "./container";
import { TOKENS } from "./infrastructure/container/tokens";
import { McpToolLoader } from "./infrastructure/mcp/mcp-tool-loader";
import type { HeartbeatJob } from "./use-cases/heartbeat-job";
import type { TelemetryPort } from "./use-cases/ports/telemetry";
import type { ChannelJob } from "./use-cases/channel-job";
import type { StartNewSession } from "./use-cases/start-new-session";
import type { ChannelGateway } from "./use-cases/ports/channel-gateway";
import { createApp } from "./adapters/http/app";

async function main() {
  await bootstrap();

  const logger = container.resolve<
    import("./use-cases/ports/logger").LoggerPort
  >(TOKENS.Logger);
  const env = container.resolve<
    import("./infrastructure/config/env-config").EnvConfig
  >(TOKENS.EnvConfig);
  const mcpToolLoader = container.resolve(McpToolLoader);
  const heartbeatJob = container.resolve<HeartbeatJob>(TOKENS.HeartbeatJob);
  const telemetry = container.resolve<TelemetryPort>(TOKENS.Telemetry);
  // Raw pino instance registered during bootstrap for pino-http middleware
  const pinoInstance = container.resolve<import("pino").Logger>(
    TOKENS.PinoInstance,
  );

  const channels = env.channelsEnabled
    ? {
        channelJob: container.resolve<ChannelJob>(TOKENS.ChannelJob),
        startNewSession: container.resolve<StartNewSession>(
          TOKENS.StartNewSession,
        ),
        channelGateway: container.resolve<ChannelGateway>(
          TOKENS.ChannelGateway,
        ),
        webhookSecret: env.telegramWebhookSecret!,
      }
    : undefined;

  const app = createApp({
    pinoInstance,
    jobQueue: container.resolve(TOKENS.JobQueue),
    heartbeatJob,
    logger: logger.child({ module: "http.heartbeat" }),
    channels,
  });

  const server = serve({ fetch: app.fetch, port: env.port });
  logger.info("server listening", { port: env.port });

  const shutdown = async (signal: string) => {
    logger.info("shutdown signal received", { signal });
    server.close();
    await mcpToolLoader.close();
    try {
      await telemetry.shutdown();
    } catch (err) {
      // Defense-in-depth: TelemetryPort impls already swallow errors,
      // but never let a shutdown error block process exit.
      logger.warn("telemetry shutdown failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    logger.info("server stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  // Bootstrap failure: logger is not yet available. Fall back to stderr.
  console.error("failed to start server:", err);
  process.exit(1);
});
