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

  // env-config validation guarantees serviceName is present when telemetryEnabled is true.
  // OTEL_EXPORTER_OTLP_* env vars are pass-through to the OTel SDK (SPEC §Telemetry);
  // the adapter does not forward them so the SDK reads process.env natively and
  // applies spec-compliant signal-path appending.
  return new OtelTelemetry({
    serviceName: env.otelServiceName!,
    recordInputs: env.telemetryRecordInputs,
    recordOutputs: env.telemetryRecordOutputs,
    logger,
  });
}
