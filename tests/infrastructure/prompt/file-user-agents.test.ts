import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileUserAgents } from "../../../src/infrastructure/prompt/file-user-agents";

describe("FileUserAgents", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "shrimp-user-agents-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("returns trimmed file contents when AGENTS.md exists", async () => {
    await writeFile(join(home, "AGENTS.md"), "\n  Hello operator  \n");

    const reader = new FileUserAgents({ home });

    await expect(reader.read()).resolves.toBe("Hello operator");
  });

  it("returns null when AGENTS.md is missing", async () => {
    const reader = new FileUserAgents({ home });

    await expect(reader.read()).resolves.toBeNull();
  });

  it("returns null when the file cannot be read (e.g. directory in place of file)", async () => {
    const reader = new FileUserAgents({ home: "/nonexistent-path-xyz" });

    await expect(reader.read()).resolves.toBeNull();
  });
});
