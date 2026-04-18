import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JsonlSessionRepository } from "../../../src/infrastructure/session/jsonl-session-repository";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";

function makeStubLogger(): LoggerPort & {
  warns: { message: string; ctx?: Record<string, unknown> }[];
} {
  const warns: { message: string; ctx?: Record<string, unknown> }[] = [];
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn((message: string, ctx?: Record<string, unknown>) => {
      warns.push({ message, ctx });
    }),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
    warns,
  };
  return logger;
}

describe("JsonlSessionRepository", () => {
  let tmpDir: string;
  let logger: ReturnType<typeof makeStubLogger>;
  let repo: JsonlSessionRepository;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "shrimp-session-test-"));
    logger = makeStubLogger();
    repo = new JsonlSessionRepository({ stateDir: tmpDir, logger });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("getCurrent() returns null when state.json does not exist", async () => {
    const result = await repo.getCurrent();

    expect(result).toBeNull();
  });

  it("createNew() then getCurrent() roundtrip returns same Session with empty messages", async () => {
    const created = await repo.createNew();

    expect(created.id).toBeTruthy();
    expect(created.messages).toEqual([]);

    const current = await repo.getCurrent();

    expect(current).not.toBeNull();
    expect(current!.id).toBe(created.id);
    expect(current!.messages).toEqual([]);

    // Verify files on disk
    const { stat } = await import("node:fs/promises");
    await expect(stat(join(tmpDir, "state.json"))).resolves.toBeDefined();
    await expect(
      stat(join(tmpDir, "sessions", `${created.id}.jsonl`)),
    ).resolves.toBeDefined();
  });

  it("createNew() + append() + getCurrent() returns messages in order; empty append leaves file untouched", async () => {
    const session = await repo.createNew();
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "world" },
    ];

    await repo.append(session.id, messages);

    const current = await repo.getCurrent();

    expect(current).not.toBeNull();
    expect(current!.messages).toEqual(messages);

    // Empty append should not change anything
    const { stat } = await import("node:fs/promises");
    const beforeStat = await stat(
      join(tmpDir, "sessions", `${session.id}.jsonl`),
    );

    await repo.append(session.id, []);

    const afterStat = await stat(
      join(tmpDir, "sessions", `${session.id}.jsonl`),
    );
    expect(afterStat.size).toBe(beforeStat.size);
  });

  it("getCurrent() throws when state.json is malformed JSON", async () => {
    await writeFile(join(tmpDir, "state.json"), "not json{");

    await expect(repo.getCurrent()).rejects.toThrow(/state\.json malformed/);
    await expect(repo.getCurrent()).rejects.toThrow(tmpDir);
  });

  it("getCurrent() returns null and logs warn when sessions/<id>.jsonl is missing", async () => {
    const session = await repo.createNew();
    // Remove the session file while state.json still points to it
    const { rm: removeFile } = await import("node:fs/promises");
    await removeFile(join(tmpDir, "sessions", `${session.id}.jsonl`));

    const result = await repo.getCurrent();

    expect(result).toBeNull();
    expect(logger.warns.length).toBeGreaterThanOrEqual(1);
    expect(logger.warns[0].message).toMatch(/discard/i);
  });

  it("append() resolves without throwing when sessions/<id>.jsonl is a directory (Fail-Open)", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000001";
    const sessionsDir = join(tmpDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    // Make the expected JSONL path a directory so appendFile will fail
    await mkdir(join(sessionsDir, `${fakeId}.jsonl`));

    await expect(
      repo.append(fakeId, [{ role: "user", content: "test" }]),
    ).resolves.toBeUndefined();
    expect(logger.warns.length).toBeGreaterThanOrEqual(1);
    expect(logger.warns[0].message).toMatch(/fail-open/i);
  });
});
