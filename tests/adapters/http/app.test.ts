import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type { JobQueue } from "../../../src/use-cases/ports/job-queue";
import type { HeartbeatJob } from "../../../src/use-cases/heartbeat-job";
import type { ChannelJob } from "../../../src/use-cases/channel-job";
import type { StartNewSession } from "../../../src/use-cases/start-new-session";
import type { ChannelGateway } from "../../../src/use-cases/ports/channel-gateway";
import { makeFakeLogger } from "../../mocks/fake-logger";
import pino from "pino";

const VALID_SECRET = "webhook-secret";

function makeBaseDeps() {
  const jobQueue: JobQueue = { tryEnqueue: vi.fn().mockReturnValue(true) };
  const heartbeatJob: HeartbeatJob = {
    run: vi.fn().mockResolvedValue(undefined),
  } as unknown as HeartbeatJob;
  return {
    pinoInstance: pino({ level: "silent" }),
    jobQueue,
    heartbeatJob,
    logger: makeFakeLogger(),
  };
}

function makeChannelDeps() {
  const channelJob: ChannelJob = {
    run: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChannelJob;
  const startNewSession: StartNewSession = {
    execute: vi.fn().mockResolvedValue({ id: "s1", messages: [] }),
  } as unknown as StartNewSession;
  const channelGateway: ChannelGateway = {
    reply: vi.fn().mockResolvedValue(undefined),
  };
  return {
    channelJob,
    startNewSession,
    channelGateway,
    webhookSecret: VALID_SECRET,
  };
}

describe("createApp", () => {
  it("GET /health returns 200", async () => {
    const app = createApp(makeBaseDeps());
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("POST /channels/telegram returns 404 when channels deps are omitted", async () => {
    const app = createApp(makeBaseDeps());
    const res = await app.request("/channels/telegram", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": VALID_SECRET,
      },
      body: JSON.stringify({ message: { text: "hi", chat: { id: 1 } } }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /channels/telegram returns 200 when channels deps are provided", async () => {
    const app = createApp({ ...makeBaseDeps(), channels: makeChannelDeps() });
    const res = await app.request("/channels/telegram", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": VALID_SECRET,
      },
      body: JSON.stringify({ message: { text: "hello", chat: { id: 42 } } }),
    });
    expect(res.status).toBe(200);
  });
});
