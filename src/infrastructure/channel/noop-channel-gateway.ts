import type { ChannelGateway } from "../../use-cases/ports/channel-gateway";
import type { ConversationRef } from "../../entities/conversation-ref";
import type { LoggerPort } from "../../use-cases/ports/logger";

/**
 * Fallback ChannelGateway used when no real Channel adapter is registered.
 * Logs the reply and resolves without sending anything — Fail-Open per SPEC.
 * Item 11 will swap in TelegramChannelGateway when CHANNELS_ENABLED is true.
 */
export class NoopChannelGateway implements ChannelGateway {
  constructor(private readonly logger: LoggerPort) {}

  async reply(ref: ConversationRef, text: string): Promise<void> {
    this.logger.debug("noop channel gateway reply dropped", {
      channel: ref.channel,
      textLength: text.length,
    });
  }

  async indicateProcessing(ref: ConversationRef): Promise<void> {
    this.logger.debug("noop channel gateway chat action dropped", {
      channel: ref.channel,
    });
  }
}
