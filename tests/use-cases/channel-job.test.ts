import { describe, expect, it, vi, beforeEach } from "vitest";
import { ChannelJob } from "../../src/use-cases/channel-job";
import type {
  SessionRepository,
  Session,
} from "../../src/use-cases/ports/session-repository";
import {
  SessionJsonlWriteError,
  SessionStateUpdateError,
} from "../../src/use-cases/ports/session-repository";
import type {
  ShrimpAgent,
  JobInput,
} from "../../src/use-cases/ports/shrimp-agent";
import type { ToolProvider } from "../../src/use-cases/ports/tool-provider";
import type { ToolProviderFactory } from "../../src/use-cases/ports/tool-provider-factory";
import type { LoggerPort } from "../../src/use-cases/ports/logger";
import type { ChannelGateway } from "../../src/use-cases/ports/channel-gateway";
import { NoopTelemetry } from "../../src/infrastructure/telemetry/noop-telemetry";
import type { TelemetryPort } from "../../src/use-cases/ports/telemetry";
import { makeFakeLogger } from "../mocks/fake-logger";
import { makeSpyTelemetry } from "../mocks/spy-telemetry";
import type { ConversationMessage } from "../../src/entities/conversation-message";
import type { ConversationRef } from "../../src/entities/conversation-ref";
import type { SummarizePort } from "../../src/use-cases/ports/summarize";

// --- Fakes ---

const makeRef = (): ConversationRef => ({
  channel: "telegram",
  payload: { chatId: "123" },
});

const DEFAULT_TELEMETRY = {
  spanName: "POST /channels/telegram",
  attributes: {
    "http.request.method": "POST",
    "http.route": "/channels/telegram",
  },
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    messages: [],
    ...overrides,
  };
}

