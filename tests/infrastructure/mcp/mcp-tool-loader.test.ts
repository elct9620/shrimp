import { describe, it, expect, vi } from "vitest";
import type {
  McpClient,
  McpClientFactory,
} from "../../../src/infrastructure/mcp/mcp-tool-loader";
import { McpToolLoader } from "../../../src/infrastructure/mcp/mcp-tool-loader";
import type { McpConfig } from "../../../src/infrastructure/config/mcp-config";
import { jsonSchema, tool } from "ai";
import { makeFakeLogger } from "../../mocks/fake-logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(
  toolDefs: Array<{ name: string; description: string }>,
): McpClient {
  return {
    tools: vi.fn().mockResolvedValue(
      Object.fromEntries(
        toolDefs.map(({ name, description }) => [
          name,
          tool({
            description,
            inputSchema: jsonSchema({ type: "object", properties: {} }),
            execute: vi.fn().mockResolvedValue({}),
          }),
        ]),
      ),
    ),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeConfig(
  servers: Record<string, { command: string; args?: string[] }>,
): McpConfig {
  return { mcpServers: servers };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("McpToolLoader", () => {
  describe("load()", () => {
    it("should return empty result when mcpServers is empty", async () => {
      const factory: McpClientFactory = vi.fn();
      const loader = new McpToolLoader(makeFakeLogger(), factory);
      const config = makeConfig({});

      const result = await loader.load(config);

      expect(result.tools).toEqual({});
      expect(result.descriptions).toEqual([]);
      expect(factory).not.toHaveBeenCalled();
    });

    it("should return both tools and descriptions when one server has two tools", async () => {
      const client = makeClient([
        { name: "readFile", description: "Read a file" },
        { name: "writeFile", description: "Write a file" },
      ]);
      const factory: McpClientFactory = vi.fn().mockResolvedValue(client);
      const loader = new McpToolLoader(makeFakeLogger(), factory);
      const config = makeConfig({
        fs: { command: "node", args: ["fs-server.js"] },
      });

      const result = await loader.load(config);

      expect(Object.keys(result.tools)).toEqual(
        expect.arrayContaining(["readFile", "writeFile"]),
      );
      expect(result.descriptions).toHaveLength(2);
      expect(result.descriptions).toEqual(
        expect.arrayContaining([
          { name: "readFile", description: "Read a file" },
          { name: "writeFile", description: "Write a file" },
        ]),
      );
    });

    it("should merge tools from two servers each with one tool", async () => {
      const clientA = makeClient([
        { name: "searchWeb", description: "Search the web" },
      ]);
      const clientB = makeClient([
        { name: "runCode", description: "Execute code" },
      ]);
      const factory: McpClientFactory = vi
        .fn()
        .mockResolvedValueOnce(clientA)
        .mockResolvedValueOnce(clientB);
      const loader = new McpToolLoader(makeFakeLogger(), factory);
      const config = makeConfig({
        search: { command: "node", args: ["search.js"] },
        runner: { command: "node", args: ["runner.js"] },
      });

      const result = await loader.load(config);

      expect(Object.keys(result.tools)).toEqual(
        expect.arrayContaining(["searchWeb", "runCode"]),
      );
      expect(result.descriptions).toHaveLength(2);
    });

    it("should exclude the failed server but still load others when one server fails to start", async () => {
      const goodClient = makeClient([
        { name: "goodTool", description: "A good tool" },
      ]);
      const factory: McpClientFactory = vi
        .fn()
        .mockRejectedValueOnce(new Error("connection refused"))
        .mockResolvedValueOnce(goodClient);
      const loader = new McpToolLoader(makeFakeLogger(), factory);
      const config = makeConfig({
        bad: { command: "bad-server" },
        good: { command: "good-server" },
      });

      const result = await loader.load(config);

      expect(result.tools).toHaveProperty("goodTool");
      expect(Object.keys(result.tools)).not.toContain("badTool");
      expect(result.descriptions).toHaveLength(1);
      expect(result.descriptions[0].name).toBe("goodTool");
    });

    it("should return empty result when all servers fail to start", async () => {
      const factory: McpClientFactory = vi
        .fn()
        .mockRejectedValue(new Error("all down"));
      const loader = new McpToolLoader(makeFakeLogger(), factory);
      const config = makeConfig({
        serverA: { command: "a" },
        serverB: { command: "b" },
      });

      const result = await loader.load(config);

      expect(result.tools).toEqual({});
      expect(result.descriptions).toEqual([]);
    });

    it("should skip a server when its tools() call fails and continue with others", async () => {
      const failingClient: McpClient = {
        tools: vi.fn().mockRejectedValue(new Error("tools listing failed")),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const goodClient = makeClient([
        { name: "goodTool", description: "works" },
      ]);
      const factory = vi
        .fn()
        .mockResolvedValueOnce(failingClient)
        .mockResolvedValueOnce(goodClient);
      const loader = new McpToolLoader(makeFakeLogger(), factory);
      const config = makeConfig({
        broken: { command: "x" },
        ok: { command: "y" },
      });

      const result = await loader.load(config);

      expect(result.tools).toHaveProperty("goodTool");
      expect(Object.keys(result.tools)).not.toContain("toolThatFails");
    });

    it("should call the factory with the server name and its definition", async () => {
      const client = makeClient([{ name: "tool1", description: "Tool one" }]);
      const factory: McpClientFactory = vi.fn().mockResolvedValue(client);
      const loader = new McpToolLoader(makeFakeLogger(), factory);
      const config = makeConfig({
        myServer: { command: "myCmd", args: ["--flag"] },
      });

      await loader.load(config);

      expect(factory).toHaveBeenCalledWith("myServer", {
        command: "myCmd",
        args: ["--flag"],
      });
    });
  });

  describe("close()", () => {
    it("should close every client that was successfully loaded", async () => {
      const clientA = makeClient([{ name: "toolA", description: "Tool A" }]);
      const clientB = makeClient([{ name: "toolB", description: "Tool B" }]);
      const factory: McpClientFactory = vi
        .fn()
        .mockResolvedValueOnce(clientA)
        .mockResolvedValueOnce(clientB);
      const loader = new McpToolLoader(makeFakeLogger(), factory);
      const config = makeConfig({
        serverA: { command: "a" },
        serverB: { command: "b" },
      });

      await loader.load(config);
      await loader.close();

      expect(clientA.close).toHaveBeenCalledOnce();
      expect(clientB.close).toHaveBeenCalledOnce();
    });

    it("should not throw when a client close throws (best-effort cleanup)", async () => {
      const client = makeClient([{ name: "tool1", description: "Tool" }]);
      (client.close as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("close failed"),
      );
      const factory: McpClientFactory = vi.fn().mockResolvedValue(client);
      const loader = new McpToolLoader(makeFakeLogger(), factory);
      const config = makeConfig({ server: { command: "cmd" } });

      await loader.load(config);

      await expect(loader.close()).resolves.toBeUndefined();
    });

    it("should resolve immediately if no clients were loaded", async () => {
      const factory: McpClientFactory = vi.fn();
      const loader = new McpToolLoader(makeFakeLogger(), factory);

      await expect(loader.close()).resolves.toBeUndefined();
    });
  });

  describe("logging", () => {
    it("should log info with serverName, toolCount and toolNames when a server connects", async () => {
      const client = makeClient([
        { name: "readFile", description: "Read a file" },
        { name: "writeFile", description: "Write a file" },
      ]);
      const factory: McpClientFactory = vi.fn().mockResolvedValue(client);
      const logger = makeFakeLogger();
      const loader = new McpToolLoader(logger, factory);
      const config = makeConfig({
        fs: { command: "node", args: ["fs-server.js"] },
      });

      await loader.load(config);

      expect(logger.info).toHaveBeenCalledWith(
        "mcp server connected",
        expect.objectContaining({
          serverName: "fs",
          toolCount: 2,
          toolNames: expect.arrayContaining(["readFile", "writeFile"]),
        }),
      );
    });

    it("should log warn with serverName, command and error when a server fails to start", async () => {
      const factory: McpClientFactory = vi
        .fn()
        .mockRejectedValue(new Error("connection refused"));
      const logger = makeFakeLogger();
      const loader = new McpToolLoader(logger, factory);
      const config = makeConfig({
        bad: { command: "bad-server", args: ["--x"] },
      });

      await loader.load(config);

      expect(logger.warn).toHaveBeenCalledWith(
        "mcp server failed to start",
        expect.objectContaining({
          serverName: "bad",
          command: "bad-server",
          error: "connection refused",
        }),
      );
    });

    it('should log warn "mcp server failed to list tools" with serverName and error', async () => {
      const failingClient: McpClient = {
        tools: vi.fn().mockRejectedValue(new Error("listTools timeout")),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const factory = vi.fn().mockResolvedValue(failingClient);
      const logger = makeFakeLogger();
      const loader = new McpToolLoader(logger, factory);
      const config = makeConfig({ broken: { command: "x" } });

      await loader.load(config);

      expect(logger.warn).toHaveBeenCalledWith(
        "mcp server failed to list tools",
        expect.objectContaining({
          serverName: "broken",
          error: "listTools timeout",
        }),
      );
    });

    it("should not log info for a server that failed to start", async () => {
      const factory: McpClientFactory = vi
        .fn()
        .mockRejectedValue(new Error("nope"));
      const logger = makeFakeLogger();
      const loader = new McpToolLoader(logger, factory);
      const config = makeConfig({ bad: { command: "x" } });

      await loader.load(config);

      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should log warn "mcp client failed to close" for each failing client during close()', async () => {
      const failingClient = makeClient([{ name: "t1", description: "a" }]);
      (failingClient.close as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("close timeout"),
      );
      const goodClient = makeClient([{ name: "t2", description: "b" }]);
      const factory = vi
        .fn()
        .mockResolvedValueOnce(failingClient)
        .mockResolvedValueOnce(goodClient);
      const logger = makeFakeLogger();
      const loader = new McpToolLoader(logger, factory);
      const config = makeConfig({ a: { command: "x" }, b: { command: "y" } });

      await loader.load(config);
      await loader.close();

      expect(logger.warn).toHaveBeenCalledWith(
        "mcp client failed to close",
        expect.objectContaining({ error: "close timeout" }),
      );
    });

    it("should log debug with clientCount when close is called", async () => {
      const client = makeClient([{ name: "toolA", description: "A" }]);
      const factory: McpClientFactory = vi.fn().mockResolvedValue(client);
      const logger = makeFakeLogger();
      const loader = new McpToolLoader(logger, factory);
      const config = makeConfig({ serverA: { command: "a" } });

      await loader.load(config);
      await loader.close();

      expect(logger.debug).toHaveBeenCalledWith(
        "mcp close",
        expect.objectContaining({ clientCount: 1 }),
      );
    });
  });
});
