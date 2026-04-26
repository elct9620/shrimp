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
  BACKOFF_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  LOG_REPLY_FAILED_UPSTREAM_STATUS,
  LOG_REPLY_FAILED_NETWORK,
  LOG_REPLY_FAILED_UPSTREAM_ERROR,
  LOG_REPLY_SKIPPED_WRONG_CHANNEL,
  LOG_CHAT_ACTION_SKIPPED_WRONG_CHANNEL,
  LOG_CHAT_ACTION_FAILED_UPSTREAM_STATUS,
  LOG_CHAT_ACTION_FAILED_NETWORK,
} from "../../../src/infrastructure/channel/telegram-channel";
import { makeFakeLogger } from "../../mocks/fake-logger";
import { makeSpyTelemetry } from "../../mocks/spy-telemetry";

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
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());

    await channel.reply(
      { channel: TELEGRAM_CHANNEL_NAME, chatId: 123, payload: {} },
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
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());

    await expect(
      channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 42, payload: {} },
        "hello",
      ),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      LOG_REPLY_FAILED_UPSTREAM_STATUS,
      expect.objectContaining({
        event: "telegram.reply.upstream_status_failed",
        status: 400,
      }),
    );
  });

  it("swallows network error and logs warn with error message", async () => {
    server.use(
      http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
        return HttpResponse.error();
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());

    await expect(
      channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 7, payload: {} },
        "test",
      ),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      LOG_REPLY_FAILED_NETWORK,
      expect.objectContaining({
        event: "telegram.reply.network_failed",
        err: expect.any(Error),
      }),
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
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());

    await expect(
      channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 99, payload: {} },
        "a".repeat(4097),
      ),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      LOG_REPLY_FAILED_UPSTREAM_ERROR,
      expect.objectContaining({
        event: "telegram.reply.upstream_error",
        error_code: 400,
        description: "Bad Request: message is too long",
      }),
    );
  });

  it("skips Telegram endpoint for wrong-channel ref and logs debug", async () => {
    let handlerCalled = false;
    server.use(
      http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
        handlerCalled = true;
        return HttpResponse.json({ ok: true, result: {} });
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());

    await channel.reply({ channel: "slack", payload: { chatId: 1 } }, "hi");

    expect(handlerCalled).toBe(false);
    expect(logger.debug).toHaveBeenCalledWith(
      LOG_REPLY_SKIPPED_WRONG_CHANNEL,
      expect.objectContaining({
        event: "telegram.reply.skipped_wrong_channel",
        channel: "slack",
      }),
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
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());
    // Paragraph boundary at char 4000 lets the chunker split cleanly under the limit.
    const longText = "a".repeat(4000) + "\n\n" + "b".repeat(1000);

    await channel.reply(
      { channel: TELEGRAM_CHANNEL_NAME, chatId: 55, payload: {} },
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
      const channel = new TelegramChannel(
        BOT_TOKEN,
        logger,
        makeSpyTelemetry(),
      );

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 1, payload: {} },
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
      const channel = new TelegramChannel(
        BOT_TOKEN,
        logger,
        makeSpyTelemetry(),
      );

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 2, payload: {} },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(callCount).toBe(3);
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        LOG_REPLY_FAILED_NETWORK,
        expect.objectContaining({
          event: "telegram.reply.network_failed",
          attempts: 3,
        }),
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
      const channel = new TelegramChannel(
        BOT_TOKEN,
        logger,
        makeSpyTelemetry(),
      );

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 3, payload: {} },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(callCount).toBe(1);
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        LOG_REPLY_FAILED_UPSTREAM_ERROR,
        expect.objectContaining({
          event: "telegram.reply.upstream_error",
          description: "Bad Request: chat not found",
        }),
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
      const channel = new TelegramChannel(
        BOT_TOKEN,
        logger,
        makeSpyTelemetry(),
      );

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 4, payload: {} },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(callCount).toBe(2);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("retries after AbortSignal.timeout fires on a hung first request", async () => {
      // AbortSignal.timeout() relies on platform-level (libuv) timers that
      // vi.useFakeTimers() does not advance, so this test runs on real timers
      // with a tiny requestTimeoutMs to keep it fast.
      vi.useRealTimers();

      let callCount = 0;
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          callCount += 1;
          if (callCount === 1) {
            return new Promise<never>(() => {});
          }
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const channel = new TelegramChannel(
        BOT_TOKEN,
        logger,
        makeSpyTelemetry(),
        {
          requestTimeoutMs: 50,
        },
      );

      await channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 5, payload: {} },
        "hi",
      );

      expect(callCount).toBe(2);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("uses 60s default request timeout aligned with Telegram Bot API server-side timeout", () => {
      // Telegram Bot API documents a 60s server-side response timeout
      // (core.telegram.org/bots/faq). Aborting earlier on the client risks
      // dropping replies that Telegram would otherwise deliver successfully.
      expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(60_000);
    });

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
      const channel = new TelegramChannel(
        BOT_TOKEN,
        logger,
        makeSpyTelemetry(),
      );

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 6, payload: {} },
        "hi",
      );

      // First attempt fires immediately; verify only one call so far.
      await vi.advanceTimersByTimeAsync(0);
      expect(callCount).toBe(1);

      // BACKOFF_MS[0] = 250ms — advancing by 250ms must trigger the retry.
      // If the uncapped retry_after:30 were used (30 000ms), no retry would
      // fire here and callCount would remain 1.
      await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
      await promise;

      expect(callCount).toBe(2);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("retries using HTTP Retry-After header when body has no parameters.retry_after", async () => {
      let callCount = 0;
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          callCount += 1;
          if (callCount === 1) {
            return HttpResponse.json(
              { ok: false, error_code: 429, description: "Too Many Requests" },
              { status: 429, headers: { "retry-after": "1" } },
            );
          }
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 10, payload: {} },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(callCount).toBe(2);
      expect(logger.warn).not.toHaveBeenCalled();
      // Attempt 1 span (calls[1]) must record 1s * 1000 = 1000ms delay.
      const attempt1 = telemetry.calls[1];
      expect(attempt1.spanAttributes).toEqual(
        expect.objectContaining({ "telegram.retry_after_ms": 1000 }),
      );
    });

    it("body parameters.retry_after wins over HTTP Retry-After header", async () => {
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
              { status: 429, headers: { "retry-after": "5" } },
            );
          }
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 11, payload: {} },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(callCount).toBe(2);
      // Body retry_after: 1 (1000ms) wins over header retry-after: 5 (5000ms).
      const attempt1 = telemetry.calls[1];
      expect(attempt1.spanAttributes).toEqual(
        expect.objectContaining({ "telegram.retry_after_ms": 1000 }),
      );
    });

    it("falls back to BACKOFF_MS when HTTP Retry-After header exceeds the 10s cap", async () => {
      let callCount = 0;
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          callCount += 1;
          if (callCount === 1) {
            return HttpResponse.json(
              { ok: false, error_code: 429, description: "Too Many Requests" },
              { status: 429, headers: { "retry-after": "30" } },
            );
          }
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 12, payload: {} },
        "hi",
      );

      // First attempt fires immediately.
      await vi.advanceTimersByTimeAsync(0);
      expect(callCount).toBe(1);

      // Header value of 30s exceeds cap — falls back to BACKOFF_MS[0] = 250ms.
      await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
      await promise;

      expect(callCount).toBe(2);
      const attempt1 = telemetry.calls[1];
      expect(attempt1.spanAttributes).toEqual(
        expect.objectContaining({ "telegram.retry_after_ms": BACKOFF_MS[0] }),
      );
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
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());
    // ~9000 chars with paragraph breaks near each 3000-char boundary → 3 chunks.
    const nineKText =
      "x".repeat(3000) + "\n\n" + "y".repeat(3000) + "\n\n" + "z".repeat(3000);

    await expect(
      channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 77, payload: {} },
        nineKText,
      ),
    ).resolves.toBeUndefined();

    expect(callCount).toBe(3);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      LOG_REPLY_FAILED_UPSTREAM_ERROR,
      expect.objectContaining({
        event: "telegram.reply.upstream_error",
        chunkIndex: 2,
        totalChunks: 3,
      }),
    );
  });

  describe("telemetry spans", () => {
    it("single-chunk reply opens exactly one telegram.send_message span with all 3 attributes", async () => {
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      await channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 100, payload: {} },
        "hello",
      );

      expect(telemetry.calls).toHaveLength(2);
      expect(telemetry.calls[0].name).toBe("telegram.send_message");
      expect(telemetry.calls[0].attributes).toEqual(
        expect.objectContaining({
          "telegram.chat.id": 100,
          "telegram.message.text.length": 5,
          "telegram.message.total_chunks": 1,
        }),
      );
    });

    it("multi-chunk reply opens exactly one telegram.send_message span with telegram.message.total_chunks: 3", async () => {
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);
      // ~9000 chars with paragraph breaks → 3 chunks.
      const nineKText =
        "x".repeat(3000) +
        "\n\n" +
        "y".repeat(3000) +
        "\n\n" +
        "z".repeat(3000);

      await channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 200, payload: {} },
        nineKText,
      );

      // 1 parent span + 3 attempt child spans (one per chunk).
      expect(telemetry.calls).toHaveLength(4);
      expect(telemetry.calls[0].name).toBe("telegram.send_message");
      expect(telemetry.calls[0].attributes).toEqual(
        expect.objectContaining({
          "telegram.message.total_chunks": 3,
        }),
      );
    });

    it("wrong-channel guard does NOT open a span", async () => {
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      await channel.reply({ channel: "slack", payload: { chatId: 1 } }, "hi");

      expect(telemetry.calls).toHaveLength(0);
    });

    it("single success: child span has attempt.index 1, attempt.max 3, attempt.outcome success, http.status_code 200, no exceptions", async () => {
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      await channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 101, payload: {} },
        "hello",
      );

      // calls[0] = parent telegram.send_message, calls[1] = attempt child
      expect(telemetry.calls).toHaveLength(2);
      const child = telemetry.calls[1];
      expect(child.name).toBe("telegram.send_message.attempt");
      expect(child.spanAttributes).toEqual(
        expect.objectContaining({
          "attempt.index": 1,
          "attempt.max": 3,
          "attempt.outcome": "success",
          "http.status_code": 200,
        }),
      );
      expect(child.exceptions).toHaveLength(0);
    });

    it("retry then success: 3 spans total; first child has outcome retry_network with 1 exception, second has outcome success", async () => {
      vi.useFakeTimers();
      let callCount = 0;
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          callCount += 1;
          if (callCount === 1) return HttpResponse.error();
          return HttpResponse.json({ ok: true, result: {} });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 102, payload: {} },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;
      vi.useRealTimers();

      // calls[0] = parent, calls[1] = first attempt (retry_network), calls[2] = second attempt (success)
      expect(telemetry.calls).toHaveLength(3);
      const firstChild = telemetry.calls[1];
      expect(firstChild.name).toBe("telegram.send_message.attempt");
      expect(firstChild.spanAttributes).toEqual(
        expect.objectContaining({ "attempt.outcome": "retry_network" }),
      );
      expect(firstChild.exceptions).toHaveLength(1);
      const secondChild = telemetry.calls[2];
      expect(secondChild.name).toBe("telegram.send_message.attempt");
      expect(secondChild.spanAttributes).toEqual(
        expect.objectContaining({ "attempt.outcome": "success" }),
      );
    });

    it("ok:false body: child span has outcome telegram_error, http.status_code 200, 1 exception", async () => {
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          return HttpResponse.json({
            ok: false,
            error_code: 400,
            description: "Bad Request: chat not found",
          });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      await channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 103, payload: {} },
        "hi",
      );

      // calls[0] = parent, calls[1] = attempt child
      expect(telemetry.calls).toHaveLength(2);
      const child = telemetry.calls[1];
      expect(child.name).toBe("telegram.send_message.attempt");
      expect(child.spanAttributes).toEqual(
        expect.objectContaining({
          "attempt.outcome": "telegram_error",
          "http.status_code": 200,
        }),
      );
      expect(child.exceptions).toHaveLength(1);
    });

    it("give_up_network: 4 spans total; last child has outcome give_up_network and 1 exception", async () => {
      vi.useFakeTimers();
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          return HttpResponse.error();
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 104, payload: {} },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;
      vi.useRealTimers();

      // calls[0] = parent, calls[1..3] = 3 attempt children
      expect(telemetry.calls).toHaveLength(4);
      const lastChild = telemetry.calls[3];
      expect(lastChild.name).toBe("telegram.send_message.attempt");
      expect(lastChild.spanAttributes).toEqual(
        expect.objectContaining({ "attempt.outcome": "give_up_network" }),
      );
      expect(lastChild.exceptions).toHaveLength(1);
    });

    it("retry_status (body retry_after): first child has outcome retry_status and telegram.retry_after_ms 1000", async () => {
      vi.useFakeTimers();
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
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 105, payload: {} },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;
      vi.useRealTimers();

      // calls[0] = parent, calls[1] = first attempt (retry_status), calls[2] = second (success)
      expect(telemetry.calls).toHaveLength(3);
      const firstChild = telemetry.calls[1];
      expect(firstChild.spanAttributes).toEqual(
        expect.objectContaining({
          "attempt.outcome": "retry_status",
          "telegram.retry_after_ms": 1000,
        }),
      );
      expect(firstChild.exceptions).toHaveLength(0);
      const secondChild = telemetry.calls[2];
      expect(secondChild.spanAttributes).toEqual(
        expect.objectContaining({ "attempt.outcome": "success" }),
      );
    });

    it("give_up_status (429 exhausted): last child has outcome give_up_status and no exception", async () => {
      vi.useFakeTimers();
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          return HttpResponse.json(
            {
              ok: false,
              error_code: 429,
              description: "Too Many Requests: retry after 1",
              parameters: { retry_after: 1 },
            },
            { status: 429 },
          );
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      const promise = channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 106, payload: {} },
        "hi",
      );
      await vi.runAllTimersAsync();
      await promise;
      vi.useRealTimers();

      // calls[0] = parent, calls[1..3] = 3 attempts; last one is give_up_status
      expect(telemetry.calls).toHaveLength(4);
      const lastChild = telemetry.calls[3];
      expect(lastChild.spanAttributes).toEqual(
        expect.objectContaining({ "attempt.outcome": "give_up_status" }),
      );
      // give_up_status does not call recordException (no error object available)
      expect(lastChild.exceptions).toHaveLength(0);
    });

    it("http_error (non-retryable 4xx): child span has outcome http_error, http.status_code 400, and 1 exception", async () => {
      server.use(
        http.post(`${TELEGRAM_BASE}/sendMessage`, () => {
          return new HttpResponse(null, { status: 400 });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      await channel.reply(
        { channel: TELEGRAM_CHANNEL_NAME, chatId: 107, payload: {} },
        "hi",
      );

      // calls[0] = parent, calls[1] = single attempt child
      expect(telemetry.calls).toHaveLength(2);
      const child = telemetry.calls[1];
      expect(child.spanAttributes).toEqual(
        expect.objectContaining({
          "attempt.outcome": "http_error",
          "http.status_code": 400,
        }),
      );
      expect(child.exceptions).toHaveLength(1);
    });
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
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());

    await channel.indicateProcessing({
      channel: TELEGRAM_CHANNEL_NAME,
      chatId: 123,
      payload: {},
    });

    expect(capturedBody).toEqual({ chat_id: 123, action: "typing" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("skips and logs debug when ref.channel is not telegram", async () => {
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());

    await channel.indicateProcessing({
      channel: "other",
      payload: { chatId: 1 },
    });

    expect(logger.debug).toHaveBeenCalledWith(
      LOG_CHAT_ACTION_SKIPPED_WRONG_CHANNEL,
      expect.objectContaining({
        event: "telegram.chat_action.skipped_wrong_channel",
        channel: "other",
      }),
    );
  });

  it("swallows upstream non-2xx and logs warn with status (Fail-Open)", async () => {
    server.use(
      http.post(`${TELEGRAM_BASE}/sendChatAction`, () => {
        return new HttpResponse(null, { status: 403 });
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());

    await expect(
      channel.indicateProcessing({
        channel: TELEGRAM_CHANNEL_NAME,
        chatId: 42,
        payload: {},
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      LOG_CHAT_ACTION_FAILED_UPSTREAM_STATUS,
      expect.objectContaining({
        event: "telegram.chat_action.upstream_status_failed",
        status: 403,
      }),
    );
  });

  it("swallows network errors and logs warn (Fail-Open)", async () => {
    server.use(
      http.post(`${TELEGRAM_BASE}/sendChatAction`, () => {
        return HttpResponse.error();
      }),
    );
    const logger = makeFakeLogger();
    const channel = new TelegramChannel(BOT_TOKEN, logger, makeSpyTelemetry());

    await expect(
      channel.indicateProcessing({
        channel: TELEGRAM_CHANNEL_NAME,
        chatId: 7,
        payload: {},
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      LOG_CHAT_ACTION_FAILED_NETWORK,
      expect.objectContaining({
        event: "telegram.chat_action.network_failed",
        err: expect.any(Error),
      }),
    );
  });

  describe("telemetry spans", () => {
    it("success: 1 span with all 4 attributes and no exceptions", async () => {
      server.use(
        http.post(`${TELEGRAM_BASE}/sendChatAction`, () => {
          return HttpResponse.json({ ok: true, result: true });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      await channel.indicateProcessing({
        channel: TELEGRAM_CHANNEL_NAME,
        chatId: 200,
        payload: {},
      });

      expect(telemetry.calls).toHaveLength(1);
      expect(telemetry.calls[0].name).toBe("telegram.chat_action");
      expect(telemetry.calls[0].spanAttributes).toEqual(
        expect.objectContaining({
          "telegram.chat.id": 200,
          "telegram.chat_action.action": "typing",
          "attempt.outcome": "success",
          "http.status_code": 200,
        }),
      );
      expect(telemetry.calls[0].exceptions).toHaveLength(0);
    });

    it("upstream non-2xx: 1 span with http_error outcome, http.status_code 403, and 1 exception", async () => {
      server.use(
        http.post(`${TELEGRAM_BASE}/sendChatAction`, () => {
          return new HttpResponse(null, { status: 403 });
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      await channel.indicateProcessing({
        channel: TELEGRAM_CHANNEL_NAME,
        chatId: 201,
        payload: {},
      });

      expect(telemetry.calls).toHaveLength(1);
      expect(telemetry.calls[0].spanAttributes).toEqual(
        expect.objectContaining({
          "attempt.outcome": "http_error",
          "http.status_code": 403,
        }),
      );
      expect(telemetry.calls[0].exceptions).toHaveLength(1);
    });

    it("network error: 1 span with network_error outcome, no http.status_code, and 1 exception", async () => {
      server.use(
        http.post(`${TELEGRAM_BASE}/sendChatAction`, () => {
          return HttpResponse.error();
        }),
      );
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      await channel.indicateProcessing({
        channel: TELEGRAM_CHANNEL_NAME,
        chatId: 202,
        payload: {},
      });

      expect(telemetry.calls).toHaveLength(1);
      expect(telemetry.calls[0].spanAttributes).toEqual(
        expect.objectContaining({ "attempt.outcome": "network_error" }),
      );
      expect(telemetry.calls[0].spanAttributes).not.toHaveProperty(
        "http.status_code",
      );
      expect(telemetry.calls[0].exceptions).toHaveLength(1);
    });

    it("wrong channel: zero spans fired", async () => {
      const logger = makeFakeLogger();
      const telemetry = makeSpyTelemetry();
      const channel = new TelegramChannel(BOT_TOKEN, logger, telemetry);

      await channel.indicateProcessing({
        channel: "other",
        payload: { chatId: 203 },
      });

      expect(telemetry.calls).toHaveLength(0);
      expect(logger.debug).toHaveBeenCalledWith(
        LOG_CHAT_ACTION_SKIPPED_WRONG_CHANNEL,
        expect.objectContaining({
          event: "telegram.chat_action.skipped_wrong_channel",
          channel: "other",
        }),
      );
    });
  });
});
