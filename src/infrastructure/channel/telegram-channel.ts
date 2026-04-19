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
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [250, 500] as const;
const RETRY_AFTER_CAP_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
// Typing indicator is cosmetic and Telegram only displays it for ~5s.
// Keep the timeout short so a slow Bot API never delays the Agent start.
const CHAT_ACTION_TIMEOUT_MS = 2_000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function retryDelayMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds != null && Number.isFinite(retryAfterSeconds)) {
    const ms = retryAfterSeconds * 1000;
    if (ms > 0 && ms <= RETRY_AFTER_CAP_MS) return ms;
  }
  return BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
}

export class TelegramChannel implements ChannelGateway {
  constructor(
    private readonly botToken: string,
    private readonly logger: LoggerPort,
  ) {}

  async indicateProcessing(ref: ConversationRef): Promise<void> {
    if (ref.channel !== TELEGRAM_CHANNEL_NAME) {
      this.logger.warn("telegram chat action skipped — wrong channel", {
        channel: ref.channel,
      });
      return;
    }
    const chatId = (ref.payload as TelegramPayload).chatId;
    const url = `https://api.telegram.org/bot${this.botToken}/sendChatAction`;
    const body = JSON.stringify({ chat_id: chatId, action: "typing" });

    // Best-effort: typing indicator is cosmetic. No retries — an expired
    // indicator simply means the user sees no hint, which is strictly better
    // than stalling the Job. Fail-Open on any error.
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(CHAT_ACTION_TIMEOUT_MS),
      });
      if (!resp.ok) {
        this.logger.warn("telegram chat action failed — upstream status", {
          status: resp.status,
        });
      }
    } catch (err) {
      this.logger.warn("telegram chat action failed — network", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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

      await this.sendChunkWithRetry(url, chatId, chunk, chunkContext);
    }
  }

  private async sendChunkWithRetry(
    url: string,
    chatId: number,
    chunk: string,
    chunkContext: Record<string, number> | undefined,
  ): Promise<void> {
    const body = JSON.stringify({ chat_id: chatId, text: chunk });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Network-level attempt — transient socket failures and timeout land in
      // the catch block. AbortSignal.timeout bounds each attempt so a hung
      // request cannot stall the Job Queue.
      let resp: Response;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
        if (isLastAttempt) {
          this.logger.warn("telegram reply failed — network", {
            error: err instanceof Error ? err.message : String(err),
            attempts: MAX_ATTEMPTS,
            ...chunkContext,
          });
          return;
        }
        await sleep(retryDelayMs(attempt));
        continue;
      }

      // Parse body for every response — Telegram Bot API reports application-
      // level failures (including 429 throttling) via `ok:false` + description,
      // with the retry delay carried in `parameters.retry_after` (seconds).
      // The HTTP `Retry-After` header is not guaranteed.
      const responseBody = (await resp.json().catch(() => null)) as {
        ok: boolean;
        error_code?: number;
        description?: string;
        parameters?: { retry_after?: number };
      } | null;

      // 429 / 5xx are transient; retry with appropriate backoff.
      if (isRetryableStatus(resp.status)) {
        const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
        if (isLastAttempt) {
          this.logger.warn("telegram reply failed — upstream status", {
            status: resp.status,
            error_code: responseBody?.error_code,
            description: responseBody?.description,
            attempts: MAX_ATTEMPTS,
            ...chunkContext,
          });
          return;
        }
        await sleep(
          retryDelayMs(attempt, responseBody?.parameters?.retry_after),
        );
        continue;
      }

      // Other non-2xx responses (4xx excl. 429) are client errors — don't retry.
      if (!resp.ok) {
        this.logger.warn("telegram reply failed — upstream status", {
          status: resp.status,
          error_code: responseBody?.error_code,
          description: responseBody?.description,
          ...chunkContext,
        });
        return;
      }

      // Application-level failure over HTTP 200 (e.g. message too long, invalid
      // chat_id). Not retryable — would waste calls.
      if (!responseBody?.ok) {
        this.logger.warn("telegram reply failed — upstream error", {
          error_code: responseBody?.error_code,
          description: responseBody?.description,
          ...chunkContext,
        });
        return;
      }

      // Success — chunk delivered.
      return;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
