import type { ChannelGateway } from "../../use-cases/ports/channel-gateway";
import type { ConversationRef } from "../../entities/conversation-ref";
import type { LoggerPort } from "../../use-cases/ports/logger";

export const TELEGRAM_CHANNEL_NAME = "telegram";

// Telegram Bot API rejects sendMessage text longer than 4096 characters.
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

type TelegramPayload = { chatId: number };

/**
 * Split text into chunks of at most `limit` characters.
 * Prefers to break at the last "\n\n" within the window, then "\n", then " ",
 * then hard-cuts at the limit if no whitespace is found.
 */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const remaining = text.length - start;
    if (remaining <= limit) {
      chunks.push(text.slice(start));
      break;
    }

    const window = text.slice(start, start + limit);

    // Prefer paragraph break, then line break, then word break.
    let breakAt = window.lastIndexOf("\n\n");
    if (breakAt === -1) breakAt = window.lastIndexOf("\n");
    if (breakAt === -1) breakAt = window.lastIndexOf(" ");

    if (breakAt <= 0) {
      // No usable boundary found — hard cut at limit.
      chunks.push(window);
      start += limit;
    } else {
      chunks.push(text.slice(start, start + breakAt));
      // Skip the whitespace boundary itself so the next chunk starts cleanly.
      const skip = text.slice(start + breakAt).match(/^(\n\n|\n| )/);
      start += breakAt + (skip ? skip[0].length : 0);
    }
  }

  return chunks;
}

/**
 * ChannelGateway backed by the Telegram Bot API sendMessage endpoint.
 * Fail-Open per SPEC §Channel Integration — both upstream non-2xx responses
 * and network errors are logged and swallowed so a failed reply never fails
 * the Job.
 *
 * Long replies are split into sequential chunks ≤ TELEGRAM_MAX_MESSAGE_LENGTH
 * to avoid the Bot API 400 "message is too long" rejection. Each chunk is sent
 * independently; a failed chunk logs a warn and does not abort the rest.
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
    const chunks = chunkText(text, TELEGRAM_MAX_MESSAGE_LENGTH);
    const totalChunks = chunks.length;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkContext =
        totalChunks > 1 ? { chunkIndex: i + 1, totalChunks } : undefined;

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        });
        if (!resp.ok) {
          this.logger.warn("telegram reply failed — upstream status", {
            status: resp.status,
            ...chunkContext,
          });
          continue;
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
            ...chunkContext,
          });
          continue;
        }
      } catch (err) {
        this.logger.warn("telegram reply failed — network", {
          error: err instanceof Error ? err.message : String(err),
          ...chunkContext,
        });
        continue;
      }
    }
  }
}
