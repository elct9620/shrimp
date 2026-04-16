import type { EnvConfig } from "../config/env-config";
import type { LoggerPort } from "../../use-cases/ports/logger";
import type { TelemetryPort } from "../../use-cases/ports/telemetry";
import { NoopTelemetry } from "./noop-telemetry";
import { OtelTelemetry } from "./otel-telemetry";

export function createTelemetry(
  env: EnvConfig,
  logger: LoggerPort,
): TelemetryPort {
  if (!env.telemetryEnabled) {
    return new NoopTelemetry();
  }

  // env-config validation guarantees these are present when telemetryEnabled is true.
  return new OtelTelemetry({
    serviceName: env.otelServiceName!,
    endpoint: env.otelExporterOtlpEndpoint!,
    headers: env.otelExporterOtlpHeaders,
    recordInputs: env.telemetryRecordInputs,
    recordOutputs: env.telemetryRecordOutputs,
    logger,
  });
}
