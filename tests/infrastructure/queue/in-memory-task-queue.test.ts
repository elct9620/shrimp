import { describe, expect, it, vi } from 'vitest'
import { InMemoryTaskQueue } from '../../../src/infrastructure/queue/in-memory-task-queue'

describe('InMemoryTaskQueue', () => {
  it('should return true when slot is free', () => {
    const queue = new InMemoryTaskQueue()
    const job = vi.fn().mockResolvedValue(undefined)

    const result = queue.tryEnqueue(job)

    expect(result).toBe(true)
  })

  it('should return false when a job is already in-flight', () => {
    const queue = new InMemoryTaskQueue()
    let resolveFirst: () => void
    const firstJob = () => new Promise<void>((resolve) => { resolveFirst = resolve })

    queue.tryEnqueue(firstJob)
    const result = queue.tryEnqueue(vi.fn().mockResolvedValue(undefined))

    expect(result).toBe(false)

    // cleanup
    resolveFirst!()
  })

  it('should return false for multiple consecutive enqueue attempts while busy', () => {
    const queue = new InMemoryTaskQueue()
    let resolveFirst: () => void
    const firstJob = () => new Promise<void>((resolve) => { resolveFirst = resolve })

    queue.tryEnqueue(firstJob)

    const results = [
      queue.tryEnqueue(vi.fn().mockResolvedValue(undefined)),
      queue.tryEnqueue(vi.fn().mockResolvedValue(undefined)),
      queue.tryEnqueue(vi.fn().mockResolvedValue(undefined)),
    ]

    expect(results).toEqual([false, false, false])

    // cleanup
    resolveFirst!()
  })

  it('should release slot after successful job completion', async () => {
    const queue = new InMemoryTaskQueue()
    let resolveFirst: () => void
    const firstJob = () => new Promise<void>((resolve) => { resolveFirst = resolve })

    queue.tryEnqueue(firstJob)

    // release the first job
    resolveFirst!()

    // wait for the finally block to run
    await Promise.resolve()

    const result = queue.tryEnqueue(vi.fn().mockResolvedValue(undefined))
    expect(result).toBe(true)
  })

  it('should release slot after job throws', async () => {
    const queue = new InMemoryTaskQueue()
    let rejectFirst: (err: Error) => void
    const failingJob = () => new Promise<void>((_resolve, reject) => { rejectFirst = reject })

    queue.tryEnqueue(failingJob)

    // cause the job to fail
    rejectFirst!(new Error('job failed'))

    // wait for the finally block to run
    await Promise.resolve()

    const result = queue.tryEnqueue(vi.fn().mockResolvedValue(undefined))
    expect(result).toBe(true)
  })

  it('should not propagate errors from the job out of tryEnqueue', async () => {
    const queue = new InMemoryTaskQueue()
    const failingJob = vi.fn().mockRejectedValue(new Error('boom'))

    // tryEnqueue is fire-and-forget; errors must not surface here
    expect(() => queue.tryEnqueue(failingJob)).not.toThrow()

    // let the promise settle without unhandled rejection
    await Promise.resolve()
  })
})
