import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPostCommentTool } from "../../../../src/adapters/tools/built-in/post-comment";
import type { BoardRepository } from "../../../../src/use-cases/ports/board-repository";
import { makeFakeRepo, makeFakeLogger } from "./helpers";

type ParseableSchema = { safeParse: (data: unknown) => { success: boolean } };

describe("createPostCommentTool", () => {
  let repo: BoardRepository;

  beforeEach(() => {
    repo = makeFakeRepo();
  });

  it("should have a description string", () => {
    const t = createPostCommentTool(repo, makeFakeLogger());
    expect(typeof t.description).toBe("string");
    expect(t.description!.length).toBeGreaterThan(0);
  });

  it("should accept valid taskId and text input", () => {
    const schema = createPostCommentTool(repo, makeFakeLogger())
      .inputSchema as unknown as ParseableSchema;
    expect(
      schema.safeParse({ taskId: "task-123", text: "Progress update" }).success,
    ).toBe(true);
  });

  it("should reject missing taskId", () => {
    const schema = createPostCommentTool(repo, makeFakeLogger())
      .inputSchema as unknown as ParseableSchema;
    expect(schema.safeParse({ text: "Progress update" }).success).toBe(false);
  });

  it("should reject missing text", () => {
    const schema = createPostCommentTool(repo, makeFakeLogger())
      .inputSchema as unknown as ParseableSchema;
    expect(schema.safeParse({ taskId: "task-123" }).success).toBe(false);
  });

  it("should reject empty input", () => {
    const schema = createPostCommentTool(repo, makeFakeLogger())
      .inputSchema as unknown as ParseableSchema;
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("should prepend Comment Tag before calling repo.postComment", async () => {
    vi.mocked(repo.postComment).mockResolvedValue(undefined);
    const t = createPostCommentTool(repo, makeFakeLogger());
    await t.execute!(
      { taskId: "task-123", text: "Progress update" },
      { toolCallId: "test", messages: [] },
    );
    expect(repo.postComment).toHaveBeenCalledWith(
      "task-123",
      "[Shrimp] Progress update",
    );
  });

  it("should return { ok: true }", async () => {
    vi.mocked(repo.postComment).mockResolvedValue(undefined);
    const t = createPostCommentTool(repo, makeFakeLogger());
    const result = await t.execute!(
      { taskId: "task-123", text: "Progress update" },
      { toolCallId: "test", messages: [] },
    );
    expect(result).toEqual({ ok: true });
  });

  it("should propagate errors from repo", async () => {
    vi.mocked(repo.postComment).mockRejectedValue(new Error("Post failed"));
    const t = createPostCommentTool(repo, makeFakeLogger());
    await expect(
      t.execute!(
        { taskId: "task-123", text: "text" },
        { toolCallId: "test", messages: [] },
      ),
    ).rejects.toThrow("Post failed");
  });

  describe("logging", () => {
    it("should log debug on invocation with taskId and textLength (not raw text)", async () => {
      vi.mocked(repo.postComment).mockResolvedValue(undefined);
      const logger = makeFakeLogger();
      const t = createPostCommentTool(repo, logger);

      await t.execute!(
        { taskId: "task-42", text: "progress note" },
        { toolCallId: "test", messages: [] },
      );

      expect(logger.debug).toHaveBeenCalledWith(
        "tool invoked",
        expect.objectContaining({
          input: { taskId: "task-42", textLength: "progress note".length },
        }),
      );
    });

    it("should log warn and rethrow when repo throws", async () => {
      vi.mocked(repo.postComment).mockRejectedValue(new Error("rejected"));
      const logger = makeFakeLogger();
      const t = createPostCommentTool(repo, logger);

      await expect(
        t.execute!(
          { taskId: "task-42", text: "x" },
          { toolCallId: "test", messages: [] },
        ),
      ).rejects.toThrow("rejected");

      expect(logger.warn).toHaveBeenCalledWith(
        "tool failed",
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });
  });
});
