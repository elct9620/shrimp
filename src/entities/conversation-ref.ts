// Use-cases MUST NOT read payload; only the originating Channel adapter interprets it.
export type ConversationRef = {
  readonly channel: string;
  /** Normalized chat/conversation identifier. Adapters populate this at construction when available. */
  readonly chatId?: number;
  readonly payload: Record<string, unknown>;
};
