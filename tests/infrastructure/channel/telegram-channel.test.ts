import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  TelegramChannel,
  TELEGRAM_CHANNEL_NAME,
  TELEGRAM_MAX_MESSAGE_LENGTH,
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

  it("sends two sendMessage calls for a 5000-char text; chunks are <=4096 chars and reconstruct the original", async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post(`${TELEGRAM_BASE}/sendMessage`, async ({ request }) => {
        capturedBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ok: true, result: {} });
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);
    // Paragraph boundary at char 4000 lets the chunker split cleanly under the limit.
    const longText = "a".repeat(4000) + "\n\n" + "b".repeat(1000);

    await channel.reply(
      { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 55 } },
      longText,
    );

    expect(capturedBodies).toHaveLength(2);
    for (const body of capturedBodies)
      expect((body.text as string).length).toBeLessThanOrEqual(
        TELEGRAM_MAX_MESSAGE_LENGTH,
      );
    // Chunks joined with the stripped boundary reproduce the original.
    expect(capturedBodies.map((b) => b.text as string).join("\n\n")).toBe(
      longText,
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  describe("retry policy", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries once on network error and succeeds", async () => {
      let callCount = 0;
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          callCount += 1;
          if (callCount === 1) return HttpResponse.error();
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const channel = new TelegramChannel(BOT_TOKEN, logger);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 1 } },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(callCount).toBe(2);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("gives up after 3 attempts on persistent network error", async () => {
      let callCount = 0;
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          callCount += 1;
          return HttpResponse.error();
        }),
      );
      const logger = makeFakeLogger();
      const channel = new TelegramChannel(BOT_TOKEN, logger);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 2 } },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(callCount).toBe(3);
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        "telegram reply failed — network",
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it("does NOT retry on body.ok:false (application rejection)", async () => {
      let callCount = 0;
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          callCount += 1;
          return HttpResponse.json({
            ok: false,
            error_code: 400,
            description: "Bad Request: chat not found",
          });
        }),
      );
      const logger = makeFakeLogger();
      const channel = new TelegramChannel(BOT_TOKEN, logger);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 3 } },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(callCount).toBe(1);
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        "telegram reply failed — upstream error",
        expect.objectContaining({ description: "Bad Request: chat not found" }),
      );
    });

    it("retries on 429 using parameters.retry_after from the Telegram body", async () => {
      let callCount = 0;
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          callCount += 1;
          if (callCount === 1) {
            return HttpResponse.json(
              {
                ok: false,
                error_code: 429,
                description: "Too Many Requests: retry after 1",
                parameters: { retry_after: 1 },
              },
              { status: 429 },
            );
          }
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const channel = new TelegramChannel(BOT_TOKEN, logger);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 4 } },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(callCount).toBe(2);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("retries after AbortSignal.timeout fires on a hung first request", async () => {
      // shouldAdvanceTime: true makes the fake clock track real wall-clock
      // time, so AbortSignal.timeout(10_000) fires after ~10s without
      // explicit vi.advanceTimersByTime calls. The never-resolving handler
      // stays pending until the fetch aborts; the abort throws TimeoutError
      // into the catch branch which schedules the 250ms retry sleep.
      vi.useFakeTimers({ shouldAdvanceTime: true });

      let callCount = 0;
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          callCount += 1;
          if (callCount === 1) {
            // Never resolves — AbortSignal.timeout(10_000ms) aborts the fetch.
            return new Promise<never>(() => {});
          }
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const channel = new TelegramChannel(BOT_TOKEN, logger);

      await channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 5 } },
        "hi",
      );

      expect(callCount).toBe(2);
      expect(logger.warn).not.toHaveBeenCalled();
    }, 15_000);

    it("falls back to exponential backoff when retry_after exceeds the 10s cap", async () => {
      let callCount = 0;
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          callCount += 1;
          if (callCount === 1) {
            return HttpResponse.json(
              {
                ok: false,
                error_code: 429,
                description: "Too Many Requests: retry after 30",
                parameters: { retry_after: 30 },
              },
              { status: 429 },
            );
          }
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const channel = new TelegramChannel(BOT_TOKEN, logger);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 6 } },
        "hi",
      );

      // First attempt fires immediately; verify only one call so far.
      await vi.advanceTimersByTimeAsync(0);
      expect(callCount).toBe(1);

      // BACKOFF_MS[0] = 250ms — advancing by 250ms must trigger the retry.
      // If the uncapped retry_after:30 were used (30 000ms), no retry would
      // fire here and callCount would remain 1.
      await vi.advanceTimersByTimeAsync(250);
      await promise;

      expect(callCount).toBe(2);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  it("is Fail-Open when a middle chunk returns ok:false — all three requests are made and warn includes chunkIndex", async () => {
    let callCount = 0;
    server.use(
      http.post(`${TELEGRAM_BASE}/sendMessage`, async () => {
        callCount += 1;
        if (callCount === 2)
          return HttpResponse.json({
            ok: false,
            error_code: 400,
            description: "Bad Request: message is too long",
          });
        return HttpResponse.json({ ok: true, result: {} });
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);
    // ~9000 chars with paragraph breaks near each 3000-char boundary → 3 chunks.
    const nineKText =
      "x".repeat(3000) + "\n\n" + "y".repeat(3000) + "\n\n" + "z".repeat(3000);

    await expect(
      channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, payload: { chatId: 77 } },
        nineKText,
      ),
    ).resolves.toBeUndefined();

    expect(callCount).toBe(3);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      "telegram reply failed — upstream error",
      expect.objectContaining({ chunkIndex: 2, totalChunks: 3 }),
    );
  });
});

describe("TelegramChannel.indicateProcessing", () => {
  it("sends sendChatAction with action=typing and resolves on 200", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(`${TELEGRAM_BASE}/sendChatAction`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, result: true });
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);

    await channel.indicateProcessing({
      channel: TELEGRAM_CHANNEL_NAME,
      payload: { chatId: 123 },
    });

    expect(capturedBody).toEqual({ chat_id: 123, action: "typing" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("skips and logs warn when ref.channel is not telegram", async () => {
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);

    await channel.indicateProcessing({
      channel: "other",
      payload: { chatId: 1 },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "telegram chat action skipped — wrong channel",
      expect.objectContaining({ channel: "other" }),
    );
  });

  it("swallows upstream non-2xx and logs warn with status (Fail-Open)", async () => {
    server.use(
      http.post(`${TELEGRAM_BASE}/sendChatAction`, () => {
        return new HttpResponse(null, { status: 403 });
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);

    await expect(
      channel.indicateProcessing({
        channel: TELEGRAM_CHANNEL_NAME,
        payload: { chatId: 42 },
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "telegram chat action failed — upstream status",
      expect.objectContaining({ status: 403 }),
    );
  });

  it("swallows network errors and logs warn (Fail-Open)", async () => {
    server.use(
      http.post(`${TELEGRAM_BASE}/sendChatAction`, () => {
        return HttpResponse.error();
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger);

    await expect(
      channel.indicateProcessing({
        channel: TELEGRAM_CHANNEL_NAME,
        payload: { chatId: 7 },
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "telegram chat action failed — network",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});
