import { describe, expect, it, vi } from "vitest";
import {
  createHeartbeatRoute,
  type HeartbeatJobRunner,
} from "../../../../src/adapters/http/routes/heartbeat";
import type { JobQueue } from "../../../../src/use-cases/ports/job-queue";
import type { BoardRepository } from "../../../../src/use-cases/ports/board-repository";
import { Section } from "../../../../src/entities/section";
import type { Task } from "../../../../src/entities/task";
import { makeFakeLogger } from "../../../mocks/fake-logger";

function makeJobQueue(): JobQueue {
  return {
    enqueue: vi.fn(),
  };
}

function makeHeartbeatJob(runImpl?: () => Promise<void>): HeartbeatJobRunner {
  const impl = runImpl ?? (() => Promise.resolve());
  return {
    run: vi.fn().mockImplementation(impl),
  };
}

function makeTask(id: string): Task {
  return {
    id,
    content: `task ${id}`,
    priority: 1,
    sectionId: "s",
  } as unknown as Task;
}

type BoardState = {
  backlog?: Task[];
  inProgress?: Task[];
  error?: Error;
};

function makeBoard(state: BoardState = {}): BoardRepository {
  const getTasks = vi.fn().mockImplementation(async (section: Section) => {
    if (state.error) throw state.error;
    if (section === Section.Backlog) return state.backlog ?? [makeTask("b1")];
    if (section === Section.InProgress) return state.inProgress ?? [];
    return [];
  });
  return {
    validateSections: vi.fn().mockResolvedValue(undefined),
    getTasks,
    getComments: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue(undefined),
    moveTask: vi.fn().mockResolvedValue(undefined),
  };
}

