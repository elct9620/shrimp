import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGetTasksTool } from "../../../../src/adapters/tools/built-in/get-tasks";
import type { BoardRepository } from "../../../../src/use-cases/ports/board-repository";
import { Section } from "../../../../src/entities/section";
import { Priority } from "../../../../src/entities/priority";
import { makeFakeRepo, makeFakeLogger } from "./helpers";

type ParseableSchema = { safeParse: (data: unknown) => { success: boolean } };

const sampleTasks = [
  { id: "1", title: "Task A", priority: Priority.p1, section: Section.Backlog },
];

describe("createGetTasksTool", () => {
  let repo: BoardRepository;

  beforeEach(() => {
    repo = makeFakeRepo();
  });

  it("should have a description string", () => {
    const t = createGetTasksTool(repo, makeFakeLogger());
    expect(typeof t.description).toBe("string");
    expect(t.description!.length).toBeGreaterThan(0);
  });

  it.each(["Backlog", "InProgress", "Done"])(
    "should accept valid section '%s' and reject invalid enum values",
    (section) => {
      const schema = createGetTasksTool(repo, makeFakeLogger())
        .inputSchema as unknown as ParseableSchema;
      expect(schema.safeParse({ section }).success).toBe(true);
    },
  );

  it("should reject missing or invalid section in schema", () => {
    const schema = createGetTasksTool(repo, makeFakeLogger())
      .inputSchema as unknown as ParseableSchema;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ section: "NotASection" }).success).toBe(false);
  });

  it.each([
    ["Backlog", Section.Backlog],
    ["InProgress", Section.InProgress],
    ["Done", Section.Done],
  ] as const)(
    "should call repo.getTasks with Section.%s and return results",
    async (input, expected) => {
      vi.mocked(repo.getTasks).mockResolvedValue(sampleTasks);
      const t = createGetTasksTool(repo, makeFakeLogger());
      const result = await t.execute!(
        { section: input },
        { toolCallId: "test", messages: [] },
      );
      expect(repo.getTasks).toHaveBeenCalledWith(expected);
      expect(result).toEqual(sampleTasks);
    },
  );

  it("should propagate errors from repo", async () => {
    vi.mocked(repo.getTasks).mockRejectedValue(new Error("API failure"));
    const t = createGetTasksTool(repo, makeFakeLogger());
    await expect(
      t.execute!(
        { section: Section.Backlog },
        { toolCallId: "test", messages: [] },
      ),
    ).rejects.toThrow("API failure");
  });

  describe("logging", () => {
    it("should log debug on invocation with the input section", async () => {
      vi.mocked(repo.getTasks).mockResolvedValue([]);
      const logger = makeFakeLogger();
      const t = createGetTasksTool(repo, logger);

      await t.execute!(
        { section: Section.Backlog },
        { toolCallId: "test", messages: [] },
      );

      expect(logger.debug).toHaveBeenCalledWith(
        "tool invoked",
        expect.objectContaining({ input: { section: Section.Backlog } }),
      );
    });

    it("should log warn with the error message and rethrow when repo throws", async () => {
      vi.mocked(repo.getTasks).mockRejectedValue(new Error("upstream down"));
      const logger = makeFakeLogger();
      const t = createGetTasksTool(repo, logger);

      await expect(
        t.execute!(
          { section: Section.Backlog },
          { toolCallId: "test", messages: [] },
        ),
      ).rejects.toThrow("upstream down");

      expect(logger.warn).toHaveBeenCalledWith(
        "tool failed",
        expect.objectContaining({ error: "upstream down" }),
      );
    });
  });
});
