import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoggerPort } from "../../use-cases/ports/logger";
import type { UserAgentsPort } from "../../use-cases/ports/user-agents";

export class FileUserAgents implements UserAgentsPort {
  private readonly path: string;
  private readonly logger?: LoggerPort;

  constructor({ home, logger }: { home: string; logger?: LoggerPort }) {
    this.path = join(home, "AGENTS.md");
    this.logger = logger;
  }

  async read(): Promise<string | null> {
    try {
      const content = await readFile(this.path, "utf8");
      const trimmed = content.trim();
      this.logger?.debug("user agents file loaded", {
        path: this.path,
        bytes: trimmed.length,
      });
      return trimmed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.logger?.debug("user agents file absent", { path: this.path });
        return null;
      }
      this.logger?.warn("user agents file unreadable", {
        path: this.path,
        code,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
