import { randomUUID } from "node:crypto";
import type { ConversationRef } from "../entities/conversation-ref";
import type { ChannelGateway } from "./ports/channel-gateway";
import type { SessionRepository } from "./ports/session-repository";
import type { ShrimpAgent } from "./ports/shrimp-agent";
import type { ToolProviderFactory } from "./ports/tool-provider-factory";
import type { LoggerPort } from "./ports/logger";
import type { SpanAttributes, TelemetryPort } from "./ports/telemetry";
import type { UserAgentsPort } from "./ports/user-agents";
import type { SummarizePort } from "./ports/summarize";
import type { SkillCatalog } from "./ports/skill-catalog";
import {
  SessionJsonlWriteError,
  SessionStateUpdateError,
} from "./ports/session-repository";
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
  skillCatalog?: SkillCatalog;
  summarize?: SummarizePort;
  compactionThreshold?: number;
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
  private readonly skillCatalog?: SkillCatalog;
  private readonly summarize?: SummarizePort;
  private readonly compactionThreshold?: number;

  constructor({
    sessionRepository,
    channelGateway,
    shrimpAgent,
    toolProviderFactory,
    maxSteps,
    logger,
    telemetry,
    userAgents,
    skillCatalog,
    summarize,
    compactionThreshold,
  }: ChannelJobConfig) {
    this.sessionRepository = sessionRepository;
    this.channelGateway = channelGateway;
    this.shrimpAgent = shrimpAgent;
    this.toolProviderFactory = toolProviderFactory;
    this.maxSteps = maxSteps;
    this.logger = logger;
    this.telemetry = telemetry;
    this.userAgents = userAgents;
    this.skillCatalog = skillCatalog;
    this.summarize = summarize;
    this.compactionThreshold = compactionThreshold;
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
        const skills = this.skillCatalog?.list();
        const systemPrompt = assembleChannelSystemPrompt({
          skills,
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

        // Deliver the agent's final text response to the originating Channel.
        // ChannelGateway.reply is Fail-Open per SPEC §Channel Integration — if
        // delivery fails the Job is not failed. We iterate newMessages so any
        // assistant turn the agent produced is sent; typically this is one.
        // SPEC step 3a: reply delivery happens before Session append (step 4).
        for (const msg of result.newMessages) {
          if (msg.role === "assistant" && msg.content.length > 0) {
            await this.channelGateway.reply(event.ref, msg.content);
          }
        }

        // Append assistant turn(s) — Fail-Open: sessionRepository.append must not throw.
        if (result.newMessages.length > 0) {
          await this.sessionRepository.append(session.id, result.newMessages);
        }

        // Auto Compact: evaluate the Compaction Threshold AFTER all entries for
        // this turn have been appended (SPEC §Session Lifecycle §Auto Compact).
        // Missing token count → skip silently (provider did not report usage).
        // Below threshold → skip silently (no compaction needed yet).
        if (
          this.summarize !== undefined &&
          this.compactionThreshold !== undefined &&
          result.promptTokens !== undefined &&
          result.promptTokens >= this.compactionThreshold
        ) {
          try {
            // Step 1: snapshot the full post-append ConversationMessage list.
            const snapshot = [
              ...session.messages,
              userMsg,
              ...result.newMessages,
            ];

            // Step 2: produce the Conversation Summary.
            const summary = await this.summarize.summarize({
              history: snapshot,
              jobId,
            });

            // Steps 3–5: create new Session JSONL + update state.json (rotateWithSummary).
            await this.sessionRepository.rotateWithSummary(summary);

            this.logger.info("auto compact: session rotated", {
              sessionId: session.id,
              promptTokens: result.promptTokens,
              threshold: this.compactionThreshold,
            });
          } catch (err) {
            // Fail-Open Recovery: compaction failure NEVER fails the Job.
            // Reply delivery and append are both committed above (SPEC steps 3a and 4).
            if (err instanceof SessionJsonlWriteError) {
              this.logger.error(
                "auto compact: JSONL write failed, rotation aborted",
                { cause: err.cause },
              );
            } else if (err instanceof SessionStateUpdateError) {
              this.logger.error(
                "auto compact: state.json update failed, new session JSONL orphaned",
                { newSessionId: err.newSessionId, cause: err.cause },
              );
            } else {
              this.logger.error(
                "auto compact: summarize failed, skipping compaction this turn",
                { cause: err },
              );
            }
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
