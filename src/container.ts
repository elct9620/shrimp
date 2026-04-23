import { container } from "tsyringe";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TOKENS } from "./infrastructure/container/tokens";
import {
  loadEnvConfig,
  type EnvConfig,
} from "./infrastructure/config/env-config";
import {
  loadMcpConfig,
  type McpConfig,
} from "./infrastructure/config/mcp-config";
import { createTelemetry } from "./infrastructure/telemetry/telemetry-factory";
import { TodoistApi } from "@doist/todoist-sdk";
import { TodoistBoardRepository } from "./infrastructure/todoist/todoist-board-repository";
import { AiSdkShrimpAgent } from "./infrastructure/ai/ai-sdk-shrimp-agent";
import { deriveGenAiProviderName } from "./infrastructure/ai/provider-name";
import { AiSdkSummarizePort } from "./infrastructure/ai/ai-sdk-summarize-port";
import {
  McpToolLoader,
  createMcpClient,
} from "./infrastructure/mcp/mcp-tool-loader";
import { InMemoryJobQueue } from "./infrastructure/queue/in-memory-job-queue";
import { BuiltInToolFactory } from "./adapters/tools/built-in-tool-factory";
import { ToolProviderFactoryImpl } from "./adapters/tools/tool-provider-factory-impl";
import { HeartbeatJob } from "./use-cases/heartbeat-job";
import { NoopChannelGateway } from "./infrastructure/channel/noop-channel-gateway";
import { TelegramChannel } from "./infrastructure/channel/telegram-channel";
import { JsonlSessionRepository } from "./infrastructure/session/jsonl-session-repository";
import { FileSkillRepository } from "./infrastructure/skill/file-skill-repository";
import { FileUserAgents } from "./infrastructure/prompt/file-user-agents";
import { ChannelJob } from "./use-cases/channel-job";
import { StartNewSession } from "./use-cases/start-new-session";
import { createPinoLogger } from "./infrastructure/logger/pino-logger";
import type { BoardRepository } from "./use-cases/ports/board-repository";
import type { LoggerPort } from "./use-cases/ports/logger";
import type { ShrimpAgent } from "./use-cases/ports/shrimp-agent";
import type { TelemetryPort } from "./use-cases/ports/telemetry";
import type { Tracer } from "@opentelemetry/api";
import type { ToolDescription } from "./use-cases/ports/tool-description";

// ---------------------------------------------------------------------------
// Module-level factory registrations (sync — lazy until resolved)
// Note: FactoryProvider does not support Lifecycle.Singleton in tsyringe;
// factories are called each resolve. In production, each token is resolved
// once in main(), so effective behaviour is singleton.
// ---------------------------------------------------------------------------

// BoardRepository: scalar deps resolved from container at resolve time
container.register(TOKENS.BoardRepository, {
  useFactory: (c) => {
    const env = c.resolve<EnvConfig>(TOKENS.EnvConfig);
    const logger = c.resolve<LoggerPort>(TOKENS.Logger);
    return new TodoistBoardRepository(
      new TodoistApi(env.todoistApiToken),
      env.todoistProjectId,
      logger.child({ module: "TodoistBoardRepository" }),
    );
  },
});

// SkillCatalog — scans Built-in and Custom roots at resolve time
container.register(TOKENS.SkillCatalog, {
  useFactory: (c) => {
    const env = c.resolve<EnvConfig>(TOKENS.EnvConfig);
    const logger = c.resolve<LoggerPort>(TOKENS.Logger);
    return new FileSkillRepository(
      env.skillsBuiltInRoot,
      env.skillsCustomRoot,
      logger,
    );
  },
});

