import type {
  SpanAttributes,
  SpanLike,
  TelemetryPort,
} from "../../src/use-cases/ports/telemetry";

export type SpanCall = {
  name: string;
  /** Attributes passed as the third argument to runInSpan (initial attributes). */
  attributes?: SpanAttributes;
  /** Attributes set via span.setAttribute / span.setAttributes inside the callback. */
  spanAttributes: SpanAttributes;
  /** Exceptions recorded via span.recordException inside the callback. */
  exceptions: unknown[];
};

export type SpyTelemetry = TelemetryPort & { calls: SpanCall[] };

/**
 * Test double that records every `runInSpan` invocation so tests can assert
 * on span name, attributes, and invocation count without wiring a real OTel
 * TracerProvider.
 *
 * Each recorded SpanCall captures:
 * - `attributes` — initial attributes passed as the third arg to runInSpan
 * - `spanAttributes` — attributes set by the callback via span.setAttribute/setAttributes
 * - `exceptions` — exceptions recorded by the callback via span.recordException
 */
export function makeSpyTelemetry(): SpyTelemetry {
  const calls: SpanCall[] = [];
  return {
    calls,
    async runInSpan(name, fn, attributes) {
      const spanAttributes: SpanAttributes = {};
      const exceptions: unknown[] = [];

      const spanLike: SpanLike = {
        setAttribute(key, value) {
          spanAttributes[key] = value;
        },
        setAttributes(attrs) {
          Object.assign(spanAttributes, attrs);
        },
        recordException(err) {
          exceptions.push(err);
        },
      };

      const call: SpanCall = { name, attributes, spanAttributes, exceptions };
      calls.push(call);
      return fn(spanLike);
    },
    async shutdown() {},
  };
}
