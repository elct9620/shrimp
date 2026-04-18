import { tool } from "ai";
import { z } from "zod";
import type { ChannelGateway } from "../../../use-cases/ports/channel-gateway";
import type { ConversationRef } from "../../../entities/conversation-ref";
import type { LoggerPort } from "../../../use-cases/ports/logger";

export const REPLY_TOOL_NAME = "reply";

export function createReplyTool(
  gateway: ChannelGateway,
  logger: LoggerPort,
  ref: ConversationRef | undefined,
) {
  return tool({
    description:
      "Send a text reply to the user in the originating chat channel. " +
      "Use this to respond to conversational messages.",
    inputSchema: z.object({
      message: z.string().min(1),
    }),
    execute: async ({ message }) => {
      if (!ref) {
        // HeartbeatJob has no ConversationRef; silently drop per architecture.md
        // so the model can still call reply() without breaking the Job.
        logger.debug("reply tool no-op (no ConversationRef)");
        return { ok: true } as const;
      }
      await gateway.reply(ref, message);
      return { ok: true } as const;
    },
  });
}
