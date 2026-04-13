import { readFileSync } from "node:fs";

export type McpServerDefinition = {
  command: string;
  args?: string[];
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

    const defRecord = def as Record<string, unknown>;

    if (typeof defRecord["command"] !== "string") {
      throw new McpConfigError(
        `Invalid .mcp.json: server "${name}" must have a string "command" field`,
      );
    }

    const serverDef: McpServerDefinition = { command: defRecord["command"] };

    if ("args" in defRecord) {
      const args = defRecord["args"];
      if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
        throw new McpConfigError(
          `Invalid .mcp.json: server "${name}" field "args" must be a string array`,
        );
      }
      serverDef.args = args as string[];
    }

    result[name] = serverDef;
  }

  return { mcpServers: result };
}

export function loadMcpConfig(path: string): McpConfig {
  const raw = readFileSync(path, "utf-8");
  return parseMcpConfig(raw);
}
