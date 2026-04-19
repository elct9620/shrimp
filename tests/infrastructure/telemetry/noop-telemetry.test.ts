import { describe, expect, it, vi } from "vitest";
import { NoopTelemetry } from "../../../src/infrastructure/telemetry/noop-telemetry";
import type { TelemetryPort } from "../../../src/use-cases/ports/telemetry";

describe("NoopTelemetry", () => {
  it("should be assignable to TelemetryPort when instantiated", () => {
    // TypeScript assignment verifies structural conformance at compile time;
    // this test confirms the class exposes all required members at runtime.
    const t: TelemetryPort = new NoopTelemetry();
    expect(typeof t.runInSpan).toBe("function");
    expect(typeof t.shutdown).toBe("function");
  });

  it("should expose a tracer with startActiveSpan method", () => {
    const noop = new NoopTelemetry();
    expect(noop.tracer).toBeTruthy();
    expect(typeof noop.tracer.startActiveSpan).toBe("function");
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

  describe("runInSpan", () => {
    it("should forward the callback's resolved value", async () => {
      const noop = new NoopTelemetry();
      await expect(noop.runInSpan("x", async () => 42)).resolves.toBe(42);
    });

    it("should invoke the callback exactly once", async () => {
      const noop = new NoopTelemetry();
      const fn = vi.fn().mockResolvedValue(undefined);
      await noop.runInSpan("x", fn);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should propagate errors thrown by the callback", async () => {
      const noop = new NoopTelemetry();
      const boom = new Error("boom");
      await expect(
        noop.runInSpan("x", async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);
    });

    it("should accept and ignore optional attributes without throwing", async () => {
      const noop = new NoopTelemetry();
      await expect(
        noop.runInSpan("x", async () => 42, {
          "http.request.method": "POST",
          "http.route": "/heartbeat",
        }),
      ).resolves.toBe(42);
    });
  });
});
