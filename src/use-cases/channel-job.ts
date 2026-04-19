import { randomUUID } from "node:crypto";
import type { ConversationRef } from "../entities/conversation-ref";
import type { ChannelGateway } from "./ports/channel-gateway";
import type { SessionRepository } from "./ports/session-repository";
import type { ShrimpAgent } from "./ports/shrimp-agent";
import type { ToolProviderFactory } from "./ports/tool-provider-factory";
import type { LoggerPort } from "./ports/logger";
import type { SpanAttributes, TelemetryPort } from "./ports/telemetry";
import type { UserAgentsPort } from "./ports/user-agents";
import { assembleChannelSystemPrompt } from "./prompt-assembler";

export type ChannelJobConfig = {
  sessionRepository: SessionRepository;
  channelGateway: ChannelGateway;
  shrimpAgent: ShrimpAgent;
  toolProviderFactory: ToolProviderFactory;
  maxSteps: number;
  logger: LoggerPort;
  telemetry: TelemetryPort;
  userAgents?: UserAgentsPort;
};

export class ChannelJob {
  private readonly sessionRepository: SessionRepository;
  private readonly channelGateway: ChannelGateway;
  private readonly shrimpAgent: ShrimpAgent;
  private readonly toolProviderFactory: ToolProviderFactory;
  private readonly maxSteps: number;
  private readonly logger: LoggerPort;
  private readonly telemetry: TelemetryPort;
  private readonly userAgents?: UserAgentsPort;

  constructor({
    sessionRepository,
    channelGateway,
    shrimpAgent,
    toolProviderFactory,
    maxSteps,
    logger,
    telemetry,
    userAgents,
  }: ChannelJobConfig) {
    this.sessionRepository = sessionRepository;
    this.channelGateway = channelGateway;
    this.shrimpAgent = shrimpAgent;
    this.toolProviderFactory = toolProviderFactory;
    this.maxSteps = maxSteps;
    this.logger = logger;
    this.telemetry = telemetry;
    this.userAgents = userAgents;
  }

  async run(event: {
    message: string;
    ref: ConversationRef;
    telemetry: { spanName: string; attributes: SpanAttributes };
  }): Promise<void> {
    // TODO: Use crypto.randomUUID() v7 when Node.js exposes it natively;
    // currently returns v4 which is the acceptable fallback per spec.
    const jobId = randomUUID();

    return this.telemetry.runInSpan(
      event.telemetry.spanName,
      async () => {
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
        const userAgents = (await this.userAgents?.read()) ?? null;
        const systemPrompt = assembleChannelSystemPrompt({
          tools: toolProvider.getToolDescriptions(),
          userAgents,
        });

        // Surface a platform-native processing hint (e.g. Telegram "typing…")
        // before the Agent starts so users see the Job is being worked on.
        // Fail-Open per SPEC §Channel Integration — ChannelGateway swallows errors.
        await this.channelGateway.indicateProcessing(event.ref);

        this.logger.debug("cycle invoking shrimp agent", {
          sessionId: session.id,
        });

        // Pass the prior session messages as history (snapshot before the new
        // user message was appended). The new user message becomes the userPrompt.
        const result = await this.shrimpAgent.run({
          systemPrompt,
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

        // Deliver the agent's final text response to the originating Channel.
        // ChannelGateway.reply is Fail-Open per SPEC §Channel Integration — if
        // delivery fails the Job is not failed. We iterate newMessages so any
        // assistant turn the agent produced is sent; typically this is one.
        for (const msg of result.newMessages) {
          if (msg.role === "assistant" && msg.content.length > 0) {
            await this.channelGateway.reply(event.ref, msg.content);
          }
        }

        this.logger.info("cycle finished", {
          sessionId: session.id,
          reason: result.reason,
        });
      },
      event.telemetry.attributes,
    );
  }
}
