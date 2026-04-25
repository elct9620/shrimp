import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, dirname, resolve, isAbsolute, sep } from "node:path";
import matter from "gray-matter";
import type {
  SkillCatalog,
  SkillCatalogEntry,
} from "../../use-cases/ports/skill-catalog";
import {
  FileNotFoundError,
  SandboxViolationError,
  SkillNotFoundError,
} from "../../use-cases/ports/skill-catalog";
import type { LoggerPort } from "../../use-cases/ports/logger";

const NAME_PATTERN = /^[a-z0-9-]+$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESC_LENGTH = 1024;

/**
 * Implements `SkillCatalog` by scanning two filesystem roots at construction
 * time (SPEC §Skill Layer §Discovery). The scan is synchronous and the catalog
 * is frozen for the process lifetime.
 *
 * Constructor params:
 *   builtInRoot  — absolute path to the Built-in Skills root (MUST exist)
 *   customRoot   — absolute path to the Custom Skills root, or null/missing dir
 *   logger       — structured logger
 *
 * Config wiring (builtInRoot ← bundled path, customRoot ← SHRIMP_HOME/skills/)
 * is handled by the DI container (item #8).
 */
export class FileSkillRepository implements SkillCatalog {
  private readonly catalog: readonly SkillCatalogEntry[];
  private readonly logger: LoggerPort;
  private readonly builtInRoot: string;
  private readonly customRoot: string | null;

  constructor(
    builtInRoot: string,
    customRoot: string | null,
    logger: LoggerPort,
  ) {
    this.logger = logger.child({ module: "FileSkillRepository" });

    // Fail fast: Built-in root is a packaging invariant (SPEC line 677).
    if (!directoryExists(builtInRoot)) {
      throw new Error(
        `Built-in Skills root is missing or not a directory: ${builtInRoot}`,
      );
    }

    // Canonicalise roots once so sandbox comparisons are consistent on
    // platforms where paths include symlink segments (e.g. macOS's
    // `/var` → `/private/var`). See `readFile()`.
    this.builtInRoot = realpathSync(builtInRoot);
    this.customRoot =
      customRoot !== null && directoryExists(customRoot)
        ? realpathSync(customRoot)
        : customRoot;

    const builtInEntries = this.scanRoot(builtInRoot, new Map());
    const builtInNames = new Map<string, SkillCatalogEntry>(
      builtInEntries.map((e) => [e.name, e]),
    );

    let customEntries: SkillCatalogEntry[] = [];
    if (customRoot !== null && directoryExists(customRoot)) {
      customEntries = this.scanRoot(customRoot, builtInNames);
    }
    // Custom root absent or null → empty Custom catalog (SPEC line 677, not an error)

    this.catalog = Object.freeze([...builtInEntries, ...customEntries]);
  }

  list(): readonly SkillCatalogEntry[] {
    return this.catalog;
  }

  async getSkillContent(name: string): Promise<string> {
    const entry = this.catalog.find((e) => e.name === name);
    if (!entry) {
      throw new SkillNotFoundError(name);
    }

    const raw = await readFile(entry.skillFilePath, "utf-8");
    const skillDir = dirname(entry.skillFilePath);
    const body = matter(raw).content.replace(/^\n+/, "");
    return rewriteRelativePaths(body, skillDir);
  }

