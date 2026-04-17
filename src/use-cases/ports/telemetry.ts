export interface TelemetryPort {
  /**
   * Run `fn` inside a named active span. Implementations are responsible for
   * the full span lifecycle: start → record exception + set ERROR status on
   * throw → end the span in a finally block. Callers observe no telemetry
   * primitives.
   */
  runInSpan<T>(name: string, fn: () => Promise<T>): Promise<T>;

  /**
   * Flush buffered spans and tear down the exporter pipeline.
   * Called by server.ts on SIGINT/SIGTERM.
   * Implementations must never throw — failures should be swallowed (fail-open).
   */
  shutdown(): Promise<void>;
}
