export type SpanAttributes = Record<string, string | number | boolean>;

/**
 * Minimal span handle passed to `runInSpan` callbacks so callers can enrich
 * the active span without importing `@opentelemetry/api` directly.
 *
 * Implementations map these methods to the underlying OTel Span. Callers
 * remain framework-agnostic.
 */
export interface SpanLike {
  /** Set a single attribute on the active span. */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Set multiple attributes on the active span in one call. */
  setAttributes(attrs: SpanAttributes): void;
  /**
   * Record an exception event on the active span.
   * Accepts any thrown value (string, Error, unknown) — implementations
   * cast to the underlying API's expected type.
   */
  recordException(err: unknown): void;
}

export interface TelemetryPort {
  /**
   * Run `fn` inside a named active span. Implementations are responsible for
   * the full span lifecycle: start → record exception + set ERROR status on
   * throw → end the span in a finally block. Callers observe no telemetry
   * primitives.
   *
   * Optional `attributes` are set on the span before `fn` runs so they are
   * visible on early-exit paths (e.g., idle Jobs, errors).
   *
   * The callback receives a `SpanLike` handle so it can set attributes or
   * record exceptions incrementally without importing `@opentelemetry/api`.
   * Existing callbacks that ignore the argument continue to work unchanged.
   */
  runInSpan<T>(
    name: string,
    fn: (span: SpanLike) => Promise<T>,
    attributes?: SpanAttributes,
  ): Promise<T>;

  /**
   * Flush buffered spans and tear down the exporter pipeline.
   * Called by server.ts on SIGINT/SIGTERM.
   * Implementations must never throw — failures should be swallowed (fail-open).
   */
  shutdown(): Promise<void>;
}
