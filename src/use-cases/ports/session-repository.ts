import type { ConversationMessage } from "../../entities/conversation-message";

export type Session = {
  id: string;
  messages: ConversationMessage[];
};

/**
 * Thrown when writing the new Session JSONL file fails during rotation.
 * state.json is NOT updated; the previous Session remains current.
 */
export class SessionJsonlWriteError extends Error {
  constructor(cause: unknown) {
    super(
      `Auto Compact: new Session JSONL write failed — rotation aborted; previous Session remains current`,
    );
    this.name = "SessionJsonlWriteError";
    this.cause = cause;
  }
}

/**
 * Thrown when updating state.json fails after the new Session JSONL was
 * written successfully. The new JSONL exists on disk as an orphan;
 * the previous Session remains current via the old state.json pointer.
 */
export class SessionStateUpdateError extends Error {
  constructor(newSessionId: string, cause: unknown) {
    super(
      `Auto Compact: state.json update failed — new Session JSONL orphaned (id: ${newSessionId}); previous Session remains current`,
    );
    this.name = "SessionStateUpdateError";
    this.cause = cause;
  }
}

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

  /**
   * Auto Compact rotation helper (SPEC §Session Lifecycle §Auto Compact, steps 3–5).
   *
   * Creates a brand-new Session (new UUID, new JSONL file under sessions/),
   * writes a single `role: "system"` ConversationMessage whose content is the
   * provided Conversation Summary string, then atomically updates state.json to
   * point to the new Session. The previous Session JSONL is left on disk as an
   * archive — this helper never deletes any file.
   *
   * Caller responsibilities (steps 1–2 and 6):
   *   - Snapshot the current Session's ConversationMessage list (step 1)
   *   - Invoke SummarizePort to produce the summary string (step 2)
   *   - Proceed with the new Session after this call returns (step 6)
   *
   * Distinct failure surfaces:
   *   - New JSONL write fails → throws `SessionJsonlWriteError`;
   *     state.json is NOT updated; no orphan file; previous Session remains current.
   *   - state.json update fails after JSONL written → throws `SessionStateUpdateError`;
   *     new JSONL remains on disk as an orphan; previous Session remains current.
   */
  rotateWithSummary(summary: string): Promise<void>;
}
