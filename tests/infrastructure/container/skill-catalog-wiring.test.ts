import { resolve } from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
// Import container.ts to trigger all module-level useFactory registrations
import { container } from "../../../src/container";
import { TOKENS } from "../../../src/infrastructure/container/tokens";
import { FileSkillRepository } from "../../../src/infrastructure/skill/file-skill-repository";
import type { SkillCatalog } from "../../../src/use-cases/ports/skill-catalog";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";

function makeStubLogger(): LoggerPort {
  const logger: LoggerPort = {
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

describe("TOKENS.SkillCatalog wiring", () => {
  beforeEach(() => {
    // Use a child container so we don't pollute the global singleton
    container.clearInstances();
  });

  it("resolves FileSkillRepository pointing at the real skills/ root and lists the todoist entry", () => {
    const builtInRoot = resolve(process.cwd(), "skills");
    const logger = makeStubLogger();

    const catalog = new FileSkillRepository(builtInRoot, null, logger);
    const entries = catalog.list();

    expect(entries.some((e) => e.name === "todoist")).toBe(true);
  });

  it("TOKENS.SkillCatalog is registered and resolves to a SkillCatalog with the todoist entry", () => {
    const builtInRoot = resolve(process.cwd(), "skills");
    const logger = makeStubLogger();

    // Register dependencies needed by the factory
    container.registerInstance(TOKENS.Logger, logger);
    container.registerInstance(TOKENS.EnvConfig, {
      skillsBuiltInRoot: builtInRoot,
      skillsCustomRoot: null,
    } as never);

    const catalog = container.resolve<SkillCatalog>(TOKENS.SkillCatalog);
    const entries = catalog.list();

    expect(entries.some((e) => e.name === "todoist")).toBe(true);
  });
});
