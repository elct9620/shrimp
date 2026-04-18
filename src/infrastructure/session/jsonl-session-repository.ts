import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  appendFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { ConversationMessage } from "../../entities/conversation-message";
import type {
  Session,
  SessionRepository,
} from "../../use-cases/ports/session-repository";
import type { LoggerPort } from "../../use-cases/ports/logger";

type StateFile = {
  currentSessionId: string | null;
};

function isStateFile(value: unknown): value is StateFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "currentSessionId" in value &&
    (typeof (value as StateFile).currentSessionId === "string" ||
      (value as StateFile).currentSessionId === null)
  );
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    "content" in value &&
    ((value as ConversationMessage).role === "user" ||
      (value as ConversationMessage).role === "assistant") &&
    typeof (value as ConversationMessage).content === "string"
  );
}

export class JsonlSessionRepository implements SessionRepository {
  private readonly stateDir: string;
  private readonly logger: LoggerPort;

  constructor({ stateDir, logger }: { stateDir: string; logger: LoggerPort }) {
    this.stateDir = stateDir;
    this.logger = logger.child({ module: "JsonlSessionRepository" });
  }

  private get stateFilePath(): string {
    return join(this.stateDir, "state.json");
  }

  private get sessionsDirPath(): string {
    return join(this.stateDir, "sessions");
  }

  private sessionFilePath(id: string): string {
    return join(this.sessionsDirPath, `${id}.jsonl`);
  }

  /**
   * Returns the current Session by reading state.json and loading its JSONL.
   * Three-way failure semantics:
   *   - state.json missing → null (not an error)
   *   - state.json malformed → throw (fail fast per SPEC)
   *   - JSONL missing or unreadable → discard-and-fresh: log warn, return null
   */
  async getCurrent(): Promise<Session | null> {
    const statePath = this.stateFilePath;

    let rawState: string;
    try {
      rawState = await readFile(statePath, "utf-8");
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") {
        return null;
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawState);
    } catch {
      throw new Error(
        `state.json malformed — Fail fast at startup: ${statePath}`,
      );
    }

    if (!isStateFile(parsed)) {
      throw new Error(
        `state.json malformed — Fail fast at startup: ${statePath}`,
      );
    }

    const { currentSessionId } = parsed;
    if (!currentSessionId) {
      return null;
    }

    const sessionPath = this.sessionFilePath(currentSessionId);
    let rawJsonl: string;
    try {
      rawJsonl = await readFile(sessionPath, "utf-8");
    } catch {
      this.logger.warn(
        "session JSONL unreadable — discarding current session",
        {
          path: sessionPath,
        },
      );
      return null;
    }

    const messages: ConversationMessage[] = [];
    for (const line of rawJsonl.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        this.logger.warn(
          "session JSONL line unparseable — discarding current session",
          {
            path: sessionPath,
          },
        );
        return null;
      }

      if (!isConversationMessage(parsed)) {
        this.logger.warn(
          "session JSONL line invalid shape — discarding current session",
          {
            path: sessionPath,
          },
        );
        return null;
      }

      messages.push(parsed);
    }

    return { id: currentSessionId, messages };
  }

  async createNew(): Promise<Session> {
    const id = randomUUID();
    const sessionsDir = this.sessionsDirPath;

    await mkdir(sessionsDir, { recursive: true });

    const sessionPath = this.sessionFilePath(id);
    await writeFile(sessionPath, "");

    const stateTmpPath = `${this.stateFilePath}.tmp`;
    const stateContent: StateFile = { currentSessionId: id };
    await writeFile(stateTmpPath, JSON.stringify(stateContent));
    await rename(stateTmpPath, this.stateFilePath);

    return { id, messages: [] };
  }

  /**
   * Appends messages to the given session's JSONL file.
   * Fail-Open: I/O failures are logged and swallowed; this method MUST NOT throw.
   */
  async append(
    sessionId: string,
    messages: readonly ConversationMessage[],
  ): Promise<void> {
    if (messages.length === 0) return;

    const sessionPath = this.sessionFilePath(sessionId);
    const lines = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";

    try {
      await appendFile(sessionPath, lines, "utf-8");
    } catch (err) {
      this.logger.warn(
        "append to session JSONL failed — continuing (Fail-Open)",
        {
          path: sessionPath,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