describe("POST /heartbeat", () => {
  it("returns 202 immediately and enqueues when pre-check passes", async () => {
    const jobQueue = makeJobQueue();
    const heartbeatJob = makeHeartbeatJob();
    const board = makeBoard({
      backlog: [makeTask("b1")],
      inProgress: [],
    });
    let preCheckChain: Promise<void> | undefined;
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob,
      board,
      logger: makeFakeLogger(),
      onPreCheckSettled: (p) => {
        preCheckChain = p;
      },
    });

    const res = await app.request("/heartbeat", { method: "POST" });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted" });

    await preCheckChain;
    expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("skips enqueue when Backlog is empty", async () => {
    const jobQueue = makeJobQueue();
    const board = makeBoard({ backlog: [], inProgress: [] });
    const logger = makeFakeLogger();
    let preCheckChain: Promise<void> | undefined;
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob: makeHeartbeatJob(),
      board,
      logger,
      onPreCheckSettled: (p) => {
        preCheckChain = p;
      },
    });

    const res = await app.request("/heartbeat", { method: "POST" });
    expect(res.status).toBe(202);

    await preCheckChain;
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "heartbeat pre-check skipped",
      expect.objectContaining({ reason: "backlog empty" }),
    );
  });

  it("skips enqueue when InProgress count > 1", async () => {
    const jobQueue = makeJobQueue();
    const board = makeBoard({
      backlog: [makeTask("b1")],
      inProgress: [makeTask("i1"), makeTask("i2")],
    });
    const logger = makeFakeLogger();
    let preCheckChain: Promise<void> | undefined;
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob: makeHeartbeatJob(),
      board,
      logger,
      onPreCheckSettled: (p) => {
        preCheckChain = p;
      },
    });

    const res = await app.request("/heartbeat", { method: "POST" });
    expect(res.status).toBe(202);

    await preCheckChain;
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "heartbeat pre-check skipped",
      expect.objectContaining({ reason: "in progress saturated (n>1)" }),
    );
  });

  it("enqueues when InProgress has exactly one task and Backlog is non-empty", async () => {
    const jobQueue = makeJobQueue();
    const board = makeBoard({
      backlog: [makeTask("b1")],
      inProgress: [makeTask("i1")],
    });
    let preCheckChain: Promise<void> | undefined;
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob: makeHeartbeatJob(),
      board,
      logger: makeFakeLogger(),
      onPreCheckSettled: (p) => {
        preCheckChain = p;
      },
    });

    const res = await app.request("/heartbeat", { method: "POST" });
    expect(res.status).toBe(202);

    await preCheckChain;
    expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("Fail-Open when BoardRepository throws — skips enqueue, logs warn, no throw across boundary", async () => {
    const jobQueue = makeJobQueue();
    const board = makeBoard({ error: new Error("todoist down") });
    const logger = makeFakeLogger();
    let preCheckChain: Promise<void> | undefined;
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob: makeHeartbeatJob(),
      board,
      logger,
      onPreCheckSettled: (p) => {
        preCheckChain = p;
      },
    });

    const res = await app.request("/heartbeat", { method: "POST" });
    expect(res.status).toBe(202);

    await preCheckChain;
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "heartbeat pre-check skipped",
      expect.objectContaining({ reason: "board query failed" }),
    );
  });

  it("passes a job closure that invokes heartbeatJob.run with HTTP span attributes", async () => {
    let capturedJob: (() => Promise<void>) | undefined;
    const jobQueue: JobQueue = {
      enqueue: vi.fn().mockImplementation((job: () => Promise<void>) => {
        capturedJob = job;
      }),
    };
    const heartbeatJob = makeHeartbeatJob();
    let preCheckChain: Promise<void> | undefined;
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob,
      board: makeBoard(),
      logger: makeFakeLogger(),
      onPreCheckSettled: (p) => {
        preCheckChain = p;
      },
    });

    await app.request("/heartbeat", {
      method: "POST",
      headers: { "User-Agent": "curl/8.0" },
    });

    await preCheckChain;
    expect(capturedJob).toBeDefined();
    await capturedJob!();
    expect(heartbeatJob.run).toHaveBeenCalledTimes(1);
    const runArg = (heartbeatJob.run as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(runArg.telemetry.spanName).toBe("POST /heartbeat");
    expect(runArg.telemetry.attributes).toMatchObject({
      "http.request.method": "POST",
      "http.route": "/heartbeat",
      "url.path": "/heartbeat",
      "user_agent.original": "curl/8.0",
    });
  });

  it("returns immediately even when heartbeatJob.run never resolves", async () => {
    const jobQueue = makeJobQueue();
    const heartbeatJob = makeHeartbeatJob(() => new Promise<void>(() => {}));
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob,
      board: makeBoard(),
      logger: makeFakeLogger(),
    });

    const res = await app.request("/heartbeat", { method: "POST" });

    expect(res.status).toBe(202);
  });

  it("accepts and ignores an arbitrary request body", async () => {
    const app = createHeartbeatRoute({
      jobQueue: makeJobQueue(),
      heartbeatJob: makeHeartbeatJob(),
      board: makeBoard(),
      logger: makeFakeLogger(),
    });

    const res = await app.request("/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anything: "ignored" }),
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted" });
  });

  it("does not handle GET /heartbeat (returns 404 or 405)", async () => {
    const app = createHeartbeatRoute({
      jobQueue: makeJobQueue(),
      heartbeatJob: makeHeartbeatJob(),
      board: makeBoard(),
      logger: makeFakeLogger(),
    });

    const res = await app.request("/heartbeat", { method: "GET" });

    expect([404, 405]).toContain(res.status);
  });

  describe("authentication", () => {
    it("accepts unauthenticated requests when no heartbeatToken is configured", async () => {
      const app = createHeartbeatRoute({
        jobQueue: makeJobQueue(),
        heartbeatJob: makeHeartbeatJob(),
        board: makeBoard(),
        logger: makeFakeLogger(),
      });

      const res = await app.request("/heartbeat", { method: "POST" });

      expect(res.status).toBe(202);
    });

    it("returns 401 when token is configured and Authorization header is missing — pre-check not invoked", async () => {
      const jobQueue = makeJobQueue();
      const board = makeBoard();
      const logger = makeFakeLogger();
      const app = createHeartbeatRoute({
        jobQueue,
        heartbeatJob: makeHeartbeatJob(),
        board,
        logger,
        heartbeatToken: "s3cret",
      });

      const res = await app.request("/heartbeat", { method: "POST" });

      expect(res.status).toBe(401);
      expect(board.getTasks).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith("heartbeat rejected");
    });

    it("returns 401 when token is configured and Bearer value does not match", async () => {
      const jobQueue = makeJobQueue();
      const board = makeBoard();
      const app = createHeartbeatRoute({
        jobQueue,
        heartbeatJob: makeHeartbeatJob(),
        board,
        logger: makeFakeLogger(),
        heartbeatToken: "s3cret",
      });

      const res = await app.request("/heartbeat", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      });

      expect(res.status).toBe(401);
      expect(board.getTasks).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it("returns 401 when Authorization uses a non-Bearer scheme", async () => {
      const app = createHeartbeatRoute({
        jobQueue: makeJobQueue(),
        heartbeatJob: makeHeartbeatJob(),
        board: makeBoard(),
        logger: makeFakeLogger(),
        heartbeatToken: "s3cret",
      });

      const res = await app.request("/heartbeat", {
        method: "POST",
        headers: { Authorization: "Basic s3cret" },
      });

      expect(res.status).toBe(401);
    });

    it("returns 202 and enqueues when Bearer value matches the configured token", async () => {
      const jobQueue = makeJobQueue();
      let preCheckChain: Promise<void> | undefined;
      const app = createHeartbeatRoute({
        jobQueue,
        heartbeatJob: makeHeartbeatJob(),
        board: makeBoard(),
        logger: makeFakeLogger(),
        heartbeatToken: "s3cret",
        onPreCheckSettled: (p) => {
          preCheckChain = p;
        },
      });

      const res = await app.request("/heartbeat", {
        method: "POST",
        headers: { Authorization: "Bearer s3cret" },
      });

      expect(res.status).toBe(202);
      await preCheckChain;
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
    });

    it("returns 401 when token values differ only in length", async () => {
      const app = createHeartbeatRoute({
        jobQueue: makeJobQueue(),
        heartbeatJob: makeHeartbeatJob(),
        board: makeBoard(),
        logger: makeFakeLogger(),
        heartbeatToken: "short",
      });

      const res = await app.request("/heartbeat", {
        method: "POST",
        headers: { Authorization: "Bearer shorter-token" },
      });

      expect(res.status).toBe(401);
    });
  });

  describe("logging", () => {
    it('logs info "heartbeat received" on every POST', async () => {
      const logger = makeFakeLogger();
      const app = createHeartbeatRoute({
        jobQueue: makeJobQueue(),
        heartbeatJob: makeHeartbeatJob(),
        board: makeBoard(),
        logger,
      });

      await app.request("/heartbeat", { method: "POST" });
      expect(logger.info).toHaveBeenCalledWith("heartbeat received");
    });

    it('logs info "heartbeat enqueued" when pre-check passes', async () => {
      const logger = makeFakeLogger();
      let preCheckChain: Promise<void> | undefined;
      const app = createHeartbeatRoute({
        jobQueue: makeJobQueue(),
        heartbeatJob: makeHeartbeatJob(),
        board: makeBoard(),
        logger,
        onPreCheckSettled: (p) => {
          preCheckChain = p;
        },
      });

      await app.request("/heartbeat", { method: "POST" });
      await preCheckChain;

      expect(logger.info).toHaveBeenCalledWith("heartbeat enqueued");
    });
  });
});
