import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../context-variables";
import type { JobQueue } from "../../../../use-cases/ports/job-queue";
import type { ChannelJob } from "../../../../use-cases/channel-job";
import type { StartNewSession } from "../../../../use-cases/start-new-session";
import type { ChannelGateway } from "../../../../use-cases/ports/channel-gateway";
import type { LoggerPort } from "../../../../use-cases/ports/logger";
import type { ConversationRef } from "../../../../entities/conversation-ref";
import { TELEGRAM_CHANNEL_NAME } from "../../../../infrastructure/channel/telegram-channel";
import { collectHttpSpanAttributes } from "../../telemetry-attributes";
import { timingSafeEqualStr } from "../../timing-safe-compare";

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
    startNewSession: StartNewSession;
    channelGateway: ChannelGateway;
    logger: LoggerPort;
  },
): Promise<void> {
  if (name === "new") {
    try {
      await deps.startNewSession.execute();
      await deps.channelGateway.reply(ref, "Started a new session.");
    } catch (err) {
      deps.logger.error("slash command /new failed", {
        error: err instanceof Error ? err.message : String(err),
      });
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
  channelJob: ChannelJob;
  startNewSession: StartNewSession;
  channelGateway: ChannelGateway;
  webhookSecret: string;
  logger: LoggerPort;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/channels/telegram", async (c) => {
    const secret = c.req.header("x-telegram-bot-api-secret-token");
    if (!secret || !timingSafeEqualStr(secret, deps.webhookSecret)) {
      return c.body(null, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.body(null, 400);
    }

    const parsed = TelegramUpdate.safeParse(body);
    if (!parsed.success) {
      return c.body(null, 400);
    }

    const msg = parsed.data.message;
    if (!msg?.text) {
      return c.body(null, 200);
    }

    const text = msg.text;
    const ref: ConversationRef = {
      channel: TELEGRAM_CHANNEL_NAME,
      payload: { chatId: msg.chat.id },
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

    const accepted = deps.jobQueue.tryEnqueue(() =>
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
      accepted,
      chatId: msg.chat.id,
    });
    return c.body(null, 200);
  });

  return app;
}
