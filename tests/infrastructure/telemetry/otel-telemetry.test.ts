import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diag, DiagLogLevel, type DiagLogger } from "@opentelemetry/api";
import type { TelemetryPort } from "../../../src/use-cases/ports/telemetry";
import { makeFakeLogger } from "../../mocks/fake-logger";

// ---------------------------------------------------------------------------
// Mock @opentelemetry/sdk-node
// ---------------------------------------------------------------------------
const mockSdkStart = vi.fn();
const mockSdkShutdown = vi.fn().mockResolvedValue(undefined);
const mockNodeSDKConstructor = vi.fn();

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class MockNodeSDK {
    constructor(opts: unknown) {
      mockNodeSDKConstructor(opts);
    }
    start = mockSdkStart;
    shutdown = mockSdkShutdown;
  },
}));

// ---------------------------------------------------------------------------
// Mock @opentelemetry/exporter-trace-otlp-http
// ---------------------------------------------------------------------------
const mockOTLPExporterConstructor = vi.fn();

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class MockOTLPTraceExporter {
    constructor(opts: unknown) {
      mockOTLPExporterConstructor(opts);
    }
  },
}));

// ---------------------------------------------------------------------------
// Mock @opentelemetry/resources — capture what was passed to resourceFromAttributes
// ---------------------------------------------------------------------------
const mockResourceFromAttributes = vi.fn((attrs: Record<string, unknown>) => ({
  _attrs: attrs,
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: (attrs: Record<string, unknown>) =>
    mockResourceFromAttributes(attrs),
}));

// ---------------------------------------------------------------------------
// Import the unit under test AFTER mocks are registered
// ---------------------------------------------------------------------------
const { OtelTelemetry } =
  await import("../../../src/infrastructure/telemetry/otel-telemetry");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeOptions(
  overrides: Partial<ConstructorParameters<typeof OtelTelemetry>[0]> = {},
): ConstructorParameters<typeof OtelTelemetry>[0] {
  return {
    serviceName: "shrimp-test",
    recordInputs: true,
    recordOutputs: true,
    logger: makeFakeLogger(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("OtelTelemetry", () => {
  let setLoggerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSdkShutdown.mockResolvedValue(undefined);
    setLoggerSpy = vi.spyOn(diag, "setLogger");
    delete process.env["OTEL_LOG_LEVEL"];
  });

  afterEach(() => {
    setLoggerSpy.mockRestore();
    diag.disable();
    delete process.env["OTEL_LOG_LEVEL"];
  });

  it("registers a diag logger that forwards OTel SDK diagnostics to LoggerPort", () => {
    const logger = makeFakeLogger();
    new OtelTelemetry(makeOptions({ logger }));

    expect(setLoggerSpy).toHaveBeenCalledOnce();
    const [diagLogger, opts] = setLoggerSpy.mock.calls[0] as [
      DiagLogger,
      { logLevel: DiagLogLevel; suppressOverrideMessage: boolean },
    ];

    diagLogger.error("export failed", { code: 401 });
    diagLogger.warn("retrying");
    diagLogger.info("sdk started");
    diagLogger.debug("batch flushed");
    diagLogger.verbose("verbose payload");

    // Logger child is created with module: OtelTelemetry, so we assert against
    // logger.child(...) — the same instance our adapter uses.
    const child = (logger.child as ReturnType<typeof vi.fn>).mock.results[0]
      .value;
    expect(child.error).toHaveBeenCalledWith("[otel] export failed", {
      args: [{ code: 401 }],
    });
    expect(child.warn).toHaveBeenCalledWith("[otel] retrying", undefined);
    expect(child.info).toHaveBeenCalledWith("[otel] sdk started", undefined);
    expect(child.debug).toHaveBeenCalledWith("[otel] batch flushed", undefined);
    expect(child.debug).toHaveBeenCalledWith(
      "[otel] verbose payload",
      undefined,
    );
    expect(opts.suppressOverrideMessage).toBe(true);
    expect(opts.logLevel).toBe(DiagLogLevel.WARN);
  });

  it("honours OTEL_LOG_LEVEL when registering the diag logger", () => {
    process.env["OTEL_LOG_LEVEL"] = "debug";
    new OtelTelemetry(makeOptions());

    const opts = setLoggerSpy.mock.calls[0][1] as { logLevel: DiagLogLevel };
    expect(opts.logLevel).toBe(DiagLogLevel.DEBUG);
  });

  it("should construct OTLPTraceExporter without url/headers so the SDK reads OTEL_EXPORTER_OTLP_* from env", () => {
    // Regression: previously we passed url:options.endpoint, which made the
    // exporter treat it as a complete URL and skip the spec-mandated
    // "/v1/traces" suffix appending — breaking Langfuse and any backend that
    // relies on OTEL_EXPORTER_OTLP_ENDPOINT being a base URL.
    new OtelTelemetry(makeOptions());

    expect(mockOTLPExporterConstructor).toHaveBeenCalledOnce();
    const args = mockOTLPExporterConstructor.mock.calls[0][0];
    expect(args?.url).toBeUndefined();
    expect(args?.headers).toBeUndefined();
  });

  it("should wire NodeSDK resource with service.name", () => {
    new OtelTelemetry(makeOptions({ serviceName: "shrimp-test" }));

    expect(mockResourceFromAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ "service.name": "shrimp-test" }),
    );
    const sdkOpts = mockNodeSDKConstructor.mock.calls[0][0] as {
      resource: { _attrs: Record<string, unknown> };
    };
    expect(sdkOpts.resource._attrs["service.name"]).toBe("shrimp-test");
  });

  it("should call sdk.start during construction", () => {
    new OtelTelemetry(makeOptions());

    expect(mockSdkStart).toHaveBeenCalledOnce();
  });

  it("should have a defined tracer after construction", () => {
    const telemetry: TelemetryPort = new OtelTelemetry(makeOptions());

    expect(telemetry.tracer).toBeDefined();
  });

  it("should reflect recordInputs from constructor options", () => {
    const t = new OtelTelemetry(makeOptions({ recordInputs: false }));

    expect(t.recordInputs).toBe(false);
  });

  it("should reflect recordOutputs from constructor options", () => {
    const t = new OtelTelemetry(makeOptions({ recordOutputs: false }));

    expect(t.recordOutputs).toBe(false);
  });

  it("should resolve and call sdk.shutdown when shutdown is called", async () => {
    const telemetry = new OtelTelemetry(makeOptions());

    await expect(telemetry.shutdown()).resolves.toBeUndefined();
    expect(mockSdkShutdown).toHaveBeenCalledOnce();
  });

  it("should swallow sdk.shutdown errors and log a warning", async () => {
    mockSdkShutdown.mockRejectedValueOnce(new Error("boom"));
    const logger = makeFakeLogger();
    const telemetry = new OtelTelemetry(makeOptions({ logger }));

    await expect(telemetry.shutdown()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "telemetry shutdown failed",
      expect.objectContaining({ error: "boom" }),
    );
  });
});
