import { describe, expect, it, vi, beforeEach } from "vitest";
import { HeartbeatJob } from "../../src/use-cases/heartbeat-job";
import { BoardSectionMissingError } from "../../src/use-cases/ports/board-repository";
import type { BoardRepository } from "../../src/use-cases/ports/board-repository";
import type {
  ShrimpAgent,
  JobInput,
} from "../../src/use-cases/ports/shrimp-agent";
import type { ToolProvider } from "../../src/use-cases/ports/tool-provider";
import type { ToolProviderFactory } from "../../src/use-cases/ports/tool-provider-factory";
import type { LoggerPort } from "../../src/use-cases/ports/logger";
import { NoopTelemetry } from "../../src/infrastructure/telemetry/noop-telemetry";
import type {
  SpanAttributes,
  TelemetryPort,
} from "../../src/use-cases/ports/telemetry";
import { makeFakeLogger } from "../mocks/fake-logger";
import { Section } from "../../src/entities/section";
import { Priority } from "../../src/entities/priority";
import type { Task } from "../../src/entities/task";

// --- Fakes ---

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  title: "Test task",
  priority: Priority.p2,
  section: Section.InProgress,
  ...overrides,
});

function makeBoardRepository(
  overrides: Partial<BoardRepository> = {},
): BoardRepository {
  return {
    validateSections: vi.fn().mockResolvedValue(undefined),
    getTasks: vi.fn().mockResolvedValue([]),
    getComments: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue(undefined),
    moveTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeShrimpAgent(
  result = { reason: "finished" as const, newMessages: [] },
) {
  const agent: ShrimpAgent & { capturedInput?: JobInput } = {
    run: vi.fn().mockImplementation(async (input: JobInput) => {
      (agent as { capturedInput?: JobInput }).capturedInput = input;
      return result;
    }),
  };
  return agent;
}

function makeToolProviderFactory(): ToolProviderFactory {
  const provider: ToolProvider = {
    getTools: vi.fn().mockReturnValue({ get_tasks: {} }),
    getToolDescriptions: vi
      .fn()
      .mockReturnValue([
        { name: "get_tasks", description: "Get tasks from board" },
      ]),
  };
  return { create: vi.fn(() => provider) };
}

function makeJob(
  board: BoardRepository,
  shrimpAgent: ShrimpAgent,
  logger: LoggerPort,
): HeartbeatJob {
  return new HeartbeatJob({
    board,
    shrimpAgent,
    toolProviderFactory: makeToolProviderFactory(),
    maxSteps: 10,
    logger,
    telemetry: new NoopTelemetry(),
  });
}

// --- Tests ---

describe("HeartbeatJob.run", () => {
  let board: BoardRepository;
  let agent: ReturnType<typeof makeShrimpAgent>;
  let logger: LoggerPort;
  let job: HeartbeatJob;

  beforeEach(() => {
    board = makeBoardRepository();
    agent = makeShrimpAgent();
    logger = makeFakeLogger();
    job = makeJob(board, agent, logger);
  });

  it("happy path: selects highest-priority InProgress task, fetches comments, invokes agent with history:[], logs cycle finished", async () => {
    const task = makeTask({ id: "ip-1", section: Section.InProgress });
    board.getTasks = vi
      .fn()
      .mockImplementation(async (section: Section) =>
        section === Section.InProgress ? [task] : [],
      );
    board.getComments = vi
      .fn()
      .mockResolvedValue([
        { text: "prior note", timestamp: new Date(), author: "user" },
      ]);

    await job.run();

    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(agent.capturedInput?.history).toEqual([]);
    expect(agent.capturedInput?.userPrompt).toContain("ip-1");
    expect(agent.capturedInput?.userPrompt).toContain("prior note");
    expect(logger.info).toHaveBeenCalledWith(
      "cycle finished",
      expect.objectContaining({ taskId: "ip-1", reason: "finished" }),
    );
  });

  it("Backlog promotion: no InProgress, one Backlog task → moved then agent invoked with In Progress section", async () => {
    const backlog = makeTask({ id: "bl-1", section: Section.Backlog });
    board.getTasks = vi
      .fn()
      .mockImplementation(async (section: Section) =>
        section === Section.Backlog ? [backlog] : [],
      );

    await job.run();

    expect(board.moveTask).toHaveBeenCalledWith("bl-1", Section.InProgress);
    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(agent.capturedInput?.userPrompt).toContain("Section: In Progress");
    expect(agent.capturedInput?.userPrompt).not.toContain("Section: Backlog");
  });

  it("no actionable tasks: ends immediately without invoking agent", async () => {
    board.getTasks = vi.fn().mockResolvedValue([]);

    await job.run();

    expect(agent.run).not.toHaveBeenCalled();
    expect(board.moveTask).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "cycle idle",
      expect.objectContaining({ reason: "no tasks available" }),
    );
  });

  it("BoardSectionMissingError: logs warn and ends without throwing or calling agent", async () => {
    board.validateSections = vi
      .fn()
      .mockRejectedValue(new BoardSectionMissingError("Done"));

    await expect(job.run()).resolves.toBeUndefined();

    expect(agent.run).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "cycle skipped — board section missing",
      expect.objectContaining({
        missingSection: expect.stringContaining("Done"),
      }),
    );
  });

  it("agent returns maxStepsReached: logs reason, does not throw", async () => {
    const task = makeTask({ section: Section.InProgress });
    board.getTasks = vi
      .fn()
      .mockImplementation(async (section: Section) =>
        section === Section.InProgress ? [task] : [],
      );
    agent.run = vi
      .fn()
      .mockResolvedValue({ reason: "maxStepsReached", newMessages: [] });

    await expect(job.run()).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith(
      "cycle finished",
      expect.objectContaining({ reason: "maxStepsReached" }),
    );
  });

  it("unexpected error propagates out of run", async () => {
    board.getTasks = vi.fn().mockRejectedValue(new Error("network failure"));

    await expect(job.run()).rejects.toThrow("network failure");
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("runs the Job inside a span named POST /heartbeat with http.* attributes", async () => {
    const calls: Array<{ name: string; attributes?: SpanAttributes }> = [];
    const spyTelemetry: TelemetryPort = {
      async runInSpan(name, fn, attributes) {
        calls.push({ name, attributes });
        return fn();
      },
      async shutdown() {},
    };
    const j = new HeartbeatJob({
      board,
      shrimpAgent: agent,
      toolProviderFactory: {
        create: vi.fn(() => ({
          getTools: vi.fn().mockReturnValue({}),
          getToolDescriptions: vi.fn().mockReturnValue([]),
        })),
      },
      maxSteps: 10,
      logger,
      telemetry: spyTelemetry,
    });

    await j.run();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("POST /heartbeat");
    expect(calls[0]!.attributes).toEqual({
      "http.request.method": "POST",
      "http.route": "/heartbeat",
    });
  });
});
