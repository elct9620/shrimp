import { describe, expect, it } from "vitest";
import type {
  FinishReason,
  TelemetrySettings,
  ToolLoopAgentSettings,
} from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { AiSdkMainAgent } from "../../../src/infrastructure/ai/ai-sdk-main-agent";
import type { MainAgentInput } from "../../../src/use-cases/ports/main-agent";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";
import { makeFakeLogger } from "../../mocks/fake-logger";
import { NoopTelemetry } from "../../../src/infrastructure/telemetry/noop-telemetry";
import { SpanStatusCode, type Tracer } from "@opentelemetry/api";

type RecordedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  ended: boolean;
  status?: { code: number; message?: string };
  exceptions: unknown[];
};

function makeRecordingTracer(): { tracer: Tracer; spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  const tracer = {
    startActiveSpan(name: string, ...args: unknown[]): unknown {
      const fn = args[args.length - 1] as (span: unknown) => unknown;
      const record: RecordedSpan = {
        name,
        attributes: {},
        ended: false,
        exceptions: [],
      };
      spans.push(record);
      const span = {
        setAttribute(key: string, value: unknown) {
          record.attributes[key] = value;
          return span;
        },
        setAttributes(attrs: Record<string, unknown>) {
          Object.assign(record.attributes, attrs);
          return span;
        },
        setStatus(status: { code: number; message?: string }) {
          record.status = status;
          return span;
        },
        recordException(exception: unknown) {
          record.exceptions.push(exception);
          return span;
        },
        updateName(newName: string) {
          record.name = newName;
          return span;
        },
        end() {
          record.ended = true;
        },
        isRecording() {
          return true;
        },
        spanContext() {
          return {
            traceId: "0".repeat(32),
            spanId: "0".repeat(16),
            traceFlags: 0,
          };
        },
        addEvent() {
          return span;
        },
        addLink() {
          return span;
        },
        addLinks() {
          return span;
        },
      };
      return fn(span);
    },
    startSpan() {
      throw new Error("startSpan not implemented in recording tracer");
    },
  } as unknown as Tracer;
  return { tracer, spans };
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
  return new AiSdkMainAgent({
    model,
    logger,
    providerName: options?.providerName ?? "test-provider",
    reasoningEffort: options?.reasoningEffort,
    tracer: options?.tracer ?? noop.tracer,
    recordInputs: options?.recordInputs ?? true,
    recordOutputs: options?.recordOutputs ?? true,
  });
}

