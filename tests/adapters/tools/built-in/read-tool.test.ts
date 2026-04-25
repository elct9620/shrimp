import { describe, it, expect, vi } from "vitest";
import {
  createReadTool,
  READ_TOOL_NAME,
} from "../../../../src/adapters/tools/built-in/read-tool";
import {
  SandboxViolationError,
  FileNotFoundError,
} from "../../../../src/use-cases/ports/skill-catalog";
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

describe("createReadTool", () => {
  it("should have a description string", () => {
    const t = createReadTool(makeFakeSkillCatalog(), makeFakeLogger());
    expect(typeof t.description).toBe("string");
    expect(t.description!.length).toBeGreaterThan(0);
  });

  it("should have tool name 'read'", () => {
    expect(READ_TOOL_NAME).toBe("read");
  });

  describe("inputSchema", () => {
    it("should accept a valid path string", () => {
      const schema = createReadTool(makeFakeSkillCatalog(), makeFakeLogger())
        .inputSchema as unknown as ParseableSchema;
      expect(
        schema.safeParse({ path: "/var/lib/shrimp/skills/my-skill/file.md" })
          .success,
      ).toBe(true);
    });

    it("should reject missing path", () => {
      const schema = createReadTool(makeFakeSkillCatalog(), makeFakeLogger())
        .inputSchema as unknown as ParseableSchema;
      expect(schema.safeParse({}).success).toBe(false);
    });

    it("should reject non-string path", () => {
      const schema = createReadTool(makeFakeSkillCatalog(), makeFakeLogger())
        .inputSchema as unknown as ParseableSchema;
      expect(schema.safeParse({ path: 42 }).success).toBe(false);
    });
  });

  describe("execute — success", () => {
    it("should call skillCatalog.readFile with the given path", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockResolvedValue("# file content");
      const t = createReadTool(catalog, makeFakeLogger());

      await t.execute!(
        { path: "/var/lib/shrimp/skills/todoist/guide.md" },
        { toolCallId: "test", messages: [] },
      );

      expect(catalog.readFile).toHaveBeenCalledWith(
        "/var/lib/shrimp/skills/todoist/guide.md",
      );
    });

    it("should return { ok: true, content } on success", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockResolvedValue("# file content");
      const t = createReadTool(catalog, makeFakeLogger());

      const result = await t.execute!(
        { path: "/var/lib/shrimp/skills/todoist/guide.md" },
        { toolCallId: "test", messages: [] },
      );

      expect(result).toEqual({ ok: true, content: "# file content" });
    });
  });

  describe("execute — SandboxViolationError", () => {
    it("should return { ok: false, error } on SandboxViolationError (not throw)", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockRejectedValue(
        new SandboxViolationError("/etc/passwd"),
      );
      const t = createReadTool(catalog, makeFakeLogger());

      const result = await t.execute!(
        { path: "/etc/passwd" },
        { toolCallId: "test", messages: [] },
      );

      expect(result).toMatchObject({ ok: false, error: expect.any(String) });
      expect(
        (result as { ok: false; error: string }).error.length,
      ).toBeGreaterThan(0);
    });

    it("should not throw on SandboxViolationError", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockRejectedValue(
        new SandboxViolationError("/etc/passwd"),
      );
      const t = createReadTool(catalog, makeFakeLogger());

      await expect(
        t.execute!(
          { path: "/etc/passwd" },
          { toolCallId: "test", messages: [] },
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("execute — FileNotFoundError", () => {
    it("should return { ok: false, error } on FileNotFoundError (not throw)", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockRejectedValue(
        new FileNotFoundError("/var/lib/shrimp/skills/missing.md"),
      );
      const t = createReadTool(catalog, makeFakeLogger());

      const result = await t.execute!(
        { path: "/var/lib/shrimp/skills/missing.md" },
        { toolCallId: "test", messages: [] },
      );

      expect(result).toEqual({
        ok: false,
        error: "File not found: /var/lib/shrimp/skills/missing.md",
      });
    });

    it("should not throw on FileNotFoundError", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockRejectedValue(
        new FileNotFoundError("/var/lib/shrimp/skills/missing.md"),
      );
      const t = createReadTool(catalog, makeFakeLogger());

      await expect(
        t.execute!(
          { path: "/var/lib/shrimp/skills/missing.md" },
          { toolCallId: "test", messages: [] },
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("execute — generic error", () => {
    it("should return { ok: false, error } on unexpected errors (not throw)", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockRejectedValue(new Error("I/O failure"));
      const t = createReadTool(catalog, makeFakeLogger());

      const result = await t.execute!(
        { path: "/var/lib/shrimp/skills/todoist/guide.md" },
        { toolCallId: "test", messages: [] },
      );

      expect(result).toEqual({ ok: false, error: "I/O failure" });
    });

    it("should stringify non-Error throws", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockRejectedValue("raw string error");
      const t = createReadTool(catalog, makeFakeLogger());

      const result = await t.execute!(
        { path: "/var/lib/shrimp/skills/todoist/guide.md" },
        { toolCallId: "test", messages: [] },
      );

      expect(result).toEqual({ ok: false, error: "raw string error" });
    });
  });

  describe("logging", () => {
    it("should log debug on invocation with the path", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockResolvedValue("content");
      const logger = makeFakeLogger();
      const t = createReadTool(catalog, logger);

      await t.execute!(
        { path: "/var/lib/shrimp/skills/todoist/guide.md" },
        { toolCallId: "test", messages: [] },
      );

      expect(logger.debug).toHaveBeenCalledWith(
        "tool invoked",
        expect.objectContaining({
          input: { path: "/var/lib/shrimp/skills/todoist/guide.md" },
        }),
      );
    });

    it("should log warn on SandboxViolationError", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockRejectedValue(
        new SandboxViolationError("/etc/passwd"),
      );
      const logger = makeFakeLogger();
      const t = createReadTool(catalog, logger);

      await t.execute!(
        { path: "/etc/passwd" },
        { toolCallId: "test", messages: [] },
      );

      expect(logger.warn).toHaveBeenCalledWith(
        "tool failed",
        expect.objectContaining({
          error: "Path is outside the allowed skill roots: /etc/passwd",
        }),
      );
    });

    it("should log warn on FileNotFoundError", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockRejectedValue(
        new FileNotFoundError("/var/lib/shrimp/skills/missing.md"),
      );
      const logger = makeFakeLogger();
      const t = createReadTool(catalog, logger);

      await t.execute!(
        { path: "/var/lib/shrimp/skills/missing.md" },
        { toolCallId: "test", messages: [] },
      );

      expect(logger.warn).toHaveBeenCalledWith(
        "tool failed",
        expect.objectContaining({
          error: "File not found: /var/lib/shrimp/skills/missing.md",
        }),
      );
    });

    it("should log warn on generic error", async () => {
      const catalog = makeFakeSkillCatalog();
      vi.mocked(catalog.readFile).mockRejectedValue(new Error("I/O failure"));
      const logger = makeFakeLogger();
      const t = createReadTool(catalog, logger);

      await t.execute!(
        { path: "/var/lib/shrimp/skills/todoist/guide.md" },
        { toolCallId: "test", messages: [] },
      );

      expect(logger.warn).toHaveBeenCalledWith(
        "tool failed",
        expect.objectContaining({ error: "I/O failure" }),
      );
    });
  });
});
