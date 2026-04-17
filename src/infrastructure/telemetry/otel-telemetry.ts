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
      endpoint:
        process.env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] ??
        process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
      protocol:
        process.env["OTEL_EXPORTER_OTLP_TRACES_PROTOCOL"] ??
        process.env["OTEL_EXPORTER_OTLP_PROTOCOL"] ??
        "http/json (Shrimp default — using @opentelemetry/exporter-trace-otlp-http)",
      headerKeys: parseHeaderKeys(
        process.env["OTEL_EXPORTER_OTLP_TRACES_HEADERS"] ??
          process.env["OTEL_EXPORTER_OTLP_HEADERS"],
      ),
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

function parseHeaderKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.split("=")[0]?.trim())
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
