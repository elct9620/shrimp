import type { ConversationRef } from "../../entities/conversation-ref";
import type { ToolProvider } from "./tool-provider";

export interface ToolProviderFactory {
  create(context?: { ref?: ConversationRef }): ToolProvider;
}
