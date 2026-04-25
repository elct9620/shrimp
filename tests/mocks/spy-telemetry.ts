import type {
  SpanAttributes,
  SpanLike,
  TelemetryPort,
} from "../../src/use-cases/ports/telemetry";

export type SpanCall = { name: string; attributes?: SpanAttributes };

export type SpyTelemetry = TelemetryPort & { calls: SpanCall[] };

/**
 * Test double that records every `runInSpan` invocation so tests can assert
 * on span name, attributes, and invocation count without wiring a real OTel
 * TracerProvider.
 */
const noopSpanLike: SpanLike = {
  setAttribute: () => undefined,
  setAttributes: () => undefined,
  recordException: () => undefined,
};

export function makeSpyTelemetry(): SpyTelemetry {
  const calls: SpanCall[] = [];
  return {
    calls,
    async runInSpan(name, fn, attributes) {
      calls.push({ name, attributes });
      return fn(noopSpanLike);
    },
    async shutdown() {},
  };
}
