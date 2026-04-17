import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  diag,
  DiagLogLevel,
  trace,
  type DiagLogger,
  type Tracer,
} from "@opentelemetry/api";
import type { TelemetryPort } from "../../use-cases/ports/telemetry";
import type { LoggerPort } from "../../use-cases/ports/logger";

export type OtelTelemetryOptions = {
  serviceName: string;
  recordInputs: boolean;
  recordOutputs: boolean;
  logger: LoggerPort;
};

export class OtelTelemetry implements TelemetryPort {
  readonly tracer: Tracer;
  readonly recordInputs: boolean;
  readonly recordOutputs: boolean;
  private readonly sdk: NodeSDK;
  private readonly logger: LoggerPort;

  constructor(options: OtelTelemetryOptions) {
    this.recordInputs = options.recordInputs;
    this.recordOutputs = options.recordOutputs;
    this.logger = options.logger.child({ module: "OtelTelemetry" });

    // OTEL_EXPORTER_OTLP_* env vars are pass-through (SPEC §Telemetry):
    // letting the SDK read process.env directly preserves spec-mandated
    // signal-path appending (e.g. /v1/traces for OTEL_EXPORTER_OTLP_ENDPOINT).
    const exporter = new OTLPTraceExporter();

    this.sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: options.serviceName,
      }),
      traceExporter: exporter,
    });

    this.sdk.start(); // registers global TracerProvider

    // Register diag logger AFTER sdk.start(): NodeSDK reinstalls its own diag
    // logger during construction, so an earlier setLogger call is silently
    // overridden. Setting it last keeps OTel SDK internals (exporter errors,
    // retries, dropped spans) flowing through pino. Default WARN keeps prod
    // quiet; OTEL_LOG_LEVEL=debug for ad-hoc investigation.
    diag.setLogger(buildDiagLogger(this.logger), {
      logLevel: parseDiagLogLevel(process.env["OTEL_LOG_LEVEL"]),
      suppressOverrideMessage: true,
    });

    this.tracer = trace.getTracer("shrimp");

    // Record what the exporter will actually use, so misconfigured endpoints
    // / headers are visible without needing diag DEBUG.
    this.logger.info("telemetry exporter ready", {
      endpoint: signalEnv("ENDPOINT"),
      protocol:
        signalEnv("PROTOCOL") ??
        "http/json (Shrimp default — using @opentelemetry/exporter-trace-otlp-http)",
      headerKeys: parseHeaderKeys(signalEnv("HEADERS")),
    });
  }

  async shutdown(): Promise<void> {
    try {
      await this.sdk.shutdown();
    } catch (err) {
      // Fail-open: never propagate exporter/shutdown errors.
      this.logger.warn("telemetry shutdown failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function buildDiagLogger(logger: LoggerPort): DiagLogger {
  return {
    error: (message, ...args) =>
      logger.error(`[otel] ${message}`, args.length > 0 ? { args } : undefined),
    warn: (message, ...args) =>
      logger.warn(`[otel] ${message}`, args.length > 0 ? { args } : undefined),
    info: (message, ...args) =>
      logger.info(`[otel] ${message}`, args.length > 0 ? { args } : undefined),
    debug: (message, ...args) =>
      logger.debug(`[otel] ${message}`, args.length > 0 ? { args } : undefined),
    verbose: (message, ...args) =>
      logger.debug(`[otel] ${message}`, args.length > 0 ? { args } : undefined),
  };
}

// OTel spec precedence: signal-specific OTEL_EXPORTER_OTLP_TRACES_<SUFFIX>
// overrides the non-signal-specific OTEL_EXPORTER_OTLP_<SUFFIX>. Empty
// strings are treated as unset (matches @opentelemetry/core's
// getStringFromEnv) so an explicit `KEY=` in .env doesn't shadow the
// fallback.
function signalEnv(suffix: string): string | undefined {
  return (
    nonEmpty(process.env[`OTEL_EXPORTER_OTLP_TRACES_${suffix}`]) ??
    nonEmpty(process.env[`OTEL_EXPORTER_OTLP_${suffix}`])
  );
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function parseHeaderKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq <= 0) return undefined;
      return part.slice(0, eq).trim();
    })
    .filter((k): k is string => !!k);
}

function parseDiagLogLevel(raw: string | undefined): DiagLogLevel {
  switch (raw?.toUpperCase()) {
    case "NONE":
      return DiagLogLevel.NONE;
    case "ERROR":
      return DiagLogLevel.ERROR;
    case "INFO":
      return DiagLogLevel.INFO;
    case "DEBUG":
      return DiagLogLevel.DEBUG;
    case "VERBOSE":
      return DiagLogLevel.VERBOSE;
    case "ALL":
      return DiagLogLevel.ALL;
    case "WARN":
    default:
      return DiagLogLevel.WARN;
  }
}
