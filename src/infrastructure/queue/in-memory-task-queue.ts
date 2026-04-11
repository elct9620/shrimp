import type { TaskQueue } from '../../use-cases/ports/task-queue'

export class InMemoryTaskQueue implements TaskQueue {
  private busy = false

  tryEnqueue(job: () => Promise<void>): boolean {
    if (this.busy) return false
    this.busy = true
    void this.run(job)
    return true
  }

  private async run(job: () => Promise<void>): Promise<void> {
    try {
      await job()
    } catch {
      // Fail-Open Recovery: errors are not propagated; the slot is always released.
      // A failed cycle is retried naturally on the next heartbeat.
    } finally {
      this.busy = false
    }
  }
}
