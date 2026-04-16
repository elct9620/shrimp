import type { Tracer } from "@opentelemetry/api";

export interface TelemetryPort {
  /**
   * The OpenTelemetry tracer. Forwarded to AI SDK's experimental_telemetry.tracer
   * and used by ProcessingCycle to start the root span. Implementations may
   * return a no-op tracer when telemetry is disabled.
   */
  readonly tracer: Tracer;

  /**
   * When false, prompt text is omitted from span attributes.
   * Maps to TELEMETRY_RECORD_INPUTS.
   */
  readonly recordInputs: boolean;

  /**
   * When false, model-generated text is omitted from span attributes.
   * Maps to TELEMETRY_RECORD_OUTPUTS.
   */
  readonly recordOutputs: boolean;

  /**
   * Flush buffered spans and tear down the exporter pipeline.
   * Called by server.ts on SIGINT/SIGTERM.
   * Implementations must never throw — failures should be swallowed (fail-open).
   */
  shutdown(): Promise<void>;
}
