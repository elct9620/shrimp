import type { ChannelGateway } from "../../use-cases/ports/channel-gateway";
import type { ConversationRef } from "../../entities/conversation-ref";
import type { LoggerPort } from "../../use-cases/ports/logger";
import type { TelemetryPort } from "../../use-cases/ports/telemetry";

export const TELEGRAM_CHANNEL_NAME = "telegram";

// Telegram Bot API rejects sendMessage text longer than 4096 characters.
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export const LOG_REPLY_FAILED_UPSTREAM_STATUS =
  "telegram reply failed — upstream status";
export const LOG_REPLY_FAILED_NETWORK = "telegram reply failed — network";
export const LOG_REPLY_FAILED_UPSTREAM_ERROR =
  "telegram reply failed — upstream error";
export const LOG_REPLY_SKIPPED_WRONG_CHANNEL =
  "telegram reply skipped — wrong channel";
export const LOG_CHAT_ACTION_SKIPPED_WRONG_CHANNEL =
  "telegram chat action skipped — wrong channel";
export const LOG_CHAT_ACTION_FAILED_UPSTREAM_STATUS =
  "telegram chat action failed — upstream status";
export const LOG_CHAT_ACTION_FAILED_NETWORK =
  "telegram chat action failed — network";

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
export const BACKOFF_MS = [250, 500] as const;
const RETRY_AFTER_CAP_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
// Typing indicator is cosmetic and Telegram only displays it for ~5s.
// Keep the timeout short so a slow Bot API never delays the Agent start.
const DEFAULT_CHAT_ACTION_TIMEOUT_MS = 2_000;

