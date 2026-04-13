import { vi } from "vitest";
import type { BoardRepository } from "../../../../src/use-cases/ports/board-repository";

export { makeFakeLogger } from "../../../mocks/fake-logger";

export function makeFakeRepo(): BoardRepository {
  return {
    validateSections: vi.fn(),
    getTasks: vi.fn(),
    getComments: vi.fn(),
    postComment: vi.fn(),
    moveTask: vi.fn(),
  };
}
