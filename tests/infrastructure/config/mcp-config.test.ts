import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import {
  McpConfigError,
  parseMcpConfig,
  loadMcpConfig,
} from "../../../src/infrastructure/config/mcp-config";

const TMP_FILE = ".tmp.mcp.json";

afterEach(() => {
  if (existsSync(TMP_FILE)) {
    unlinkSync(TMP_FILE);
  }
});

describe("parseMcpConfig", () => {
  describe("valid configs", () => {
    it("should return correctly shaped object for a single Streamable HTTP server", () => {
      const raw = JSON.stringify({
        mcpServers: {
          myServer: { type: "http", url: "https://example.com/mcp" },
        },
      });

      const config = parseMcpConfig(raw);

      expect(config).toEqual({
        mcpServers: {
          myServer: { type: "http", url: "https://example.com/mcp" },
        },
      });
    });

    it("should preserve all servers when multiple are defined", () => {
      const raw = JSON.stringify({
        mcpServers: {
          serverA: { type: "http", url: "https://a.example.com/mcp" },
          serverB: { type: "http", url: "https://b.example.com/mcp" },
        },
      });

      const config = parseMcpConfig(raw);

      expect(config.mcpServers).toHaveProperty("serverA");
      expect(config.mcpServers).toHaveProperty("serverB");
      expect(config.mcpServers["serverA"]).toEqual({
        type: "http",
        url: "https://a.example.com/mcp",
      });
      expect(config.mcpServers["serverB"]).toEqual({
        type: "http",
        url: "https://b.example.com/mcp",
      });
    });

    it("should return empty mcpServers when mcpServers is an empty object", () => {
      const raw = JSON.stringify({ mcpServers: {} });

      const config = parseMcpConfig(raw);

      expect(config).toEqual({ mcpServers: {} });
    });

    it("should preserve headers on a server definition", () => {
      const raw = JSON.stringify({
        mcpServers: {
          withAuth: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer token" },
          },
        },
      });

      const config = parseMcpConfig(raw);

      expect(config.mcpServers["withAuth"].headers).toEqual({
        Authorization: "Bearer token",
      });
    });

    it("should default type to http when omitted but url is present", () => {
      const raw = JSON.stringify({
        mcpServers: {
          implicit: { url: "https://example.com/mcp" },
        },
      });

      const config = parseMcpConfig(raw);

      expect(config.mcpServers["implicit"]).toEqual({
        type: "http",
        url: "https://example.com/mcp",
      });
    });
  });

  describe("fail-fast on invalid JSON", () => {
    it("should throw McpConfigError when input is not valid JSON", () => {
      expect(() => parseMcpConfig("not json")).toThrow(McpConfigError);
    });

    it("should throw McpConfigError on truncated JSON", () => {
      expect(() => parseMcpConfig('{"mcpServers":')).toThrow(McpConfigError);
    });
  });

  describe("fail-fast on wrong root type", () => {
    it("should throw McpConfigError when parsed value is an array", () => {
      expect(() => parseMcpConfig("[]")).toThrow(McpConfigError);
    });

    it("should throw McpConfigError when parsed value is a number", () => {
      expect(() => parseMcpConfig("42")).toThrow(McpConfigError);
    });

    it("should throw McpConfigError when parsed value is null", () => {
      expect(() => parseMcpConfig("null")).toThrow(McpConfigError);
    });
  });

  describe("fail-fast on missing or wrong mcpServers key", () => {
    it("should throw McpConfigError when the mcpServers key is missing", () => {
      expect(() => parseMcpConfig("{}")).toThrow(McpConfigError);
    });

    it("should throw McpConfigError when mcpServers is a string instead of an object", () => {
      expect(() =>
        parseMcpConfig(JSON.stringify({ mcpServers: "bad" })),
      ).toThrow(McpConfigError);
    });

    it("should throw McpConfigError when mcpServers is null", () => {
      expect(() =>
        parseMcpConfig(JSON.stringify({ mcpServers: null })),
      ).toThrow(McpConfigError);
    });

    it("should throw McpConfigError when mcpServers is an array", () => {
      expect(() => parseMcpConfig(JSON.stringify({ mcpServers: [] }))).toThrow(
        McpConfigError,
      );
    });
  });

  describe("fail-fast on invalid server definitions", () => {
    it("should throw McpConfigError when a server definition is a string", () => {
      expect(() =>
        parseMcpConfig(JSON.stringify({ mcpServers: { srv: "bad" } })),
      ).toThrow(McpConfigError);
    });

    it("should throw McpConfigError when an http server is missing url", () => {
      expect(() =>
        parseMcpConfig(
          JSON.stringify({ mcpServers: { srv: { type: "http" } } }),
        ),
      ).toThrow(McpConfigError);
    });

    it("should throw McpConfigError when url is a number instead of a string", () => {
      expect(() =>
        parseMcpConfig(
          JSON.stringify({ mcpServers: { srv: { type: "http", url: 123 } } }),
        ),
      ).toThrow(McpConfigError);
    });

    it("should throw McpConfigError when type is stdio (not supported)", () => {
      expect(() =>
        parseMcpConfig(
          JSON.stringify({
            mcpServers: { srv: { type: "stdio", command: "node" } },
          }),
        ),
      ).toThrow(/only "http" is supported/);
    });

    it("should throw McpConfigError for legacy command-based server (stdio not supported)", () => {
      expect(() =>
        parseMcpConfig(
          JSON.stringify({
            mcpServers: { srv: { command: "node", args: ["server.js"] } },
          }),
        ),
      ).toThrow(McpConfigError);
    });

    it("should throw McpConfigError when type is a number instead of a string", () => {
      expect(() =>
        parseMcpConfig(
          JSON.stringify({
            mcpServers: { srv: { type: 123, url: "https://example.com" } },
          }),
        ),
      ).toThrow(/field "type" must be a string/);
    });

    it("should throw McpConfigError when type is sse (not supported)", () => {
      expect(() =>
        parseMcpConfig(
          JSON.stringify({
            mcpServers: { srv: { type: "sse", url: "https://example.com" } },
          }),
        ),
      ).toThrow(/only "http" is supported/);
    });

    it("should throw McpConfigError when headers contains a non-string value", () => {
      expect(() =>
        parseMcpConfig(
          JSON.stringify({
            mcpServers: {
              srv: {
                type: "http",
                url: "https://example.com",
                headers: { Authorization: 42 },
              },
            },
          }),
        ),
      ).toThrow(McpConfigError);
    });
  });

  describe("McpConfigError", () => {
    it('should set name to "McpConfigError"', () => {
      let error: McpConfigError | undefined;
      try {
        parseMcpConfig("null");
      } catch (e) {
        if (e instanceof McpConfigError) error = e;
      }
      expect(error).toBeDefined();
      expect(error!.name).toBe("McpConfigError");
    });

    it("should include a descriptive message on invalid JSON", () => {
      let error: McpConfigError | undefined;
      try {
        parseMcpConfig("not json");
      } catch (e) {
        if (e instanceof McpConfigError) error = e;
      }
      expect(error).toBeDefined();
      expect(error!.message.length).toBeGreaterThan(0);
    });
  });
});

describe("loadMcpConfig", () => {
  it("should read the file and return the parsed config", () => {
    const content = JSON.stringify({
      mcpServers: {
        fileServer: { type: "http", url: "https://example.com/mcp" },
      },
    });
    writeFileSync(TMP_FILE, content, "utf-8");

    const config = loadMcpConfig(TMP_FILE);

    expect(config).toEqual({
      mcpServers: {
        fileServer: { type: "http", url: "https://example.com/mcp" },
      },
    });
  });
});
