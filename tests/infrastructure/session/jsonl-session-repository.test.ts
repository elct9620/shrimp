import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JsonlSessionRepository } from "../../../src/infrastructure/session/jsonl-session-repository";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";
import {
  SessionJsonlWriteError,
  SessionStateUpdateError,
} from "../../../src/use-cases/ports/session-repository";

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

  describe("rotateWithSummary()", () => {
    const SUMMARY = "This is a conversation summary.";

    it("success: creates new JSONL with single role:system entry, updates state.json, retains old JSONL", async () => {
      const { stat } = await import("node:fs/promises");

      // Establish a pre-existing session with content
      const old = await repo.createNew();
      await repo.append(old.id, [{ role: "user", content: "old message" }]);
      const oldJsonlPath = join(tmpDir, "sessions", `${old.id}.jsonl`);

      await repo.rotateWithSummary(SUMMARY);

      // state.json now points to a new session
      const current = await repo.getCurrent();
      expect(current).not.toBeNull();
      expect(current!.id).not.toBe(old.id);

      // New session has exactly one role:system message with the summary
      expect(current!.messages).toHaveLength(1);
      expect(current!.messages[0]).toEqual({
        role: "system",
        content: SUMMARY,
      });

      // Old JSONL is still on disk (archive retained)
      await expect(stat(oldJsonlPath)).resolves.toBeDefined();

      // New JSONL exists on disk
      const newJsonlPath = join(tmpDir, "sessions", `${current!.id}.jsonl`);
      await expect(stat(newJsonlPath)).resolves.toBeDefined();
    });

    it("success: new JSONL file contains exactly one JSON line (the system summary)", async () => {
      await repo.createNew();

      await repo.rotateWithSummary(SUMMARY);

      const current = await repo.getCurrent();
      const newJsonlPath = join(tmpDir, "sessions", `${current!.id}.jsonl`);
      const raw = await readFile(newJsonlPath, "utf-8");

      const nonEmptyLines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      expect(nonEmptyLines).toHaveLength(1);

      const parsed = JSON.parse(nonEmptyLines[0]);
      expect(parsed).toEqual({ role: "system", content: SUMMARY });
    });

    it("JSONL write fails → throws SessionJsonlWriteError; state.json NOT updated", async () => {
      const { chmod } = await import("node:fs/promises");

      const old = await repo.createNew();

      // Make the sessions directory non-writable so writeFile into it fails
      const sessionsDir = join(tmpDir, "sessions");
      await chmod(sessionsDir, 0o444);

      try {
        await expect(repo.rotateWithSummary(SUMMARY)).rejects.toThrow(
          SessionJsonlWriteError,
        );
      } finally {
        // Restore permissions before any further reads / afterEach cleanup
        await chmod(sessionsDir, 0o755);
      }

      // state.json still points to the old session — no rotation occurred
      const stateRaw = await readFile(join(tmpDir, "state.json"), "utf-8");
      const state = JSON.parse(stateRaw) as { currentSessionId: string };
      expect(state.currentSessionId).toBe(old.id);
    });

    it("state.json update fails after JSONL written → throws SessionStateUpdateError; new JSONL orphaned on disk", async () => {
      const { stat } = await import("node:fs/promises");

      await repo.createNew();

      // Make state.json a directory so rename(state.json.tmp → state.json) fails
      const stateJsonPath = join(tmpDir, "state.json");
      await rm(stateJsonPath, { force: true });
      await mkdir(stateJsonPath);

      let thrownError: unknown;
      try {
        await repo.rotateWithSummary(SUMMARY);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(SessionStateUpdateError);

      // Extract the orphaned session ID from the error message
      const errorMsg = (thrownError as SessionStateUpdateError).message;
      const idMatch = errorMsg.match(/id: ([0-9a-f-]{36})/);
      expect(idMatch).not.toBeNull();
      const orphanedId = idMatch![1];

      // The orphaned JSONL exists on disk
      const orphanedPath = join(tmpDir, "sessions", `${orphanedId}.jsonl`);
      await expect(stat(orphanedPath)).resolves.toBeDefined();
    });

    it("previous session JSONL is untouched after successful rotation", async () => {
      const old = await repo.createNew();
      await repo.append(old.id, [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
      ]);

      const oldJsonlPath = join(tmpDir, "sessions", `${old.id}.jsonl`);
      const beforeRaw = await readFile(oldJsonlPath, "utf-8");

      await repo.rotateWithSummary(SUMMARY);

      const afterRaw = await readFile(oldJsonlPath, "utf-8");
      expect(afterRaw).toBe(beforeRaw);
    });
  });
});
