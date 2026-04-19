import type { ConversationMessage } from "../../entities/conversation-message";

export type SummarizeInput = {
  /** Pre-compaction snapshot of the current Session's ConversationMessage history. */
  history: readonly ConversationMessage[];
  /** Job ID from the invoking ChannelJob, used for correlation. */
  jobId: string;
};

/** See SPEC.md §SummarizePort */
export interface SummarizePort {
  summarize(input: SummarizeInput): Promise<string>;
}
