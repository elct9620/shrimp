import { vi } from 'vitest'
import type { BoardRepository } from '../../../../src/use-cases/ports/board-repository'

export function makeFakeRepo(): BoardRepository {
  return {
    getTasks: vi.fn(),
    getComments: vi.fn(),
    postComment: vi.fn(),
    moveTask: vi.fn(),
  }
}
