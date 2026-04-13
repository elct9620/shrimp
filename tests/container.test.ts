import { container } from "tsyringe";
import type { DependencyContainer } from "tsyringe";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import type { LanguageModel } from "ai";
import { setupServer } from "msw/node";
import { TOKENS } from "../src/infrastructure/container/tokens";
import {
  EnvConfigError,
  loadEnvConfig,
} from "../src/infrastructure/config/env-config";
import { McpToolLoader } from "../src/infrastructure/mcp/mcp-tool-loader";
import type { McpClientFactory } from "../src/infrastructure/mcp/mcp-tool-loader";
import { ProcessingCycle } from "../src/use-cases/processing-cycle";
import type { LoggerPort } from "../src/use-cases/ports/logger";
import { createApp } from "../src/adapters/http/app";
import type { EnvConfig } from "../src/infrastructure/config/env-config";
import { BuiltInToolFactory } from "../src/adapters/tools/built-in-tool-factory";
import { ToolProviderFactoryImpl } from "../src/adapters/tools/tool-provider-factory-impl";
import { createPinoLogger } from "../src/infrastructure/logger/pino-logger";
import { todoistHandlers } from "./mocks/todoist-handlers";

// Trigger module-level factory registrations on the root container
import "../src/container";

// ---------------------------------------------------------------------------
// MSW server — intercepts Todoist REST API calls at the HTTP boundary
// ---------------------------------------------------------------------------

const server = setupServer(...todoistHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Mock factories for external boundaries
// ---------------------------------------------------------------------------

function makeFakeLanguageModel(): LanguageModel {
  return {
    specificationVersion: "v1",
    provider: "test",
    modelId: "test-model",
    defaultObjectGenerationMode: undefined,
    doGenerate: vi.fn().mockResolvedValue({
      text: "",
      usage: {},
      finishReason: "stop",
      rawResponse: { headers: {} },
      warnings: [],
    }),
    doStream: vi.fn(),
  } as unknown as LanguageModel;
}

function makeFakeLogger(): LoggerPort {
  const logger: LoggerPort = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

function makeSilentPinoInstance() {
  return createPinoLogger({ level: "silent", pretty: false }).pino;
}

function makeTestEnvConfig(): EnvConfig {
  return {
    openAiBaseUrl: "http://localhost:11434/v1",
    openAiApiKey: "dummy-key",
    aiModel: "test-model",
    aiMaxSteps: 50,
    todoistApiToken: "todoist-token",
    todoistProjectId: "project-123",
    port: 3000,
    logLevel: "silent",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Register all external-boundary mocks into a child container so that
 * factory-wired components (BoardRepository, MainAgent, etc.) can resolve
 * their scalar dependencies from the child.
 */
function registerMockDeps(child: DependencyContainer): void {
  child.registerInstance(TOKENS.EnvConfig, makeTestEnvConfig());
  child.registerInstance(TOKENS.Logger, makeFakeLogger());
  child.registerInstance(TOKENS.LanguageModel, makeFakeLanguageModel());
  const stubFactory: McpClientFactory = vi
    .fn()
    .mockRejectedValue(new Error("stub"));
  child.registerInstance(TOKENS.McpClientFactory, stubFactory);
  child.registerInstance(TOKENS.McpConfig, { mcpServers: {} });
  // ToolProviderFactory: register a factory using real implementation with empty MCP tools
  child.register(TOKENS.ToolProviderFactory, {
    useFactory: (c) =>
      new ToolProviderFactoryImpl(
        c.resolve(BuiltInToolFactory),
        {},
        [],
        c.resolve<LoggerPort>(TOKENS.Logger).child({ module: "ToolRegistry" }),
      ),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const REQUIRED_ENV = {
  OPENAI_BASE_URL: "http://localhost:11434/v1",
  OPENAI_API_KEY: "dummy-key",
  AI_MODEL: "test-model",
  TODOIST_API_TOKEN: "todoist-token",
  TODOIST_PROJECT_ID: "project-123",
  LOG_LEVEL: "silent",
};

describe("container integration", () => {
  let child: DependencyContainer;

  beforeEach(() => {
    child = container.createChildContainer();
  });

  afterEach(() => {
    child.dispose();
    vi.unstubAllEnvs();
  });

  describe("HTTP routes", () => {
    it("should respond 200 to GET /health", async () => {
      registerMockDeps(child);

      const taskQueue = child.resolve<
        import("../src/use-cases/ports/task-queue").TaskQueue
      >(TOKENS.TaskQueue);
      const processingCycle = child.resolve(ProcessingCycle);
      const app = createApp({
        pinoInstance: makeSilentPinoInstance(),
        taskQueue,
        processingCycle,
        logger: child.resolve<LoggerPort>(TOKENS.Logger),
      });

      const res = await app.request("/health", { method: "GET" });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });

    it("should respond 202 to POST /heartbeat", async () => {
      registerMockDeps(child);

      const taskQueue = child.resolve<
        import("../src/use-cases/ports/task-queue").TaskQueue
      >(TOKENS.TaskQueue);
      const processingCycle = child.resolve(ProcessingCycle);
      const app = createApp({
        pinoInstance: makeSilentPinoInstance(),
        taskQueue,
        processingCycle,
        logger: child.resolve<LoggerPort>(TOKENS.Logger),
      });

      const res = await app.request("/heartbeat", { method: "POST" });

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ status: "accepted" });
    });
  });

  describe("container wiring", () => {
    it("should resolve ProcessingCycle with all dependencies satisfied", () => {
      registerMockDeps(child);

      expect(() => child.resolve(ProcessingCycle)).not.toThrow();
    });

    it("should resolve McpToolLoader whose close() can be called without throwing", async () => {
      registerMockDeps(child);

      const mcpToolLoader = child.resolve(McpToolLoader);

      await expect(mcpToolLoader.close()).resolves.toBeUndefined();
    });
  });

  describe("env config", () => {
    it("should throw EnvConfigError when required env vars are missing", () => {
      // All env vars absent — loadEnvConfig reads process.env
      expect(() => loadEnvConfig({})).toThrow(EnvConfigError);
    });

    it("should load env config successfully when all required vars are present", () => {
      for (const [key, value] of Object.entries(REQUIRED_ENV)) {
        vi.stubEnv(key, value);
      }

      expect(() => loadEnvConfig()).not.toThrow();
    });
  });
});
