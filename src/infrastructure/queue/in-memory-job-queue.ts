import { injectable, inject } from "tsyringe";
import type { JobQueue } from "../../use-cases/ports/job-queue";
import type { LoggerPort } from "../../use-cases/ports/logger";
import { TOKENS } from "../container/tokens";

@injectable()
export class InMemoryJobQueue implements JobQueue {
  private busy = false;
  private readonly pending: Array<() => Promise<void>> = [];
  private readonly logger: LoggerPort;

  constructor(@inject(TOKENS.Logger) logger: LoggerPort) {
    this.logger = logger.child({ module: "InMemoryJobQueue" });
  }

  tryEnqueue(job: () => Promise<void>): boolean {
    if (this.busy || this.pending.length > 0) {
      this.logger.debug("queue job rejected", { reason: "busy" });
      return false;
    }
    this.pending.push(job);
    this.logger.debug("queue job accepted");
    void this.drain();
    return true;
  }

  enqueue(job: () => Promise<void>): void {
    this.pending.push(job);
    this.logger.debug("queue job accepted", { pending: this.pending.length });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    const next = this.pending.shift();
    if (next === undefined) return;
    this.busy = true;
    try {
      await next();
      this.logger.debug("queue job completed");
    } catch (err) {
      // Fail-Open Recovery: errors are not propagated; the slot is always released.
      this.logger.warn("queue job failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.busy = false;
      void this.drain();
    }
  }
}
