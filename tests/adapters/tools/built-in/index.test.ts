import { describe, it, expect, vi } from "vitest";
import {
  createBuiltInTools,
  createBuiltInToolDescriptions,
} from "../../../../src/adapters/tools/built-in/index";
import type { SkillCatalog } from "../../../../src/use-cases/ports/skill-catalog";
import { makeFakeRepo, makeFakeLogger } from "./helpers";

function makeFakeSkillCatalog(): SkillCatalog {
  return {
    list: vi.fn(),
    getSkillContent: vi.fn(),
    readFile: vi.fn(),
  };
}

describe("createBuiltInTools", () => {
  it("returns the four built-in Todoist tools with schema and execute", () => {
    const tools = createBuiltInTools(
      makeFakeRepo(),
      makeFakeSkillCatalog(),
      makeFakeLogger(),
    );
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "getTasks",
        "getComments",
        "postComment",
        "moveTask",
      ]),
    );
    for (const tool of Object.values(tools)) {
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("includes skill and read tools alongside Todoist tools", () => {
    const tools = createBuiltInTools(
      makeFakeRepo(),
      makeFakeSkillCatalog(),
      makeFakeLogger(),
    );
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(["skill", "read"]),
    );
  });

  it("wires the repo through so tool execution reaches it", async () => {
    const repo = makeFakeRepo();
    vi.mocked(repo.getTasks).mockResolvedValue([]);
    const tools = createBuiltInTools(
      repo,
      makeFakeSkillCatalog(),
      makeFakeLogger(),
    );
    await tools.getTasks.execute!(
      { section: "Backlog" },
      { toolCallId: "test", messages: [] },
    );
    expect(repo.getTasks).toHaveBeenCalled();
  });
});

describe("createBuiltInToolDescriptions", () => {
  it("returns one description per tool key with matching names", () => {
    const descriptions = createBuiltInToolDescriptions();
    const toolKeys = Object.keys(
      createBuiltInTools(
        makeFakeRepo(),
        makeFakeSkillCatalog(),
        makeFakeLogger(),
      ),
    );
    expect(descriptions).toHaveLength(toolKeys.length);
    const descriptionNames = descriptions.map((d) => d.name);
    expect(descriptionNames).toEqual(expect.arrayContaining(toolKeys));
    for (const d of descriptions) {
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });

  it("includes skill and read tool descriptions", () => {
    const descriptions = createBuiltInToolDescriptions();
    const names = descriptions.map((d) => d.name);
    expect(names).toContain("skill");
    expect(names).toContain("read");
  });
});
