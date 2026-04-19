import { describe, expect, it, vi, beforeEach } from "vitest";
import { ChannelJob } from "../../src/use-cases/channel-job";
import type {
  SessionRepository,
  Session,
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
import { makeFakeLogger } from "../mocks/fake-logger";
import type { ConversationMessage } from "../../src/entities/conversation-message";
import type { ConversationRef } from "../../src/entities/conversation-ref";

// --- Fakes ---

const makeRef = (): ConversationRef => ({
  channel: "telegram",
  payload: { chatId: "123" },
});

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
    ...overrides,
  };
}

function makeShrimpAgent(
  result = {
    reason: "finished" as const,
    newMessages: [{ role: "assistant" as const, content: "Reply text" }],
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
} {
  return { reply: vi.fn().mockResolvedValue(undefined) };
}

function makeJob(
  sessionRepo: SessionRepository,
  shrimpAgent: ShrimpAgent,
  logger: LoggerPort,
  toolProviderFactory?: ToolProviderFactory,
  channelGateway?: ChannelGateway,
): ChannelJob {
  return new ChannelJob({
    sessionRepository: sessionRepo,
    channelGateway: channelGateway ?? makeChannelGateway(),
    shrimpAgent,
    toolProviderFactory: toolProviderFactory ?? makeToolProviderFactory(),
    maxSteps: 10,
    logger,
    telemetry: new NoopTelemetry(),
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

    await job.run({ message: "Hello bot", ref: makeRef() });

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

    await job.run({ message: "Follow up", ref: makeRef() });

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
      job.run({ message: "Trigger error", ref: makeRef() }),
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

    await j.run({ message: "Hi", ref: makeRef() });

    const systemPrompt = agent.capturedInput?.systemPrompt ?? "";
    expect(systemPrompt).toContain("## Operating Principles");
    expect(systemPrompt).toContain("## Conversation Style");
    expect(systemPrompt).toContain("search_web");
    expect(systemPrompt).toContain("Search the web");
    expect(systemPrompt).not.toMatch(/^You are/);
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

    await j.run({ message: "Hi", ref });

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

    await job.run({ message: "Msg", ref: makeRef() });

    expect(appendOrder[0]).toBe("append");
    expect(appendOrder[1]).toBe("agent");
  });
});
