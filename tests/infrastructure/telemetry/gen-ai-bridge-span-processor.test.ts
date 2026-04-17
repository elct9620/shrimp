import { describe, expect, it } from "vitest";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ROOT_CONTEXT } from "@opentelemetry/api";
import { GenAiBridgeSpanProcessor } from "../../../src/infrastructure/telemetry/gen-ai-bridge-span-processor";

function makeFakeSpan(overrides?: Partial<ReadableSpan>): ReadableSpan {
  return {
    name: "test.span",
    kind: 0,
    spanContext: () => ({
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      traceFlags: 1,
    }),
    startTime: [0, 0],
    endTime: [0, 0],
    status: { code: 0 },
    attributes: {},
    links: [],
    events: [],
    duration: [0, 0],
    ended: true,
    resource: {} as ReadableSpan["resource"],
    instrumentationScope: { name: "test" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  } as unknown as ReadableSpan;
}

/** Runs onEnd and returns a snapshot of the span's attributes. */
function endSpan(
  processor: GenAiBridgeSpanProcessor,
  span: ReadableSpan,
): Record<string, unknown> {
  processor.onEnd(span);
  return { ...span.attributes };
}

describe("GenAiBridgeSpanProcessor", () => {
  it("should instantiate without error", () => {
    expect(() => new GenAiBridgeSpanProcessor()).not.toThrow();
  });

  it("onStart should be a no-op and not throw", () => {
    const processor = new GenAiBridgeSpanProcessor();
    const fakeSpan = makeFakeSpan();
    expect(() =>
      processor.onStart(
        fakeSpan as unknown as Parameters<typeof processor.onStart>[0],
        ROOT_CONTEXT,
      ),
    ).not.toThrow();
  });

  it("onEnd should not throw with a minimal fake ReadableSpan", () => {
    const processor = new GenAiBridgeSpanProcessor();
    const span = makeFakeSpan();
    expect(() => processor.onEnd(span)).not.toThrow();
  });

  it("shutdown should resolve", async () => {
    const processor = new GenAiBridgeSpanProcessor();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });

  it("forceFlush should resolve", async () => {
    const processor = new GenAiBridgeSpanProcessor();
    await expect(processor.forceFlush()).resolves.toBeUndefined();
  });

  describe("tool-call mapping (ai.toolCall → gen_ai.*)", () => {
    it("maps all four gen_ai attrs when span name is ai.toolCall with name and id", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "search_web",
          "ai.toolCall.id": "call_abc123",
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs["gen_ai.operation.name"]).toBe("execute_tool");
      expect(attrs["gen_ai.tool.name"]).toBe("search_web");
      expect(attrs["gen_ai.tool.call.id"]).toBe("call_abc123");
      expect(attrs["gen_ai.tool.type"]).toBe("function");
    });

    it("detects and maps when span has ai.toolCall.name attr but a different span name", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.toolCall.v2", // hypothetical future AI SDK name
        attributes: {
          "ai.toolCall.name": "list_tasks",
          "ai.toolCall.id": "call_xyz789",
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs["gen_ai.operation.name"]).toBe("execute_tool");
      expect(attrs["gen_ai.tool.name"]).toBe("list_tasks");
      expect(attrs["gen_ai.tool.call.id"]).toBe("call_xyz789");
      expect(attrs["gen_ai.tool.type"]).toBe("function");
    });

    it("does NOT add any gen_ai.* attrs for unrelated spans", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.generateText",
        attributes: { "ai.model.id": "gpt-4o" },
      });

      const attrs = endSpan(processor, span);

      expect(attrs).not.toHaveProperty("gen_ai.operation.name");
      expect(attrs).not.toHaveProperty("gen_ai.tool.name");
      expect(attrs).not.toHaveProperty("gen_ai.tool.call.id");
      expect(attrs).not.toHaveProperty("gen_ai.tool.type");
    });

    it("skips gen_ai.tool.call.id when ai.toolCall.id is absent", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "get_weather",
          // ai.toolCall.id intentionally omitted
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs["gen_ai.operation.name"]).toBe("execute_tool");
      expect(attrs["gen_ai.tool.name"]).toBe("get_weather");
      expect(attrs).not.toHaveProperty("gen_ai.tool.call.id");
      expect(attrs["gen_ai.tool.type"]).toBe("function");
    });

    it("preserves existing gen_ai.tool.name when already present", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "new_name",
          "gen_ai.tool.name": "existing_name",
        },
      });

      const attrs = endSpan(processor, span);

      // Must not overwrite the existing value
      expect(attrs["gen_ai.tool.name"]).toBe("existing_name");
    });
  });

  describe("tool-call args/result mapping (ai.toolCall.args/result → gen_ai.tool.call.*)", () => {
    it("maps both arguments and result when both attrs are present", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "search_web",
          "ai.toolCall.args": '{"query":"otel"}',
          "ai.toolCall.result": '{"results":[]}',
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs["gen_ai.tool.call.arguments"]).toBe('{"query":"otel"}');
      expect(attrs["gen_ai.tool.call.result"]).toBe('{"results":[]}');
    });

    it("maps arguments but skips result when ai.toolCall.result is absent (recordOutputs=false)", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "search_web",
          "ai.toolCall.args": '{"query":"otel"}',
          // ai.toolCall.result intentionally absent (recordOutputs=false)
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs["gen_ai.tool.call.arguments"]).toBe('{"query":"otel"}');
      expect(attrs).not.toHaveProperty("gen_ai.tool.call.result");
    });

    it("maps result but skips arguments when ai.toolCall.args is absent (recordInputs=false)", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "search_web",
          // ai.toolCall.args intentionally absent (recordInputs=false)
          "ai.toolCall.result": '{"results":[]}',
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs).not.toHaveProperty("gen_ai.tool.call.arguments");
      expect(attrs["gen_ai.tool.call.result"]).toBe('{"results":[]}');
    });

    it("sets neither gen_ai.tool.call.* when both source attrs are absent", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "search_web",
          // both args and result absent
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs).not.toHaveProperty("gen_ai.tool.call.arguments");
      expect(attrs).not.toHaveProperty("gen_ai.tool.call.result");
    });

    it("does NOT map args/result on non-tool-call spans even when attrs are accidentally present", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.generateText",
        attributes: {
          "ai.toolCall.args": '{"query":"otel"}',
          "ai.toolCall.result": '{"results":[]}',
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs).not.toHaveProperty("gen_ai.tool.call.arguments");
      expect(attrs).not.toHaveProperty("gen_ai.tool.call.result");
    });

    it("preserves existing gen_ai.tool.call.arguments when already present", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "search_web",
          "ai.toolCall.args": '{"query":"new"}',
          "gen_ai.tool.call.arguments": '{"query":"existing"}',
        },
      });

      const attrs = endSpan(processor, span);

      // setIfAbsent must not overwrite the pre-existing value
      expect(attrs["gen_ai.tool.call.arguments"]).toBe('{"query":"existing"}');
    });
  });

  describe("chat span mapping (ai.generateText.doGenerate / ai.streamText.doStream → gen_ai.*)", () => {
    it("maps operation.name=chat and provider.name for ai.generateText.doGenerate with gen_ai.system", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: { "gen_ai.system": "openai" },
      });

      const attrs = endSpan(processor, span);

      expect(attrs["gen_ai.operation.name"]).toBe("chat");
      expect(attrs["gen_ai.provider.name"]).toBe("openai");
    });

    it("maps operation.name=chat and provider.name for ai.streamText.doStream with gen_ai.system", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.streamText.doStream",
        attributes: { "gen_ai.system": "anthropic" },
      });

      const attrs = endSpan(processor, span);

      expect(attrs["gen_ai.operation.name"]).toBe("chat");
      expect(attrs["gen_ai.provider.name"]).toBe("anthropic");
    });

    it("sets operation.name=chat but skips provider.name when gen_ai.system is absent", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: { "gen_ai.request.model": "gpt-4o" },
      });

      const attrs = endSpan(processor, span);

      expect(attrs["gen_ai.operation.name"]).toBe("chat");
      expect(attrs).not.toHaveProperty("gen_ai.provider.name");
    });

    it("skips chat mapping for the orchestration wrapper ai.generateText (not an LLM-call span)", () => {
      const processor = new GenAiBridgeSpanProcessor();
      // ai.generateText is the outer wrapper; AI SDK does NOT set gen_ai.system on it.
      const span = makeFakeSpan({
        name: "ai.generateText",
        attributes: {},
      });

      const attrs = endSpan(processor, span);

      // Chat translator must not fire; tool-call translator also does not fire.
      expect(attrs).not.toHaveProperty("gen_ai.operation.name");
      expect(attrs).not.toHaveProperty("gen_ai.provider.name");
    });

    it("does NOT apply chat mapping to tool-call spans (tool-call translator still runs)", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "search_web",
          "ai.toolCall.id": "call_abc",
        },
      });

      const attrs = endSpan(processor, span);

      // Tool-call translator sets execute_tool, not chat.
      expect(attrs["gen_ai.operation.name"]).toBe("execute_tool");
      expect(attrs).not.toHaveProperty("gen_ai.provider.name");
    });

    it("preserves pre-existing gen_ai.operation.name via setIfAbsent", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: {
          "gen_ai.system": "openai",
          "gen_ai.operation.name": "text_completion", // hypothetical pre-set value
        },
      });

      const attrs = endSpan(processor, span);

      // setIfAbsent must not overwrite the pre-existing value.
      expect(attrs["gen_ai.operation.name"]).toBe("text_completion");
      // provider.name is still mirrored since it was absent.
      expect(attrs["gen_ai.provider.name"]).toBe("openai");
    });
  });
});
