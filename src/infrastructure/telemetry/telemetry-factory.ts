import type { Tracer } from "@opentelemetry/api";
import type { EnvConfig } from "../config/env-config";
import type { LoggerPort } from "../../use-cases/ports/logger";
import type { TelemetryPort } from "../../use-cases/ports/telemetry";
import { NoopTelemetry } from "./noop-telemetry";
import { OtelTelemetry } from "./otel-telemetry";

export type TelemetryBundle = {
  telemetry: TelemetryPort;
  tracer: Tracer;
};

export function createTelemetry(
  env: EnvConfig,
  logger: LoggerPort,
): TelemetryBundle {
  if (!env.telemetryEnabled) {
    const noop = new NoopTelemetry();
    return { telemetry: noop, tracer: noop.tracer };
  }

  // env-config validation guarantees serviceName is present when telemetryEnabled is true.
  // OTEL_EXPORTER_OTLP_* env vars are pass-through to the OTel SDK (SPEC §Telemetry);
  // the adapter does not forward them so the SDK reads process.env natively and
  // applies spec-compliant signal-path appending.
  const otel = new OtelTelemetry({
    serviceName: env.otelServiceName!,
    logger,
  });
  return { telemetry: otel, tracer: otel.tracer };
}
