import type { ToolProviderFactory } from "../../use-cases/ports/tool-provider-factory";
import type { ToolProvider } from "../../use-cases/ports/tool-provider";
import type { ToolSet } from "../../use-cases/ports/tool-set";
import type { ToolDescription } from "../../use-cases/ports/tool-description";
import type { LoggerPort } from "../../use-cases/ports/logger";
import type { ConversationRef } from "../../entities/conversation-ref";
import type { BuiltInToolFactory } from "./built-in-tool-factory";
import { ToolRegistry } from "./tool-registry";

export class ToolProviderFactoryImpl implements ToolProviderFactory {
  constructor(
    private readonly builtInFactory: BuiltInToolFactory,
    private readonly mcpTools: ToolSet,
    private readonly mcpDescriptions: ToolDescription[],
    private readonly logger: LoggerPort,
  ) {}

  create(context?: { ref?: ConversationRef }): ToolProvider {
    const builtIn = this.builtInFactory.create(context);
    return new ToolRegistry(
      {
        builtInTools: builtIn.tools,
        builtInDescriptions: builtIn.descriptions,
        mcpTools: this.mcpTools,
        mcpDescriptions: this.mcpDescriptions,
      },
      this.logger,
    );
  }
}
