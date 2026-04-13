export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

export type EnvConfig = {
  openAiBaseUrl: string;
  openAiApiKey: string;
  aiModel: string;
  aiMaxSteps: number;
  aiReasoningEffort?: string;
  todoistApiToken: string;
  todoistProjectId: string;
  port: number;
  logLevel: LogLevel;
};

export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvConfigError";
  }
}

const VALID_LOG_LEVELS: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
];

const REQUIRED_KEYS = [
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "AI_MODEL",
  "TODOIST_API_TOKEN",
  "TODOIST_PROJECT_ID",
] as const;

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined) return "info";
  if ((VALID_LOG_LEVELS as readonly string[]).includes(value))
    return value as LogLevel;
  throw new EnvConfigError(
    `Invalid LOG_LEVEL: "${value}". Valid values are: ${VALID_LOG_LEVELS.join(", ")}`,
  );
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new EnvConfigError(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  return {
    openAiBaseUrl: env["OPENAI_BASE_URL"] as string,
    openAiApiKey: env["OPENAI_API_KEY"] as string,
    aiModel: env["AI_MODEL"] as string,
    aiMaxSteps: parsePositiveInt(env["AI_MAX_STEPS"], 50),
    aiReasoningEffort: env["AI_REASONING_EFFORT"] || undefined,
    todoistApiToken: env["TODOIST_API_TOKEN"] as string,
    todoistProjectId: env["TODOIST_PROJECT_ID"] as string,
    port: parsePositiveInt(env["PORT"], 3000),
    logLevel: parseLogLevel(env["LOG_LEVEL"]),
  };
}
