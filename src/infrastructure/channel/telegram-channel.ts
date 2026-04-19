import type { ChannelGateway } from "../../use-cases/ports/channel-gateway";
import type { ConversationRef } from "../../entities/conversation-ref";
import type { LoggerPort } from "../../use-cases/ports/logger";

export const TELEGRAM_CHANNEL_NAME = "telegram";

type TelegramPayload = { chatId: number };

/**
 * ChannelGateway backed by the Telegram Bot API sendMessage endpoint.
 * Fail-Open per SPEC §Channel Integration — both upstream non-2xx responses
 * and network errors are logged and swallowed so a failed reply never fails
 * the Job.
 */
export class TelegramChannel implements ChannelGateway {
  constructor(
    private readonly botToken: string,
    private readonly logger: LoggerPort,
  ) {}

  async reply(ref: ConversationRef, text: string): Promise<void> {
    // Guard: only handle refs originating from the Telegram webhook adapter.
    if (ref.channel !== TELEGRAM_CHANNEL_NAME) {
      this.logger.warn("telegram reply skipped — wrong channel", {
        channel: ref.channel,
      });
      return;
    }
    const chatId = (ref.payload as TelegramPayload).chatId;
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!resp.ok) {
        this.logger.warn("telegram reply failed — upstream status", {
          status: resp.status,
        });
        return;
      }
      // Telegram Bot API may return HTTP 200 with { ok: false, error_code, description }
      // when the request is accepted at transport level but rejected at application level
      // (e.g. message too long, invalid chat_id). We must parse the body to detect this.
      const body = (await resp.json()) as {
        ok: boolean;
        error_code?: number;
        description?: string;
      };
      if (!body.ok) {
        this.logger.warn("telegram reply failed — upstream error", {
          error_code: body.error_code,
          description: body.description,
        });
        return;
      }
    } catch (err) {
      this.logger.warn("telegram reply failed — network", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }
}
