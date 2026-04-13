import type { ToolProvider } from "../../use-cases/ports/tool-provider";
import type { ToolSet } from "../../use-cases/ports/tool-set";
import type { ToolDescription } from "../../use-cases/ports/tool-description";
import type { LoggerPort } from "../../use-cases/ports/logger";

export type ToolRegistryInput = {
  builtInTools: ToolSet;
  builtInDescriptions: ToolDescription[];
  mcpTools: ToolSet;
  mcpDescriptions: ToolDescription[];
};

export class ToolRegistry implements ToolProvider {
  constructor(
    private readonly input: ToolRegistryInput,
    logger: LoggerPort,
  ) {
    const builtInCount = Object.keys(input.builtInTools).length;
    const mcpCount = Object.keys(input.mcpTools).length;
    const builtInNames = new Set(Object.keys(input.builtInTools));
    const collisions = Object.keys(input.mcpTools).filter((name) =>
      builtInNames.has(name),
    );

    logger.info("tool registry assembled", {
      builtInCount,
      mcpCount,
      totalCount: builtInCount + mcpCount - collisions.length,
    });

    if (collisions.length > 0) {
      logger.warn("tool name collision — built-in wins", { collisions });
    }
  }

  getTools(): ToolSet {
    return { ...this.input.mcpTools, ...this.input.builtInTools };
  }

  getToolDescriptions(): ToolDescription[] {
    const builtInNames = new Set(
      this.input.builtInDescriptions.map((d) => d.name),
    );
    const filteredMcp = this.input.mcpDescriptions.filter(
      (d) => !builtInNames.has(d.name),
    );
    return [...this.input.builtInDescriptions, ...filteredMcp];
  }
}
