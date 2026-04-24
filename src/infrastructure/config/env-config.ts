import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

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
  telemetryEnabled: boolean;
  telemetryRecordInputs: boolean;
  telemetryRecordOutputs: boolean;
  otelServiceName?: string;
  otelExporterOtlpEndpoint?: string;
  otelExporterOtlpHeaders?: string;
  channelsEnabled: boolean;
  telegramBotToken?: string;
  telegramWebhookSecret?: string;
  // Always resolved (defaults to ~/.shrimp). Used for Session persistence when
  // channelsEnabled is true, and for the optional User Agents Appendix
  // (AGENTS.md) on every Job regardless of channelsEnabled.
  shrimpHome: string;
  // Absolute path to the Built-in Skills root packaged with the application
  // bundle. Resolved from process.cwd() because the Dockerfile sets WORKDIR
  // /app and ships skills at /app/skills/, while dev runs from the repo root
  // where skills/ lives at the same level. EnvConfig does NOT check existence
  // — FileSkillRepository fail-fasts if the directory is absent at startup.
  skillsBuiltInRoot: string;
  // Absolute path to the Custom Skills root at SHRIMP_HOME/skills/. Always a
  // string (never null); FileSkillRepository treats a missing directory as an
  // empty Custom catalog per SPEC §Skills Layout.
  skillsCustomRoot: string;
  heartbeatToken?: string;
  // Only present when channelsEnabled is true.
  autoCompactTokenThreshold?: number;
  autoCompactModel?: string;
  // Defaults to 2048 when unset/empty (channels-enabled only).
  autoCompactMaxOutputTokens?: number;
};

const DEFAULT_AUTO_COMPACT_MAX_OUTPUT_TOKENS = 2048;
// Conservative default sized for modern long-context models (Claude Sonnet/Opus
// 200k, GPT-4o 128k). Operators on shorter-context models should lower this;
// operators on very large contexts can raise it.
const DEFAULT_AUTO_COMPACT_TOKEN_THRESHOLD = 100000;

export class EnvConfigError extends Error {
  /** The environment variable keys that caused the error (missing or invalid). */
  readonly fields: readonly string[];

  constructor(message: string, fields: readonly string[] = []) {
    super(message);
    this.name = "EnvConfigError";
    this.fields = fields;
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

const REQUIRED_TELEMETRY_KEYS = [
  "OTEL_SERVICE_NAME",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
] as const;

const REQUIRED_CHANNEL_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
] as const;

const DEFAULT_SHRIMP_HOME = join(homedir(), ".shrimp");

function resolveShrimpHome(env: NodeJS.ProcessEnv): string {
  const primary = env["SHRIMP_HOME"];
  if (primary) return primary;
  const legacy = env["SHRIMP_STATE_DIR"];
  if (legacy) {
    process.stderr.write(
      "warning: SHRIMP_STATE_DIR is deprecated; use SHRIMP_HOME instead. The legacy name is still honored but will be removed in a future release.\n",
    );
    return legacy;
  }
  return DEFAULT_SHRIMP_HOME;
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined) return "info";
  if ((VALID_LOG_LEVELS as readonly string[]).includes(value))
    return value as LogLevel;
  throw new EnvConfigError(
    `Invalid LOG_LEVEL: "${value}". Valid values are: ${VALID_LOG_LEVELS.join(", ")}`,
    ["LOG_LEVEL"],
  );
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseOptionalPositiveInt(
  value: string | undefined,
  key: string,
): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EnvConfigError(
      `Invalid ${key}: "${value}". Must be a positive integer (>= 1).`,
      [key],
    );
  }
  return parsed;
}

function parseTelemetryEnabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function parseTelemetryRecordFlag(value: string | undefined): boolean {
  return value !== "false" && value !== "0";
}

function parseChannelsEnabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new EnvConfigError(
      `Missing required environment variables: ${missing.join(", ")}`,
      missing,
    );
  }

  const telemetryEnabled = parseTelemetryEnabled(env["TELEMETRY_ENABLED"]);

  if (telemetryEnabled) {
    const missingTelemetry = REQUIRED_TELEMETRY_KEYS.filter((key) => !env[key]);
    if (missingTelemetry.length > 0) {
      throw new EnvConfigError(
        `Missing required environment variables: ${missingTelemetry.join(", ")}`,
        missingTelemetry,
      );
    }
  }

  const channelsEnabled = parseChannelsEnabled(env["CHANNELS_ENABLED"]);

  let telegramBotToken: string | undefined;
  let telegramWebhookSecret: string | undefined;
  let autoCompactTokenThreshold: number | undefined;
  let autoCompactModel: string | undefined;
  let autoCompactMaxOutputTokens: number | undefined;
  const shrimpHome = resolveShrimpHome(env);

  if (channelsEnabled) {
    const missingChannels = REQUIRED_CHANNEL_KEYS.filter((key) => !env[key]);
    if (missingChannels.length > 0) {
      throw new EnvConfigError(
        `Missing required environment variables: ${missingChannels.join(", ")}`,
        missingChannels,
      );
    }

    telegramBotToken = env["TELEGRAM_BOT_TOKEN"] as string;
    telegramWebhookSecret = env["TELEGRAM_WEBHOOK_SECRET"] as string;

    autoCompactTokenThreshold =
      parseOptionalPositiveInt(
        env["AUTO_COMPACT_TOKEN_THRESHOLD"],
        "AUTO_COMPACT_TOKEN_THRESHOLD",
      ) ?? DEFAULT_AUTO_COMPACT_TOKEN_THRESHOLD;
    autoCompactModel = env["AUTO_COMPACT_MODEL"] || undefined;
    autoCompactMaxOutputTokens =
      parseOptionalPositiveInt(
        env["AUTO_COMPACT_MAX_OUTPUT_TOKENS"],
        "AUTO_COMPACT_MAX_OUTPUT_TOKENS",
      ) ?? DEFAULT_AUTO_COMPACT_MAX_OUTPUT_TOKENS;

    try {
      mkdirSync(shrimpHome, { recursive: true });
    } catch (err) {
      throw new EnvConfigError(
        `Failed to create SHRIMP_HOME "${shrimpHome}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
    telemetryEnabled,
    telemetryRecordInputs: parseTelemetryRecordFlag(
      env["TELEMETRY_RECORD_INPUTS"],
    ),
    telemetryRecordOutputs: parseTelemetryRecordFlag(
      env["TELEMETRY_RECORD_OUTPUTS"],
    ),
    otelServiceName: env["OTEL_SERVICE_NAME"] || undefined,
    otelExporterOtlpEndpoint: env["OTEL_EXPORTER_OTLP_ENDPOINT"] || undefined,
    otelExporterOtlpHeaders: env["OTEL_EXPORTER_OTLP_HEADERS"] || undefined,
    channelsEnabled,
    telegramBotToken,
    telegramWebhookSecret,
    shrimpHome,
    skillsBuiltInRoot: resolve(process.cwd(), "skills"),
    skillsCustomRoot: join(shrimpHome, "skills"),
    heartbeatToken: env["SHRIMP_HEARTBEAT_TOKEN"] || undefined,
    autoCompactTokenThreshold,
    autoCompactModel,
    autoCompactMaxOutputTokens,
  };
}
