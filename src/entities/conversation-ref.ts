// Use-cases MUST NOT read payload; only the originating Channel adapter interprets it.
export type ConversationRef = {
  readonly channel: string;
  readonly payload: Record<string, unknown>;
};