// ShrimpAgent — registered via useFactory to pass provider-specific options
container.register(TOKENS.ShrimpAgent, {
  useFactory: (c) => {
    const env = c.resolve<EnvConfig>(TOKENS.EnvConfig);
    return new AiSdkShrimpAgent({
      model: c.resolve(TOKENS.LanguageModel),
      logger: c.resolve<LoggerPort>(TOKENS.Logger),
      providerName: deriveGenAiProviderName(env.openAiBaseUrl),
      reasoningEffort: env.aiReasoningEffort,
      tracer: c.resolve<Tracer>(TOKENS.Tracer),
      recordInputs: env.telemetryRecordInputs,
      recordOutputs: env.telemetryRecordOutputs,
    });
  },
});

// JobQueue
container.register(TOKENS.JobQueue, { useClass: InMemoryJobQueue });

// HeartbeatJob — Use Case: registered via useFactory, no @inject
container.register(TOKENS.HeartbeatJob, {
  useFactory: (c) =>
    new HeartbeatJob({
      board: c.resolve<BoardRepository>(TOKENS.BoardRepository),
      shrimpAgent: c.resolve<ShrimpAgent>(TOKENS.ShrimpAgent),
      toolProviderFactory: c.resolve(TOKENS.ToolProviderFactory),
      maxSteps: c.resolve<EnvConfig>(TOKENS.EnvConfig).aiMaxSteps,
      logger: c
        .resolve<LoggerPort>(TOKENS.Logger)
        .child({ module: "HeartbeatJob" }),
      telemetry: c.resolve<TelemetryPort>(TOKENS.Telemetry),
      userAgents: c.resolve(TOKENS.UserAgents),
      skillCatalog: c.resolve(TOKENS.SkillCatalog),
    }),
});

export { container };

// ---------------------------------------------------------------------------
// Async bootstrap: runtime values + MCP load
// ---------------------------------------------------------------------------

