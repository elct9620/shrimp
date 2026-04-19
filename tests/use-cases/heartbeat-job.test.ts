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
import type { TelemetryPort } from "../../src/use-cases/ports/telemetry";
import { makeFakeLogger } from "../mocks/fake-logger";
import { makeSpyTelemetry } from "../mocks/spy-telemetry";
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

const DEFAULT_INPUT = {
  telemetry: {
    spanName: "POST /heartbeat",
    attributes: {
      "http.request.method": "POST",
      "http.route": "/heartbeat",
    },
  },
};

function makeJob(
  board: BoardRepository,
  shrimpAgent: ShrimpAgent,
  logger: LoggerPort,
  telemetry: TelemetryPort = new NoopTelemetry(),
): HeartbeatJob {
  return new HeartbeatJob({
    board,
    shrimpAgent,
    toolProviderFactory: makeToolProviderFactory(),
    maxSteps: 10,
    logger,
    telemetry,
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

    await job.run(DEFAULT_INPUT);

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

    await job.run(DEFAULT_INPUT);

    expect(board.moveTask).toHaveBeenCalledWith("bl-1", Section.InProgress);
    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(agent.capturedInput?.userPrompt).toContain("Section: In Progress");
    expect(agent.capturedInput?.userPrompt).not.toContain("Section: Backlog");
  });

  it("no actionable tasks: ends immediately without invoking agent", async () => {
    board.getTasks = vi.fn().mockResolvedValue([]);

    await job.run(DEFAULT_INPUT);

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

    await expect(job.run(DEFAULT_INPUT)).resolves.toBeUndefined();

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

    await expect(job.run(DEFAULT_INPUT)).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith(
      "cycle finished",
      expect.objectContaining({ reason: "maxStepsReached" }),
    );
  });

  it("unexpected error propagates out of run", async () => {
    board.getTasks = vi.fn().mockRejectedValue(new Error("network failure"));

    await expect(job.run(DEFAULT_INPUT)).rejects.toThrow("network failure");
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("forwards the caller-provided span name and attributes to the telemetry port", async () => {
    const spy = makeSpyTelemetry();
    const j = makeJob(board, agent, logger, spy);

    await j.run({
      telemetry: {
        spanName: "POST /heartbeat",
        attributes: {
          "http.request.method": "POST",
          "http.route": "/heartbeat",
          "user_agent.original": "curl/8.0",
        },
      },
    });

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.name).toBe("POST /heartbeat");
    expect(spy.calls[0]!.attributes).toEqual({
      "http.request.method": "POST",
      "http.route": "/heartbeat",
      "user_agent.original": "curl/8.0",
    });
  });

  it("wraps the Job in a span even when an unexpected error propagates", async () => {
    board.getTasks = vi.fn().mockRejectedValue(new Error("boom"));
    const spy = makeSpyTelemetry();
    const j = makeJob(board, agent, logger, spy);

    await expect(j.run(DEFAULT_INPUT)).rejects.toThrow("boom");
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.name).toBe("POST /heartbeat");
  });
});
