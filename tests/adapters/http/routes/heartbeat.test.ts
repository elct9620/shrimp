import { describe, expect, it, vi } from "vitest";
import { createHeartbeatRoute } from "../../../../src/adapters/http/routes/heartbeat";
import type { JobQueue } from "../../../../src/use-cases/ports/job-queue";
import type { HeartbeatJob } from "../../../../src/use-cases/heartbeat-job";
import { makeFakeLogger } from "../../../mocks/fake-logger";

function makeJobQueue(slotFree = true): JobQueue {
  return {
    tryEnqueue: vi.fn().mockReturnValue(slotFree),
  };
}

function makeHeartbeatJob(runImpl?: () => Promise<void>): HeartbeatJob {
  const impl = runImpl ?? (() => Promise.resolve());
  return {
    run: vi.fn().mockImplementation(impl),
  } as unknown as HeartbeatJob;
}

describe("POST /heartbeat", () => {
  it("should return 202 with accepted status when queue slot is free", async () => {
    const jobQueue = makeJobQueue(true);
    const heartbeatJob = makeHeartbeatJob();
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob,
      logger: makeFakeLogger(),
    });

    const res = await app.request("/heartbeat", { method: "POST" });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted" });
  });

  it("should return 202 with accepted status when queue slot is busy", async () => {
    const jobQueue = makeJobQueue(false);
    const heartbeatJob = makeHeartbeatJob();
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob,
      logger: makeFakeLogger(),
    });

    const res = await app.request("/heartbeat", { method: "POST" });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted" });
  });

  it("should call tryEnqueue exactly once per request", async () => {
    const jobQueue = makeJobQueue();
    const heartbeatJob = makeHeartbeatJob();
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob,
      logger: makeFakeLogger(),
    });

    await app.request("/heartbeat", { method: "POST" });

    expect(jobQueue.tryEnqueue).toHaveBeenCalledTimes(1);
  });

  it("should pass a job closure that invokes heartbeatJob.run when executed", async () => {
    let capturedJob: (() => Promise<void>) | undefined;
    const jobQueue: JobQueue = {
      tryEnqueue: vi.fn().mockImplementation((job: () => Promise<void>) => {
        capturedJob = job;
        return true;
      }),
    };
    const heartbeatJob = makeHeartbeatJob();
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob,
      logger: makeFakeLogger(),
    });

    await app.request("/heartbeat", { method: "POST" });

    expect(capturedJob).toBeDefined();
    await capturedJob!();
    expect(heartbeatJob.run).toHaveBeenCalledWith({
      telemetry: {
        spanName: "POST /heartbeat",
        attributes: {
          "http.request.method": "POST",
          "http.route": "/heartbeat",
        },
      },
    });
  });

  it("should return immediately even when heartbeatJob.run never resolves", async () => {
    let capturedJob: (() => Promise<void>) | undefined;
    const jobQueue: JobQueue = {
      tryEnqueue: vi.fn().mockImplementation((job: () => Promise<void>) => {
        capturedJob = job;
        return true;
      }),
    };
    // A run() that never resolves
    const heartbeatJob = makeHeartbeatJob(() => new Promise<void>(() => {}));
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob,
      logger: makeFakeLogger(),
    });

    const res = await app.request("/heartbeat", { method: "POST" });

    // Response arrives without awaiting the job
    expect(res.status).toBe(202);
    expect(capturedJob).toBeDefined();
    // We don't invoke capturedJob here — the test proves response didn't wait for it
  });

  it("should accept and ignore an arbitrary request body", async () => {
    const jobQueue = makeJobQueue();
    const heartbeatJob = makeHeartbeatJob();
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob,
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

  it("should not handle GET /heartbeat (returns 404 or 405)", async () => {
    const jobQueue = makeJobQueue();
    const heartbeatJob = makeHeartbeatJob();
    const app = createHeartbeatRoute({
      jobQueue,
      heartbeatJob,
      logger: makeFakeLogger(),
    });

    const res = await app.request("/heartbeat", { method: "GET" });

    expect([404, 405]).toContain(res.status);
  });

  describe("authentication", () => {
    it("should accept unauthenticated requests when no heartbeatToken is configured", async () => {
      const app = createHeartbeatRoute({
        jobQueue: makeJobQueue(),
        heartbeatJob: makeHeartbeatJob(),
        logger: makeFakeLogger(),
      });

      const res = await app.request("/heartbeat", { method: "POST" });

      expect(res.status).toBe(202);
    });

    it("should return 401 when token is configured and Authorization header is missing", async () => {
      const jobQueue = makeJobQueue();
      const logger = makeFakeLogger();
      const app = createHeartbeatRoute({
        jobQueue,
        heartbeatJob: makeHeartbeatJob(),
        logger,
        heartbeatToken: "s3cret",
      });

      const res = await app.request("/heartbeat", { method: "POST" });

      expect(res.status).toBe(401);
      expect(jobQueue.tryEnqueue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith("heartbeat rejected");
    });

    it("should return 401 when token is configured and Bearer value does not match", async () => {
      const jobQueue = makeJobQueue();
      const app = createHeartbeatRoute({
        jobQueue,
        heartbeatJob: makeHeartbeatJob(),
        logger: makeFakeLogger(),
        heartbeatToken: "s3cret",
      });

      const res = await app.request("/heartbeat", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      });

      expect(res.status).toBe(401);
      expect(jobQueue.tryEnqueue).not.toHaveBeenCalled();
    });

    it("should return 401 when Authorization uses a non-Bearer scheme", async () => {
      const app = createHeartbeatRoute({
        jobQueue: makeJobQueue(),
        heartbeatJob: makeHeartbeatJob(),
        logger: makeFakeLogger(),
        heartbeatToken: "s3cret",
      });

      const res = await app.request("/heartbeat", {
        method: "POST",
        headers: { Authorization: "Basic s3cret" },
      });

      expect(res.status).toBe(401);
    });

    it("should return 202 when Bearer value matches the configured token", async () => {
      const jobQueue = makeJobQueue();
      const app = createHeartbeatRoute({
        jobQueue,
        heartbeatJob: makeHeartbeatJob(),
        logger: makeFakeLogger(),
        heartbeatToken: "s3cret",
      });

      const res = await app.request("/heartbeat", {
        method: "POST",
        headers: { Authorization: "Bearer s3cret" },
      });

      expect(res.status).toBe(202);
      expect(jobQueue.tryEnqueue).toHaveBeenCalledTimes(1);
    });

    it("should return 401 when token values differ only in length (avoids timing-safe length mismatch throw)", async () => {
      const app = createHeartbeatRoute({
        jobQueue: makeJobQueue(),
        heartbeatJob: makeHeartbeatJob(),
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
    it('should log info "heartbeat received" on every POST', async () => {
      const jobQueue = makeJobQueue(true);
      const heartbeatJob = makeHeartbeatJob();
      const logger = makeFakeLogger();
      const app = createHeartbeatRoute({ jobQueue, heartbeatJob, logger });

      await app.request("/heartbeat", { method: "POST" });

      expect(logger.info).toHaveBeenCalledWith("heartbeat received");
    });

    it('should log info "heartbeat enqueued" with accepted=true when queue accepts', async () => {
      const jobQueue = makeJobQueue(true);
      const heartbeatJob = makeHeartbeatJob();
      const logger = makeFakeLogger();
      const app = createHeartbeatRoute({ jobQueue, heartbeatJob, logger });

      await app.request("/heartbeat", { method: "POST" });

      expect(logger.info).toHaveBeenCalledWith(
        "heartbeat enqueued",
        expect.objectContaining({ accepted: true }),
      );
    });

    it('should log info "heartbeat enqueued" with accepted=false when queue rejects', async () => {
      const jobQueue = makeJobQueue(false);
      const heartbeatJob = makeHeartbeatJob();
      const logger = makeFakeLogger();
      const app = createHeartbeatRoute({ jobQueue, heartbeatJob, logger });

      await app.request("/heartbeat", { method: "POST" });

      expect(logger.info).toHaveBeenCalledWith(
        "heartbeat enqueued",
        expect.objectContaining({ accepted: false }),
      );
    });
  });
});
