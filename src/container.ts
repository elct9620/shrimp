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
import {
  McpToolLoader,
  createMcpClient,
} from "./infrastructure/mcp/mcp-tool-loader";
import { InMemoryTaskQueue } from "./infrastructure/queue/in-memory-task-queue";
import { BuiltInToolFactory } from "./adapters/tools/built-in-tool-factory";
import { ToolProviderFactoryImpl } from "./adapters/tools/tool-provider-factory-impl";
import { Job } from "./use-cases/job";
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

// ShrimpAgent — registered via useFactory to pass provider-specific options
container.register(TOKENS.ShrimpAgent, {
  useFactory: (c) => {
    const env = c.resolve<EnvConfig>(TOKENS.EnvConfig);
    return new AiSdkShrimpAgent({
      model: c.resolve(TOKENS.LanguageModel),
      logger: c.resolve<LoggerPort>(TOKENS.Logger),
      providerName: "shrimp",
      reasoningEffort: env.aiReasoningEffort,
      tracer: c.resolve<Tracer>(TOKENS.Tracer),
      recordInputs: env.telemetryRecordInputs,
      recordOutputs: env.telemetryRecordOutputs,
    });
  },
});

// TaskQueue
container.register(TOKENS.TaskQueue, { useClass: InMemoryTaskQueue });

// Job — Use Case: registered via useFactory, no @inject
container.register(Job, {
  useFactory: (c) =>
    new Job({
      board: c.resolve<BoardRepository>(TOKENS.BoardRepository),
      mainAgent: c.resolve<ShrimpAgent>(TOKENS.ShrimpAgent),
      toolProviderFactory: c.resolve(TOKENS.ToolProviderFactory),
      maxSteps: c.resolve<EnvConfig>(TOKENS.EnvConfig).aiMaxSteps,
      logger: c.resolve<LoggerPort>(TOKENS.Logger).child({ module: "Job" }),
      telemetry: c.resolve<TelemetryPort>(TOKENS.Telemetry),
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

  // 4. Language model
  const provider = createOpenAICompatible({
    name: "shrimp",
    baseURL: env.openAiBaseUrl,
    apiKey: env.openAiApiKey,
  });
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
