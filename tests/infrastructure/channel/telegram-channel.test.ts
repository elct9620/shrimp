import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  TelegramChannel,
  TELEGRAM_CHANNEL_NAME,
} from "../../../src/infrastructure/channel/telegram-channel";
import { makeFakeLogger } from "../../mocks/fake-logger";

const BOT_TOKEN = "test-bot-token";
const TELEGRAM_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("TelegramChannel.reply", () => {
  it("sends sendMessage with correct body and resolves on 200", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${TELEGRAM_BASE}/sendMessage`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, result: {} });
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);

    await channel.reply(
      { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 123 } },
      "hi",
    );

    expect(capturedBody).toEqual({ chat_id: 123, text: "hi" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("swallows upstream 400 and logs warn with status", async () => {
    server.use(
      http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
        return new HttpResponse(null, { status: 400 });
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);

    await expect(
      channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 42 } },
        "hello",
      ),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "telegram reply failed — upstream status",
      expect.objectContaining({ status: 400 }),
    );
  });

  it("swallows network error and logs warn with error message", async () => {
    server.use(
      http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
        return HttpResponse.error();
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);

    await expect(
      channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 7 } },
        "test",
      ),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "telegram reply failed — network",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("swallows HTTP-200 with ok:false body and logs warn with description", async () => {
    server.use(
      http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
        return HttpResponse.json({
          ok: false,
          error_code: 400,
          description: "Bad Request: message is too long",
        });
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);

    await expect(
      channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 99 } },
        "a".repeat(4097),
      ),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "telegram reply failed — upstream error",
      expect.objectContaining({
        error_code: 400,
        description: "Bad Request: message is too long",
      }),
    );
  });

  it("skips Telegram endpoint for wrong-channel ref and logs warn", async () => {
    let handlerCalled = false;
    server.use(
      http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
        handlerCalled = true;
        return HttpResponse.json({ ok: true, result: {} });
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);

    await channel.reply({ channel: "slack", payload: { chatId: 1 } }, "hi");

    expect(handlerCalled).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "telegram reply skipped — wrong channel",
      expect.objectContaining({ channel: "slack" }),
    );
  });
});
