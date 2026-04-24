import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/adapters/http/app";
import type {
  HeartbeatJobRunner,
  // CreateAppDeps re-exports the narrow types, so import from app
} from "../../../src/adapters/http/routes/heartbeat";
import type {
  ChannelJobRunner,
  SessionStarter,
} from "../../../src/adapters/http/routes/channels/telegram";
import type { JobQueue } from "../../../src/use-cases/ports/job-queue";
import type { BoardRepository } from "../../../src/use-cases/ports/board-repository";
import type { ChannelGateway } from "../../../src/use-cases/ports/channel-gateway";
import { makeFakeLogger } from "../../mocks/fake-logger";
import pino from "pino";

const VALID_SECRET = "webhook-secret";

function makeBaseDeps() {
  const jobQueue: JobQueue = {
    enqueue: vi.fn(),
  };
  const heartbeatJob: HeartbeatJobRunner = {
    run: vi.fn().mockResolvedValue(undefined),
  };
  const board: BoardRepository = {
    validateSections: vi.fn().mockResolvedValue(undefined),
    getTasks: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue(undefined),
    moveTask: vi.fn().mockResolvedValue(undefined),
  };
  return {
    pinoInstance: pino({ level: "silent" }),
    jobQueue,
    heartbeatJob,
    board,
    logger: makeFakeLogger(),
  };
}

function makeChannelDeps() {
  const channelJob: ChannelJobRunner = {
    run: vi.fn().mockResolvedValue(undefined),
  };
  const startNewSession: SessionStarter = {
    execute: vi.fn().mockResolvedValue({ id: "s1", messages: [] }),
  };
  const channelGateway: ChannelGateway = {
    reply: vi.fn().mockResolvedValue(undefined),
    indicateProcessing: vi.fn().mockResolvedValue(undefined),
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
