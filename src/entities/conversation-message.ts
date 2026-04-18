export type ConversationRole = "user" | "assistant";

export type ConversationMessage = {
  readonly role: ConversationRole;
  readonly content: string;
};
