import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { trace, type Tracer } from "@opentelemetry/api";
import type { TelemetryPort } from "../../use-cases/ports/telemetry";
import type { LoggerPort } from "../../use-cases/ports/logger";

export type OtelTelemetryOptions = {
  serviceName: string;
  endpoint: string;
  /** Raw OTEL_EXPORTER_OTLP_HEADERS string; parsed and passed through to the exporter. */
  headers?: string;
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

    const exporter = new OTLPTraceExporter({
      url: options.endpoint,
      headers: parseHeaders(options.headers),
    });

    this.sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: options.serviceName,
      }),
      traceExporter: exporter,
    });

    this.sdk.start(); // registers global TracerProvider
    this.tracer = trace.getTracer("shrimp");
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

function parseHeaders(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (!raw) return undefined;
  // OTLP convention: comma-separated "key=value" pairs.
  const out: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
