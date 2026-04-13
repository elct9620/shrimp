import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { AiSdkMainAgent } from "../../../src/infrastructure/ai/ai-sdk-main-agent";
import type { MainAgentInput } from "../../../src/use-cases/ports/main-agent";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";

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

type FinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "tool-calls"
  | "error"
  | "other";

function makeModel(finishReason: FinishReason = "stop") {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: "done" }],
      finishReason: { unified: finishReason, raw: undefined },
      usage: {
        inputTokens: {
          total: 0,
          noCache: 0,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 0, text: 0, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

function makeAgent(
  model: MockLanguageModelV3,
  logger: LoggerPort,
  options?: { providerName?: string; reasoningEffort?: string },
) {
  return new AiSdkMainAgent({
    model,
    logger,
    providerName: options?.providerName ?? "test-provider",
    reasoningEffort: options?.reasoningEffort,
  });
}

const baseInput: MainAgentInput = {
  systemPrompt: "You are a helpful assistant.",
  userPrompt: "Complete the task.",
  tools: { my_tool: {} },
  maxSteps: 3,
};

describe("AiSdkMainAgent.run", () => {
  describe("termination reason mapping", () => {
    it("should return finished when model returns stop", async () => {
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger());

      const result = await agent.run(baseInput);

      expect(result.reason).toBe("finished");
    });

    it("should return finished when model returns tool-calls", async () => {
      const model = makeModel("tool-calls");
      const agent = makeAgent(model, makeFakeLogger());

      const result = await agent.run(baseInput);

      expect(result.reason).toBe("finished");
    });

    it("should return maxStepsReached when model returns length", async () => {
      const model = makeModel("length");
      const agent = makeAgent(model, makeFakeLogger());

      const result = await agent.run(baseInput);

      expect(result.reason).toBe("maxStepsReached");
    });

    it("should return error when model returns error", async () => {
      const model = makeModel("error");
      const agent = makeAgent(model, makeFakeLogger());

      const result = await agent.run(baseInput);

      expect(result.reason).toBe("error");
    });

    it("should return error when model returns content-filter", async () => {
      const model = makeModel("content-filter");
      const agent = makeAgent(model, makeFakeLogger());

      const result = await agent.run(baseInput);

      expect(result.reason).toBe("error");
    });

    it("should return error when model returns other", async () => {
      const model = makeModel("other");
      const agent = makeAgent(model, makeFakeLogger());

      const result = await agent.run(baseInput);

      expect(result.reason).toBe("error");
    });
  });

  describe("input passthrough", () => {
    it("should pass systemPrompt as instructions to ToolLoopAgent", async () => {
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger());

      await agent.run({
        ...baseInput,
        systemPrompt: "System instruction here.",
      });

      const callOptions = model.doGenerateCalls[0];
      const systemMessage = callOptions.prompt.find(
        (m: { role: string }) => m.role === "system",
      );
      expect(systemMessage?.content).toBe("System instruction here.");
    });

    it("should pass userPrompt as the user message to ToolLoopAgent", async () => {
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger());

      await agent.run({ ...baseInput, userPrompt: "Do the thing now." });

      const callOptions = model.doGenerateCalls[0];
      const userMessages = callOptions.prompt.filter(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessages.length).toBeGreaterThan(0);
      const firstUser = userMessages[0];
      const content = firstUser.content as Array<{
        type: string;
        text?: string;
      }>;
      const textPart = content.find((p) => p.type === "text");
      expect(textPart?.text).toBe("Do the thing now.");
    });

    it("should pass tools from input to ToolLoopAgent", async () => {
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger());
      const tools = {
        special_tool: { description: "does special things", parameters: {} },
      };

      await agent.run({ ...baseInput, tools });

      const callOptions = model.doGenerateCalls[0];
      expect(callOptions.tools).toBeDefined();
      expect(
        callOptions.tools!.some(
          (t: { name: string }) => t.name === "special_tool",
        ),
      ).toBe(true);
    });
  });

  describe("providerOptions", () => {
    it("should pass providerOptions with reasoningEffort when configured", async () => {
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        providerName: "shrimp",
        reasoningEffort: "high",
      });

      await agent.run(baseInput);

      const callOptions = model.doGenerateCalls[0];
      expect(callOptions.providerOptions).toEqual({
        shrimp: { reasoningEffort: "high" },
      });
    });

    it("should not pass providerOptions when reasoningEffort is undefined", async () => {
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger());

      await agent.run(baseInput);

      const callOptions = model.doGenerateCalls[0];
      expect(callOptions.providerOptions).toBeUndefined();
    });
  });

  describe("independence across calls", () => {
    it("should work correctly when called multiple times", async () => {
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger());

      const result1 = await agent.run(baseInput);
      const result2 = await agent.run({
        ...baseInput,
        userPrompt: "Second call.",
      });

      expect(result1.reason).toBe("finished");
      expect(result2.reason).toBe("finished");
    });
  });

  describe("logging", () => {
    it("should log debug on run start with maxSteps and toolCount", async () => {
      const model = makeModel("stop");
      const logger = makeFakeLogger();
      const agent = makeAgent(model, logger);

      await agent.run({
        ...baseInput,
        maxSteps: 7,
        tools: { a: {}, b: {}, c: {} },
      });

      expect(logger.debug).toHaveBeenCalledWith(
        "main agent run started",
        expect.objectContaining({ maxSteps: 7, toolCount: 3 }),
      );
    });

    it("should log info on successful finish with raw and mapped reason", async () => {
      const model = makeModel("stop");
      const logger = makeFakeLogger();
      const agent = makeAgent(model, logger);

      await agent.run(baseInput);

      expect(logger.info).toHaveBeenCalledWith(
        "main agent run finished",
        expect.objectContaining({ finishReason: "stop", reason: "finished" }),
      );
    });

    it("should log info with mapped maxStepsReached when the model returns length", async () => {
      const model = makeModel("length");
      const logger = makeFakeLogger();
      const agent = makeAgent(model, logger);

      await agent.run(baseInput);

      expect(logger.info).toHaveBeenCalledWith(
        "main agent run finished",
        expect.objectContaining({
          finishReason: "length",
          reason: "maxStepsReached",
        }),
      );
    });

    it("should log error and rethrow when agent.generate throws", async () => {
      const boom = new Error("upstream provider exploded");
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          throw boom;
        },
      });

      const logger = makeFakeLogger();
      const agent = makeAgent(model, logger);

      await expect(agent.run(baseInput)).rejects.toThrow(
        "upstream provider exploded",
      );

      expect(logger.error).toHaveBeenCalledWith(
        "main agent run failed",
        expect.objectContaining({ error: "upstream provider exploded" }),
      );
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