const baseInput: MainAgentInput = {
  systemPrompt: "You are a helpful assistant.",
  userPrompt: "Complete the task.",
  tools: { my_tool: {} },
  maxSteps: 3,
  heartbeatId: "00000000-0000-0000-0000-000000000001",
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

  describe("experimental_telemetry forwarding", () => {
    function makeInspectableAgent(captured: TelemetrySettings[]) {
      return class InspectableAgent extends AiSdkMainAgent {
        override buildToolLoopAgentOptions(
          input: MainAgentInput,
        ): ToolLoopAgentSettings {
          const opts = super.buildToolLoopAgentOptions(input);
          if (opts.experimental_telemetry) {
            captured.push(opts.experimental_telemetry);
          }
          return opts;
        }
      };
    }

    it("should forward experimental_telemetry with isEnabled:true and functionId to ToolLoopAgent", async () => {
      const capturedTelemetry: TelemetrySettings[] = [];
      const model = makeModel("stop");
      const tracer = new NoopTelemetry().tracer;

      const InspectableAgent = makeInspectableAgent(capturedTelemetry);
      const agent = new InspectableAgent({
        model,
        logger: makeFakeLogger(),
        providerName: "test-provider",
        tracer,
        recordInputs: true,
        recordOutputs: true,
      });

      await agent.run(baseInput);

      expect(capturedTelemetry).toHaveLength(1);
      const et = capturedTelemetry[0];
      expect(et.isEnabled).toBe(true);
      expect(et.functionId).toBe("shrimp.main-agent");
      expect(et.recordInputs).toBe(true);
      expect(et.recordOutputs).toBe(true);
      expect(et.tracer).toBe(tracer);
    });

    it("should forward recordInputs:false and recordOutputs:false to experimental_telemetry", async () => {
      const capturedTelemetry: TelemetrySettings[] = [];
      const model = makeModel("stop");

      const InspectableAgent = makeInspectableAgent(capturedTelemetry);
      const agent = new InspectableAgent({
        model,
        logger: makeFakeLogger(),
        providerName: "test-provider",
        tracer: new NoopTelemetry().tracer,
        recordInputs: false,
        recordOutputs: false,
      });

      await agent.run(baseInput);

      const et = capturedTelemetry[0];
      expect(et.recordInputs).toBe(false);
      expect(et.recordOutputs).toBe(false);
    });

    it("should forward the exact tracer instance supplied by the caller", async () => {
      const capturedTelemetry: TelemetrySettings[] = [];
      const sentinelTracer = new NoopTelemetry().tracer;
      const model = makeModel("stop");

      const InspectableAgent = makeInspectableAgent(capturedTelemetry);
      const agent = new InspectableAgent({
        model,
        logger: makeFakeLogger(),
        providerName: "test-provider",
        tracer: sentinelTracer,
        recordInputs: true,
        recordOutputs: true,
      });

      await agent.run(baseInput);

      const et = capturedTelemetry[0];
      expect(et.tracer).toBe(sentinelTracer);
    });
  });

  describe("gen_ai semantic conventions", () => {
    function findMainAgentSpan(spans: RecordedSpan[]) {
      return spans.find(
        (s) =>
          s.name === "invoke_agent shrimp.main-agent" ||
          s.name === "shrimp.main-agent",
      );
    }

    it("should rename outer span to 'invoke_agent shrimp.main-agent' per semconv", async () => {
      const { tracer, spans } = makeRecordingTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run(baseInput);

      expect(spans[0].name).toBe("invoke_agent shrimp.main-agent");
    });

    it("should record exception, set ERROR status, end the span, and rethrow when generate throws", async () => {
      const { tracer, spans } = makeRecordingTracer();
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

      const span = findMainAgentSpan(spans);
      expect(span).toBeDefined();
      expect(span!.ended).toBe(true);
      expect(span!.status?.code).toBe(SpanStatusCode.ERROR);
      expect(span!.exceptions).toContain(boom);
    });

    it("should set gen_ai.operation.name to invoke_agent on success", async () => {
      const { tracer, spans } = makeRecordingTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run(baseInput);

      const span = findMainAgentSpan(spans);
      expect(span!.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    });

    it("should set gen_ai.agent.name to shrimp.main-agent on success", async () => {
      const { tracer, spans } = makeRecordingTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run(baseInput);

      const span = findMainAgentSpan(spans);
      expect(span!.attributes["gen_ai.agent.name"]).toBe("shrimp.main-agent");
    });

    it("should set gen_ai.provider.name to the configured providerName on success", async () => {
      const { tracer, spans } = makeRecordingTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        providerName: "my-provider",
      });

      await agent.run(baseInput);

      const span = findMainAgentSpan(spans);
      expect(span!.attributes["gen_ai.provider.name"]).toBe("my-provider");
    });

    it("should set gen_ai.conversation.id to the heartbeatId from MainAgentInput", async () => {
      const { tracer, spans } = makeRecordingTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await agent.run(baseInput);

      const span = findMainAgentSpan(spans);
      expect(span!.attributes["gen_ai.conversation.id"]).toBe(
        baseInput.heartbeatId,
      );
    });

    it("should set gen_ai.conversation.id even when recordInputs=false and recordOutputs=false", async () => {
      const { tracer, spans } = makeRecordingTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: false,
        recordOutputs: false,
      });

      await agent.run(baseInput);

      const span = findMainAgentSpan(spans);
      expect(span!.attributes["gen_ai.conversation.id"]).toBe(
        baseInput.heartbeatId,
      );
    });

    it("should set error.type to the error constructor name when generate throws", async () => {
      const { tracer, spans } = makeRecordingTracer();
      const boom = new Error("upstream provider exploded");
      const model = new MockLanguageModelV3({
        doGenerate: async () => {
          throw boom;
        },
      });
      const agent = makeAgent(model, makeFakeLogger(), { tracer });

      await expect(agent.run(baseInput)).rejects.toThrow();

      const span = findMainAgentSpan(spans);
      expect(span!.attributes["error.type"]).toBe("Error");
    });

    it("should set gen_ai.provider.name even when generate throws", async () => {
      const { tracer, spans } = makeRecordingTracer();
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

      const span = findMainAgentSpan(spans);
      expect(span!.attributes["gen_ai.provider.name"]).toBe("my-provider");
    });

    it("should set gen_ai.input.messages to system+user shape when recordInputs=true", async () => {
      const { tracer, spans } = makeRecordingTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: true,
      });

      await agent.run(baseInput);

      const span = findMainAgentSpan(spans);
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
      const { tracer, spans } = makeRecordingTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordOutputs: true,
      });

      await agent.run(baseInput);

      const span = findMainAgentSpan(spans);
      const raw = span!.attributes["gen_ai.output.messages"];
      expect(typeof raw).toBe("string");
      const parsed = JSON.parse(raw as string);
      expect(parsed).toEqual([
        { role: "assistant", parts: [{ type: "text", content: "done" }] },
      ]);
    });

    it("should omit gen_ai.input.messages when recordInputs=false but still set output messages", async () => {
      const { tracer, spans } = makeRecordingTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: false,
        recordOutputs: true,
      });

      await agent.run(baseInput);

      const span = findMainAgentSpan(spans);
      expect(span!.attributes).not.toHaveProperty("gen_ai.input.messages");
      expect(span!.attributes).toHaveProperty("gen_ai.output.messages");
    });

    it("should omit gen_ai.output.messages when recordOutputs=false but still set input messages", async () => {
      const { tracer, spans } = makeRecordingTracer();
      const model = makeModel("stop");
      const agent = makeAgent(model, makeFakeLogger(), {
        tracer,
        recordInputs: true,
        recordOutputs: false,
      });

      await agent.run(baseInput);

      const span = findMainAgentSpan(spans);
      expect(span!.attributes).toHaveProperty("gen_ai.input.messages");
      expect(span!.attributes).not.toHaveProperty("gen_ai.output.messages");
    });

    it("should set gen_ai.input.messages but not gen_ai.output.messages when generate throws", async () => {
      const { tracer, spans } = makeRecordingTracer();
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

      const span = findMainAgentSpan(spans);
      expect(span!.attributes).toHaveProperty("gen_ai.input.messages");
      expect(span!.attributes).not.toHaveProperty("gen_ai.output.messages");
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
