import { describe, it, expect, vi } from "vitest";
import { createReplyTool } from "../../../../src/adapters/tools/built-in/reply";
import type { ChannelGateway } from "../../../../src/use-cases/ports/channel-gateway";
import type { ConversationRef } from "../../../../src/entities/conversation-ref";
import { makeFakeLogger } from "./helpers";

function makeRef(): ConversationRef {
  return { channel: "telegram", payload: { chatId: "42" } };
}

function makeGateway(): ChannelGateway {
  return { reply: vi.fn().mockResolvedValue(undefined) };
}

describe("createReplyTool", () => {
  it("with ConversationRef: forwards to gateway.reply and returns {ok:true}", async () => {
    const ref = makeRef();
    const gateway = makeGateway();
    const t = createReplyTool(gateway, makeFakeLogger(), ref);

    const result = await t.execute!(
      { message: "Hello!" },
      { toolCallId: "tc1", messages: [] },
    );

    expect(gateway.reply).toHaveBeenCalledWith(ref, "Hello!");
    expect(result).toEqual({ ok: true });
  });

  it("without ConversationRef: does NOT call gateway, logs debug, returns {ok:true}", async () => {
    const gateway = makeGateway();
    const logger = makeFakeLogger();
    const t = createReplyTool(gateway, logger, undefined);

    const result = await t.execute!(
      { message: "Hello!" },
      { toolCallId: "tc2", messages: [] },
    );

    expect(gateway.reply).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "reply tool no-op (no ConversationRef)",
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects empty message via inputSchema", () => {
    const t = createReplyTool(makeGateway(), makeFakeLogger(), makeRef());
    const schema = t.inputSchema as unknown as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ message: "" }).success).toBe(false);
    expect(schema.safeParse({ message: "hi" }).success).toBe(true);
  });
});
