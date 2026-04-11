import { describe, expect, it, vi } from 'vitest'
import { createHeartbeatRoute } from '../../../../src/adapters/http/routes/heartbeat'
import type { TaskQueue } from '../../../../src/use-cases/ports/task-queue'
import type { ProcessingCycle } from '../../../../src/use-cases/processing-cycle'
import type { LoggerPort } from '../../../../src/use-cases/ports/logger'

function makeTaskQueue(slotFree = true): TaskQueue {
  return {
    tryEnqueue: vi.fn().mockReturnValue(slotFree),
  }
}

function makeProcessingCycle(runImpl?: () => Promise<void>): ProcessingCycle {
  const impl = runImpl ?? (() => Promise.resolve())
  return { run: vi.fn().mockImplementation(impl) } as unknown as ProcessingCycle
}

function makeFakeLogger(): LoggerPort {
  const logger: LoggerPort = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  }
  return logger
}

describe('POST /heartbeat', () => {
  it('should return 202 with accepted status when queue slot is free', async () => {
    const taskQueue = makeTaskQueue(true)
    const processingCycle = makeProcessingCycle()
    const app = createHeartbeatRoute({ taskQueue, processingCycle, logger: makeFakeLogger() })

    const res = await app.request('/heartbeat', { method: 'POST' })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'accepted' })
  })

  it('should return 202 with accepted status when queue slot is busy', async () => {
    const taskQueue = makeTaskQueue(false)
    const processingCycle = makeProcessingCycle()
    const app = createHeartbeatRoute({ taskQueue, processingCycle, logger: makeFakeLogger() })

    const res = await app.request('/heartbeat', { method: 'POST' })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'accepted' })
  })

  it('should call tryEnqueue exactly once per request', async () => {
    const taskQueue = makeTaskQueue()
    const processingCycle = makeProcessingCycle()
    const app = createHeartbeatRoute({ taskQueue, processingCycle, logger: makeFakeLogger() })

    await app.request('/heartbeat', { method: 'POST' })

    expect(taskQueue.tryEnqueue).toHaveBeenCalledTimes(1)
  })

  it('should pass a job closure that invokes processingCycle.run when executed', async () => {
    let capturedJob: (() => Promise<void>) | undefined
    const taskQueue: TaskQueue = {
      tryEnqueue: vi.fn().mockImplementation((job: () => Promise<void>) => {
        capturedJob = job
        return true
      }),
    }
    const processingCycle = makeProcessingCycle()
    const app = createHeartbeatRoute({ taskQueue, processingCycle, logger: makeFakeLogger() })

    await app.request('/heartbeat', { method: 'POST' })

    expect(capturedJob).toBeDefined()
    await capturedJob!()
    expect(processingCycle.run).toHaveBeenCalledTimes(1)
  })

  it('should return immediately even when processingCycle.run never resolves', async () => {
    let capturedJob: (() => Promise<void>) | undefined
    const taskQueue: TaskQueue = {
      tryEnqueue: vi.fn().mockImplementation((job: () => Promise<void>) => {
        capturedJob = job
        return true
      }),
    }
    // A run() that never resolves
    const processingCycle = makeProcessingCycle(() => new Promise<void>(() => {}))
    const app = createHeartbeatRoute({ taskQueue, processingCycle, logger: makeFakeLogger() })

    const res = await app.request('/heartbeat', { method: 'POST' })

    // Response arrives without awaiting the job
    expect(res.status).toBe(202)
    expect(capturedJob).toBeDefined()
    // We don't invoke capturedJob here — the test proves response didn't wait for it
  })

  it('should accept and ignore an arbitrary request body', async () => {
    const taskQueue = makeTaskQueue()
    const processingCycle = makeProcessingCycle()
    const app = createHeartbeatRoute({ taskQueue, processingCycle, logger: makeFakeLogger() })

    const res = await app.request('/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anything: 'ignored' }),
    })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'accepted' })
  })

  it('should not handle GET /heartbeat (returns 404 or 405)', async () => {
    const taskQueue = makeTaskQueue()
    const processingCycle = makeProcessingCycle()
    const app = createHeartbeatRoute({ taskQueue, processingCycle, logger: makeFakeLogger() })

    const res = await app.request('/heartbeat', { method: 'GET' })

    expect([404, 405]).toContain(res.status)
  })

  describe('logging', () => {
    it('should log info "heartbeat received" on every POST', async () => {
      const taskQueue = makeTaskQueue(true)
      const processingCycle = makeProcessingCycle()
      const logger = makeFakeLogger()
      const app = createHeartbeatRoute({ taskQueue, processingCycle, logger })

      await app.request('/heartbeat', { method: 'POST' })

      expect(logger.info).toHaveBeenCalledWith('heartbeat received')
    })

    it('should log info "heartbeat enqueued" with accepted=true when queue accepts', async () => {
      const taskQueue = makeTaskQueue(true)
      const processingCycle = makeProcessingCycle()
      const logger = makeFakeLogger()
      const app = createHeartbeatRoute({ taskQueue, processingCycle, logger })

      await app.request('/heartbeat', { method: 'POST' })

      expect(logger.info).toHaveBeenCalledWith(
        'heartbeat enqueued',
        expect.objectContaining({ accepted: true }),
      )
    })

    it('should log info "heartbeat enqueued" with accepted=false when queue rejects', async () => {
      const taskQueue = makeTaskQueue(false)
      const processingCycle = makeProcessingCycle()
      const logger = makeFakeLogger()
      const app = createHeartbeatRoute({ taskQueue, processingCycle, logger })

      await app.request('/heartbeat', { method: 'POST' })

      expect(logger.info).toHaveBeenCalledWith(
        'heartbeat enqueued',
        expect.objectContaining({ accepted: false }),
      )
    })
  })
})
