import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileUserAgents } from "../../../src/infrastructure/prompt/file-user-agents";

describe("FileUserAgents", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "shrimp-user-agents-"));
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  it("returns trimmed file contents when AGENTS.md exists", async () => {
    await writeFile(join(stateDir, "AGENTS.md"), "\n  Hello operator  \n");

    const reader = new FileUserAgents({ stateDir });

    await expect(reader.read()).resolves.toBe("Hello operator");
  });

  it("returns null when AGENTS.md is missing", async () => {
    const reader = new FileUserAgents({ stateDir });

    await expect(reader.read()).resolves.toBeNull();
  });

  it("returns null when the file cannot be read (e.g. directory in place of file)", async () => {
    const reader = new FileUserAgents({ stateDir: "/nonexistent-path-xyz" });

    await expect(reader.read()).resolves.toBeNull();
  });
});
