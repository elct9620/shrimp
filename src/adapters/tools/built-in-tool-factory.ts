import { injectable, inject } from "tsyringe";
import { TOKENS } from "../../infrastructure/container/tokens";
import type { BoardRepository } from "../../use-cases/ports/board-repository";
import type { LoggerPort } from "../../use-cases/ports/logger";
import type { ChannelGateway } from "../../use-cases/ports/channel-gateway";
import type { ConversationRef } from "../../entities/conversation-ref";
import type { ToolSet } from "../../use-cases/ports/tool-set";
import type { ToolDescription } from "../../use-cases/ports/tool-description";
import {
  createBuiltInTools,
  createBuiltInToolDescriptions,
} from "./built-in/index";

@injectable()
export class BuiltInToolFactory {
  constructor(
    @inject(TOKENS.BoardRepository) private readonly board: BoardRepository,
    @inject(TOKENS.Logger) private readonly logger: LoggerPort,
    @inject(TOKENS.ChannelGateway)
    private readonly channelGateway: ChannelGateway,
  ) {}

  create(context?: { ref?: ConversationRef }): {
    tools: ToolSet;
    descriptions: ToolDescription[];
  } {
    return {
      tools: createBuiltInTools(
        this.board,
        this.logger.child({ module: "built-in-tools" }),
        this.channelGateway,
        context?.ref,
      ),
      descriptions: createBuiltInToolDescriptions(),
    };
  }
}
