import type { ConversationRef } from "../../entities/conversation-ref";

export interface ChannelGateway {
  /**
   * Deliver an outbound reply to the Channel conversation pointed at by `ref`.
   *
   * Fail-Open per SPEC §Channel Integration: implementations must NOT throw
   * on delivery failure (network error, upstream rejection, etc.). They log
   * the error and resolve normally so the Job is never failed solely because
   * a reply could not be delivered.
   */
  reply(ref: ConversationRef, text: string): Promise<void>;

  /**
   * Signal that the Agent is processing so the user sees a platform-native
   * "working" indicator (e.g. Telegram's "typing…" status).
   *
   * Fail-Open per SPEC §Channel Integration: implementations must NOT throw
   * on delivery failure. A missing indicator is a cosmetic degradation and
   * must never fail the Job.
   */
  indicateProcessing(ref: ConversationRef): Promise<void>;
}
