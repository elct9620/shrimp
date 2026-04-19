import { generateText, type LanguageModel, type ModelMessage } from "ai";
import type {
  SummarizePort,
  SummarizeInput,
} from "../../use-cases/ports/summarize";
import type { LoggerPort } from "../../use-cases/ports/logger";
import summarizePrompt from "./prompts/summarize.md?raw";

export type AiSdkSummarizePortOptions = {
  model: LanguageModel;
  logger: LoggerPort;
};

export class AiSdkSummarizePort implements SummarizePort {
  private readonly model: LanguageModel;
  private readonly logger: LoggerPort;

  constructor(options: AiSdkSummarizePortOptions) {
    this.model = options.model;
    this.logger = options.logger.child({ module: "AiSdkSummarizePort" });
  }

  async summarize(input: SummarizeInput): Promise<string> {
    this.logger.debug("summarize started", {
      jobId: input.jobId,
      messageCount: input.history.length,
    });

    const messages: ModelMessage[] = input.history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // AI SDK requires at least one message when using the `messages` shape.
    // When history is empty (degenerate case), fall back to `prompt` so the
    // system instruction is still delivered to the model.
    const result = await generateText({
      ...(messages.length > 0
        ? { model: this.model, system: summarizePrompt, messages }
        : { model: this.model, prompt: summarizePrompt }),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "shrimp.summarize",
        metadata: { jobId: input.jobId },
      },
    });

    this.logger.debug("summarize finished", { jobId: input.jobId });

    return result.text;
  }
}
