export type ConversationRole = "user" | "assistant" | "system";

export type ConversationMessage = {
  readonly role: ConversationRole;
  readonly content: string;
};
