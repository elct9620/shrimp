import { describe, expect, it, vi } from "vitest";
import { InMemoryJobQueue } from "../../../src/infrastructure/queue/in-memory-job-queue";
import { makeFakeLogger } from "../../mocks/fake-logger";

describe("InMemoryJobQueue", () => {
  it("runs a single enqueued job immediately when slot is free", async () => {
    const queue = new InMemoryJobQueue(makeFakeLogger());
    const job = vi.fn().mockResolvedValue(undefined);

    queue.enqueue(job);
    await Promise.resolve();

    expect(job).toHaveBeenCalledTimes(1);
  });

  it("does not propagate errors from the job out of enqueue", async () => {
    const queue = new InMemoryJobQueue(makeFakeLogger());
    const failingJob = vi.fn().mockRejectedValue(new Error("boom"));

    expect(() => queue.enqueue(failingJob)).not.toThrow();

    // let the promise settle without unhandled rejection
    await Promise.resolve();
    await Promise.resolve();
  });

  describe("FIFO buffering", () => {
    it("queues pending jobs while busy and runs them in enqueue order", async () => {
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

    it("releases the slot after a job throws and continues draining", async () => {
      const queue = new InMemoryJobQueue(makeFakeLogger());
      const order: string[] = [];
      const failing = vi.fn().mockRejectedValue(new Error("boom"));
      const follow = async () => {
        order.push("follow");
      };

      queue.enqueue(failing);
      queue.enqueue(follow);

      await new Promise((r) => setTimeout(r, 0));

      expect(failing).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["follow"]);
    });
  });

  describe("logging", () => {
    it('logs debug "queue job accepted" when enqueue is invoked', () => {
      const logger = makeFakeLogger();
      const queue = new InMemoryJobQueue(logger);

      queue.enqueue(vi.fn().mockResolvedValue(undefined));

      expect(logger.debug).toHaveBeenCalledWith(
        "queue job accepted",
        expect.objectContaining({ pending: expect.any(Number) }),
      );
    });

    it('logs debug "queue job completed" after successful run', async () => {
      const logger = makeFakeLogger();
      const queue = new InMemoryJobQueue(logger);

      queue.enqueue(vi.fn().mockResolvedValue(undefined));

      await Promise.resolve();
      await Promise.resolve();

      expect(logger.debug).toHaveBeenCalledWith("queue job completed");
    });

    it('logs warn "queue job failed" with the error message when job rejects', async () => {
      const logger = makeFakeLogger();
      const queue = new InMemoryJobQueue(logger);
      const failingJob = vi.fn().mockRejectedValue(new Error("boom"));

      queue.enqueue(failingJob);

      await Promise.resolve();
      await Promise.resolve();

      expect(logger.warn).toHaveBeenCalledWith(
        "queue job failed",
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });
  });
});
