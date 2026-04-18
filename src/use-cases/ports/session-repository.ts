import type { ConversationMessage } from "../../entities/conversation-message";

export type Session = {
  id: string;
  messages: ConversationMessage[];
};

export interface SessionRepository {
  /**
   * Returns the current Session (reads state.json, then loads the JSONL file),
   * or null when none exists.
   *
   * SPEC failure semantics: state.json missing → return null (not an error);
   * state.json malformed → fail fast (throw at construction / load time);
   * JSONL missing or unreadable → return a fresh session with no messages.
   */
  getCurrent(): Promise<Session | null>;

  /**
   * Creates a new Session, persists it as current, and returns it.
   * Used on the first inbound message and on /new.
   * Any previous Session file is retained on disk as an archive;
   * this call only moves the "current" pointer to the freshly created Session.
   */
  createNew(): Promise<Session>;

  /**
   * Appends messages to the given Session's JSONL file.
   *
   * SPEC failure semantics: JSONL append failure during a Job is Fail-Open —
   * implementations MUST NOT throw on I/O failure here; they log and continue.
   * The interface returns void to reinforce that callers should not rely on
   * a success/failure signal from this method.
   */
  append(
    sessionId: string,
    messages: readonly ConversationMessage[],
  ): Promise<void>;
}
