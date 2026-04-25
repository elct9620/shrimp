import { describe, it, expect, vi } from "vitest";
import { createSkillTool } from "../../../../src/adapters/tools/built-in/skill-tool";
import { SkillNotFoundError } from "../../../../src/use-cases/ports/skill-catalog";
import type { SkillCatalog } from "../../../../src/use-cases/ports/skill-catalog";
import { makeFakeLogger } from "./helpers";

type ParseableSchema = { safeParse: (data: unknown) => { success: boolean } };

function makeFakeSkillCatalog(): SkillCatalog {
  return {
    list: vi.fn(),
    getSkillContent: vi.fn(),
    readFile: vi.fn(),
  };
}

describe("createSkillTool", () => {
  it("should have a description string", () => {
    const t = createSkillTool(makeFakeSkillCatalog(), makeFakeLogger());
    expect(typeof t.description).toBe("string");
    expect(t.description!.length).toBeGreaterThan(0);
  });

  describe("inputSchema", () => {
    it("should accept a valid name string", () => {
      const schema = createSkillTool(makeFakeSkillCatalog(), makeFakeLogger())
        .inputSchema as unknown as ParseableSchema;
      expect(schema.safeParse({ name: "todoist" }).success).toBe(true);
    });

    it("should reject missing name", () => {
      const schema = createSkillTool(makeFakeSkillCatalog(), makeFakeLogger())
        .inputSchema as unknown as ParseableSchema;
      expect(schema.safeParse({}).success).toBe(false);
    });

    it("should reject non-string name", () => {
      const schema = createSkillTool(makeFakeSkillCatalog(), makeFakeLogger())
        .inputSchema as unknown as ParseableSchema;
      expect(schema.safeParse({ name: 42 }).success).toBe(false);
    });
  });

  describe("execute — success", () => {
    it("should call skillCatalog.getSkillContent with the given name", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.getSkillContent).mockResolvedValue("# SKILL content");
      const t = createSkillTool(catalog, makeFakeLogger());

      await t.execute!(
        { name: "todoist" },
        { toolCallId: "test", messages: [] },
      );

      expect(catalog.getSkillContent).toHaveBeenCalledWith("todoist");
    });

    it("should return { ok: true, content } on success", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.getSkillContent).mockResolvedValue("# SKILL content");
      const t = createSkillTool(catalog, makeFakeLogger());

      const result = await t.execute!(
        { name: "todoist" },
        { toolCallId: "test", messages: [] },
      );

      expect(result).toEqual({ ok: true, content: "# SKILL content" });
    });
  });

  describe("execute — SkillNotFoundError", () => {
    it("should return { ok: false, error } on SkillNotFoundError (not throw)", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.getSkillContent).mockRejectedValue(
        new SkillNotFoundError("unknown-skill"),
      );
      const t = createSkillTool(catalog, makeFakeLogger());

      const result = await t.execute!(
        { name: "unknown-skill" },
        { toolCallId: "test", messages: [] },
      );

      expect(result).toEqual({
        ok: false,
        error: "Skill not found: unknown-skill",
      });
    });

    it("should not throw on SkillNotFoundError", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.getSkillContent).mockRejectedValue(
        new SkillNotFoundError("missing"),
      );
      const t = createSkillTool(catalog, makeFakeLogger());

      await expect(
        t.execute!({ name: "missing" }, { toolCallId: "test", messages: [] }),
      ).resolves.not.toThrow();
    });
  });

  describe("execute — generic error", () => {
    it("should return { ok: false, error } on unexpected errors (not throw)", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.getSkillContent).mockRejectedValue(
        new Error("I/O failure"),
      );
      const t = createSkillTool(catalog, makeFakeLogger());

      const result = await t.execute!(
        { name: "todoist" },
        { toolCallId: "test", messages: [] },
      );

      expect(result).toEqual({ ok: false, error: "I/O failure" });
    });

    it("should stringify non-Error throws", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.getSkillContent).mockRejectedValue("raw string error");
      const t = createSkillTool(catalog, makeFakeLogger());

      const result = await t.execute!(
        { name: "todoist" },
        { toolCallId: "test", messages: [] },
      );

      expect(result).toEqual({ ok: false, error: "raw string error" });
    });
  });

  describe("logging", () => {
    it("should log debug on invocation with the skill name", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.getSkillContent).mockResolvedValue("content");
      const logger = makeFakeLogger();
      const t = createSkillTool(catalog, logger);

      await t.execute!(
        { name: "todoist" },
        { toolCallId: "test", messages: [] },
      );

      expect(logger.debug).toHaveBeenCalledWith(
        "tool invoked",
        expect.objectContaining({ input: { name: "todoist" } }),
      );
    });

    it("should log warn on SkillNotFoundError", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.getSkillContent).mockRejectedValue(
        new SkillNotFoundError("missing"),
      );
      const logger = makeFakeLogger();
      const t = createSkillTool(catalog, logger);

      await t.execute!(
        { name: "missing" },
        { toolCallId: "test", messages: [] },
      );

      expect(logger.warn).toHaveBeenCalledWith(
        "tool failed",
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });

    it("should log warn on generic error", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.getSkillContent).mockRejectedValue(
        new Error("I/O failure"),
      );
      const logger = makeFakeLogger();
      const t = createSkillTool(catalog, logger);

      await t.execute!(
        { name: "todoist" },
        { toolCallId: "test", messages: [] },
      );

      expect(logger.warn).toHaveBeenCalledWith(
        "tool failed",
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });
  });
});