export async function bootstrap(): Promise<void> {
  // 1. Env config — fails fast with EnvConfigError if required vars are missing
  const env = loadEnvConfig();
  container.registerInstance(TOKENS.EnvConfig, env);

  // 2. Logger
  const { logger, pino: pinoInstance } = createPinoLogger({
    level: env.logLevel,
    pretty: process.env.NODE_ENV !== "production",
  });
  container.registerInstance(TOKENS.Logger, logger);
  // Store raw pino instance for HTTP middleware
  container.registerInstance(TOKENS.PinoInstance, pinoInstance);

  // 2a. UserAgents — reads optional $SHRIMP_HOME/AGENTS.md (appended to system prompt)
  container.registerInstance(
    TOKENS.UserAgents,
    new FileUserAgents({
      home: env.shrimpHome,
      logger: logger.child({ module: "FileUserAgents" }),
    }),
  );

  logger.info("env config loaded", {
    logLevel: env.logLevel,
    port: env.port,
    aiMaxSteps: env.aiMaxSteps,
  });

  // 3. Telemetry — initialize before HTTP server accepts heartbeats (SPEC §Initialization ordering)
  const { telemetry, tracer } = createTelemetry(env, logger);
  container.registerInstance(TOKENS.Telemetry, telemetry);
  container.registerInstance(TOKENS.Tracer, tracer);
  logger.info("telemetry initialized", { enabled: env.telemetryEnabled });

  // 3a. Language model provider — created here so both TOKENS.LanguageModel and
  // channel-only registrations (SummarizePort) can share the same provider instance.
  const provider = createOpenAICompatible({
    name: "shrimp",
    baseURL: env.openAiBaseUrl,
    apiKey: env.openAiApiKey,
  });

  // 3b. ChannelGateway — TelegramChannel when enabled, NoopChannelGateway otherwise.
  // Registered before step 8 (ToolProviderFactory) so BuiltInToolFactory can resolve it.
  if (env.channelsEnabled) {
    container.register(TOKENS.ChannelGateway, {
      useFactory: () =>
        new TelegramChannel(
          env.telegramBotToken!,
          logger.child({ module: "TelegramChannel" }),
        ),
    });

    // SessionRepository
    container.register(TOKENS.SessionRepository, {
      useFactory: (c) =>
        new JsonlSessionRepository({
          stateDir: env.shrimpHome,
          logger: c
            .resolve<LoggerPort>(TOKENS.Logger)
            .child({ module: "JsonlSessionRepository" }),
        }),
    });

    // ChannelJob
    container.register(TOKENS.ChannelJob, {
      useFactory: (c) =>
        new ChannelJob({
          sessionRepository: c.resolve(TOKENS.SessionRepository),
          channelGateway: c.resolve(TOKENS.ChannelGateway),
          shrimpAgent: c.resolve<ShrimpAgent>(TOKENS.ShrimpAgent),
          toolProviderFactory: c.resolve(TOKENS.ToolProviderFactory),
          maxSteps: env.aiMaxSteps,
          logger: c
            .resolve<LoggerPort>(TOKENS.Logger)
            .child({ module: "ChannelJob" }),
          telemetry: c.resolve<TelemetryPort>(TOKENS.Telemetry),
          userAgents: c.resolve(TOKENS.UserAgents),
          skillCatalog: c.resolve(TOKENS.SkillCatalog),
          summarize: c.resolve(TOKENS.Summarize),
          compactionThreshold: env.autoCompactTokenThreshold!,
        }),
    });

    // StartNewSession
    container.register(TOKENS.StartNewSession, {
      useFactory: (c) =>
        new StartNewSession(
          c.resolve(TOKENS.SessionRepository),
          c
            .resolve<LoggerPort>(TOKENS.Logger)
            .child({ module: "StartNewSession" }),
        ),
    });

    // SummarizePort — uses AUTO_COMPACT_MODEL when set, falls back to AI_MODEL
    container.register(TOKENS.Summarize, {
      useFactory: (c) =>
        new AiSdkSummarizePort({
          model: provider.chatModel(env.autoCompactModel ?? env.aiModel),
          logger: c.resolve<LoggerPort>(TOKENS.Logger),
          maxOutputTokens: env.autoCompactMaxOutputTokens,
        }),
    });

    logger.info("channel feature enabled", { gateway: "telegram" });
  } else {
    container.register(TOKENS.ChannelGateway, {
      useFactory: (c) =>
        new NoopChannelGateway(
          c
            .resolve<LoggerPort>(TOKENS.Logger)
            .child({ module: "NoopChannelGateway" }),
        ),
    });
  }

  // 4. Language model
  container.registerInstance(
    TOKENS.LanguageModel,
    provider.chatModel(env.aiModel),
  );

  // 5. MCP client factory
  container.registerInstance(TOKENS.McpClientFactory, createMcpClient);

  // 6. MCP config — absent file is explicitly allowed per SPEC §Deployment §Rules
  let mcpConfig: McpConfig = { mcpServers: {} };
  try {
    mcpConfig = loadMcpConfig(".mcp.json");
    logger.info("mcp config loaded", {
      serverCount: Object.keys(mcpConfig.mcpServers).length,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("failed to load mcp config", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    logger.debug("no .mcp.json found — continuing without mcp servers");
  }
  container.registerInstance(TOKENS.McpConfig, mcpConfig);

  // 7. MCP tool loading (async — result consumed by ToolProviderFactory)
  const mcpToolLoader = container.resolve(McpToolLoader);
  let mcpTools: Record<string, unknown> = {};
  let mcpDescriptions: ToolDescription[] = [];
  try {
    const result = await mcpToolLoader.load(mcpConfig);
    mcpTools = result.tools;
    mcpDescriptions = result.descriptions;
  } catch {
    // Per SPEC §Failure Handling: if loading fails entirely, run with built-in tools only
  }

  // 8. ToolProviderFactory — needs async MCP results captured in closure
  container.register(TOKENS.ToolProviderFactory, {
    useFactory: (c) =>
      new ToolProviderFactoryImpl(
        c.resolve(BuiltInToolFactory),
        mcpTools,
        mcpDescriptions,
        c.resolve<LoggerPort>(TOKENS.Logger).child({ module: "ToolRegistry" }),
      ),
  });
}