  async readFile(inputPath: string): Promise<string> {
    // Step 1: Canonicalise — resolve symlinks and `..` BEFORE the prefix check
    // so a symlink inside a root pointing outside is caught (SPEC line 487).
    let canonical: string;
    try {
      canonical = await realpath(inputPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new FileNotFoundError(inputPath);
      }
      throw new Error(`Failed to resolve path: ${(err as Error).message}`);
    }

    // Step 2: Verify the canonical path is strictly inside an allowed root.
    // Using a trailing sep ensures "/app/skills-extra/foo" is not matched by
    // "/app/skills" prefix (SPEC line 485).
    this.assertInsideRoot(canonical, this.builtInRoot, this.customRoot);

    // Step 3: Confirm it is a regular file (not a directory).
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(canonical);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new FileNotFoundError(inputPath);
      }
      throw new Error(`Failed to stat file: ${(err as Error).message}`);
    }
    if (!fileStat.isFile()) {
      throw new FileNotFoundError(inputPath);
    }

    // Step 4: Read and return.
    try {
      return await readFile(canonical, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Race: file removed between realpath and read.
        throw new FileNotFoundError(inputPath);
      }
      throw new Error(`Failed to read file: ${(err as Error).message}`);
    }
  }

  /**
   * Throws `SandboxViolationError` if `canonical` is not strictly inside
   * `builtInRoot` or `customRoot` (when non-null).
   *
   * "Strictly inside" means the canonical path begins with the root followed
   * by `path.sep`, ensuring prefix-only matches (e.g. `/skills-extra`) are
   * not confused with `/skills`.
   */
  private assertInsideRoot(
    canonical: string,
    builtInRoot: string,
    customRoot: string | null,
  ): void {
    const isInside = (root: string): boolean =>
      canonical.startsWith(root + sep);

    if (isInside(builtInRoot)) return;
    if (customRoot !== null && isInside(customRoot)) return;

    throw new SandboxViolationError(canonical);
  }

  /**
   * Scans immediate children of `root` for valid skills. Already-known names
   * (from a prior root scan) are used to detect duplicates; duplicate Custom
   * skills are warn+skip while the existing Built-in entry wins.
   */
  private scanRoot(
    root: string,
    existingNames: Map<string, SkillCatalogEntry>,
  ): SkillCatalogEntry[] {
    const entries: SkillCatalogEntry[] = [];

    let children: string[];
    try {
      children = readdirSync(root);
    } catch {
      return entries;
    }

    for (const child of children) {
      const childPath = join(root, child);

      // Only immediate directories are candidate skills (SPEC line 440).
      let stat;
      try {
        stat = statSync(childPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const skillFilePath = join(childPath, "SKILL.md");
      let rawContent: string;
      try {
        rawContent = readFileSync(skillFilePath, "utf-8");
      } catch {
        // Missing SKILL.md → not a skill, skip silently (SPEC line 440).
        continue;
      }

      const entry = this.parseSkillEntry(child, skillFilePath, rawContent);
      if (!entry) continue; // parse failure already warned

      // Duplicate check (SPEC line 679): Built-in wins over Custom.
      if (existingNames.has(entry.name)) {
        this.logger.warn(
          "SKILL.md duplicate skill name — Built-in skill wins; skipping Custom skill",
          { skillDir: childPath, name: entry.name },
        );
        continue;
      }

      entries.push(entry);
      existingNames.set(entry.name, entry);
    }

    return entries;
  }

  /**
   * Parses YAML frontmatter from `rawContent` and validates required fields.
   * Returns `null` (and emits a warn) if any rule is violated (SPEC line 678).
   */
  private parseSkillEntry(
    dirName: string,
    skillFilePath: string,
    rawContent: string,
  ): SkillCatalogEntry | null {
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(rawContent);
    } catch (err) {
      this.logger.warn("SKILL.md frontmatter unparseable — skipping skill", {
        skillFilePath,
        err,
      });
      return null;
    }

    const { data } = parsed;
    const name: unknown = data["name"];
    const description: unknown = data["description"];

    if (typeof name !== "string" || name.length === 0) {
      this.logger.warn(
        "SKILL.md frontmatter missing or empty 'name' field — skipping skill",
        { skillFilePath },
      );
      return null;
    }

    if (name.length > MAX_NAME_LENGTH) {
      this.logger.warn(
        `SKILL.md 'name' exceeds ${MAX_NAME_LENGTH} characters — skipping skill`,
        { skillFilePath, name },
      );
      return null;
    }

    if (!NAME_PATTERN.test(name)) {
      this.logger.warn(
        "SKILL.md 'name' contains invalid characters (allowed: [a-z0-9-]) — skipping skill",
        { skillFilePath, name },
      );
      return null;
    }

    if (name !== dirName) {
      this.logger.warn(
        "SKILL.md 'name' does not match parent directory name — skipping skill",
        { skillFilePath, name, dirName },
      );
      return null;
    }

    if (typeof description !== "string" || description.length === 0) {
      this.logger.warn(
        "SKILL.md frontmatter missing or empty 'description' field — skipping skill",
        { skillFilePath },
      );
      return null;
    }

    if (description.length > MAX_DESC_LENGTH) {
      this.logger.warn(
        `SKILL.md 'description' exceeds ${MAX_DESC_LENGTH} characters — skipping skill`,
        { skillFilePath },
      );
      return null;
    }

    return { name, description, skillFilePath };
  }
}

/**
 * Rewrites relative resource references in `content` to absolute paths
 * anchored at `skillDir` (SPEC §Skill Layer §`skill(name)` tool lines 471-478).
 *
 * Rewriting covers:
 *   1. Markdown link and image targets: `[text](path)` and `![alt](path)`
 *   2. Backtick code spans: `` `path` `` where path looks like a relative file path
 *
 * Paths are left untouched when:
 *   - They begin with `/` (absolute)
 *   - They contain a URI scheme (`http:`, `https:`, `mailto:`, etc.)
 *   - Resolving them escapes `skillDir` (e.g. `../other/file`) (SPEC line 478)
 *
 * Heuristic for backtick spans: a span is treated as a file path when it
 * matches `[^\`/][^\`]*\.[^\`/]{1,10}` — i.e. a relative token containing
 * at least one dot-separated extension. This avoids rewriting command names
 * (e.g. `ls`) while catching common cases like `scripts/setup.sh`. False
 * negatives (paths without extensions) are accepted; the SPEC says "recognisable
 * as file paths", not "every possible path".
 */
function rewriteRelativePaths(content: string, skillDir: string): string {
  // 1. Markdown links and images: ![alt](target) or [text](target)
  content = content.replace(
    /(!?\[[^\]]*\])\(([^)]+)\)/g,
    (match, prefix: string, target: string) => {
      const rewritten = maybeRewrite(target.trim(), skillDir);
      return rewritten === target ? match : `${prefix}(${rewritten})`;
    },
  );

  // 2. Backtick code spans: `path`
  //    Heuristic: relative token with at least one dot-separated segment
  //    that looks like a file extension (1-10 chars after the last dot).
  const BACKTICK_FILE_PATTERN = /^[^/][^`]*\.[^`./]{1,10}$/;
  content = content.replace(/`([^`]+)`/g, (match, inner: string) => {
    const trimmed = inner.trim();
    if (!BACKTICK_FILE_PATTERN.test(trimmed)) return match;
    const rewritten = maybeRewrite(trimmed, skillDir);
    return rewritten === trimmed ? match : `\`${rewritten}\``;
  });

  return content;
}

/**
 * Returns the rewritten absolute path if `target` is a relative path that
 * stays within `skillDir`, or the original `target` otherwise.
 */
function maybeRewrite(target: string, skillDir: string): string {
  // Leave absolute paths and URI schemes untouched.
  if (isAbsolute(target)) return target;
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(target)) return target;

  const absolute = resolve(skillDir, target);

  // Leave escaping paths untouched (SPEC line 478).
  if (!absolute.startsWith(skillDir + "/") && absolute !== skillDir) {
    return target;
  }

  return absolute;
}

function directoryExists(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
