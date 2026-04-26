import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../context-variables";
import type { JobQueue } from "../../../../use-cases/ports/job-queue";
import type { ChannelJob } from "../../../../use-cases/channel-job";
import type { StartNewSession } from "../../../../use-cases/start-new-session";
import type { ChannelGateway } from "../../../../use-cases/ports/channel-gateway";
import type { LoggerPort } from "../../../../use-cases/ports/logger";

export type ChannelJobRunner = Pick<ChannelJob, "run">;
export type SessionStarter = Pick<StartNewSession, "execute">;
import type { ConversationRef } from "../../../../entities/conversation-ref";
import { TELEGRAM_CHANNEL_NAME } from "../../../../infrastructure/channel/telegram-channel";
import { collectHttpSpanAttributes } from "../../telemetry-attributes";
import { timingSafeEqualStr } from "../../timing-safe-compare";

export const LOG_WEBHOOK_UNAUTHORIZED =
  "telegram webhook rejected — secret mismatch";

export const LOG_WEBHOOK_INVALID_JSON =
  "telegram webhook rejected — invalid JSON";

export const LOG_WEBHOOK_UNSUPPORTED_UPDATE =
  "telegram webhook accepted — unsupported update type";

function deriveUpdateType(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "unknown";
  const p = payload as Record<string, unknown>;
  // Order matters: edited_message takes precedence over message when both exist (rare)
  for (const key of [
    "edited_message",
    "message",
    "callback_query",
    "channel_post",
    "edited_channel_post",
    "inline_query",
    "chosen_inline_result",
    "shipping_query",
    "pre_checkout_query",
    "poll",
    "poll_answer",
    "my_chat_member",
    "chat_member",
    "chat_join_request",
  ] as const) {
    if (key in p) {
      if (key === "message") {
        // Distinguish text-message from media-message
        const m = p[key] as Record<string, unknown>;
        if ("text" in m) return "message.text";
        if ("photo" in m) return "message.photo";
        if ("voice" in m) return "message.voice";
        if ("audio" in m) return "message.audio";
        if ("video" in m) return "message.video";
        if ("sticker" in m) return "message.sticker";
        if ("document" in m) return "message.document";
        return "message.other";
      }
      return key;
    }
  }
  return "unknown";
}

const TelegramUpdate = z.object({
  update_id: z.number().optional(),
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.number() }),
    })
    .optional(),
});

async function handleSlashCommand(
  name: string | undefined,
  ref: ConversationRef,
  deps: {
    startNewSession: SessionStarter;
    channelGateway: ChannelGateway;
    logger: LoggerPort;
  },
): Promise<void> {
  if (name === "new") {
    try {
      await deps.startNewSession.execute();
      await deps.channelGateway.reply(ref, "Started a new session.");
    } catch (err) {
      deps.logger.error("slash command /new failed", { err });
      await deps.channelGateway.reply(ref, "Failed to start a new session.");
    }
    return;
  }

  const commandName = name ?? "";
  deps.logger.info("unknown slash command received", { command: commandName });
  await deps.channelGateway.reply(ref, `Unknown command: /${commandName}`);
}

export function createTelegramRoute(deps: {
  jobQueue: JobQueue;
  channelJob: ChannelJobRunner;
  startNewSession: SessionStarter;
  channelGateway: ChannelGateway;
  webhookSecret: string;
  logger: LoggerPort;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/channels/telegram", async (c) => {
    const secret = c.req.header("x-telegram-bot-api-secret-token");
    if (!secret || !timingSafeEqualStr(secret, deps.webhookSecret)) {
      deps.logger.warn(LOG_WEBHOOK_UNAUTHORIZED, {
        event: "channel.telegram.webhook.unauthorized",
        secret_length: secret?.length ?? 0,
      });
      return c.body(null, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      deps.logger.warn(LOG_WEBHOOK_INVALID_JSON, {
        event: "channel.telegram.webhook.invalid_json",
        content_length: Number(c.req.header("content-length") ?? 0),
      });
      return c.body(null, 400);
    }

    const parsed = TelegramUpdate.safeParse(body);
    if (!parsed.success) {
      return c.body(null, 400);
    }

    const msg = parsed.data.message;
    if (!msg?.text) {
      deps.logger.debug(LOG_WEBHOOK_UNSUPPORTED_UPDATE, {
        event: "channel.telegram.webhook.unsupported_update",
        update_type: deriveUpdateType(body),
        update_id: parsed.data.update_id,
      });
      return c.body(null, 200);
    }

    const text = msg.text;
    const ref: ConversationRef = {
      channel: TELEGRAM_CHANNEL_NAME,
      chatId: msg.chat.id,
      payload: {},
    };

    if (text.startsWith("/")) {
      const name = text.slice(1).split(/\s+/, 1)[0]?.toLowerCase();
      await handleSlashCommand(name, ref, deps);
      return c.body(null, 200);
    }

    const attributes = collectHttpSpanAttributes(c, "/channels/telegram");
    attributes["telegram.chat.id"] = msg.chat.id;
    attributes["telegram.message.text.length"] = text.length;
    if (parsed.data.update_id !== undefined) {
      attributes["telegram.update.id"] = parsed.data.update_id;
    }

    deps.jobQueue.enqueue(() =>
      deps.channelJob.run({
        message: text,
        ref,
        telemetry: {
          spanName: "POST /channels/telegram",
          attributes,
        },
      }),
    );
    deps.logger.info("telegram message received", {
      chatId: msg.chat.id,
    });
    return c.body(null, 200);
  });

  return app;
}
