import { describe, expect, it } from "vitest";
import type {
  SkillCatalog,
  SkillCatalogEntry,
} from "../../../src/use-cases/ports/skill-catalog";
import {
  SkillNotFoundError,
  SandboxViolationError,
  FileNotFoundError,
} from "../../../src/use-cases/ports/skill-catalog";

// Fake implementation exercising the interface shape.
class FakeSkillCatalog implements SkillCatalog {
  private readonly entries: SkillCatalogEntry[];
  private readonly contents: Map<string, string>;
  private readonly files: Map<string, string>;

  constructor(
    entries: SkillCatalogEntry[],
    contents: Map<string, string>,
    files: Map<string, string>,
  ) {
    this.entries = entries;
    this.contents = contents;
    this.files = files;
  }

  list(): readonly SkillCatalogEntry[] {
    return this.entries;
  }

  async getSkillContent(name: string): Promise<string> {
    const content = this.contents.get(name);
    if (content === undefined) {
      throw new SkillNotFoundError(name);
    }
    return content;
  }

  async readFile(path: string): Promise<string> {
    if (path.startsWith("/outside/")) {
      throw new SandboxViolationError(path);
    }
    const content = this.files.get(path);
    if (content === undefined) {
      throw new FileNotFoundError(path);
    }
    return content;
  }
}

const makeEntry = (
  overrides: Partial<SkillCatalogEntry> = {},
): SkillCatalogEntry => ({
  name: "todoist",
  description: "Interact with the Todoist board",
  skillFilePath: "/app/skills/todoist/SKILL.md",
  ...overrides,
});

describe("SkillCatalog port contract", () => {
  describe("list()", () => {
    it("returns an empty array when catalog is empty", () => {
      const catalog = new FakeSkillCatalog([], new Map(), new Map());
      expect(catalog.list()).toEqual([]);
    });

    it("returns all catalog entries with name, description, and skillFilePath", () => {
      const entry = makeEntry();
      const catalog = new FakeSkillCatalog([entry], new Map(), new Map());
      const result = catalog.list();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: "todoist",
        description: "Interact with the Todoist board",
        skillFilePath: "/app/skills/todoist/SKILL.md",
      });
    });

    it("returns multiple entries", () => {
      const entries = [
        makeEntry({
          name: "todoist",
          skillFilePath: "/app/skills/todoist/SKILL.md",
        }),
        makeEntry({
          name: "custom",
          description: "A custom skill",
          skillFilePath: "/var/lib/shrimp/skills/custom/SKILL.md",
        }),
      ];
      const catalog = new FakeSkillCatalog(entries, new Map(), new Map());
      expect(catalog.list()).toHaveLength(2);
    });
  });

  describe("getSkillContent(name)", () => {
    it("returns SKILL.md content for a known skill name", async () => {
      const contents = new Map([
        ["todoist", "---\nname: todoist\n---\n# Todoist"],
      ]);
      const catalog = new FakeSkillCatalog([makeEntry()], contents, new Map());
      const content = await catalog.getSkillContent("todoist");
      expect(content).toContain("name: todoist");
    });

    it("throws SkillNotFoundError for an unknown name", async () => {
      const catalog = new FakeSkillCatalog([], new Map(), new Map());
      await expect(catalog.getSkillContent("unknown")).rejects.toThrow(
        SkillNotFoundError,
      );
    });

    it("SkillNotFoundError carries the skill name", async () => {
      const catalog = new FakeSkillCatalog([], new Map(), new Map());
      await expect(catalog.getSkillContent("unknown")).rejects.toThrow(
        "unknown",
      );
    });
  });

  describe("readFile(path)", () => {
    it("returns file content for a sandboxed path", async () => {
      const files = new Map([
        ["/app/skills/todoist/references/guide.md", "# Guide"],
      ]);
      const catalog = new FakeSkillCatalog([], new Map(), files);
      const content = await catalog.readFile(
        "/app/skills/todoist/references/guide.md",
      );
      expect(content).toBe("# Guide");
    });

    it("throws SandboxViolationError for a path outside sandbox roots", async () => {
      const catalog = new FakeSkillCatalog([], new Map(), new Map());
      await expect(catalog.readFile("/outside/etc/passwd")).rejects.toThrow(
        SandboxViolationError,
      );
    });

    it("throws FileNotFoundError for a missing file within sandbox", async () => {
      const catalog = new FakeSkillCatalog([], new Map(), new Map());
      await expect(
        catalog.readFile("/app/skills/todoist/missing.md"),
      ).rejects.toThrow(FileNotFoundError);
    });

    it("SandboxViolationError carries the path", async () => {
      const catalog = new FakeSkillCatalog([], new Map(), new Map());
      await expect(catalog.readFile("/outside/secret")).rejects.toThrow(
        "/outside/secret",
      );
    });

    it("FileNotFoundError carries the path", async () => {
      const catalog = new FakeSkillCatalog([], new Map(), new Map());
      await expect(
        catalog.readFile("/app/skills/todoist/missing.md"),
      ).rejects.toThrow("/app/skills/todoist/missing.md");
    });
  });
});