export type TelegramChannelOptions = {
  requestTimeoutMs?: number;
  chatActionTimeoutMs?: number;
};

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
  private readonly requestTimeoutMs: number;
  private readonly chatActionTimeoutMs: number;

  constructor(
    private readonly botToken: string,
    private readonly logger: LoggerPort,
    private readonly telemetry: TelemetryPort,
    options: TelegramChannelOptions = {},
  ) {
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.chatActionTimeoutMs =
      options.chatActionTimeoutMs ?? DEFAULT_CHAT_ACTION_TIMEOUT_MS;
  }

  async indicateProcessing(ref: ConversationRef): Promise<void> {
    if (ref.channel !== TELEGRAM_CHANNEL_NAME) {
      this.logger.debug(LOG_CHAT_ACTION_SKIPPED_WRONG_CHANNEL, {
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
    await this.telemetry.runInSpan("telegram.chat_action", async (span) => {
      span.setAttribute("telegram.chat.id", chatId);
      span.setAttribute("telegram.chat_action.action", "typing");

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(this.chatActionTimeoutMs),
        });
        span.setAttribute("http.status_code", resp.status);
        if (!resp.ok) {
          span.recordException(new Error(`http ${resp.status}`));
          span.setAttribute("attempt.outcome", "http_error");
          this.logger.warn(LOG_CHAT_ACTION_FAILED_UPSTREAM_STATUS, {
            status: resp.status,
          });
        } else {
          span.setAttribute("attempt.outcome", "success");
        }
      } catch (err) {
        span.recordException(err);
        span.setAttribute("attempt.outcome", "network_error");
        this.logger.warn(LOG_CHAT_ACTION_FAILED_NETWORK, {
          err,
        });
      }
    });
  }

  async reply(ref: ConversationRef, text: string): Promise<void> {
    // Guard: only handle refs originating from the Telegram webhook adapter.
    if (ref.channel !== TELEGRAM_CHANNEL_NAME) {
      this.logger.debug(LOG_REPLY_SKIPPED_WRONG_CHANNEL, {
        channel: ref.channel,
      });
      return;
    }
    const chatId = (ref.payload as TelegramPayload).chatId;
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const chunks = chunkText(text, TELEGRAM_MAX_MESSAGE_LENGTH);
    const totalChunks = chunks.length;

    await this.telemetry.runInSpan(
      "telegram.send_message",
      async () => {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const chunkContext =
            totalChunks > 1 ? { chunkIndex: i + 1, totalChunks } : undefined;

          await this.sendChunkWithRetry(url, chatId, chunk, chunkContext);
        }
      },
      {
        "telegram.chat.id": chatId,
        "telegram.message.text.length": text.length,
        "telegram.message.total_chunks": totalChunks,
      },
    );
  }

  private async sendChunkWithRetry(
    url: string,
    chatId: number,
    chunk: string,
    chunkContext: { chunkIndex: number; totalChunks: number } | undefined,
  ): Promise<void> {
    const body = JSON.stringify({ chat_id: chatId, text: chunk });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      type AttemptResult =
        | { outcome: "success" }
        | { outcome: "retry_network"; delayMs: number; err: unknown }
        | {
            outcome: "retry_status";
            delayMs: number;
            status: number;
            error_code?: number;
            description?: string;
          }
        | { outcome: "give_up_network"; err: unknown }
        | {
            outcome: "give_up_status";
            status: number;
            error_code?: number;
            description?: string;
          }
        | {
            outcome: "http_error";
            status: number;
            error_code?: number;
            description?: string;
          }
        | {
            outcome: "telegram_error";
            error_code?: number;
            description?: string;
          };

      const result = await this.telemetry.runInSpan(
        "telegram.send_message.attempt",
        async (span) => {
          span.setAttribute("attempt.index", attempt + 1);
          span.setAttribute("attempt.max", MAX_ATTEMPTS);
          if (chunkContext) {
            span.setAttribute("telegram.chunk.index", chunkContext.chunkIndex);
            span.setAttribute("telegram.chunk.total", chunkContext.totalChunks);
          }

          // Network-level attempt — transient socket failures and timeout land
          // in the catch block. AbortSignal.timeout bounds each attempt so a
          // hung request cannot stall the Job Queue.
          let resp: Response;
          try {
            resp = await fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
              signal: AbortSignal.timeout(this.requestTimeoutMs),
            });
          } catch (err) {
            const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
            span.recordException(err);
            if (isLastAttempt) {
              span.setAttribute("attempt.outcome", "give_up_network");
              return { outcome: "give_up_network", err } as AttemptResult;
            }
            const delayMs = retryDelayMs(attempt);
            span.setAttribute("attempt.outcome", "retry_network");
            span.setAttribute("telegram.retry_after_ms", delayMs);
            return { outcome: "retry_network", delayMs, err } as AttemptResult;
          }

          span.setAttribute("http.status_code", resp.status);

          // Parse body for every response — Telegram Bot API reports
          // application-level failures (including 429 throttling) via
          // `ok:false` + description, with the retry delay carried in
          // `parameters.retry_after` (seconds).
          // The HTTP `Retry-After` header is not guaranteed.
          const responseBody = (await resp.json().catch(() => null)) as {
            ok: boolean;
            error_code?: number;
            description?: string;
            parameters?: { retry_after?: number };
          } | null;

          const error_code = responseBody?.error_code;
          const description = responseBody?.description;

          // 429 / 5xx are transient; retry with appropriate backoff.
          if (isRetryableStatus(resp.status)) {
            const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
            if (error_code != null) {
              span.setAttribute("telegram.error_code", error_code);
            }
            if (isLastAttempt) {
              span.setAttribute("attempt.outcome", "give_up_status");
              return {
                outcome: "give_up_status",
                status: resp.status,
                error_code,
                description,
              } as AttemptResult;
            }
            const delayMs = retryDelayMs(
              attempt,
              responseBody?.parameters?.retry_after,
            );
            span.setAttribute("attempt.outcome", "retry_status");
            span.setAttribute("telegram.retry_after_ms", delayMs);
            return {
              outcome: "retry_status",
              delayMs,
              status: resp.status,
              error_code,
              description,
            } as AttemptResult;
          }

          // Other non-2xx responses (4xx excl. 429) are client errors —
          // don't retry.
          if (!resp.ok) {
            span.recordException(
              new Error(
                `http ${resp.status}: ${description ?? "no description"}`,
              ),
            );
            if (error_code != null) {
              span.setAttribute("telegram.error_code", error_code);
            }
            span.setAttribute("attempt.outcome", "http_error");
            return {
              outcome: "http_error",
              status: resp.status,
              error_code,
              description,
            } as AttemptResult;
          }

          // Application-level failure over HTTP 200 (e.g. message too long,
          // invalid chat_id). Not retryable — would waste calls.
          if (!responseBody?.ok) {
            span.recordException(new Error(description ?? "telegram error"));
            if (error_code != null) {
              span.setAttribute("telegram.error_code", error_code);
            }
            span.setAttribute("attempt.outcome", "telegram_error");
            return {
              outcome: "telegram_error",
              error_code,
              description,
            } as AttemptResult;
          }

          // Success — chunk delivered.
          span.setAttribute("attempt.outcome", "success");
          return { outcome: "success" } as AttemptResult;
        },
      );

      // Translate outcome to logger.warn + return/continue outside the span.
      if (result.outcome === "give_up_network") {
        this.logger.warn(LOG_REPLY_FAILED_NETWORK, {
          err: result.err,
          attempts: MAX_ATTEMPTS,
          ...chunkContext,
        });
        return;
      }
      if (result.outcome === "give_up_status") {
        this.logger.warn(LOG_REPLY_FAILED_UPSTREAM_STATUS, {
          status: result.status,
          error_code: result.error_code,
          description: result.description,
          attempts: MAX_ATTEMPTS,
          ...chunkContext,
        });
        return;
      }
      if (result.outcome === "http_error") {
        this.logger.warn(LOG_REPLY_FAILED_UPSTREAM_STATUS, {
          status: result.status,
          error_code: result.error_code,
          description: result.description,
          ...chunkContext,
        });
        return;
      }
      if (result.outcome === "telegram_error") {
        this.logger.warn(LOG_REPLY_FAILED_UPSTREAM_ERROR, {
          error_code: result.error_code,
          description: result.description,
          ...chunkContext,
        });
        return;
      }
      if (result.outcome === "success") {
        return;
      }

      // retry_network or retry_status — sleep outside the span.
      await sleep(result.delayMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
