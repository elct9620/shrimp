import { trace, type Tracer } from "@opentelemetry/api";
import type {
  SpanAttributes,
  SpanLike,
  TelemetryPort,
} from "../../use-cases/ports/telemetry";

const noopSpanLike: SpanLike = {
  setAttribute: () => undefined,
  setAttributes: () => undefined,
  recordException: () => undefined,
};

export class NoopTelemetry implements TelemetryPort {
  readonly tracer: Tracer = trace.getTracer("shrimp");

  async runInSpan<T>(
    _name: string,
    fn: (span: SpanLike) => Promise<T>,
    _attributes?: SpanAttributes,
  ): Promise<T> {
    return fn(noopSpanLike);
  }

  async shutdown(): Promise<void> {
    // No-op: there is no exporter to flush.
  }
}
