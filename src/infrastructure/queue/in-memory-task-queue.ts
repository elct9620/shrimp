import { injectable, inject } from 'tsyringe'
import type { TaskQueue } from '../../use-cases/ports/task-queue'
import type { LoggerPort } from '../../use-cases/ports/logger'
import { TOKENS } from '../container/tokens'

@injectable()
export class InMemoryTaskQueue implements TaskQueue {
  private busy = false

  constructor(@inject(TOKENS.Logger) private readonly logger: LoggerPort) {}

  tryEnqueue(job: () => Promise<void>): boolean {
    if (this.busy) {
      this.logger.debug('queue job rejected', { reason: 'busy' })
      return false
    }
    this.busy = true
    this.logger.debug('queue job accepted')
    void this.run(job)
    return true
  }

  private async run(job: () => Promise<void>): Promise<void> {
    try {
      await job()
      this.logger.debug('queue job completed')
    } catch (err) {
      // Fail-Open Recovery: errors are not propagated; the slot is always released.
      // A failed cycle is retried naturally on the next heartbeat.
      this.logger.warn('queue job failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      this.busy = false
    }
  }
}
