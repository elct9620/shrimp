import { generateText, type LanguageModel, type ModelMessage } from "ai";
import type {
  SummarizePort,
  SummarizeInput,
} from "../../use-cases/ports/summarize";
import type { LoggerPort } from "../../use-cases/ports/logger";
import { assembleSummarizeSystemPrompt } from "../../use-cases/prompt-assembler";

export type AiSdkSummarizePortOptions = {
  model: LanguageModel;
  logger: LoggerPort;
  // Optional upper bound on generated summary length. When undefined, no limit
  // is passed and the provider's default applies.
  maxOutputTokens?: number;
};

export class AiSdkSummarizePort implements SummarizePort {
  private readonly model: LanguageModel;
  private readonly logger: LoggerPort;
  private readonly maxOutputTokens: number | undefined;
  private readonly systemPrompt: string = assembleSummarizeSystemPrompt();

  constructor(options: AiSdkSummarizePortOptions) {
    this.model = options.model;
    this.logger = options.logger.child({ module: "AiSdkSummarizePort" });
    this.maxOutputTokens = options.maxOutputTokens;
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
        ? { model: this.model, system: this.systemPrompt, messages }
        : { model: this.model, prompt: this.systemPrompt }),
      ...(this.maxOutputTokens !== undefined
        ? { maxOutputTokens: this.maxOutputTokens }
        : {}),
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
