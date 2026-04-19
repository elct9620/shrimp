import { readFileSync } from "node:fs";

export type McpServerDefinition = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

export type McpConfig = {
  mcpServers: Record<string, McpServerDefinition>;
};

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

function parseHeaders(
  name: string,
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new McpConfigError(
      `Invalid .mcp.json: server "${name}" field "headers" must be an object of strings`,
    );
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "string") {
      throw new McpConfigError(
        `Invalid .mcp.json: server "${name}" header "${k}" must be a string`,
      );
    }
    out[k] = v;
  }
  return out;
}

function parseServerDefinition(
  name: string,
  defRecord: Record<string, unknown>,
): McpServerDefinition {
  const rawType = defRecord["type"];
  const type = typeof rawType === "string" ? rawType : "http";

  if (type !== "http") {
    throw new McpConfigError(
      `Invalid .mcp.json: server "${name}" has unsupported type "${type}" (only "http" is supported)`,
    );
  }

  if (typeof defRecord["url"] !== "string") {
    throw new McpConfigError(
      `Invalid .mcp.json: server "${name}" must have a string "url" field`,
    );
  }

  const def: McpServerDefinition = {
    type: "http",
    url: defRecord["url"],
  };
  const headers = parseHeaders(name, defRecord["headers"]);
  if (headers) def.headers = headers;
  return def;
}

export function parseMcpConfig(raw: string): McpConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new McpConfigError("Invalid JSON: input could not be parsed");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new McpConfigError(
      "Invalid .mcp.json: root value must be a JSON object",
    );
  }

  const root = parsed as Record<string, unknown>;

  if (!("mcpServers" in root)) {
    throw new McpConfigError(
      'Invalid .mcp.json: missing required key "mcpServers"',
    );
  }

  const mcpServers = root["mcpServers"];

  if (
    mcpServers === null ||
    typeof mcpServers !== "object" ||
    Array.isArray(mcpServers)
  ) {
    throw new McpConfigError(
      'Invalid .mcp.json: "mcpServers" must be a JSON object',
    );
  }

  const serversRecord = mcpServers as Record<string, unknown>;
  const result: Record<string, McpServerDefinition> = {};

  for (const [name, def] of Object.entries(serversRecord)) {
    if (def === null || typeof def !== "object" || Array.isArray(def)) {
      throw new McpConfigError(
        `Invalid .mcp.json: server definition for "${name}" must be a JSON object`,
      );
    }
    result[name] = parseServerDefinition(name, def as Record<string, unknown>);
  }

  return { mcpServers: result };
}

export function loadMcpConfig(path: string): McpConfig {
  const raw = readFileSync(path, "utf-8");
  return parseMcpConfig(raw);
}
