import { beforeEach, describe, expect, it, vi } from "vitest";
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
    endpoint: "http://localhost:4318/v1/traces",
    headers: undefined,
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockSdkShutdown.mockResolvedValue(undefined);
  });

  it("should wire OTLPTraceExporter with url and parsed headers", () => {
    new OtelTelemetry(
      makeOptions({
        endpoint: "http://localhost:4318/v1/traces",
        headers: "X-Auth=secret,X-Tenant=acme",
      }),
    );

    expect(mockOTLPExporterConstructor).toHaveBeenCalledWith({
      url: "http://localhost:4318/v1/traces",
      headers: { "X-Auth": "secret", "X-Tenant": "acme" },
    });
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

  it("should pass headers as undefined when headers option is not provided", () => {
    new OtelTelemetry(makeOptions({ headers: undefined }));

    expect(mockOTLPExporterConstructor).toHaveBeenCalledWith({
      url: "http://localhost:4318/v1/traces",
      headers: undefined,
    });
  });

  it("should pass headers as undefined when headers option is an empty string", () => {
    new OtelTelemetry(makeOptions({ headers: "" }));

    expect(mockOTLPExporterConstructor).toHaveBeenCalledWith({
      url: "http://localhost:4318/v1/traces",
      headers: undefined,
    });
  });

  it("should ignore malformed header pairs and keep valid ones", () => {
    // "valid=ok" → kept; "broken" → no "=", dropped; "= " → key is empty, dropped; "empty=" → key non-empty, value is ""
    new OtelTelemetry(makeOptions({ headers: "valid=ok,broken,= ,empty=" }));

    expect(mockOTLPExporterConstructor).toHaveBeenCalledWith({
      url: "http://localhost:4318/v1/traces",
      headers: { valid: "ok", empty: "" },
    });
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
