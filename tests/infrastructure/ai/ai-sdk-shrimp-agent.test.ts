import { describe, expect, it } from "vitest";
import type { FinishReason } from "ai";
import { tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode, type Tracer } from "@opentelemetry/api";
import {
  AiSdkShrimpAgent,
  SESSION_AFFINITY_HEADER,
} from "../../../src/infrastructure/ai/ai-sdk-shrimp-agent";
import type { JobInput } from "../../../src/use-cases/ports/shrimp-agent";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";
import { makeFakeLogger } from "../../mocks/fake-logger";
import { NoopTelemetry } from "../../../src/infrastructure/telemetry/noop-telemetry";

function makeInMemoryTracer(): {
  tracer: Tracer;
  exporter: InMemorySpanExporter;
} {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  return { tracer: provider.getTracer("test"), exporter };
}

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

type StepUsage = {
  inputTokens: {
    total: number;
    noCache: number;
    cacheRead: undefined;
    cacheWrite: undefined;
  };
  outputTokens: { total: number; text: number; reasoning: undefined };
};

type StepConfig = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
  >;
  finishReason: FinishReason;
  usage?: StepUsage;
};

const DEFAULT_USAGE: StepUsage = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

/**
 * Builds a MockLanguageModelV3 that plays through `steps` in order.
 * Each call to `doGenerate` advances to the next step; the last step is
 * repeated if the model is called more times than there are steps.
 * Per-step `usage` is optional — defaults to all-zero counts.
 */
function makeMultiStepModel(steps: StepConfig[]) {
  let callCount = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const step = steps[Math.min(callCount, steps.length - 1)];
      callCount++;
      return {
        content: step.content,
        finishReason: { unified: step.finishReason, raw: undefined },
        usage: step.usage ?? DEFAULT_USAGE,
        warnings: [],
      };
    },
  });
}

function makeAgent(
  model: MockLanguageModelV3,
  logger: LoggerPort,
  options?: {
    providerName?: string;
    reasoningEffort?: string;
    tracer?: Tracer;
    recordInputs?: boolean;
    recordOutputs?: boolean;
  },
) {
  const noop = new NoopTelemetry();
  return new AiSdkShrimpAgent({
    model,
    logger,
    providerName: options?.providerName ?? "test-provider",
    reasoningEffort: options?.reasoningEffort,
    tracer: options?.tracer ?? noop.tracer,
    recordInputs: options?.recordInputs ?? true,
    recordOutputs: options?.recordOutputs ?? true,
  });
}

const baseInput: JobInput = {
  systemPrompt: "You are a helpful assistant.",
  userPrompt: "Complete the task.",
  tools: { my_tool: {} },
  maxSteps: 3,
  jobId: "00000000-0000-0000-0000-000000000001",
  history: [],
};

