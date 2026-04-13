import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../../src/adapters/tools/tool-registry";
import type { ToolProvider } from "../../../src/use-cases/ports/tool-provider";
import type { ToolSet } from "../../../src/use-cases/ports/tool-set";
import type { ToolDescription } from "../../../src/use-cases/ports/tool-description";
import { makeFakeLogger } from "../../mocks/fake-logger";

function makeTools(...names: string[]): ToolSet {
  return Object.fromEntries(names.map((n) => [n, { fake: n }]));
}

function makeDescriptions(...names: string[]): ToolDescription[] {
  return names.map((name) => ({ name, description: `desc for ${name}` }));
}

describe("ToolRegistry", () => {
  it("implements ToolProvider interface", () => {
    const registry: ToolProvider = new ToolRegistry(
      {
        builtInTools: {},
        builtInDescriptions: [],
        mcpTools: {},
        mcpDescriptions: [],
      },
      makeFakeLogger(),
    );
    expect(typeof registry.getTools).toBe("function");
    expect(typeof registry.getToolDescriptions).toBe("function");
  });

  it("returns merged map with all built-in and MCP tool names as keys", () => {
    const registry = new ToolRegistry(
      {
        builtInTools: makeTools("getTasks", "postComment"),
        builtInDescriptions: makeDescriptions("getTasks", "postComment"),
        mcpTools: makeTools("searchWeb", "readPage"),
        mcpDescriptions: makeDescriptions("searchWeb", "readPage"),
      },
      makeFakeLogger(),
    );

    const tools = registry.getTools();
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "getTasks",
        "postComment",
        "searchWeb",
        "readPage",
      ]),
    );
    expect(Object.keys(tools)).toHaveLength(4);
  });

  it("returns built-in descriptions first in getToolDescriptions", () => {
    const registry = new ToolRegistry(
      {
        builtInTools: makeTools("getTasks"),
        builtInDescriptions: makeDescriptions("getTasks"),
        mcpTools: makeTools("searchWeb"),
        mcpDescriptions: makeDescriptions("searchWeb"),
      },
      makeFakeLogger(),
    );

    const descriptions = registry.getToolDescriptions();
    expect(descriptions[0].name).toBe("getTasks");
    expect(descriptions[1].name).toBe("searchWeb");
  });

  it("returns only built-in tools when MCP tools are empty", () => {
    const registry = new ToolRegistry(
      {
        builtInTools: makeTools("getTasks", "postComment"),
        builtInDescriptions: makeDescriptions("getTasks", "postComment"),
        mcpTools: {},
        mcpDescriptions: [],
      },
      makeFakeLogger(),
    );

    const tools = registry.getTools();
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(["getTasks", "postComment"]),
    );
    expect(Object.keys(tools)).toHaveLength(2);

    const descriptions = registry.getToolDescriptions();
    expect(descriptions).toHaveLength(2);
    expect(descriptions.map((d) => d.name)).toEqual([
      "getTasks",
      "postComment",
    ]);
  });

  it("built-in wins on name collision in getTools", () => {
    const builtInValue = { source: "built-in" };
    const mcpValue = { source: "mcp" };
    const registry = new ToolRegistry(
      {
        builtInTools: { collision: builtInValue },
        builtInDescriptions: [
          { name: "collision", description: "built-in version" },
        ],
        mcpTools: { collision: mcpValue },
        mcpDescriptions: [{ name: "collision", description: "mcp version" }],
      },
      makeFakeLogger(),
    );

    const tools = registry.getTools();
    expect(tools["collision"]).toBe(builtInValue);
  });

  it("built-in wins on name collision in getToolDescriptions", () => {
    const registry = new ToolRegistry(
      {
        builtInTools: { collision: {} },
        builtInDescriptions: [
          { name: "collision", description: "built-in version" },
        ],
        mcpTools: { collision: {} },
        mcpDescriptions: [{ name: "collision", description: "mcp version" }],
      },
      makeFakeLogger(),
    );

    const descriptions = registry.getToolDescriptions();
    expect(descriptions).toHaveLength(1);
    expect(descriptions[0].description).toBe("built-in version");
  });

  it("returns empty set when both built-in and MCP are empty", () => {
    const registry = new ToolRegistry(
      {
        builtInTools: {},
        builtInDescriptions: [],
        mcpTools: {},
        mcpDescriptions: [],
      },
      makeFakeLogger(),
    );

    expect(registry.getTools()).toEqual({});
    expect(registry.getToolDescriptions()).toEqual([]);
  });

  describe("logging", () => {
    it("should log info with builtInCount, mcpCount and totalCount at construction", () => {
      const logger = makeFakeLogger();

      new ToolRegistry(
        {
          builtInTools: makeTools("getTasks", "postComment"),
          builtInDescriptions: makeDescriptions("getTasks", "postComment"),
          mcpTools: makeTools("searchWeb", "readPage", "runCode"),
          mcpDescriptions: makeDescriptions("searchWeb", "readPage", "runCode"),
        },
        logger,
      );

      expect(logger.info).toHaveBeenCalledWith(
        "tool registry assembled",
        expect.objectContaining({
          builtInCount: 2,
          mcpCount: 3,
          totalCount: 5,
        }),
      );
    });

    it("should log warn listing the colliding names when built-in and MCP share names", () => {
      const logger = makeFakeLogger();

      new ToolRegistry(
        {
          builtInTools: makeTools("getTasks", "postComment"),
          builtInDescriptions: makeDescriptions("getTasks", "postComment"),
          mcpTools: makeTools("getTasks", "searchWeb"),
          mcpDescriptions: makeDescriptions("getTasks", "searchWeb"),
        },
        logger,
      );

      expect(logger.warn).toHaveBeenCalledWith(
        "tool name collision — built-in wins",
        expect.objectContaining({ collisions: ["getTasks"] }),
      );
    });

    it("should subtract collisions from totalCount in the info log", () => {
      const logger = makeFakeLogger();

      new ToolRegistry(
        {
          builtInTools: makeTools("a", "b"),
          builtInDescriptions: makeDescriptions("a", "b"),
          mcpTools: makeTools("a", "c"),
          mcpDescriptions: makeDescriptions("a", "c"),
        },
        logger,
      );

      expect(logger.info).toHaveBeenCalledWith(
        "tool registry assembled",
        expect.objectContaining({
          builtInCount: 2,
          mcpCount: 2,
          totalCount: 3,
        }),
      );
    });

    it("should not log warn when there are no collisions", () => {
      const logger = makeFakeLogger();

      new ToolRegistry(
        {
          builtInTools: makeTools("a"),
          builtInDescriptions: makeDescriptions("a"),
          mcpTools: makeTools("b"),
          mcpDescriptions: makeDescriptions("b"),
        },
        logger,
      );

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
