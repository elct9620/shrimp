import { describe, expect, it, vi } from "vitest";
import { InMemoryJobQueue } from "../../../src/infrastructure/queue/in-memory-job-queue";
import { makeFakeLogger } from "../../mocks/fake-logger";

describe("InMemoryJobQueue", () => {
  it("should return true when slot is free", () => {
    const queue = new InMemoryJobQueue(makeFakeLogger());
    const job = vi.fn().mockResolvedValue(undefined);

    const result = queue.tryEnqueue(job);

    expect(result).toBe(true);
  });

  it("should return false when a job is already in-flight", () => {
    const queue = new InMemoryJobQueue(makeFakeLogger());
    let resolveFirst: () => void;
    const firstJob = () =>
      new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

    queue.tryEnqueue(firstJob);
    const result = queue.tryEnqueue(vi.fn().mockResolvedValue(undefined));

    expect(result).toBe(false);

    // cleanup
    resolveFirst!();
  });

  it("should return false for multiple consecutive enqueue attempts while busy", () => {
    const queue = new InMemoryJobQueue(makeFakeLogger());
    let resolveFirst: () => void;
    const firstJob = () =>
      new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

    queue.tryEnqueue(firstJob);

    const results = [
      queue.tryEnqueue(vi.fn().mockResolvedValue(undefined)),
      queue.tryEnqueue(vi.fn().mockResolvedValue(undefined)),
      queue.tryEnqueue(vi.fn().mockResolvedValue(undefined)),
    ];

    expect(results).toEqual([false, false, false]);

    // cleanup
    resolveFirst!();
  });

  it("should release slot after successful job completion", async () => {
    const queue = new InMemoryJobQueue(makeFakeLogger());
    let resolveFirst: () => void;
    const firstJob = () =>
      new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

    queue.tryEnqueue(firstJob);

    // release the first job
    resolveFirst!();

    // wait for the finally block to run
    await Promise.resolve();

    const result = queue.tryEnqueue(vi.fn().mockResolvedValue(undefined));
    expect(result).toBe(true);
  });

  it("should release slot after job throws", async () => {
    const queue = new InMemoryJobQueue(makeFakeLogger());
    let rejectFirst: (err: Error) => void;
    const failingJob = () =>
      new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      });

    queue.tryEnqueue(failingJob);

    // cause the job to fail
    rejectFirst!(new Error("job failed"));

    // wait for the finally block to run
    await Promise.resolve();

    const result = queue.tryEnqueue(vi.fn().mockResolvedValue(undefined));
    expect(result).toBe(true);
  });

  it("should not propagate errors from the job out of tryEnqueue", async () => {
    const queue = new InMemoryJobQueue(makeFakeLogger());
    const failingJob = vi.fn().mockRejectedValue(new Error("boom"));

    // tryEnqueue is fire-and-forget; errors must not surface here
    expect(() => queue.tryEnqueue(failingJob)).not.toThrow();

    // let the promise settle without unhandled rejection
    await Promise.resolve();
  });

  describe("enqueue (FIFO)", () => {
    it("should queue pending jobs when busy and run them in order after slot releases", async () => {
      const queue = new InMemoryJobQueue(makeFakeLogger());
      const order: string[] = [];
      let resolveFirst: () => void;

      const first = () =>
        new Promise<void>((resolve) => {
          resolveFirst = () => {
            order.push("first");
            resolve();
          };
        });
      const second = async () => {
        order.push("second");
      };
      const third = async () => {
        order.push("third");
      };

      queue.enqueue(first);
      queue.enqueue(second);
      queue.enqueue(third);

      expect(order).toEqual([]);

      resolveFirst!();
      await new Promise((r) => setTimeout(r, 0));

      expect(order).toEqual(["first", "second", "third"]);
    });

    it("should cause tryEnqueue to return false when pending jobs exist even after slot releases", async () => {
      const queue = new InMemoryJobQueue(makeFakeLogger());
      let resolveFirst: () => void;
      const first = () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });

      queue.enqueue(first);
      queue.enqueue(vi.fn().mockResolvedValue(undefined));

      // Even if first resolves, the second is pending so tryEnqueue should still reject.
      resolveFirst!();
      const result = queue.tryEnqueue(vi.fn().mockResolvedValue(undefined));

      expect(result).toBe(false);
    });
  });

  describe("logging", () => {
    it('should log debug "queue job accepted" when enqueue succeeds', () => {
      const logger = makeFakeLogger();
      const queue = new InMemoryJobQueue(logger);

      queue.tryEnqueue(vi.fn().mockResolvedValue(undefined));

      expect(logger.debug).toHaveBeenCalledWith("queue job accepted");
    });

    it('should log debug "queue job rejected" with reason busy when slot is taken', () => {
      const logger = makeFakeLogger();
      const queue = new InMemoryJobQueue(logger);
      let resolveFirst: () => void;
      const firstJob = () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });

      queue.tryEnqueue(firstJob);
      queue.tryEnqueue(vi.fn().mockResolvedValue(undefined));

      expect(logger.debug).toHaveBeenCalledWith(
        "queue job rejected",
        expect.objectContaining({ reason: "busy" }),
      );

      resolveFirst!();
    });

    it('should log debug "queue job completed" after successful run', async () => {
      const logger = makeFakeLogger();
      const queue = new InMemoryJobQueue(logger);

      queue.tryEnqueue(vi.fn().mockResolvedValue(undefined));

      // Wait for both the resolved job and the subsequent finally block
      await Promise.resolve();
      await Promise.resolve();

      expect(logger.debug).toHaveBeenCalledWith("queue job completed");
    });

    it('should log warn "queue job failed" with the error message when job rejects', async () => {
      const logger = makeFakeLogger();
      const queue = new InMemoryJobQueue(logger);
      const failingJob = vi.fn().mockRejectedValue(new Error("boom"));

      queue.tryEnqueue(failingJob);

      await Promise.resolve();
      await Promise.resolve();

      expect(logger.warn).toHaveBeenCalledWith(
        "queue job failed",
        expect.objectContaining({ error: "boom" }),
      );
    });
  });
});
