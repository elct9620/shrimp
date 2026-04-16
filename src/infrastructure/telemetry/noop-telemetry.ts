import { trace, type Tracer } from "@opentelemetry/api";
import type { TelemetryPort } from "../../use-cases/ports/telemetry";

export class NoopTelemetry implements TelemetryPort {
  readonly tracer: Tracer = trace.getTracer("shrimp");
  readonly recordInputs = true;
  readonly recordOutputs = true;

  async shutdown(): Promise<void> {
    // No-op: there is no exporter to flush.
  }
}