describe("AiSdkShrimpAgent.run", () => {
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

  describe("history passthrough", () => {
    it("should prepend history messages before the user prompt in the AI SDK call", async () => {
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger());

      await agent.run({
        ...baseInput,
        history: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ],
        userPrompt: "Follow-up question.",
      });

      const callOptions = model.doGenerateCalls[0];
      const roles = callOptions.prompt.map((m: { role: string }) => m.role);
      // system, user (history[0]), assistant (history[1]), user (current prompt)
      expect(roles).toEqual(["system", "user", "assistant", "user"]);
    });

    it("should return newMessages with the assistant final text", async () => {
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger());

      const result = await agent.run(baseInput);

      expect(result.newMessages).toHaveLength(1);
      expect(result.newMessages[0]).toEqual({
        role: "assistant",
        content: "done",
      });
    });

    it("should return empty newMessages when text is empty", async () => {
      const emptyModel = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: "text" as const, text: "" }],
          finishReason: { unified: "stop" as const, raw: undefined },
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
      const agent = makeAgent(emptyModel, makeFakeLogger());

      const result = await agent.run(baseInput);

      expect(result.newMessages).toHaveLength(0);
    });

    // In a multi-step tool loop the model may emit text in earlier steps
    // (scratch / thinking) then end on a tool call. Those intermediate turns
    // must NOT be relayed as replies — only the final aggregated `result.text`
    // (what OTel records as gen_ai.output.messages) is delivered.
    it("returns no newMessages when only intermediate steps had text", async () => {
      const multiStepModel = makeMultiStepModel([
        {
          content: [
            { type: "text", text: "Let me check that for you." },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "ping",
              input: "{}",
            },
          ],
          finishReason: "tool-calls",
        },
        {
          content: [{ type: "text", text: "" }],
          finishReason: "stop",
        },
      ]);

      const pingTool = tool({
        description: "ping",
        inputSchema: z.object({}),
        execute: async () => "pong",
      });

      const agent = makeAgent(multiStepModel, makeFakeLogger());
      const result = await agent.run({
        ...baseInput,
        tools: { ping: pingTool },
        maxSteps: 3,
      });

      expect(result.newMessages).toHaveLength(0);
    });
  });

  describe("experimental_telemetry forwarding", () => {
    it("should forward experimental_telemetry with isEnabled:true and functionId to ToolLoopAgent", async () => {
      // Observable effect: the outer span is named "invoke_agent shrimp.job" and
      // gen_ai.agent.name is "shrimp.job" — both derive from functionId="shrimp.job"
      // in experimental_telemetry being active (isEnabled:true).
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: true,
        recordOutputs: true,
      });

      await agent.run(baseInput);

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBeGreaterThan(0);
      const agentSpan = spans.find((s) => s.name === "invoke_agent shrimp.job");
      expect(agentSpan).toBeDefined();
      expect(agentSpan!.attributes["gen_ai.agent.name"]).toBe("shrimp.job");
    });

    it("should forward recordInputs:false and recordOutputs:false to experimental_telemetry", async () => {
      // Observable effect: when recordInputs/recordOutputs are false, the span must
      // not carry gen_ai.input.messages or gen_ai.output.messages.
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: false,
        recordOutputs: false,
      });

      await agent.run(baseInput);

      const spans = exporter.getFinishedSpans();
      const agentSpan = spans.find((s) => s.name === "invoke_agent shrimp.job");
      expect(agentSpan).toBeDefined();
      expect(agentSpan!.attributes).not.toHaveProperty("gen_ai.input.messages");
      expect(agentSpan!.attributes).not.toHaveProperty(
        "gen_ai.output.messages",
      );
    });

    it("should forward the exact tracer instance supplied by the caller", async () => {
      // Observable effect: supplying an in-memory tracer means its spans are
      // captured in the exporter — proving that exact tracer was used.
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: true,
        recordOutputs: true,
      });

      await agent.run(baseInput);

      expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);
    });
  });

  describe("gen_ai semantic conventions", () => {
    function findShrimpAgentSpan(
      spans: ReturnType<InMemorySpanExporter["getFinishedSpans"]>,
    ) {
      return spans.find(
        (s) => s.name === "invoke_agent shrimp.job" || s.name === "shrimp.job",
      );
    }

    it("should rename outer span to 'invoke_agent shrimp.job' per semconv", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span).toBeDefined();
      expect(span!.name).toBe("invoke_agent shrimp.job");
    });

    it("should record exception, set ERROR status, end the span, and rethrow when generate throws", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const boom = new Error("upstream provider exploded");
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          throw boom;
        },
      });
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: true,
        recordOutputs: true,
      });

      await expect(agent.run(baseInput)).rejects.toThrow(
        "upstream provider exploded",
      );

      const spans = exporter.getFinishedSpans();
      const span = findShrimpAgentSpan(spans);
      expect(span).toBeDefined();
      // span being in getFinishedSpans() proves it was ended (even after error)
      expect(span!.status?.code).toBe(SpanStatusCode.ERROR);
      // OTel recordException stores exception as a span event named "exception"
      // with attribute "exception.message" matching the error message.
      expect(
        span!.events.some(
          (e) =>
            e.name === "exception" &&
            e.attributes?.["exception.message"] === boom.message,
        ),
      ).toBe(true);
    });

    it("should set gen_ai.operation.name to invoke_agent on success", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    });

    it("should set gen_ai.agent.name to shrimp.job on success", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes["gen_ai.agent.name"]).toBe("shrimp.job");
    });

    it("should set gen_ai.provider.name to the configured providerName on success", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        providerName: "my-provider",
      });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes["gen_ai.provider.name"]).toBe("my-provider");
    });

    it("should set gen_ai.conversation.id to the sessionId for a ChannelJob (sessionId present)", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run({ ...baseInput, sessionId: "sess-abc" });

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes["gen_ai.conversation.id"]).toBe("sess-abc");
    });

    it("should NOT set gen_ai.conversation.id for a HeartbeatJob (sessionId absent)", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      // baseInput has no sessionId — simulates a HeartbeatJob
      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes).not.toHaveProperty("gen_ai.conversation.id");
    });

    it("should always set shrimp.job.id to the jobId from JobInput", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes["shrimp.job.id"]).toBe(baseInput.jobId);
    });

    it("should set gen_ai.agent.id to a non-empty UUID-format string", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      const agentId = span!.attributes["gen_ai.agent.id"];
      expect(typeof agentId).toBe("string");
      expect(agentId as string).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("should set gen_ai.agent.version to a non-empty semver string", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      const version = span!.attributes["gen_ai.agent.version"];
      expect(typeof version).toBe("string");
      expect(version as string).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("should set gen_ai.agent.id and gen_ai.agent.version regardless of recordInputs/recordOutputs", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: false,
        recordOutputs: false,
      });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes["gen_ai.agent.id"]).toBeDefined();
      expect(span!.attributes["gen_ai.agent.version"]).toBeDefined();
    });

    it("should set error.type to the error constructor name when generate throws", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const boom = new Error("upstream provider exploded");
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          throw boom;
        },
      });
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await expect(agent.run(baseInput)).rejects.toThrow();

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes["error.type"]).toBe("Error");
    });

    it("should set gen_ai.provider.name even when generate throws", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          throw new Error("boom");
        },
      });
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        providerName: "my-provider",
      });

      await expect(agent.run(baseInput)).rejects.toThrow();

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes["gen_ai.provider.name"]).toBe("my-provider");
    });

    it("should set gen_ai.input.messages to system+user shape when recordInputs=true", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: true,
      });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      const raw = span!.attributes["gen_ai.input.messages"];
      expect(typeof raw).toBe("string");
      const parsed = JSON.parse(raw as string);
      expect(parsed).toEqual([
        {
          role: "system",
          parts: [{ type: "text", content: baseInput.systemPrompt }],
        },
        {
          role: "user",
          parts: [{ type: "text", content: baseInput.userPrompt }],
        },
      ]);
    });

    it("should set gen_ai.output.messages to assistant text shape when recordOutputs=true", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordOutputs: true,
      });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      const raw = span!.attributes["gen_ai.output.messages"];
      expect(typeof raw).toBe("string");
      const parsed = JSON.parse(raw as string);
      expect(parsed).toEqual([
        { role: "assistant", parts: [{ type: "text", content: "done" }] },
      ]);
    });

    it("should include reasoning part in gen_ai.output.messages when model emits reasoning", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const reasoningModel = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [
            { type: "reasoning" as const, text: "Plan: respond politely." },
            { type: "text" as const, text: "done" },
          ],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: {
              total: 0,
              noCache: 0,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
          },
          warnings: [],
        }),
      });
      const agent = makeAgent(reasoningModel, makeFakeLogger(), {
        tracer,
        recordOutputs: true,
      });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      const parsed = JSON.parse(
        span!.attributes["gen_ai.output.messages"] as string,
      );
      expect(parsed).toEqual([
        {
          role: "assistant",
          parts: [
            { type: "reasoning", content: "Plan: respond politely." },
            { type: "text", content: "done" },
          ],
        },
      ]);
    });

    it("should omit gen_ai.input.messages when recordInputs=false but still set output messages", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: false,
        recordOutputs: true,
      });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes).not.toHaveProperty("gen_ai.input.messages");
      expect(span!.attributes).toHaveProperty("gen_ai.output.messages");
    });

    it("should omit gen_ai.output.messages when recordOutputs=false but still set input messages", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: true,
        recordOutputs: false,
      });

      await agent.run(baseInput);

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes).toHaveProperty("gen_ai.input.messages");
      expect(span!.attributes).not.toHaveProperty("gen_ai.output.messages");
    });

    it("should set gen_ai.input.messages but not gen_ai.output.messages when generate throws", async () => {
      const { tracer, exporter } = makeInMemoryTracer();
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          throw new Error("provider exploded");
        },
      });
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: true,
        recordOutputs: true,
      });

      await expect(agent.run(baseInput)).rejects.toThrow("provider exploded");

      const span = findShrimpAgentSpan(exporter.getFinishedSpans());
      expect(span!.attributes).toHaveProperty("gen_ai.input.messages");
      expect(span!.attributes).not.toHaveProperty("gen_ai.output.messages");
    });
  });

  describe("promptTokens", () => {
    it("should return promptTokens from last-step usage when provider reports input tokens", async () => {
      const model = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: "text" as const, text: "done" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: {
              total: 1234,
              noCache: 1234,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 50, text: 50, reasoning: undefined },
          },
          warnings: [],
        }),
      });
      const agent = makeAgent(model, makeFakeLogger());

      const result = await agent.run(baseInput);

      expect(result.promptTokens).toBe(1234);
    });

    it("should return promptTokens as undefined when provider omits usage input tokens", async () => {
      const model = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: "text" as const, text: "done" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: {
              total: undefined,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: undefined,
              text: undefined,
              reasoning: undefined,
            },
          },
          warnings: [],
        }),
      });
      const agent = makeAgent(model, makeFakeLogger());

      const result = await agent.run(baseInput);

      expect(result.promptTokens).toBeUndefined();
    });
  });

  describe("session affinity header", () => {
    it("should send x-session-affinity equal to sessionId on every doGenerate call for a ChannelJob (multi-step)", async () => {
      // ChannelJob shape: sessionId is set. The header must equal sessionId, not jobId,
      // and must be present on ALL doGenerate calls across ≥2 round-trips.
      const multiStepModel = makeMultiStepModel([
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "ping",
              input: "{}",
            },
          ],
          finishReason: "tool-calls",
        },
        {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
        },
      ]);

      const pingTool = tool({
        description: "ping",
        inputSchema: z.object({}),
        execute: async () => "pong",
      });

      const agent = makeAgent(multiStepModel, makeFakeLogger());
      await agent.run({
        ...baseInput,
        jobId: "job-xyz",
        sessionId: "sess-abc",
        tools: { ping: pingTool },
        maxSteps: 3,
      });

      const calls = multiStepModel.doGenerateCalls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      for (const call of calls) {
        expect(call.headers).toBeDefined();
        expect(call.headers![SESSION_AFFINITY_HEADER]).toBe("sess-abc");
      }
    });

    it("should send x-session-affinity equal to jobId when sessionId is absent (HeartbeatJob fallback)", async () => {
      // HeartbeatJob shape: sessionId is NOT set. The header must fall back to jobId.
      // Using distinct values ("job-xyz" vs no sessionId) ensures a swapped ?? operand
      // regression is caught — if the code used sessionId ?? jobId but sessionId was
      // accidentally defined, or vice versa, the assertion would fail.
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger());

      await agent.run({
        ...baseInput,
        jobId: "job-xyz",
        sessionId: undefined,
      });

      const call = model.doGenerateCalls[0];
      expect(call.headers).toBeDefined();
      expect(call.headers![SESSION_AFFINITY_HEADER]).toBe("job-xyz");
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
        expect.objectContaining({ err: expect.any(Error) }),
      );
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