function makeSessionRepository(
  overrides: Partial<SessionRepository> = {},
): SessionRepository {
  return {
    getCurrent: vi.fn().mockResolvedValue(null),
    createNew: vi.fn().mockResolvedValue(makeSession({ id: "session-new" })),
    append: vi.fn().mockResolvedValue(undefined),
    rotateWithSummary: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeShrimpAgent(
  result = {
    reason: "finished" as const,
    newMessages: [{ role: "assistant" as const, content: "Reply text" }],
    promptTokens: undefined as number | undefined,
  },
) {
  const agent: ShrimpAgent & { capturedInput?: JobInput } = {
    run: vi.fn().mockImplementation(async (input: JobInput) => {
      (agent as { capturedInput?: JobInput }).capturedInput = input;
      return result;
    }),
  };
  return agent;
}

function makeToolProviderFactory(): ToolProviderFactory & {
  create: ReturnType<typeof vi.fn>;
} {
  const provider: ToolProvider = {
    getTools: vi.fn().mockReturnValue({}),
    getToolDescriptions: vi.fn().mockReturnValue([]),
  };
  return { create: vi.fn(() => provider) };
}

function makeChannelGateway(): ChannelGateway & {
  reply: ReturnType<typeof vi.fn>;
  indicateProcessing: ReturnType<typeof vi.fn>;
} {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    indicateProcessing: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSummarizePort(summary = "Summarized history"): SummarizePort & {
  summarize: ReturnType<typeof vi.fn>;
} {
  return {
    summarize: vi.fn().mockResolvedValue(summary),
  };
}

function makeJob(
  sessionRepo: SessionRepository,
  shrimpAgent: ShrimpAgent,
  logger: LoggerPort,
  toolProviderFactory?: ToolProviderFactory,
  channelGateway?: ChannelGateway,
  telemetry: TelemetryPort = new NoopTelemetry(),
  summarize?: SummarizePort,
  compactionThreshold?: number,
): ChannelJob {
  return new ChannelJob({
    sessionRepository: sessionRepo,
    channelGateway: channelGateway ?? makeChannelGateway(),
    shrimpAgent,
    toolProviderFactory: toolProviderFactory ?? makeToolProviderFactory(),
    maxSteps: 10,
    logger,
    telemetry,
    summarize,
    compactionThreshold,
  });
}

// --- Tests ---

describe("ChannelJob.run", () => {
  let sessionRepo: SessionRepository;
  let agent: ReturnType<typeof makeShrimpAgent>;
  let logger: LoggerPort;
  let job: ChannelJob;

  beforeEach(() => {
    sessionRepo = makeSessionRepository();
    agent = makeShrimpAgent();
    logger = makeFakeLogger();
    job = makeJob(sessionRepo, agent, logger);
  });

  it("first message: getCurrent returns null → createNew called, user msg appended, agent invoked with history:[], sessionId set, assistant messages appended", async () => {
    const newSession = makeSession({ id: "session-new", messages: [] });
    sessionRepo.getCurrent = vi.fn().mockResolvedValue(null);
    sessionRepo.createNew = vi.fn().mockResolvedValue(newSession);

    await job.run({
      message: "Hello bot",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    expect(sessionRepo.createNew).toHaveBeenCalledTimes(1);

    // User message appended before agent call
    expect(sessionRepo.append).toHaveBeenCalledWith("session-new", [
      { role: "user", content: "Hello bot" },
    ]);

    // Agent invoked with empty history (new session had no prior messages)
    expect(agent.capturedInput?.history).toEqual([]);
    expect(agent.capturedInput?.userPrompt).toBe("Hello bot");
    expect(agent.capturedInput?.sessionId).toBe("session-new");

    // Assistant new messages appended after agent call
    const appendCalls = (sessionRepo.append as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(appendCalls).toHaveLength(2);
    expect(appendCalls[1]).toEqual([
      "session-new",
      [{ role: "assistant", content: "Reply text" }],
    ]);

    expect(logger.info).toHaveBeenCalledWith(
      "cycle finished",
      expect.objectContaining({ sessionId: "session-new", reason: "finished" }),
    );
  });

  it("subsequent message: existing session with history → agent invoked with prior messages as history", async () => {
    const priorMessages: ConversationMessage[] = [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
    ];
    const existingSession = makeSession({
      id: "session-existing",
      messages: priorMessages,
    });
    sessionRepo.getCurrent = vi.fn().mockResolvedValue(existingSession);

    await job.run({
      message: "Follow up",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    expect(sessionRepo.createNew).not.toHaveBeenCalled();
    expect(agent.capturedInput?.history).toEqual(priorMessages);
    expect(agent.capturedInput?.userPrompt).toBe("Follow up");
    expect(agent.capturedInput?.sessionId).toBe("session-existing");
  });

  it("agent throws: error propagates out of run (consistent with HeartbeatJob — JobQueue handles slot release)", async () => {
    const existingSession = makeSession({ id: "session-1" });
    sessionRepo.getCurrent = vi.fn().mockResolvedValue(existingSession);
    agent.run = vi.fn().mockRejectedValue(new Error("agent exploded"));

    await expect(
      job.run({
        message: "Trigger error",
        ref: makeRef(),
        telemetry: DEFAULT_TELEMETRY,
      }),
    ).rejects.toThrow("agent exploded");
  });

  it("assembles the system prompt via the shared assembler (includes base principles and tool descriptions)", async () => {
    const factory: ToolProviderFactory = {
      create: vi.fn(() => ({
        getTools: vi.fn().mockReturnValue({}),
        getToolDescriptions: vi
          .fn()
          .mockReturnValue([
            { name: "search_web", description: "Search the web" },
          ]),
      })),
    };
    const j = makeJob(sessionRepo, agent, logger, factory);

    await j.run({
      message: "Hi",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    const systemPrompt = agent.capturedInput?.systemPrompt ?? "";
    expect(systemPrompt).toContain("## Operating Principles");
    expect(systemPrompt).toContain("## Conversation Style");
    expect(systemPrompt).toContain("search_web");
    expect(systemPrompt).toContain("Search the web");
    expect(systemPrompt).not.toMatch(/^You are/);
  });

  it("signals processing to ChannelGateway before invoking the agent so users see a working indicator", async () => {
    const ref = makeRef();
    const gateway = makeChannelGateway();

    const order: string[] = [];
    gateway.indicateProcessing = vi.fn().mockImplementation(async () => {
      order.push("indicate");
    });
    agent.run = vi.fn().mockImplementation(async () => {
      order.push("agent");
      return { reason: "finished" as const, newMessages: [] };
    });

    const j = makeJob(
      sessionRepo,
      agent,
      logger,
      makeToolProviderFactory(),
      gateway,
    );

    await j.run({ message: "Hi", ref, telemetry: DEFAULT_TELEMETRY });

    expect(gateway.indicateProcessing).toHaveBeenCalledWith(ref);
    expect(order).toEqual(["indicate", "agent"]);
  });

  it("delivers the agent's assistant reply directly via ChannelGateway", async () => {
    const ref = makeRef();
    const gateway = makeChannelGateway();
    const j = makeJob(
      sessionRepo,
      agent,
      logger,
      makeToolProviderFactory(),
      gateway,
    );

    await j.run({ message: "Hi", ref, telemetry: DEFAULT_TELEMETRY });

    expect(gateway.reply).toHaveBeenCalledWith(ref, "Reply text");
  });

  it("user msg is appended before agent invocation so transcript is preserved on agent failure", async () => {
    const session = makeSession({ id: "session-1" });
    sessionRepo.getCurrent = vi.fn().mockResolvedValue(session);

    const appendOrder: string[] = [];
    sessionRepo.append = vi.fn().mockImplementation(async () => {
      appendOrder.push("append");
    });
    agent.run = vi.fn().mockImplementation(async () => {
      appendOrder.push("agent");
      return { reason: "finished", newMessages: [] };
    });

    await job.run({
      message: "Msg",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    expect(appendOrder[0]).toBe("append");
    expect(appendOrder[1]).toBe("agent");
  });

  it("forwards the caller-provided span name and attributes to the telemetry port", async () => {
    const spy = makeSpyTelemetry();
    const j = makeJob(sessionRepo, agent, logger, undefined, undefined, spy);

    await j.run({
      message: "Hi",
      ref: makeRef(),
      telemetry: {
        spanName: "POST /channels/telegram",
        attributes: {
          "http.request.method": "POST",
          "http.route": "/channels/telegram",
          "telegram.chat.id": 42,
          "user_agent.original": "TelegramBot",
        },
      },
    });

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.name).toBe("POST /channels/telegram");
    expect(spy.calls[0]!.attributes).toEqual({
      "http.request.method": "POST",
      "http.route": "/channels/telegram",
      "telegram.chat.id": 42,
      "user_agent.original": "TelegramBot",
    });
  });

  it("wraps the Job in a span even when the agent propagates an error", async () => {
    const existingSession = makeSession({ id: "session-1" });
    sessionRepo.getCurrent = vi.fn().mockResolvedValue(existingSession);
    agent.run = vi.fn().mockRejectedValue(new Error("boom"));
    const spy = makeSpyTelemetry();
    const j = makeJob(sessionRepo, agent, logger, undefined, undefined, spy);

    await expect(
      j.run({
        message: "Trigger",
        ref: makeRef(),
        telemetry: DEFAULT_TELEMETRY,
      }),
    ).rejects.toThrow("boom");
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.name).toBe("POST /channels/telegram");
  });
});

describe("ChannelJob.run — Auto Compact", () => {
  const THRESHOLD = 1000;

  function makeAgentWithTokens(promptTokens: number | undefined) {
    return makeShrimpAgent({
      reason: "finished" as const,
      newMessages: [{ role: "assistant" as const, content: "Reply" }],
      promptTokens,
    });
  }

  it("should invoke SummarizePort and rotateWithSummary when promptTokens meets threshold", async () => {
    const priorMessages: ConversationMessage[] = [
      { role: "user", content: "Earlier message" },
      { role: "assistant", content: "Earlier reply" },
    ];
    const session = makeSession({ id: "session-1", messages: priorMessages });
    const sessionRepo = makeSessionRepository({
      getCurrent: vi.fn().mockResolvedValue(session),
    });
    const summarizePort = makeSummarizePort("Compact summary text");
    const agentWithTokens = makeAgentWithTokens(THRESHOLD); // exactly at threshold
    const logger = makeFakeLogger();

    const job = makeJob(
      sessionRepo,
      agentWithTokens,
      logger,
      undefined,
      undefined,
      new NoopTelemetry(),
      summarizePort,
      THRESHOLD,
    );

    await job.run({
      message: "New message",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    expect(summarizePort.summarize).toHaveBeenCalledTimes(1);
    expect(sessionRepo.rotateWithSummary).toHaveBeenCalledTimes(1);
    expect(sessionRepo.rotateWithSummary).toHaveBeenCalledWith(
      "Compact summary text",
    );
  });

  it("should pass post-append snapshot (prior + user + assistant messages) to SummarizePort", async () => {
    const priorMessages: ConversationMessage[] = [
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Earlier reply" },
    ];
    const session = makeSession({ id: "session-1", messages: priorMessages });
    const sessionRepo = makeSessionRepository({
      getCurrent: vi.fn().mockResolvedValue(session),
    });
    const summarizePort = makeSummarizePort();
    const agentWithTokens = makeAgentWithTokens(THRESHOLD);

    const job = makeJob(
      sessionRepo,
      agentWithTokens,
      makeFakeLogger(),
      undefined,
      undefined,
      new NoopTelemetry(),
      summarizePort,
      THRESHOLD,
    );

    await job.run({
      message: "New message",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    // Snapshot must include prior messages + user message + assistant reply
    const capturedHistory = summarizePort.summarize.mock.calls[0]?.[0]?.history;
    expect(capturedHistory).toEqual([
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Earlier reply" },
      { role: "user", content: "New message" },
      { role: "assistant", content: "Reply" },
    ]);
  });

  it("should pass jobId to SummarizePort for correlation", async () => {
    const session = makeSession({ id: "session-1", messages: [] });
    const sessionRepo = makeSessionRepository({
      getCurrent: vi.fn().mockResolvedValue(session),
    });
    const summarizePort = makeSummarizePort();
    const agentWithTokens = makeAgentWithTokens(THRESHOLD);

    const job = makeJob(
      sessionRepo,
      agentWithTokens,
      makeFakeLogger(),
      undefined,
      undefined,
      new NoopTelemetry(),
      summarizePort,
      THRESHOLD,
    );

    await job.run({
      message: "Hi",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    const capturedJobId = summarizePort.summarize.mock.calls[0]?.[0]?.jobId;
    expect(typeof capturedJobId).toBe("string");
    expect(capturedJobId).toBeTruthy();
  });

  it("should skip compaction when promptTokens is below threshold", async () => {
    const session = makeSession({ id: "session-1", messages: [] });
    const sessionRepo = makeSessionRepository({
      getCurrent: vi.fn().mockResolvedValue(session),
    });
    const summarizePort = makeSummarizePort();
    const agentBelowThreshold = makeAgentWithTokens(THRESHOLD - 1);

    const job = makeJob(
      sessionRepo,
      agentBelowThreshold,
      makeFakeLogger(),
      undefined,
      undefined,
      new NoopTelemetry(),
      summarizePort,
      THRESHOLD,
    );

    await job.run({
      message: "Hi",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    expect(summarizePort.summarize).not.toHaveBeenCalled();
    expect(sessionRepo.rotateWithSummary).not.toHaveBeenCalled();
  });

  it("should skip compaction when promptTokens is undefined (provider did not report usage)", async () => {
    const session = makeSession({ id: "session-1", messages: [] });
    const sessionRepo = makeSessionRepository({
      getCurrent: vi.fn().mockResolvedValue(session),
    });
    const summarizePort = makeSummarizePort();
    const agentNoTokens = makeAgentWithTokens(undefined);

    const job = makeJob(
      sessionRepo,
      agentNoTokens,
      makeFakeLogger(),
      undefined,
      undefined,
      new NoopTelemetry(),
      summarizePort,
      THRESHOLD,
    );

    await job.run({
      message: "Hi",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    expect(summarizePort.summarize).not.toHaveBeenCalled();
    expect(sessionRepo.rotateWithSummary).not.toHaveBeenCalled();
  });

  it("should skip compaction when no compactionThreshold is configured (channels-disabled path)", async () => {
    const session = makeSession({ id: "session-1", messages: [] });
    const sessionRepo = makeSessionRepository({
      getCurrent: vi.fn().mockResolvedValue(session),
    });
    const summarizePort = makeSummarizePort();
    // No threshold provided — simulates ChannelJob built without auto-compact config
    const agentWithTokens = makeAgentWithTokens(9999);

    const job = makeJob(
      sessionRepo,
      agentWithTokens,
      makeFakeLogger(),
      undefined,
      undefined,
      new NoopTelemetry(),
      summarizePort,
      undefined, // no threshold
    );

    await job.run({
      message: "Hi",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    expect(summarizePort.summarize).not.toHaveBeenCalled();
    expect(sessionRepo.rotateWithSummary).not.toHaveBeenCalled();
  });

  it("should ensure append happens before the snapshot is taken for SummarizePort", async () => {
    const session = makeSession({ id: "session-1", messages: [] });
    const sessionRepo = makeSessionRepository({
      getCurrent: vi.fn().mockResolvedValue(session),
    });
    const appendOrder: string[] = [];
    let snapshotAtSummarizeCall: readonly ConversationMessage[] = [];

    sessionRepo.append = vi.fn().mockImplementation(async () => {
      appendOrder.push("append");
    });

    const summarizePort: SummarizePort = {
      summarize: vi
        .fn()
        .mockImplementation(
          async ({ history }: { history: readonly ConversationMessage[] }) => {
            snapshotAtSummarizeCall = history;
            appendOrder.push("summarize");
            return "summary";
          },
        ),
    };

    const agentWithTokens = makeAgentWithTokens(THRESHOLD);

    const job = makeJob(
      sessionRepo,
      agentWithTokens,
      makeFakeLogger(),
      undefined,
      undefined,
      new NoopTelemetry(),
      summarizePort,
      THRESHOLD,
    );

    await job.run({
      message: "Hello",
      ref: makeRef(),
      telemetry: DEFAULT_TELEMETRY,
    });

    // Both appends happen before summarize
    expect(appendOrder[0]).toBe("append"); // user msg append
    expect(appendOrder[1]).toBe("append"); // assistant msg append
    expect(appendOrder[2]).toBe("summarize");

    // Snapshot includes the user message that was appended
    expect(snapshotAtSummarizeCall).toContainEqual({
      role: "user",
      content: "Hello",
    });
    // Snapshot includes the assistant reply that was appended
    expect(snapshotAtSummarizeCall).toContainEqual({
      role: "assistant",
      content: "Reply",
    });
  });
});

describe("ChannelJob.run — Auto Compact Fail-Open", () => {
  const THRESHOLD = 1000;

  function makeAgentAtThreshold() {
    return makeShrimpAgent({
      reason: "finished" as const,
      newMessages: [{ role: "assistant" as const, content: "Reply" }],
      promptTokens: THRESHOLD,
    });
  }

  it("should complete successfully and not call rotateWithSummary when SummarizePort throws", async () => {
    const session = makeSession({ id: "session-1", messages: [] });
    const sessionRepo = makeSessionRepository({
      getCurrent: vi.fn().mockResolvedValue(session),
    });
    const gateway = makeChannelGateway();
    const logger = makeFakeLogger();

    const summarizePort: SummarizePort = {
      summarize: vi.fn().mockRejectedValue(new Error("provider timeout")),
    };

    const job = makeJob(
      sessionRepo,
      makeAgentAtThreshold(),
      logger,
      undefined,
      gateway,
      new NoopTelemetry(),
      summarizePort,
      THRESHOLD,
    );

    // Job must resolve without throwing
    await expect(
      job.run({ message: "Hi", ref: makeRef(), telemetry: DEFAULT_TELEMETRY }),
    ).resolves.toBeUndefined();

    // rotateWithSummary must NOT have been called
    expect(sessionRepo.rotateWithSummary).not.toHaveBeenCalled();

    // Reply must still have been delivered
    expect(gateway.reply).toHaveBeenCalledWith(makeRef(), "Reply");

    // Error must be logged with cause
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("summarize failed"),
      expect.objectContaining({ cause: expect.any(Error) }),
    );
  });

  it("should complete successfully when rotateWithSummary throws SessionJsonlWriteError", async () => {
    const session = makeSession({ id: "session-1", messages: [] });
    const sessionRepo = makeSessionRepository({
      getCurrent: vi.fn().mockResolvedValue(session),
      rotateWithSummary: vi
        .fn()
        .mockRejectedValue(new SessionJsonlWriteError(new Error("disk full"))),
    });
    const gateway = makeChannelGateway();
    const logger = makeFakeLogger();

    const job = makeJob(
      sessionRepo,
      makeAgentAtThreshold(),
      logger,
      undefined,
      gateway,
      new NoopTelemetry(),
      makeSummarizePort(),
      THRESHOLD,
    );

    await expect(
      job.run({ message: "Hi", ref: makeRef(), telemetry: DEFAULT_TELEMETRY }),
    ).resolves.toBeUndefined();

    // Reply must still have been delivered
    expect(gateway.reply).toHaveBeenCalledWith(makeRef(), "Reply");

    // Error must mention JSONL write failure / rotation aborted
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("JSONL write failed"),
      expect.objectContaining({ cause: expect.any(Error) }),
    );
  });

  it("should complete successfully and log orphaned newSessionId when rotateWithSummary throws SessionStateUpdateError", async () => {
    const ORPHAN_ID = "orphan-session-uuid";
    const session = makeSession({ id: "session-1", messages: [] });
    const sessionRepo = makeSessionRepository({
      getCurrent: vi.fn().mockResolvedValue(session),
      rotateWithSummary: vi
        .fn()
        .mockRejectedValue(
          new SessionStateUpdateError(
            ORPHAN_ID,
            new Error("atomic write failed"),
          ),
        ),
    });
    const gateway = makeChannelGateway();
    const logger = makeFakeLogger();

    const job = makeJob(
      sessionRepo,
      makeAgentAtThreshold(),
      logger,
      undefined,
      gateway,
      new NoopTelemetry(),
      makeSummarizePort(),
      THRESHOLD,
    );

    await expect(
      job.run({ message: "Hi", ref: makeRef(), telemetry: DEFAULT_TELEMETRY }),
    ).resolves.toBeUndefined();

    // Reply must still have been delivered
    expect(gateway.reply).toHaveBeenCalledWith(makeRef(), "Reply");

    // Error must mention orphaned JSONL and include the orphan session ID
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("state.json update failed"),
      expect.objectContaining({
        newSessionId: ORPHAN_ID,
        cause: expect.any(Error),
      }),
    );
  });
});
