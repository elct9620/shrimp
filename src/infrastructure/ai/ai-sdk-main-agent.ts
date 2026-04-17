import {
  ToolLoopAgent,
  stepCountIs,
  type LanguageModel,
  type ToolLoopAgentSettings,
  type ToolSet as AiToolSet,
} from "ai";
import { SpanStatusCode, type Tracer } from "@opentelemetry/api";
import type {
  MainAgent,
  MainAgentInput,
  MainAgentResult,
  MainAgentTerminationReason,
} from "../../use-cases/ports/main-agent";
import type { LoggerPort } from "../../use-cases/ports/logger";
import { toGenAiOutputMessages } from "../telemetry/gen-ai-bridge-span-processor";
import pkg from "../../../package.json";

// Agent-level gen_ai attributes only: operation.name=invoke_agent, agent.name,
// agent.id (stable type UUID), agent.version (from package.json), provider.name,
// conversation.id (Heartbeat correlation), error.type on failure, and overall
// input/output.messages for trace-root consumers (e.g. Langfuse). Per-LLM-turn
// and tool-call gen_ai attrs are emitted by GenAiBridgeSpanProcessor from AI SDK's
// ai.* attrs. See src/infrastructure/telemetry/gen-ai-bridge-span-processor.ts
const ATTR_GEN_AI_OPERATION_NAME = "gen_ai.operation.name";
const ATTR_GEN_AI_AGENT_NAME = "gen_ai.agent.name";
// gen_ai.agent.id per OTel semconv is a stable unique identifier for the agent
// implementation (not per-instance). We use a hardcoded UUID v4 that identifies
// the "Shrimp Main Agent" type across all deployments. This constant never changes;
// it correlates behavior across versions — use gen_ai.agent.version for that.
const ATTR_GEN_AI_AGENT_ID = "gen_ai.agent.id";
const ATTR_GEN_AI_AGENT_VERSION = "gen_ai.agent.version";
const ATTR_GEN_AI_PROVIDER_NAME = "gen_ai.provider.name";
const ATTR_GEN_AI_CONVERSATION_ID = "gen_ai.conversation.id";
const ATTR_GEN_AI_INPUT_MESSAGES = "gen_ai.input.messages";
const ATTR_GEN_AI_OUTPUT_MESSAGES = "gen_ai.output.messages";
const ATTR_ERROR_TYPE = "error.type";

// Stable type-level identifier for the Shrimp Main Agent implementation.
// Per OTel gen_ai semconv, gen_ai.agent.id is a stable unique identifier for
// the agent (analogous to an OpenAI assistant ID for custom agents). We use a
// fixed UUID v4 to identify this agent type — NOT per-deployment or per-instance.
// This value must not change; create a new UUID only when a fundamentally
// different agent implementation replaces this one.
const SHRIMP_MAIN_AGENT_ID = "e3a7c2f1-84b6-4d9e-a531-7c02b5f8e490";

// Version resolved from package.json at module load time (resolveJsonModule=true).
// This correlates observability signals with the deployed release.
const SHRIMP_AGENT_VERSION: string = pkg.version;

export type AiSdkMainAgentOptions = {
  model: LanguageModel;
  logger: LoggerPort;
  providerName: string;
  reasoningEffort?: string;
  tracer: Tracer;
  recordInputs: boolean;
  recordOutputs: boolean;
};

export class AiSdkMainAgent implements MainAgent {
  private readonly model: LanguageModel;
  private readonly logger: LoggerPort;
  private readonly tracer: Tracer;
  private readonly providerName: string;
  private readonly recordInputs: boolean;
  private readonly recordOutputs: boolean;
  private readonly providerOptions:
    | Record<string, Record<string, string>>
    | undefined;

