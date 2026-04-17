import { describe, expect, it } from "vitest";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ROOT_CONTEXT } from "@opentelemetry/api";
import {
  GenAiBridgeSpanProcessor,
  toGenAiInputMessages,
  toGenAiOutputMessages,
} from "../../../src/infrastructure/telemetry/gen-ai-bridge-span-processor";

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

  // ---------------------------------------------------------------------------
  // Pure transform unit tests
  // ---------------------------------------------------------------------------

  describe("toGenAiInputMessages (pure transform)", () => {
    it("maps system and user messages with string content to single text parts", () => {
      const result = toGenAiInputMessages([
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello!" },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        role: "system",
        parts: [{ type: "text", content: "You are helpful." }],
      });
      expect(result[1]).toEqual({
        role: "user",
        parts: [{ type: "text", content: "Hello!" }],
      });
    });

    it("maps user message with string content to a single text part", () => {
      const result = toGenAiInputMessages([
        { role: "user", content: "What is the weather?" },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]!.parts).toEqual([
        { type: "text", content: "What is the weather?" },
      ]);
    });

    it("maps assistant message with mixed text and tool-call array content", () => {
      const result = toGenAiInputMessages([
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check that." },
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "search",
              input: { query: "weather" },
            },
          ],
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]!.parts).toEqual([
        { type: "text", content: "Let me check that." },
        {
          type: "tool_call",
          id: "call_1",
          name: "search",
          arguments: { query: "weather" },
        },
      ]);
    });

    it("maps tool message with tool-result content to tool_call_response part", () => {
      const result = toGenAiInputMessages([
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "search",
              output: { results: ["cloudy"] },
            },
          ],
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]!.parts).toEqual([
        {
          type: "tool_call_response",
          id: "call_1",
          response: { results: ["cloudy"] },
        },
      ]);
    });

    it("drops unknown part types (e.g. reasoning) silently; message still emitted when other parts remain", () => {
      const result = toGenAiInputMessages([
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Let me think..." },
            { type: "text", text: "The answer is 42." },
          ],
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]!.parts).toEqual([
        { type: "text", content: "The answer is 42." },
      ]);
    });

    it("drops the whole message when all parts are unknown types", () => {
      const result = toGenAiInputMessages([
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Just thinking..." },
            { type: "file", text: "some-file-data" },
          ],
        },
      ]);

      expect(result).toHaveLength(0);
    });

    it("passes tool-call arguments through as objects, not re-stringified", () => {
      const args = { query: "otel", limit: 10 };
      const result = toGenAiInputMessages([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "search",
              input: args,
            },
          ],
        },
      ]);

      // arguments must be the original object, not JSON.stringify(args)
      expect(result[0]!.parts[0]).toMatchObject({
        type: "tool_call",
        arguments: { query: "otel", limit: 10 },
      });
    });
  });

  describe("toGenAiOutputMessages (pure transform)", () => {
    it("produces an assistant text part when only text is present", () => {
      const result = toGenAiOutputMessages("Hello, world!", []);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "assistant",
        parts: [{ type: "text", content: "Hello, world!" }],
      });
    });

    it("produces tool_call parts when only toolCalls are present (no text)", () => {
      const toolCalls = [
        { toolCallId: "c1", toolName: "search", input: { q: "otel" } },
      ];
      const result = toGenAiOutputMessages(undefined, toolCalls);

      expect(result).toHaveLength(1);
      expect(result[0]!.parts).toEqual([
        {
          type: "tool_call",
          id: "c1",
          name: "search",
          arguments: { q: "otel" },
        },
      ]);
    });

    it("produces both text and tool_call parts when both are present", () => {
      const toolCalls = [
        { toolCallId: "c2", toolName: "lookup", input: { id: 5 } },
      ];
      const result = toGenAiOutputMessages("Here you go.", toolCalls);

      expect(result).toHaveLength(1);
      const parts = result[0]!.parts;
      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({ type: "text", content: "Here you go." });
      expect(parts[1]).toMatchObject({ type: "tool_call", id: "c2" });
    });

    it("returns empty array when both text and toolCalls are absent", () => {
      expect(toGenAiOutputMessages(undefined, [])).toHaveLength(0);
      expect(toGenAiOutputMessages(null, [])).toHaveLength(0);
      expect(toGenAiOutputMessages("", [])).toHaveLength(0);
    });

    it("passes tool-call arguments through as objects, not re-stringified", () => {
      const result = toGenAiOutputMessages(undefined, [
        { toolCallId: "c3", toolName: "run", input: { x: 1 } },
      ]);

      expect(result[0]!.parts[0]).toMatchObject({
        type: "tool_call",
        arguments: { x: 1 },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Integration tests: structured messages on real span flow
  // ---------------------------------------------------------------------------

  describe("structured messages (gen_ai.input.messages / gen_ai.output.messages)", () => {
    it("sets gen_ai.input.messages from ai.prompt.messages on a chat span", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const messages = [
        { role: "system", content: "Be helpful." },
        { role: "user", content: "Hi" },
      ];
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: { "ai.prompt.messages": JSON.stringify(messages) },
      });

      const attrs = endSpan(processor, span);

      const parsed = JSON.parse(attrs["gen_ai.input.messages"] as string);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].role).toBe("system");
      expect(parsed[1].role).toBe("user");
    });

    it("sets gen_ai.output.messages from ai.response.text on a chat span", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: { "ai.response.text": "The answer is 42." },
      });

      const attrs = endSpan(processor, span);

      const parsed = JSON.parse(attrs["gen_ai.output.messages"] as string);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].role).toBe("assistant");
      expect(parsed[0].parts).toEqual([
        { type: "text", content: "The answer is 42." },
      ]);
    });

    it("sets gen_ai.output.messages from ai.response.toolCalls on a chat span (no text)", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const toolCalls = [
        { toolCallId: "c1", toolName: "search", input: { q: "x" } },
      ];
      const span = makeFakeSpan({
        name: "ai.streamText.doStream",
        attributes: { "ai.response.toolCalls": JSON.stringify(toolCalls) },
      });

      const attrs = endSpan(processor, span);

      const parsed = JSON.parse(attrs["gen_ai.output.messages"] as string);
      expect(parsed[0].parts[0].type).toBe("tool_call");
      expect(attrs).not.toHaveProperty("gen_ai.input.messages");
    });

    it("does NOT set gen_ai.output.messages when both response attrs are absent (recordOutputs=false)", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: {
          "ai.prompt.messages": JSON.stringify([
            { role: "user", content: "hi" },
          ]),
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs).toHaveProperty("gen_ai.input.messages");
      expect(attrs).not.toHaveProperty("gen_ai.output.messages");
    });

    it("does NOT set gen_ai.input.messages when ai.prompt.messages is absent (recordInputs=false)", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: { "ai.response.text": "Sure!" },
      });

      const attrs = endSpan(processor, span);

      expect(attrs).not.toHaveProperty("gen_ai.input.messages");
      expect(attrs).toHaveProperty("gen_ai.output.messages");
    });

    it("silently skips gen_ai.input.messages when ai.prompt.messages is malformed JSON", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: { "ai.prompt.messages": "not-json{{{" },
      });

      expect(() => processor.onEnd(span)).not.toThrow();
      expect(span.attributes).not.toHaveProperty("gen_ai.input.messages");
    });

    it("does NOT invoke message translation on non-chat spans", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const messages = [{ role: "user", content: "hi" }];
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "search",
          "ai.prompt.messages": JSON.stringify(messages),
          "ai.response.text": "Sure!",
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs).not.toHaveProperty("gen_ai.input.messages");
      expect(attrs).not.toHaveProperty("gen_ai.output.messages");
    });

    it("preserves pre-existing gen_ai.input.messages via setIfAbsent", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const existing = JSON.stringify([
        { role: "user", parts: [{ type: "text", content: "pre-set" }] },
      ]);
      const messages = [{ role: "user", content: "override-attempt" }];
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: {
          "ai.prompt.messages": JSON.stringify(messages),
          "gen_ai.input.messages": existing,
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs["gen_ai.input.messages"]).toBe(existing);
    });
  });

  // ---------------------------------------------------------------------------
  // Tool definitions bridge (item #10)
  // ---------------------------------------------------------------------------

  describe("tool definitions bridge (ai.prompt.tools → gen_ai.tool.definitions)", () => {
    it("passes ai.prompt.tools string[] through to gen_ai.tool.definitions verbatim on a chat span", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const toolDefs = [
        JSON.stringify({ name: "search_web", description: "Search the web" }),
        JSON.stringify({ name: "list_tasks", description: "List tasks" }),
      ];
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: { "ai.prompt.tools": toolDefs },
      });

      const attrs = endSpan(processor, span);

      // Value must be the same reference/deep-equal string array — no re-serialization.
      expect(attrs["gen_ai.tool.definitions"]).toEqual(toolDefs);
    });

    it("does NOT set gen_ai.tool.definitions when ai.prompt.tools is absent on a chat span", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: { "gen_ai.system": "openai" },
      });

      const attrs = endSpan(processor, span);

      expect(attrs).not.toHaveProperty("gen_ai.tool.definitions");
    });

    it("does NOT map ai.prompt.tools on a non-chat span (e.g. ai.toolCall)", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const toolDefs = [JSON.stringify({ name: "search_web" })];
      const span = makeFakeSpan({
        name: "ai.toolCall",
        attributes: {
          "ai.toolCall.name": "search_web",
          "ai.prompt.tools": toolDefs,
        },
      });

      const attrs = endSpan(processor, span);

      expect(attrs).not.toHaveProperty("gen_ai.tool.definitions");
    });

    it("preserves pre-existing gen_ai.tool.definitions via setIfAbsent on a chat span", () => {
      const processor = new GenAiBridgeSpanProcessor();
      const existing = [JSON.stringify({ name: "pre_existing_tool" })];
      const incoming = [JSON.stringify({ name: "new_tool" })];
      const span = makeFakeSpan({
        name: "ai.generateText.doGenerate",
        attributes: {
          "ai.prompt.tools": incoming,
          "gen_ai.tool.definitions": existing,
        },
      });

      const attrs = endSpan(processor, span);

      // setIfAbsent must not overwrite the pre-existing value.
      expect(attrs["gen_ai.tool.definitions"]).toEqual(existing);
    });

    it("passes through verbatim when the value is a single string (future shape robustness)", () => {
      // If AI SDK ever changes to emit a single JSON-array string, the bridge
      // must not crash or transform — telemetry robustness is more important
      // than enforcing the current string[] shape.
      const processor = new GenAiBridgeSpanProcessor();
      const singleString = '[{"name":"search_web"}]';
      const span = makeFakeSpan({
        name: "ai.streamText.doStream",
        attributes: { "ai.prompt.tools": singleString },
      });

      const attrs = endSpan(processor, span);

      expect(attrs["gen_ai.tool.definitions"]).toBe(singleString);
    });
  });
});
