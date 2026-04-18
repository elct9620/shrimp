import { randomUUID } from "node:crypto";
import type { ConversationRef } from "../entities/conversation-ref";
import type { SessionRepository } from "./ports/session-repository";
import type { ShrimpAgent } from "./ports/shrimp-agent";
import type { ToolProviderFactory } from "./ports/tool-provider-factory";
import type { LoggerPort } from "./ports/logger";
import type { TelemetryPort } from "./ports/telemetry";

export type ChannelJobConfig = {
  sessionRepository: SessionRepository;
  shrimpAgent: ShrimpAgent;
  toolProviderFactory: ToolProviderFactory;
  maxSteps: number;
  logger: LoggerPort;
  telemetry: TelemetryPort;
};

const CHANNEL_SYSTEM_PROMPT = `You are a helpful assistant responding to messages in a chat channel.
Use the available tools when needed to fulfill the request.
Keep replies concise and relevant to the user's message.`;

export class ChannelJob {
  private readonly sessionRepository: SessionRepository;
  private readonly shrimpAgent: ShrimpAgent;
  private readonly toolProviderFactory: ToolProviderFactory;
  private readonly maxSteps: number;
  private readonly logger: LoggerPort;
  private readonly telemetry: TelemetryPort;

  constructor({
    sessionRepository,
    shrimpAgent,
    toolProviderFactory,
    maxSteps,
    logger,
    telemetry,
  }: ChannelJobConfig) {
    this.sessionRepository = sessionRepository;
    this.shrimpAgent = shrimpAgent;
    this.toolProviderFactory = toolProviderFactory;
    this.maxSteps = maxSteps;
    this.logger = logger;
    this.telemetry = telemetry;
  }

  async run(event: { message: string; ref: ConversationRef }): Promise<void> {
    // TODO: Use crypto.randomUUID() v7 when Node.js exposes it natively;
    // currently returns v4 which is the acceptable fallback per spec.
    const jobId = randomUUID();

    return this.telemetry.runInSpan("shrimp.job", async () => {
      this.logger.info("cycle started");

      // Load or lazily create the current session.
      let session = await this.sessionRepository.getCurrent();
      if (!session) {
        session = await this.sessionRepository.createNew();
        this.logger.debug("cycle new session created", {
          sessionId: session.id,
        });
      }

      const userMsg = { role: "user" as const, content: event.message };

      // Persist the incoming user message before agent invocation so the
      // transcript is preserved even if the agent call fails (Fail-Open per SPEC).
      await this.sessionRepository.append(session.id, [userMsg]);

      const toolProvider = this.toolProviderFactory.create();

      this.logger.debug("cycle invoking shrimp agent", {
        sessionId: session.id,
      });

      // Pass the prior session messages as history (snapshot before the new
      // user message was appended). The new user message becomes the userPrompt.
      const result = await this.shrimpAgent.run({
        systemPrompt: CHANNEL_SYSTEM_PROMPT,
        userPrompt: event.message,
        tools: toolProvider.getTools(),
        maxSteps: this.maxSteps,
        jobId,
        history: session.messages,
        sessionId: session.id,
      });

      // Append assistant turn(s) — Fail-Open: sessionRepository.append must not throw.
      if (result.newMessages.length > 0) {
        await this.sessionRepository.append(session.id, result.newMessages);
      }

      this.logger.info("cycle finished", {
        sessionId: session.id,
        reason: result.reason,
      });
    });
  }
}