  constructor(options: AiSdkMainAgentOptions) {
    this.model = options.model;
    this.logger = options.logger.child({ module: "AiSdkMainAgent" });
    this.tracer = options.tracer;
    this.providerName = options.providerName;
    this.recordInputs = options.recordInputs;
    this.recordOutputs = options.recordOutputs;
    this.providerOptions = options.reasoningEffort
      ? { [options.providerName]: { reasoningEffort: options.reasoningEffort } }
      : undefined;
  }

  protected buildToolLoopAgentOptions(
    input: MainAgentInput,
  ): ToolLoopAgentSettings {
    return {
      model: this.model,
      tools: input.tools as AiToolSet,
      instructions: input.systemPrompt,
      stopWhen: stepCountIs(input.maxSteps),
      providerOptions: this.providerOptions,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "shrimp.main-agent",
        recordInputs: this.recordInputs,
        recordOutputs: this.recordOutputs,
        tracer: this.tracer,
      },
    };
  }

  async run(input: MainAgentInput): Promise<MainAgentResult> {
    const toolCount = Object.keys(input.tools).length;
    this.logger.debug("main agent run started", {
      maxSteps: input.maxSteps,
      toolCount,
    });

    return this.tracer.startActiveSpan("shrimp.main-agent", async (span) => {
      // Rename to semconv SHOULD form: "{gen_ai.operation.name} {gen_ai.agent.name}"
      // per gen_ai-agent-spans spec. updateName is called before any setAttribute
      // so the canonical name applies from the span's first moment. The initial
      // name passed to startActiveSpan acts as fallback on tracers that do not
      // implement updateName.
      span.updateName("invoke_agent shrimp.main-agent");
      span.setAttribute(ATTR_GEN_AI_OPERATION_NAME, "invoke_agent");
      span.setAttribute(ATTR_GEN_AI_AGENT_NAME, "shrimp.main-agent");
      span.setAttribute(ATTR_GEN_AI_AGENT_ID, SHRIMP_MAIN_AGENT_ID);
      span.setAttribute(ATTR_GEN_AI_AGENT_VERSION, SHRIMP_AGENT_VERSION);
      span.setAttribute(ATTR_GEN_AI_PROVIDER_NAME, this.providerName);
      // Correlation ID — always recorded regardless of recordInputs/recordOutputs
      // because it is trace glue, not sensitive content.
      span.setAttribute(ATTR_GEN_AI_CONVERSATION_ID, input.heartbeatId);

      if (this.recordInputs) {
        const inputMessages = [
          {
            role: "system",
            parts: [{ type: "text", content: input.systemPrompt }],
          },
          {
            role: "user",
            parts: [{ type: "text", content: input.userPrompt }],
          },
        ];
        span.setAttribute(
          ATTR_GEN_AI_INPUT_MESSAGES,
          JSON.stringify(inputMessages),
        );
      }

      const agent = new ToolLoopAgent(this.buildToolLoopAgentOptions(input));

      try {
        const result = await agent.generate({ prompt: input.userPrompt });

        if (this.recordOutputs) {
          const outputMessages = toGenAiOutputMessages(result.text, []);
          if (outputMessages.length > 0) {
            span.setAttribute(
              ATTR_GEN_AI_OUTPUT_MESSAGES,
              JSON.stringify(outputMessages),
            );
          }
        }

        const reason = mapFinishReason(result.finishReason);
        this.logger.info("main agent run finished", {
          finishReason: result.finishReason,
          reason,
        });

        return { reason };
      } catch (err) {
        span.recordException(err as Error);
        span.setAttribute(
          ATTR_ERROR_TYPE,
          err instanceof Error ? err.constructor.name : typeof err,
        );
        span.setStatus({ code: SpanStatusCode.ERROR });
        this.logger.error("main agent run failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    });
  }
}

function mapFinishReason(reason: string): MainAgentTerminationReason {
  switch (reason) {
    case "stop":
    case "tool-calls":
      return "finished";
    case "length":
      return "maxStepsReached";
    default:
      return "error";
  }
}
