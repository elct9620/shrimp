import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { AiSdkSummarizePort } from "../../../src/infrastructure/ai/ai-sdk-summarize-port";
import { SESSION_AFFINITY_HEADER } from "../../../src/infrastructure/ai/ai-sdk-shrimp-agent";
import type { SummarizeInput } from "../../../src/use-cases/ports/summarize";
import { makeFakeLogger } from "../../mocks/fake-logger";

function makeModel(text: string = "This is the summary.") {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

function makePort(model: MockLanguageModelV3) {
  return new AiSdkSummarizePort({
    model,
    logger: makeFakeLogger(),
  });
}

const baseInput: SummarizeInput = {
  history: [
    { role: "user", content: "Hello, can you help me?" },
    { role: "assistant", content: "Of course! What do you need?" },
    { role: "user", content: "I need to summarize this conversation." },
    { role: "assistant", content: "Sure, I can do that." },
  ],
  jobId: "00000000-0000-0000-0000-000000000001",
};

describe("AiSdkSummarizePort.summarize", () => {
  describe("success", () => {
    it("should return the model text as the summary string", async () => {
      const model = makeModel("Conversation about summarization assistance.");
      const port = makePort(model);

      const result = await port.summarize(baseInput);

      expect(result).toBe("Conversation about summarization assistance.");
    });

    it("should return the exact text from the model response", async () => {
      const model = makeModel("Short summary.");
      const port = makePort(model);

      const result = await port.summarize(baseInput);

      expect(result).toBe("Short summary.");
    });
  });

  describe("history passthrough", () => {
    it("should pass all history messages to the model in order", async () => {
      const model = makeModel();
      const port = makePort(model);

      await port.summarize(baseInput);

      const callOptions = model.doGenerateCalls[0];
      const roles = callOptions.prompt
        .filter((m: { role: string }) => m.role !== "system")
        .map((m: { role: string }) => m.role);
      expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
    });

    it("should pass the conversation content to the model", async () => {
      const model = makeModel();
      const port = makePort(model);

      await port.summarize(baseInput);

      const callOptions = model.doGenerateCalls[0];
      const userMessages = callOptions.prompt.filter(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessages.length).toBe(2);
      const firstUserContent = userMessages[0].content as Array<{
        type: string;
        text?: string;
      }>;
      const textPart = firstUserContent.find((p) => p.type === "text");
      expect(textPart?.text).toBe("Hello, can you help me?");
    });

    it("should include a system prompt with summarization instruction", async () => {
      const model = makeModel();
      const port = makePort(model);

      await port.summarize(baseInput);

      const callOptions = model.doGenerateCalls[0];
      const systemMessage = callOptions.prompt.find(
        (m: { role: string }) => m.role === "system",
      );
      expect(systemMessage).toBeDefined();
      expect(typeof systemMessage?.content).toBe("string");
      expect((systemMessage?.content as string).length).toBeGreaterThan(0);
    });

    it("should deliver the assembled system prompt (not a bare one-liner)", async () => {
      const model = makeModel();
      const port = makePort(model);

      await port.summarize(baseInput);

      const callOptions = model.doGenerateCalls[0];
      const systemMessage = callOptions.prompt.find(
        (m: { role: string }) => m.role === "system",
      );
      // Sentinel from the summarize variant; assembler-level content is
      // covered in tests/use-cases/prompt-assembler.test.ts.
      expect(systemMessage?.content as string).toContain("## Objective");
    });

    it("should work with an empty history", async () => {
      const model = makeModel("Nothing to summarize.");
      const port = makePort(model);

      const result = await port.summarize({ ...baseInput, history: [] });

      expect(result).toBe("Nothing to summarize.");
    });
  });

  describe("error propagation", () => {
    it("should propagate errors from the model without catching them", async () => {
      const boom = new Error("provider unavailable");
      const failingModel = new MockLanguageModelV3({
        doGenerate: async () => {
          throw boom;
        },
      });
      const port = makePort(failingModel);

      await expect(port.summarize(baseInput)).rejects.toThrow(
        "provider unavailable",
      );
    });

    it("should propagate the exact error instance from the model", async () => {
      const boom = new Error("specific error");
      const failingModel = new MockLanguageModelV3({
        doGenerate: async () => {
          throw boom;
        },
      });
      const port = makePort(failingModel);

      await expect(port.summarize(baseInput)).rejects.toBe(boom);
    });
  });

  describe("no tool calls", () => {
    it("should not pass any tools to the model", async () => {
      const model = makeModel();
      const port = makePort(model);

      await port.summarize(baseInput);

      const callOptions = model.doGenerateCalls[0];
      // tools should be absent — no tool calling for summarization
      expect(callOptions.tools).toBeUndefined();
    });
  });

  describe("jobId isolation", () => {
    it("should not include jobId in any message sent to the model", async () => {
      const model = makeModel();
      const port = makePort(model);
      const jobId = "00000000-0000-0000-0000-000000000099";

      await port.summarize({ ...baseInput, jobId });

      const callOptions = model.doGenerateCalls[0];
      const allText = callOptions.prompt
        .map((m: { role: string; content: unknown }) =>
          typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        )
        .join(" ");
      expect(allText).not.toContain(jobId);
    });
  });

  describe("empty model response", () => {
    it("should return an empty string when the model returns empty text", async () => {
      const model = makeModel("");
      const port = makePort(model);

      const result = await port.summarize(baseInput);

      expect(result).toBe("");
    });
  });

  describe("prompt caching independence", () => {
    it("should NOT include x-session-affinity header in the doGenerate call", async () => {
      // SummarizePort is independent of the Shrimp Agent — it MUST NOT send the
      // session-affinity header that is reserved for Shrimp Agent requests only
      // (see SPEC.md §Prompt Caching / §Independence from Shrimp Agent).
      const model = makeModel();
      const port = makePort(model);

      await port.summarize(baseInput);

      const callOptions = model.doGenerateCalls[0];
      expect(callOptions.headers?.[SESSION_AFFINITY_HEADER]).toBeUndefined();
    });
  });
});
