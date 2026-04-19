import { trace, type Tracer } from "@opentelemetry/api";
import type {
  SpanAttributes,
  TelemetryPort,
} from "../../use-cases/ports/telemetry";

export class NoopTelemetry implements TelemetryPort {
  readonly tracer: Tracer = trace.getTracer("shrimp");

  async runInSpan<T>(
    _name: string,
    fn: () => Promise<T>,
    _attributes?: SpanAttributes,
  ): Promise<T> {
    return fn();
  }

  async shutdown(): Promise<void> {
    // No-op: there is no exporter to flush.
  }
}
