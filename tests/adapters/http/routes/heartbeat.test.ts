import { describe, expect, it, vi } from "vitest";
import { createHeartbeatRoute } from "../../../../src/adapters/http/routes/heartbeat";
import type { JobQueue } from "../../../../src/use-cases/ports/job-queue";
import type { Job } from "../../../../src/use-cases/job";
import { makeFakeLogger } from "../../../mocks/fake-logger";

function makeJobQueue(slotFree = true): JobQueue {
  return {
    tryEnqueue: vi.fn().mockReturnValue(slotFree),
  };
}

function makeJob(runImpl?: () => Promise<void>): Job {
  const impl = runImpl ?? (() => Promise.resolve());
  return {
    run: vi.fn().mockImplementation(impl),
  } as unknown as Job;
}

describe("POST /heartbeat", () => {
  it("should return 202 with accepted status when queue slot is free", async () => {
    const jobQueue = makeJobQueue(true);
    const job = makeJob();
    const app = createHeartbeatRoute({
      jobQueue,
      job,
      logger: makeFakeLogger(),
    });

    const res = await app.request("/heartbeat", { method: "POST" });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted" });
  });

  it("should return 202 with accepted status when queue slot is busy", async () => {
    const jobQueue = makeJobQueue(false);
    const job = makeJob();
    const app = createHeartbeatRoute({
      jobQueue,
      job,
      logger: makeFakeLogger(),
    });

    const res = await app.request("/heartbeat", { method: "POST" });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted" });
  });

  it("should call tryEnqueue exactly once per request", async () => {
    const jobQueue = makeJobQueue();
    const job = makeJob();
    const app = createHeartbeatRoute({
      jobQueue,
      job,
      logger: makeFakeLogger(),
    });

    await app.request("/heartbeat", { method: "POST" });

    expect(jobQueue.tryEnqueue).toHaveBeenCalledTimes(1);
  });

  it("should pass a job closure that invokes job.run when executed", async () => {
    let capturedJob: (() => Promise<void>) | undefined;
    const jobQueue: JobQueue = {
      tryEnqueue: vi.fn().mockImplementation((job: () => Promise<void>) => {
        capturedJob = job;
        return true;
      }),
    };
    const job = makeJob();
    const app = createHeartbeatRoute({
      jobQueue,
      job,
      logger: makeFakeLogger(),
    });

    await app.request("/heartbeat", { method: "POST" });

    expect(capturedJob).toBeDefined();
    await capturedJob!();
    expect(job.run).toHaveBeenCalledTimes(1);
  });

  it("should return immediately even when job.run never resolves", async () => {
    let capturedJob: (() => Promise<void>) | undefined;
    const jobQueue: JobQueue = {
      tryEnqueue: vi.fn().mockImplementation((job: () => Promise<void>) => {
        capturedJob = job;
        return true;
      }),
    };
    // A run() that never resolves
    const job = makeJob(() => new Promise<void>(() => {}));
    const app = createHeartbeatRoute({
      jobQueue,
      job,
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
    const job = makeJob();
    const app = createHeartbeatRoute({
      jobQueue,
      job,
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
    const job = makeJob();
    const app = createHeartbeatRoute({
      jobQueue,
      job,
      logger: makeFakeLogger(),
    });

    const res = await app.request("/heartbeat", { method: "GET" });

    expect([404, 405]).toContain(res.status);
  });

  describe("logging", () => {
    it('should log info "heartbeat received" on every POST', async () => {
      const jobQueue = makeJobQueue(true);
      const job = makeJob();
      const logger = makeFakeLogger();
      const app = createHeartbeatRoute({ jobQueue, job, logger });

      await app.request("/heartbeat", { method: "POST" });

      expect(logger.info).toHaveBeenCalledWith("heartbeat received");
    });

    it('should log info "heartbeat enqueued" with accepted=true when queue accepts', async () => {
      const jobQueue = makeJobQueue(true);
      const job = makeJob();
      const logger = makeFakeLogger();
      const app = createHeartbeatRoute({ jobQueue, job, logger });

      await app.request("/heartbeat", { method: "POST" });

      expect(logger.info).toHaveBeenCalledWith(
        "heartbeat enqueued",
        expect.objectContaining({ accepted: true }),
      );
    });

    it('should log info "heartbeat enqueued" with accepted=false when queue rejects', async () => {
      const jobQueue = makeJobQueue(false);
      const job = makeJob();
      const logger = makeFakeLogger();
      const app = createHeartbeatRoute({ jobQueue, job, logger });

      await app.request("/heartbeat", { method: "POST" });

      expect(logger.info).toHaveBeenCalledWith(
        "heartbeat enqueued",
        expect.objectContaining({ accepted: false }),
      );
    });
  });
});
