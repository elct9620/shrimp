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

// Agent-level gen_ai attributes only: operation.name=invoke_agent, agent.name,
// provider.name, and error.type on failure. All LLM-call and tool-call gen_ai
// attrs — including structured gen_ai.input/output.messages — are emitted by
// GenAiBridgeSpanProcessor translating AI SDK's ai.* attrs on span end.
// See src/infrastructure/telemetry/gen-ai-bridge-span-processor.ts
const ATTR_GEN_AI_OPERATION_NAME = "gen_ai.operation.name";
const ATTR_GEN_AI_AGENT_NAME = "gen_ai.agent.name";
const ATTR_GEN_AI_PROVIDER_NAME = "gen_ai.provider.name";
const ATTR_ERROR_TYPE = "error.type";

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
      span.setAttribute(ATTR_GEN_AI_OPERATION_NAME, "invoke_agent");
      span.setAttribute(ATTR_GEN_AI_AGENT_NAME, "shrimp.main-agent");
      span.setAttribute(ATTR_GEN_AI_PROVIDER_NAME, this.providerName);

      const agent = new ToolLoopAgent(this.buildToolLoopAgentOptions(input));

      try {
        const result = await agent.generate({ prompt: input.userPrompt });

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
