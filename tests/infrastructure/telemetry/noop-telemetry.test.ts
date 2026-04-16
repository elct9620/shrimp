import { describe, expect, it } from "vitest";
import { NoopTelemetry } from "../../../src/infrastructure/telemetry/noop-telemetry";
import type { TelemetryPort } from "../../../src/use-cases/ports/telemetry";

describe("NoopTelemetry", () => {
  it("should be assignable to TelemetryPort when instantiated", () => {
    // TypeScript assignment verifies structural conformance at compile time;
    // this test confirms the class exposes all required members at runtime.
    const t: TelemetryPort = new NoopTelemetry();
    expect(t.tracer).toBeDefined();
    expect(typeof t.recordInputs).toBe("boolean");
    expect(typeof t.recordOutputs).toBe("boolean");
    expect(typeof t.shutdown).toBe("function");
  });

  it("should expose a tracer with startActiveSpan method", () => {
    const noop = new NoopTelemetry();
    expect(noop.tracer).toBeTruthy();
    expect(typeof noop.tracer.startActiveSpan).toBe("function");
  });

  it("should default recordInputs to true", () => {
    const noop = new NoopTelemetry();
    expect(noop.recordInputs).toBe(true);
  });

  it("should default recordOutputs to true", () => {
    const noop = new NoopTelemetry();
    expect(noop.recordOutputs).toBe(true);
  });

  it("should resolve shutdown without error", async () => {
    const noop = new NoopTelemetry();
    await expect(noop.shutdown()).resolves.toBeUndefined();
  });

  it("should return callback result when startActiveSpan is called", () => {
    const noop = new NoopTelemetry();
    const result = noop.tracer.startActiveSpan("test", (span) => {
      span.end();
      return "ok";
    });
    expect(result).toBe("ok");
  });
});
