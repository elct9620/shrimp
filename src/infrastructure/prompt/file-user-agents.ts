import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UserAgentsPort } from "../../use-cases/ports/user-agents";

export class FileUserAgents implements UserAgentsPort {
  private readonly path: string;

  constructor({ stateDir }: { stateDir: string }) {
    this.path = join(stateDir, "AGENTS.md");
  }

  async read(): Promise<string | null> {
    try {
      const content = await readFile(this.path, "utf8");
      return content.trim();
    } catch {
      return null;
    }
  }
}
