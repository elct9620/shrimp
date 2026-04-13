import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
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

// Minimal LanguageModelV2 stub — fulfills the v2 interface without calling any live API.
// LanguageModel = LanguageModelV3 | LanguageModelV2 | GlobalProviderModelId; the v2 shape
// is identified by specificationVersion: 'v2'.
function makeModel(finishReason: FinishReason = "stop") {
  const doGenerate = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "done" }],
    finishReason,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
  });

  const model = {
    specificationVersion: "v2" as const,
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},
    doGenerate,
    doStream: async () => {
      throw new Error("streaming not needed");
    },
  } satisfies LanguageModel;

  return { model, doGenerate };
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
      const { model } = makeModel("stop");
      const loop = new AiSdkMainAgent(model, makeFakeLogger());

      const result = await loop.run(baseInput);

      expect(result.reason).toBe("finished");
    });

    it("should return finished when model returns tool-calls", async () => {
      const { model } = makeModel("tool-calls");
      const loop = new AiSdkMainAgent(model, makeFakeLogger());

      const result = await loop.run(baseInput);

      expect(result.reason).toBe("finished");
    });

    it("should return maxStepsReached when model returns length", async () => {
      const { model } = makeModel("length");
      const loop = new AiSdkMainAgent(model, makeFakeLogger());

      const result = await loop.run(baseInput);

      expect(result.reason).toBe("maxStepsReached");
    });

    it("should return error when model returns error", async () => {
      const { model } = makeModel("error");
      const loop = new AiSdkMainAgent(model, makeFakeLogger());

      const result = await loop.run(baseInput);

      expect(result.reason).toBe("error");
    });

    it("should return error when model returns content-filter", async () => {
      const { model } = makeModel("content-filter");
      const loop = new AiSdkMainAgent(model, makeFakeLogger());

      const result = await loop.run(baseInput);

      expect(result.reason).toBe("error");
    });

    it("should return error when model returns other", async () => {
      const { model } = makeModel("other");
      const loop = new AiSdkMainAgent(model, makeFakeLogger());

      const result = await loop.run(baseInput);

      expect(result.reason).toBe("error");
    });
  });

  describe("input passthrough", () => {
    it("should pass systemPrompt as instructions to ToolLoopAgent", async () => {
      const { model, doGenerate } = makeModel("stop");
      const loop = new AiSdkMainAgent(model, makeFakeLogger());

      await loop.run({
        ...baseInput,
        systemPrompt: "System instruction here.",
      });

      const callOptions = doGenerate.mock.calls[0][0];
      // AI SDK v6 encodes instructions as a system-role message in the prompt array
      const systemMessage = callOptions.prompt.find(
        (m: { role: string }) => m.role === "system",
      );
      expect(systemMessage?.content).toBe("System instruction here.");
    });

    it("should pass userPrompt as the user message to ToolLoopAgent", async () => {
      const { model, doGenerate } = makeModel("stop");
      const loop = new AiSdkMainAgent(model, makeFakeLogger());

      await loop.run({ ...baseInput, userPrompt: "Do the thing now." });

      const callOptions = doGenerate.mock.calls[0][0];
      const userMessages = callOptions.prompt.filter(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessages.length).toBeGreaterThan(0);
      const firstUser = userMessages[0];
      const textPart = firstUser.content.find(
        (p: { type: string }) => p.type === "text",
      ) as { type: "text"; text: string } | undefined;
      expect(textPart?.text).toBe("Do the thing now.");
    });

    it("should pass tools from input to ToolLoopAgent", async () => {
      const { model, doGenerate } = makeModel("stop");
      const loop = new AiSdkMainAgent(model, makeFakeLogger());
      const tools = {
        special_tool: { description: "does special things", parameters: {} },
      };

      await loop.run({ ...baseInput, tools });

      const callOptions = doGenerate.mock.calls[0][0];
      expect(callOptions.tools).toBeDefined();
      expect(
        callOptions.tools!.some(
          (t: { name: string }) => t.name === "special_tool",
        ),
      ).toBe(true);
    });
  });

  describe("independence across calls", () => {
    it("should work correctly when called multiple times", async () => {
      const { model } = makeModel("stop");
      const loop = new AiSdkMainAgent(model, makeFakeLogger());

      const result1 = await loop.run(baseInput);
      const result2 = await loop.run({
        ...baseInput,
        userPrompt: "Second call.",
      });

      expect(result1.reason).toBe("finished");
      expect(result2.reason).toBe("finished");
    });
  });

  describe("logging", () => {
    it("should log debug on run start with maxSteps and toolCount", async () => {
      const { model } = makeModel("stop");
      const logger = makeFakeLogger();
      const loop = new AiSdkMainAgent(model, logger);

      await loop.run({
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
      const { model } = makeModel("stop");
      const logger = makeFakeLogger();
      const loop = new AiSdkMainAgent(model, logger);

      await loop.run(baseInput);

      expect(logger.info).toHaveBeenCalledWith(
        "main agent run finished",
        expect.objectContaining({ finishReason: "stop", reason: "finished" }),
      );
    });

    it("should log info with mapped maxStepsReached when the model returns length", async () => {
      const { model } = makeModel("length");
      const logger = makeFakeLogger();
      const loop = new AiSdkMainAgent(model, logger);

      await loop.run(baseInput);

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
      const doGenerate = vi.fn().mockRejectedValue(boom);
      const model = {
        specificationVersion: "v2" as const,
        provider: "test",
        modelId: "test-model",
        supportedUrls: {},
        doGenerate,
        doStream: async () => {
          throw new Error("streaming not needed");
        },
      } satisfies LanguageModel;

      const logger = makeFakeLogger();
      const loop = new AiSdkMainAgent(model, logger);

      await expect(loop.run(baseInput)).rejects.toThrow(
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
