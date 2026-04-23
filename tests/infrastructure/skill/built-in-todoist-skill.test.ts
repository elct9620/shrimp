import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { FileSkillRepository } from "../../../src/infrastructure/skill/file-skill-repository";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";

function makeStubLogger(): LoggerPort {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

describe("Built-in todoist skill discovery", () => {
  const builtInRoot = resolve(__dirname, "../../../skills");

  it("discovers the todoist skill from the real skills/ directory", () => {
    const logger = makeStubLogger();
    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    const todoist = entries.find((e) => e.name === "todoist");
    expect(todoist).toBeDefined();
    expect(todoist!.name).toBe("todoist");
    expect(todoist!.description.length).toBeGreaterThan(0);
    expect(todoist!.description.length).toBeLessThanOrEqual(1024);
    expect(todoist!.skillFilePath).toMatch(/skills\/todoist\/SKILL\.md$/);
  });

  it("todoist skill description mentions Todoist board interaction", () => {
    const logger = makeStubLogger();
    const repo = new FileSkillRepository(builtInRoot, null, logger);
    const entries = repo.list();

    const todoist = entries.find((e) => e.name === "todoist");
    expect(todoist).toBeDefined();
    // Description should be informative about the skill's purpose
    expect(todoist!.description.toLowerCase()).toMatch(/todoist|board|task/);
  });
});
