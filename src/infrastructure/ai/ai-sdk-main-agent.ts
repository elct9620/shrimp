import {
  ToolLoopAgent,
  stepCountIs,
  type LanguageModel,
  type ToolLoopAgentSettings,
  type ToolSet as AiToolSet,
} from "ai";
import type {
  MainAgent,
  MainAgentInput,
  MainAgentResult,
  MainAgentTerminationReason,
} from "../../use-cases/ports/main-agent";
import type { LoggerPort } from "../../use-cases/ports/logger";
import type { TelemetryPort } from "../../use-cases/ports/telemetry";

export type AiSdkMainAgentOptions = {
  model: LanguageModel;
  logger: LoggerPort;
  providerName: string;
  reasoningEffort?: string;
  telemetry: TelemetryPort;
};

export class AiSdkMainAgent implements MainAgent {
  private readonly model: LanguageModel;
  private readonly logger: LoggerPort;
  private readonly telemetry: TelemetryPort;
  private readonly providerOptions:
    | Record<string, Record<string, string>>
    | undefined;

  constructor(options: AiSdkMainAgentOptions) {
    this.model = options.model;
    this.logger = options.logger.child({ module: "AiSdkMainAgent" });
    this.telemetry = options.telemetry;
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
        recordInputs: this.telemetry.recordInputs,
        recordOutputs: this.telemetry.recordOutputs,
        tracer: this.telemetry.tracer,
      },
    };
  }

  async run(input: MainAgentInput): Promise<MainAgentResult> {
    const toolCount = Object.keys(input.tools).length;
    this.logger.debug("main agent run started", {
      maxSteps: input.maxSteps,
      toolCount,
    });

    const agent = new ToolLoopAgent(this.buildToolLoopAgentOptions(input));

    let result;
    try {
      result = await agent.generate({ prompt: input.userPrompt });
    } catch (err) {
      this.logger.error("main agent run failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const reason = mapFinishReason(result.finishReason);
    this.logger.info("main agent run finished", {
      finishReason: result.finishReason,
      reason,
    });

    return { reason };
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
