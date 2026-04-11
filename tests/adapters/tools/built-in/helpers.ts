import { vi } from 'vitest'
import type { BoardRepository } from '../../../../src/use-cases/ports/board-repository'
import type { LoggerPort } from '../../../../src/use-cases/ports/logger'

export function makeFakeRepo(): BoardRepository {
  return {
    getTasks: vi.fn(),
    getComments: vi.fn(),
    postComment: vi.fn(),
    moveTask: vi.fn(),
  }
}

export function makeFakeLogger(): LoggerPort {
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
