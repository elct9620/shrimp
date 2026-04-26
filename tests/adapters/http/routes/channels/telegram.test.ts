import { describe, expect, it, vi } from "vitest";
import {
  createTelegramRoute,
  LOG_WEBHOOK_UNAUTHORIZED,
  type ChannelJobRunner,
  type SessionStarter,
} from "../../../../../src/adapters/http/routes/channels/telegram";
import type { JobQueue } from "../../../../../src/use-cases/ports/job-queue";
import type { ChannelGateway } from "../../../../../src/use-cases/ports/channel-gateway";
import { makeFakeLogger } from "../../../../mocks/fake-logger";

const VALID_SECRET = "test-secret-token";

function makeJobQueue(): JobQueue {
  return {
    enqueue: vi.fn(),
  };
}

function makeChannelJob(): ChannelJobRunner {
  return { run: vi.fn().mockResolvedValue(undefined) };
}

function makeStartNewSession(): SessionStarter {
  return {
    execute: vi.fn().mockResolvedValue({ id: "session-1", messages: [] }),
  };
}

function makeChannelGateway(): ChannelGateway {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    indicateProcessing: vi.fn().mockResolvedValue(undefined),
  };
}

function makeApp(overrides?: {
  jobQueue?: JobQueue;
  channelJob?: ChannelJobRunner;
  startNewSession?: SessionStarter;
  channelGateway?: ChannelGateway;
  webhookSecret?: string;
  logger?: ReturnType<typeof makeFakeLogger>;
}) {
  return createTelegramRoute({
    jobQueue: overrides?.jobQueue ?? makeJobQueue(),
    channelJob: overrides?.channelJob ?? makeChannelJob(),
    startNewSession: overrides?.startNewSession ?? makeStartNewSession(),
    channelGateway: overrides?.channelGateway ?? makeChannelGateway(),
    webhookSecret: overrides?.webhookSecret ?? VALID_SECRET,
    logger: overrides?.logger ?? makeFakeLogger(),
  });
}

function post(
  app: ReturnType<typeof createTelegramRoute>,
  body: unknown,
  secret?: string,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret !== undefined) {
    headers["x-telegram-bot-api-secret-token"] = secret;
  }
  return app.request("/channels/telegram", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /channels/telegram", () => {
  it("returns 401 when secret header is missing", async () => {
    const jobQueue = makeJobQueue();
    const logger = makeFakeLogger();
    const app = makeApp({ jobQueue, logger });
    const res = await post(app, {}, undefined);
    expect(res.status).toBe(401);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      LOG_WEBHOOK_UNAUTHORIZED,
      expect.objectContaining({
        event: "channel.telegram.webhook.unauthorized",
        secret_length: 0,
      }),
    );
  });

  it("returns 401 when secret header does not match", async () => {
    const jobQueue = makeJobQueue();
    const logger = makeFakeLogger();
    const app = makeApp({ jobQueue, logger });
    const res = await post(app, {}, "wrong-secret");
    expect(res.status).toBe(401);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      LOG_WEBHOOK_UNAUTHORIZED,
      expect.objectContaining({
        event: "channel.telegram.webhook.unauthorized",
        secret_length: "wrong-secret".length,
      }),
    );
  });

  it("returns 400 when body is malformed JSON", async () => {
    const jobQueue = makeJobQueue();
    const app = makeApp({ jobQueue });
    const res = await post(app, "{not-json", VALID_SECRET);
    expect(res.status).toBe(400);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it("returns 200 and skips dispatch for a non-message update (empty object)", async () => {
    const jobQueue = makeJobQueue();
    const startNewSession = makeStartNewSession();
    const app = makeApp({ jobQueue, startNewSession });
    const res = await post(app, {}, VALID_SECRET);
    expect(res.status).toBe(200);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(startNewSession.execute).not.toHaveBeenCalled();
  });

  it("returns 200 and skips dispatch for a non-message update (e.g. edited_message)", async () => {
    const jobQueue = makeJobQueue();
    const startNewSession = makeStartNewSession();
    const app = makeApp({ jobQueue, startNewSession });
    // edited_message update has no `message` — hits the "acknowledge and skip" branch.
    const res = await post(
      app,
      { edited_message: { text: "edit", chat: { id: 1 } } },
      VALID_SECRET,
    );
    expect(res.status).toBe(200);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(startNewSession.execute).not.toHaveBeenCalled();
  });

  it("returns 200 and skips dispatch for a message without text (e.g. photo)", async () => {
    const jobQueue = makeJobQueue();
    const startNewSession = makeStartNewSession();
    const app = makeApp({ jobQueue, startNewSession });
    // photo-only message has no text field — should ack 200 per SPEC §Telegram Channel
    const res = await post(
      app,
      { message: { photo: [{ file_id: "abc" }], chat: { id: 1 } } },
      VALID_SECRET,
    );
    expect(res.status).toBe(200);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(startNewSession.execute).not.toHaveBeenCalled();
  });

  it("returns 200 and enqueues ChannelJob for a plain text message", async () => {
    let capturedFn: (() => Promise<void>) | undefined;
    const jobQueue: JobQueue = {
      enqueue: vi.fn().mockImplementation((fn: () => Promise<void>) => {
        capturedFn = fn;
      }),
    };
    const channelJob = makeChannelJob();
    const app = makeApp({ jobQueue, channelJob });

    const res = await post(
      app,
      {
        update_id: 987654321,
        message: { text: "hello", chat: { id: 42 } },
      },
      VALID_SECRET,
    );

    expect(res.status).toBe(200);
    expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(capturedFn).toBeDefined();

    await capturedFn!();
    expect(channelJob.run).toHaveBeenCalledTimes(1);
    const runArg = (channelJob.run as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(runArg.message).toBe("hello");
    expect(runArg.ref).toEqual({
      channel: "telegram",
      payload: { chatId: 42 },
    });
    expect(runArg.telemetry.spanName).toBe("POST /channels/telegram");
    expect(runArg.telemetry.attributes).toMatchObject({
      "http.request.method": "POST",
      "http.route": "/channels/telegram",
      "url.path": "/channels/telegram",
      "telegram.chat.id": 42,
      "telegram.update.id": 987654321,
      "telegram.message.text.length": 5,
    });
  });

  it("returns 200 and calls StartNewSession for /new command — no enqueue", async () => {
    const jobQueue = makeJobQueue();
    const startNewSession = makeStartNewSession();
    const channelGateway = makeChannelGateway();
    const app = makeApp({ jobQueue, startNewSession, channelGateway });

    const res = await post(
      app,
      { message: { text: "/new", chat: { id: 99 } } },
      VALID_SECRET,
    );

    expect(res.status).toBe(200);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(startNewSession.execute).toHaveBeenCalledTimes(1);
    expect(channelGateway.reply).toHaveBeenCalledWith(
      { channel: "telegram", payload: { chatId: 99 } },
      "Started a new session.",
    );
  });

  it("returns 200 and replies unknown-command for unrecognised slash command — no enqueue, no StartNewSession", async () => {
    const jobQueue = makeJobQueue();
    const startNewSession = makeStartNewSession();
    const channelGateway = makeChannelGateway();
    const app = makeApp({ jobQueue, startNewSession, channelGateway });

    const res = await post(
      app,
      { message: { text: "/help", chat: { id: 7 } } },
      VALID_SECRET,
    );

    expect(res.status).toBe(200);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(startNewSession.execute).not.toHaveBeenCalled();
    expect(channelGateway.reply).toHaveBeenCalledWith(
      { channel: "telegram", payload: { chatId: 7 } },
      "Unknown command: /help",
    );
  });
});
