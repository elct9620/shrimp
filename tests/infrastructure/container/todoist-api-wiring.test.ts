import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted spy: vi.mock factories run before module-level test code, so the
// spy must be created via vi.hoisted() to be referenceable inside the factory.
const constructorSpy = vi.hoisted(() => vi.fn());

vi.mock("@doist/todoist-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@doist/todoist-sdk")>();
  return {
    ...original,
    TodoistApi: class MockTodoistApi extends original.TodoistApi {
      constructor(token: string, options?: unknown) {
        super(token, options as never);
        constructorSpy(token, options);
      }
    },
  };
});

// Import container.ts AFTER vi.mock so the mock is in place
import { container } from "../../../src/container";
import { TOKENS } from "../../../src/infrastructure/container/tokens";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";

function makeStubLogger(): LoggerPort {
  const logger: LoggerPort = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

describe("TOKENS.BoardRepository wiring — TodoistApi customFetch", () => {
  beforeEach(() => {
    container.clearInstances();
    constructorSpy.mockClear();
  });

  it("constructs TodoistApi with a customFetch option so undici dispatcher is never reached", () => {
    const logger = makeStubLogger();
    container.registerInstance(TOKENS.Logger, logger);
    container.registerInstance(TOKENS.EnvConfig, {
      todoistApiToken: "test-token",
      todoistProjectId: "proj-1",
    } as never);

    // Resolving BoardRepository triggers the factory which calls new TodoistApi(...)
    container.resolve(TOKENS.BoardRepository);

    expect(constructorSpy).toHaveBeenCalledOnce();
    const options = constructorSpy.mock.calls[0]?.[1] as
      | { customFetch?: unknown }
      | undefined;
    expect(options).toBeDefined();
    expect(typeof options?.customFetch).toBe("function");
  });
});
