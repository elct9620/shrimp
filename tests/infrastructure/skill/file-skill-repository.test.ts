import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileSkillRepository } from "../../../src/infrastructure/skill/file-skill-repository";
import {
  SkillNotFoundError,
  SandboxViolationError,
  FileNotFoundError,
} from "../../../src/use-cases/ports/skill-catalog";
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

async function writeSkill(
  root: string,
  dirName: string,
  frontmatter: Record<string, string>,
  body = "Skill body content.",
): Promise<void> {
  const skillDir = join(root, dirName);
  await mkdir(skillDir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  await writeFile(join(skillDir, "SKILL.md"), `---\n${fm}\n---\n${body}`);
}

describe("FileSkillRepository", () => {
  let tmpDir: string;
  let builtInRoot: string;
  let customRoot: string;
  let logger: ReturnType<typeof makeStubLogger>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "shrimp-skill-test-"));
    builtInRoot = join(tmpDir, "built-in");
    customRoot = join(tmpDir, "custom");
    await mkdir(builtInRoot, { recursive: true });
    await mkdir(customRoot, { recursive: true });
    logger = makeStubLogger();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- Discovery: happy path ---

  it("happy path: two built-in skills + one custom skill → catalog has all three", async () => {
    await writeSkill(builtInRoot, "skill-a", {
      name: "skill-a",
      description: "Skill A description",
    });
    await writeSkill(builtInRoot, "skill-b", {
      name: "skill-b",
      description: "Skill B description",
    });
    await writeSkill(customRoot, "skill-c", {
      name: "skill-c",
      description: "Skill C description",
    });

    const repo = new FileSkillRepository(builtInRoot, customRoot, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(3);
    const names = entries.map((e) => e.name);
    expect(names).toContain("skill-a");
    expect(names).toContain("skill-b");
    expect(names).toContain("skill-c");

    for (const entry of entries) {
      expect(entry.skillFilePath).toMatch(/SKILL\.md$/);
      // Must be absolute
      expect(entry.skillFilePath.startsWith("/")).toBe(true);
    }
  });

  it("catalog entries include correct description from frontmatter", async () => {
    await writeSkill(builtInRoot, "my-skill", {
      name: "my-skill",
      description: "Does something useful",
    });

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("my-skill");
    expect(entries[0].description).toBe("Does something useful");
  });

  // --- Invalid SKILL.md → warn+skip ---

  it("missing name field → warn+skip; other skills still loaded", async () => {
    await writeSkill(builtInRoot, "good-skill", {
      name: "good-skill",
      description: "Good",
    });
    // Missing name field
    const badDir = join(builtInRoot, "bad-skill");
    await mkdir(badDir);
    await writeFile(
      join(badDir, "SKILL.md"),
      "---\ndescription: No name here\n---\nBody",
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("good-skill");
    expect(logger.warns.length).toBeGreaterThan(0);
    expect(logger.warns[0].message).toContain("SKILL.md");
  });

  it("name with invalid charset → warn+skip", async () => {
    await writeSkill(builtInRoot, "Bad_Skill", {
      name: "Bad_Skill",
      description: "Underscore not allowed",
    });

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(0);
    expect(logger.warns.length).toBeGreaterThan(0);
  });

  it("name does not match parent dir name → warn+skip", async () => {
    const skillDir = join(builtInRoot, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: other-name\ndescription: Mismatch\n---\nBody",
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(0);
    expect(logger.warns.length).toBeGreaterThan(0);
  });

  it("description missing → warn+skip", async () => {
    const skillDir = join(builtInRoot, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\n---\nBody",
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(0);
    expect(logger.warns.length).toBeGreaterThan(0);
  });

  it("description too long (>1024 chars) → warn+skip", async () => {
    const skillDir = join(builtInRoot, "my-skill");
    await mkdir(skillDir);
    const longDesc = "x".repeat(1025);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: my-skill\ndescription: "${longDesc}"\n---\nBody`,
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(0);
    expect(logger.warns.length).toBeGreaterThan(0);
  });

  it("name too long (>64 chars) → warn+skip", async () => {
    const longName = "a".repeat(65);
    const skillDir = join(builtInRoot, longName);
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${longName}\ndescription: Too long name\n---\nBody`,
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(0);
    expect(logger.warns.length).toBeGreaterThan(0);
  });

  it("SKILL.md file missing in skill dir → skip silently (no warn)", async () => {
    const notASkillDir = join(builtInRoot, "not-a-skill");
    await mkdir(notASkillDir);
    // No SKILL.md

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(0);
    expect(logger.warns).toHaveLength(0);
  });

  it("non-directory entry in root → skip silently", async () => {
    await writeFile(join(builtInRoot, "README.md"), "# README");

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(0);
    expect(logger.warns).toHaveLength(0);
  });

  // --- Duplicate across roots → Built-in wins ---

  it("duplicate name across roots → built-in wins, warn emitted for custom", async () => {
    await writeSkill(builtInRoot, "my-skill", {
      name: "my-skill",
      description: "Built-in version",
    });
    await writeSkill(customRoot, "my-skill", {
      name: "my-skill",
      description: "Custom version",
    });

    const repo = new FileSkillRepository(builtInRoot, customRoot, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe("Built-in version");
    expect(logger.warns.length).toBeGreaterThan(0);
    expect(logger.warns[0].message).toContain("duplicate");
  });

  // --- Built-in root missing → fail fast ---

  it("built-in root missing → throws at construction", async () => {
    const missingRoot = join(tmpDir, "does-not-exist");

    expect(() => new FileSkillRepository(missingRoot, null, logger)).toThrow();
  });

  // --- Custom root absent → empty Custom portion ---

  it("custom root null → no error, only built-in skills loaded", async () => {
    await writeSkill(builtInRoot, "my-skill", {
      name: "my-skill",
      description: "Only built-in",
    });

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("my-skill");
  });

  it("custom root points to non-existent dir → no error, only built-in skills", async () => {
    await writeSkill(builtInRoot, "my-skill", {
      name: "my-skill",
      description: "Only built-in",
    });
    const absentCustom = join(tmpDir, "missing-custom");

    const repo = new FileSkillRepository(builtInRoot, absentCustom, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("my-skill");
  });

  // --- No recursive discovery ---

  it("nested skill dir is not discovered", async () => {
    await writeSkill(builtInRoot, "parent-skill", {
      name: "parent-skill",
      description: "Parent",
    });
    // Create a nested skill inside parent-skill
    const nestedDir = join(builtInRoot, "parent-skill", "nested-skill");
    await mkdir(nestedDir);
    await writeFile(
      join(nestedDir, "SKILL.md"),
      "---\nname: nested-skill\ndescription: Nested\n---\nBody",
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("parent-skill");
  });

  // --- list() returns readonly snapshot ---

  it("list() returns readonly array (catalog frozen after init)", async () => {
    await writeSkill(builtInRoot, "my-skill", {
      name: "my-skill",
      description: "A skill",
    });

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    // Should be the same reference on successive calls (frozen snapshot)
    expect(repo.list()).toBe(entries);
  });

  // --- getSkillContent ---

  it("getSkillContent: unknown name → throws SkillNotFoundError", async () => {
    const repo = new FileSkillRepository(builtInRoot, null, logger);

    await expect(repo.getSkillContent("no-such-skill")).rejects.toThrow(
      SkillNotFoundError,
    );
  });

  it("getSkillContent: includes frontmatter in returned content", async () => {
    await writeSkill(
      builtInRoot,
      "my-skill",
      { name: "my-skill", description: "Useful skill" },
      "Body of skill.",
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const content = await repo.getSkillContent("my-skill");

    expect(content).toContain("---");
    expect(content).toContain("name: my-skill");
    expect(content).toContain("description: Useful skill");
    expect(content).toContain("Body of skill.");
  });

  it("getSkillContent: rewrites relative markdown links to absolute", async () => {
    const skillDir = join(builtInRoot, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: my-skill",
        "description: Path rewrite test",
        "---",
        "See [example](./references/example.md) for details.",
        "Also check [other](sub/file.txt) file.",
      ].join("\n"),
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const content = await repo.getSkillContent("my-skill");

    expect(content).toContain(`${skillDir}/references/example.md`);
    expect(content).toContain(`${skillDir}/sub/file.txt`);
    // Relative syntax gone
    expect(content).not.toContain("](./references/example.md)");
    expect(content).not.toContain("](sub/file.txt)");
  });

  it("getSkillContent: rewrites relative markdown images to absolute", async () => {
    const skillDir = join(builtInRoot, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: my-skill",
        "description: Image rewrite test",
        "---",
        "![diagram](images/flow.png) shows the flow.",
      ].join("\n"),
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const content = await repo.getSkillContent("my-skill");

    expect(content).toContain(`${skillDir}/images/flow.png`);
    expect(content).not.toContain("](images/flow.png)");
  });

  it("getSkillContent: leaves absolute paths untouched", async () => {
    const skillDir = join(builtInRoot, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: my-skill",
        "description: Absolute paths",
        "---",
        "See [doc](/absolute/path/file.md) here.",
      ].join("\n"),
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const content = await repo.getSkillContent("my-skill");

    expect(content).toContain("](/absolute/path/file.md)");
  });

  it("getSkillContent: leaves non-local URLs untouched", async () => {
    const skillDir = join(builtInRoot, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: my-skill",
        "description: URLs test",
        "---",
        "See [docs](https://example.com/docs) and [mail](mailto:foo@bar.com).",
      ].join("\n"),
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const content = await repo.getSkillContent("my-skill");

    expect(content).toContain("](https://example.com/docs)");
    expect(content).toContain("](mailto:foo@bar.com)");
  });

  it("getSkillContent: leaves escaping relative paths untouched", async () => {
    const skillDir = join(builtInRoot, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: my-skill",
        "description: Escaping paths",
        "---",
        "See [other](../other-skill/file.md) for reference.",
      ].join("\n"),
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const content = await repo.getSkillContent("my-skill");

    // Escaping relative paths left as-is
    expect(content).toContain("](../other-skill/file.md)");
  });

  it("getSkillContent: rewrites backtick code spans with relative paths", async () => {
    const skillDir = join(builtInRoot, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: my-skill",
        "description: Backtick rewrite",
        "---",
        "Run `scripts/setup.sh` to begin.",
        "Also see `references/guide.md` for details.",
      ].join("\n"),
    );

    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const content = await repo.getSkillContent("my-skill");

    expect(content).toContain(`\`${skillDir}/scripts/setup.sh\``);
    expect(content).toContain(`\`${skillDir}/references/guide.md\``);
  });

  // --- readFile sandbox ---

  describe("readFile()", () => {
    it("reads a file inside builtInRoot and returns its content", async () => {
      const skillDir = join(builtInRoot, "my-skill");
      await mkdir(skillDir, { recursive: true });
      const filePath = join(skillDir, "resource.txt");
      await writeFile(filePath, "hello from resource");

      const repo = new FileSkillRepository(builtInRoot, null, logger);
      const content = await repo.readFile(filePath);

      expect(content).toBe("hello from resource");
    });

    it("reads a file inside customRoot and returns its content", async () => {
      const skillDir = join(customRoot, "my-skill");
      await mkdir(skillDir, { recursive: true });
      const filePath = join(skillDir, "data.txt");
      await writeFile(filePath, "custom data");

      const repo = new FileSkillRepository(builtInRoot, customRoot, logger);
      const content = await repo.readFile(filePath);

      expect(content).toBe("custom data");
    });

    it("non-existent file (ENOENT at realpath) → FileNotFoundError", async () => {
      const repo = new FileSkillRepository(builtInRoot, null, logger);
      const missingPath = join(builtInRoot, "no-such-file.txt");

      await expect(repo.readFile(missingPath)).rejects.toThrow(
        FileNotFoundError,
      );
    });

    it("absolute path outside both roots → SandboxViolationError", async () => {
      const repo = new FileSkillRepository(builtInRoot, null, logger);
      const outsidePath = join(tmpDir, "outside.txt");
      await writeFile(outsidePath, "secret");

      await expect(repo.readFile(outsidePath)).rejects.toThrow(
        SandboxViolationError,
      );
    });

    it("path with .. traversal ending outside roots → SandboxViolationError", async () => {
      const skillDir = join(builtInRoot, "my-skill");
      await mkdir(skillDir, { recursive: true });
      const outsideFile = join(tmpDir, "outside.txt");
      await writeFile(outsideFile, "secret");

      const repo = new FileSkillRepository(builtInRoot, null, logger);
      // Traverse up: builtInRoot/my-skill/../../outside.txt resolves to tmpDir/outside.txt
      const traversalPath = join(skillDir, "..", "..", "outside.txt");

      await expect(repo.readFile(traversalPath)).rejects.toThrow(
        SandboxViolationError,
      );
    });

    it("path with .. that stays inside root → allowed, returns content", async () => {
      const skillDir = join(builtInRoot, "my-skill");
      await mkdir(skillDir, { recursive: true });
      const filePath = join(skillDir, "resource.txt");
      await writeFile(filePath, "inside content");

      const repo = new FileSkillRepository(builtInRoot, null, logger);
      // Path: builtInRoot/my-skill/../my-skill/resource.txt → still inside root
      const redundantPath = join(skillDir, "..", "my-skill", "resource.txt");

      const content = await repo.readFile(redundantPath);
      expect(content).toBe("inside content");
    });

    it("symlink inside root pointing OUTSIDE roots → SandboxViolationError", async () => {
      const skillDir = join(builtInRoot, "my-skill");
      await mkdir(skillDir, { recursive: true });
      const outsideFile = join(tmpDir, "secret.txt");
      await writeFile(outsideFile, "outside secret");
      // Create symlink inside builtInRoot pointing outside
      const symlinkPath = join(skillDir, "escape-link.txt");
      await symlink(outsideFile, symlinkPath);

      const repo = new FileSkillRepository(builtInRoot, null, logger);

      await expect(repo.readFile(symlinkPath)).rejects.toThrow(
        SandboxViolationError,
      );
    });

    it("symlink inside root pointing to another file inside root → allowed", async () => {
      const skillDir = join(builtInRoot, "my-skill");
      await mkdir(skillDir, { recursive: true });
      const targetFile = join(skillDir, "target.txt");
      await writeFile(targetFile, "target content");
      const symlinkPath = join(skillDir, "link.txt");
      await symlink(targetFile, symlinkPath);

      const repo = new FileSkillRepository(builtInRoot, null, logger);
      const content = await repo.readFile(symlinkPath);

      expect(content).toBe("target content");
    });

    it("path equal to builtInRoot itself → SandboxViolationError", async () => {
      const repo = new FileSkillRepository(builtInRoot, null, logger);

      await expect(repo.readFile(builtInRoot)).rejects.toThrow(
        SandboxViolationError,
      );
    });

    it("path equal to customRoot itself → SandboxViolationError", async () => {
      const repo = new FileSkillRepository(builtInRoot, customRoot, logger);

      await expect(repo.readFile(customRoot)).rejects.toThrow(
        SandboxViolationError,
      );
    });

    it("directory target → FileNotFoundError", async () => {
      const skillDir = join(builtInRoot, "my-skill");
      await mkdir(skillDir, { recursive: true });

      const repo = new FileSkillRepository(builtInRoot, null, logger);

      await expect(repo.readFile(skillDir)).rejects.toThrow(FileNotFoundError);
    });

    it("customRoot is null → path in customRoot area → SandboxViolationError", async () => {
      const skillDir = join(customRoot, "my-skill");
      await mkdir(skillDir, { recursive: true });
      const filePath = join(skillDir, "data.txt");
      await writeFile(filePath, "custom data");

      // null customRoot → only builtInRoot is allowed
      const repo = new FileSkillRepository(builtInRoot, null, logger);

      await expect(repo.readFile(filePath)).rejects.toThrow(
        SandboxViolationError,
      );
    });

    it("trailing-sep: path with root prefix but different root name → SandboxViolationError", async () => {
      // builtInRoot is e.g. /tmp/shrimp-skill-test-xyz/built-in
      // Path /tmp/shrimp-skill-test-xyz/built-in-extra/foo must NOT be inside builtInRoot
      const sibling = join(tmpDir, "built-in-extra");
      await mkdir(sibling, { recursive: true });
      const siblingsFile = join(sibling, "foo.txt");
      await writeFile(siblingsFile, "should be refused");

      const repo = new FileSkillRepository(builtInRoot, null, logger);

      await expect(repo.readFile(siblingsFile)).rejects.toThrow(
        SandboxViolationError,
      );
    });
  });
});
