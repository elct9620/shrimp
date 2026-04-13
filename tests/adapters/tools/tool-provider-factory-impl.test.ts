import { describe, it, expect, vi } from "vitest";
import { ToolProviderFactoryImpl } from "../../../src/adapters/tools/tool-provider-factory-impl";
import type { BuiltInToolFactory } from "../../../src/adapters/tools/built-in-tool-factory";
import type { ToolSet } from "../../../src/use-cases/ports/tool-set";
import type { ToolDescription } from "../../../src/use-cases/ports/tool-description";
import { makeFakeLogger } from "../../mocks/fake-logger";

function makeTools(...names: string[]): ToolSet {
  return Object.fromEntries(names.map((n) => [n, { fake: n }]));
}

function makeDescriptions(...names: string[]): ToolDescription[] {
  return names.map((name) => ({ name, description: `desc for ${name}` }));
}

function makeBuiltInFactory(
  tools: ToolSet,
  descriptions: ToolDescription[],
): BuiltInToolFactory {
  return {
    create: vi.fn().mockReturnValue({ tools, descriptions }),
  } as unknown as BuiltInToolFactory;
}

describe("ToolProviderFactoryImpl", () => {
  it("create() returns a ToolProvider with built-in tools", () => {
    const builtInFactory = makeBuiltInFactory(
      makeTools("getTasks"),
      makeDescriptions("getTasks"),
    );
    const factory = new ToolProviderFactoryImpl(
      builtInFactory,
      {},
      [],
      makeFakeLogger(),
    );

    const provider = factory.create();

    expect(Object.keys(provider.getTools())).toContain("getTasks");
  });

  it("create() returns a ToolProvider that includes MCP tools", () => {
    const builtInFactory = makeBuiltInFactory(
      makeTools("getTasks"),
      makeDescriptions("getTasks"),
    );
    const factory = new ToolProviderFactoryImpl(
      builtInFactory,
      makeTools("searchWeb"),
      makeDescriptions("searchWeb"),
      makeFakeLogger(),
    );

    const provider = factory.create();
    const toolNames = Object.keys(provider.getTools());

    expect(toolNames).toContain("getTasks");
    expect(toolNames).toContain("searchWeb");
  });

  it("create() calls builtInFactory.create() each time", () => {
    const builtInFactory = makeBuiltInFactory(
      makeTools("a"),
      makeDescriptions("a"),
    );
    const factory = new ToolProviderFactoryImpl(
      builtInFactory,
      {},
      [],
      makeFakeLogger(),
    );

    factory.create();
    factory.create();

    expect(builtInFactory.create).toHaveBeenCalledTimes(2);
  });

  it("create() returns a ToolProvider whose descriptions include both built-in and MCP", () => {
    const builtInFactory = makeBuiltInFactory(
      makeTools("getTasks"),
      makeDescriptions("getTasks"),
    );
    const factory = new ToolProviderFactoryImpl(
      builtInFactory,
      makeTools("searchWeb"),
      makeDescriptions("searchWeb"),
      makeFakeLogger(),
    );

    const provider = factory.create();
    const names = provider.getToolDescriptions().map((d) => d.name);

    expect(names).toContain("getTasks");
    expect(names).toContain("searchWeb");
  });
});
