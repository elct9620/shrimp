/**
 * Thrown by `SkillCatalog.getSkillContent` when no valid skill matches the
 * requested name. The adapter (`SkillTool`) catches this and returns an error
 * result to the model rather than propagating the exception.
 */
export class SkillNotFoundError extends Error {
  constructor(name: string) {
    super(`Skill not found: ${name}`);
    this.name = "SkillNotFoundError";
  }
}

/**
 * Thrown by `SkillCatalog.readFile` when the resolved canonical path lies
 * outside both the Built-in Skills root and the Custom Skills root.
 * The adapter (`ReadTool`) catches this and returns an error result to the
 * model rather than propagating the exception.
 */
export class SandboxViolationError extends Error {
  constructor(path: string) {
    super(`Path is outside the allowed skill roots: ${path}`);
    this.name = "SandboxViolationError";
  }
}

/**
 * Thrown by `SkillCatalog.readFile` when the resolved path is within the
 * sandbox but the file does not exist (or is not a regular file).
 * The adapter (`ReadTool`) catches this and returns an error result to the
 * model rather than propagating the exception.
 */
export class FileNotFoundError extends Error {
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = "FileNotFoundError";
  }
}

/**
 * One entry in the Skill Catalog — the three fields surfaced to the Shrimp
 * Agent via the System Prompt (SPEC §Skill Layer §Skill Catalog assembly).
 */
export interface SkillCatalogEntry {
  /** Skill name from SKILL.md frontmatter; equals the parent directory name. */
  readonly name: string;
  /** Human-readable description from SKILL.md frontmatter. */
  readonly description: string;
  /** Absolute filesystem path to this skill's SKILL.md. */
  readonly skillFilePath: string;
}

/**
 * Port that surfaces the discovered Agent Skill catalog and provides
 * on-demand content access for the Skill Layer tools (SPEC §Skill Layer).
 *
 * Consumers:
 * - `PromptAssembler` — calls `list()` to embed the catalog in the System Prompt.
 * - `SkillTool` — calls `getSkillContent(name)` to return full SKILL.md content
 *   with relative-to-absolute path rewriting applied.
 * - `ReadTool` — calls `readFile(path)` for sandbox-checked resource access.
 */
export interface SkillCatalog {
  /**
   * Returns the complete set of valid discovered skills, fixed at startup.
   * Synchronous: the catalog is assembled once during process startup and
   * never changes for the process lifetime (SPEC §Skill Layer §Discovery).
   */
  list(): readonly SkillCatalogEntry[];

  /**
   * Returns the full textual content of the named skill's SKILL.md, with
   * relative resource references rewritten to absolute paths anchored at
   * the skill's own directory (SPEC §Skill Layer §`skill(name)` tool).
   *
   * @throws {SkillNotFoundError} if no valid skill matches `name`.
   */
  getSkillContent(name: string): Promise<string>;

  /**
   * Returns the content of the file at the given absolute path after
   * verifying it lies within the Built-in Skills root or the Custom Skills
   * root (symlinks are resolved before the prefix check).
   *
   * (SPEC §Skill Layer §`read(path)` tool).
   *
   * @throws {SandboxViolationError} if the resolved path falls outside both roots.
   * @throws {FileNotFoundError} if the path is within the sandbox but the file
   *   does not exist or is not a regular file.
   */
  readFile(path: string): Promise<string>;
}
