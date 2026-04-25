import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  diag,
  DiagLogLevel,
  SpanStatusCode,
  trace,
  type DiagLogger,
  type Tracer,
} from "@opentelemetry/api";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type {
  SpanAttributes,
  TelemetryPort,
} from "../../use-cases/ports/telemetry";
import type { LoggerPort } from "../../use-cases/ports/logger";
import { GenAiBridgeSpanProcessor } from "./gen-ai-bridge-span-processor";

export type OtelTelemetryOptions = {
  serviceName: string;
  logger: LoggerPort;
  /**
   * Override the tracer used for `runInSpan`. Intended for tests; production
   * callers leave this unset so the tracer is resolved from the global
   * TracerProvider that `NodeSDK.start()` just registered.
   */
  tracer?: Tracer;
  /**
   * Override the NodeSDK instance. Intended for tests; production callers
   * leave this unset so a real NodeSDK is constructed with the OTLP exporter.
   */
  sdk?: Pick<NodeSDK, "start" | "shutdown">;
};

export class OtelTelemetry implements TelemetryPort {
  readonly tracer: Tracer;
  private readonly sdk: Pick<NodeSDK, "start" | "shutdown">;
  private readonly logger: LoggerPort;

  constructor(options: OtelTelemetryOptions) {
    this.logger = options.logger.child({ module: "OtelTelemetry" });

    // Default deployment.environment into OTEL_RESOURCE_ATTRIBUTES so users
    // don't have to set it manually. Must mutate process.env before NodeSDK
    // reads it via its env resource detector.
    applyDefaultDeploymentEnvironment(process.env);

    // OTEL_EXPORTER_OTLP_* env vars are pass-through (SPEC §Telemetry):
    // letting the SDK read process.env directly preserves spec-mandated
    // signal-path appending (e.g. /v1/traces for OTEL_EXPORTER_OTLP_ENDPOINT).
    const exporter = new OTLPTraceExporter();

    this.sdk =
      options.sdk ??
      new NodeSDK({
        resource: resourceFromAttributes({
          [ATTR_SERVICE_NAME]: options.serviceName,
        }),
        spanProcessors: [
          new GenAiBridgeSpanProcessor(),
          new BatchSpanProcessor(exporter),
        ],
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

    this.tracer = options.tracer ?? trace.getTracer("shrimp");

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

  async runInSpan<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: SpanAttributes,
  ): Promise<T> {
    return this.tracer.startActiveSpan(name, async (span) => {
      if (attributes) {
        span.setAttributes(attributes);
      }
      try {
        return await fn();
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  async shutdown(): Promise<void> {
    try {
      await this.sdk.shutdown();
    } catch (err) {
      // Fail-open: never propagate exporter/shutdown errors.
      this.logger.warn("telemetry shutdown failed", {
        err,
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

const DEPLOYMENT_ENVIRONMENT_KEY = "deployment.environment";

export function applyDefaultDeploymentEnvironment(
  env: NodeJS.ProcessEnv,
): void {
  const pairs = parseResourceAttributes(env["OTEL_RESOURCE_ATTRIBUTES"]);
  if (pairs.some(([k]) => k === DEPLOYMENT_ENVIRONMENT_KEY)) return;

  const deploymentEnv =
    nonEmpty(env["SHRIMP_ENV"]) ?? nonEmpty(env["NODE_ENV"]) ?? "development";
  pairs.push([DEPLOYMENT_ENVIRONMENT_KEY, deploymentEnv]);
  env["OTEL_RESOURCE_ATTRIBUTES"] = serializeResourceAttributes(pairs);
}

function parseResourceAttributes(raw: string | undefined): [string, string][] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part): [string, string] | undefined => {
      const eq = part.indexOf("=");
      if (eq <= 0) return undefined;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (!key) return undefined;
      return [key, value];
    })
    .filter((p): p is [string, string] => p !== undefined);
}

function serializeResourceAttributes(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => `${k}=${v}`).join(",");
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
