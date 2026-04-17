import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  diag,
  DiagLogLevel,
  SpanStatusCode,
  type DiagLogger,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
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
  });

  afterEach(() => {
    setLoggerSpy.mockRestore();
    diag.disable();
    vi.unstubAllEnvs();
  });

  it("should forward OTel SDK diagnostics through the LoggerPort", () => {
    // makeFakeLogger().child() returns the same instance, so the child wired
    // into the adapter is `logger` itself — we can assert directly on it.
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

    expect(logger.error).toHaveBeenCalledWith("[otel] export failed", {
      args: [{ code: 401 }],
    });
    expect(logger.warn).toHaveBeenCalledWith("[otel] retrying", undefined);
    expect(logger.info).toHaveBeenCalledWith("[otel] sdk started", undefined);
    expect(logger.debug).toHaveBeenCalledWith(
      "[otel] batch flushed",
      undefined,
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "[otel] verbose payload",
      undefined,
    );
    expect(opts.suppressOverrideMessage).toBe(true);
    expect(opts.logLevel).toBe(DiagLogLevel.WARN);
  });

  it("should honour OTEL_LOG_LEVEL for the diag logger level", () => {
    vi.stubEnv("OTEL_LOG_LEVEL", "debug");
    new OtelTelemetry(makeOptions());

    const opts = setLoggerSpy.mock.calls[0][1] as { logLevel: DiagLogLevel };
    expect(opts.logLevel).toBe(DiagLogLevel.DEBUG);
  });

  it.each([
    ["NONE", DiagLogLevel.NONE],
    ["none", DiagLogLevel.NONE],
    ["ERROR", DiagLogLevel.ERROR],
    ["WARN", DiagLogLevel.WARN],
    ["INFO", DiagLogLevel.INFO],
    ["DEBUG", DiagLogLevel.DEBUG],
    ["VERBOSE", DiagLogLevel.VERBOSE],
    ["ALL", DiagLogLevel.ALL],
    ["Debug", DiagLogLevel.DEBUG],
    ["unknown", DiagLogLevel.WARN],
  ])(
    "should map OTEL_LOG_LEVEL=%s to the matching DiagLogLevel",
    (raw, expected) => {
      vi.stubEnv("OTEL_LOG_LEVEL", raw);
      new OtelTelemetry(makeOptions());

      const opts = setLoggerSpy.mock.calls[0][1] as { logLevel: DiagLogLevel };
      expect(opts.logLevel).toBe(expected);
    },
  );

  it("should default the diag logger level to WARN when OTEL_LOG_LEVEL is unset", () => {
    new OtelTelemetry(makeOptions());

    const opts = setLoggerSpy.mock.calls[0][1] as { logLevel: DiagLogLevel };
    expect(opts.logLevel).toBe(DiagLogLevel.WARN);
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

  it("should expose a tracer on the concrete adapter for DI wiring", () => {
    const telemetry = new OtelTelemetry(makeOptions());

    expect(telemetry.tracer).toBeDefined();
  });

  it("should satisfy the TelemetryPort contract", () => {
    const t: TelemetryPort = new OtelTelemetry(makeOptions());

    expect(typeof t.runInSpan).toBe("function");
    expect(typeof t.shutdown).toBe("function");
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

  describe("runInSpan", () => {
    type FakeSpan = {
      end: ReturnType<typeof vi.fn>;
      recordException: ReturnType<typeof vi.fn>;
      setStatus: ReturnType<typeof vi.fn>;
    };

    function makeFakeTracer(span: FakeSpan): Tracer {
      return {
        startActiveSpan: ((_name: string, cb: (span: Span) => unknown) =>
          cb(span as unknown as Span)) as Tracer["startActiveSpan"],
        startSpan: vi.fn(),
      } as unknown as Tracer;
    }

    function buildTelemetry(
      span: FakeSpan,
    ): InstanceType<typeof OtelTelemetry> {
      return new OtelTelemetry(makeOptions({ tracer: makeFakeTracer(span) }));
    }

    function makeSpan(): FakeSpan {
      return {
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
      };
    }

    it("should invoke the callback and return its resolved value", async () => {
      const span = makeSpan();
      const telemetry = buildTelemetry(span);
      const result = await telemetry.runInSpan("x", async () => "ok");
      expect(result).toBe("ok");
    });

    it("should end the span exactly once on the happy path", async () => {
      const span = makeSpan();
      const telemetry = buildTelemetry(span);
      await telemetry.runInSpan("x", async () => undefined);
      expect(span.end).toHaveBeenCalledTimes(1);
      expect(span.recordException).not.toHaveBeenCalled();
      expect(span.setStatus).not.toHaveBeenCalled();
    });

    it("should record the exception, set ERROR status, end the span, and rethrow", async () => {
      const span = makeSpan();
      const telemetry = buildTelemetry(span);
      const boom = new Error("boom");
      await expect(
        telemetry.runInSpan("x", async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);
      expect(span.recordException).toHaveBeenCalledWith(boom);
      expect(span.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
      });
      expect(span.end).toHaveBeenCalledTimes(1);
    });
  });

  describe("telemetry exporter ready startup log", () => {
    // Clear any host-shell OTEL_EXPORTER_OTLP_* values that would otherwise
    // leak into these tests. Individual tests then stub what they need.
    beforeEach(() => {
      vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
      vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "");
      vi.stubEnv("OTEL_EXPORTER_OTLP_PROTOCOL", "");
      vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "");
      vi.stubEnv("OTEL_EXPORTER_OTLP_HEADERS", "");
      vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "");
    });

    it("should log the resolved endpoint, protocol, and header keys", () => {
      vi.stubEnv(
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "https://example.test/api/public/otel",
      );
      vi.stubEnv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json");
      vi.stubEnv(
        "OTEL_EXPORTER_OTLP_HEADERS",
        "Authorization=Basic abc,X-Tenant=acme",
      );
      const logger = makeFakeLogger();
      new OtelTelemetry(makeOptions({ logger }));

      expect(logger.info).toHaveBeenCalledWith("telemetry exporter ready", {
        endpoint: "https://example.test/api/public/otel",
        protocol: "http/json",
        headerKeys: ["Authorization", "X-Tenant"],
      });
    });

    it("should prefer OTEL_EXPORTER_OTLP_TRACES_* env vars over the non-signal-specific ones", () => {
      vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://generic.test/otel");
      vi.stubEnv(
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        "https://traces.test/v1/traces",
      );
      vi.stubEnv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json");
      vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "http/protobuf");
      vi.stubEnv("OTEL_EXPORTER_OTLP_HEADERS", "X-Generic=g");
      vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "X-Traces=t");
      const logger = makeFakeLogger();
      new OtelTelemetry(makeOptions({ logger }));

      expect(logger.info).toHaveBeenCalledWith("telemetry exporter ready", {
        endpoint: "https://traces.test/v1/traces",
        protocol: "http/protobuf",
        headerKeys: ["X-Traces"],
      });
    });

    it("should fall back to the bundled http/json default when no protocol env var is set", () => {
      vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://example.test/otel");
      const logger = makeFakeLogger();
      new OtelTelemetry(makeOptions({ logger }));

      expect(logger.info).toHaveBeenCalledWith(
        "telemetry exporter ready",
        expect.objectContaining({
          protocol: expect.stringContaining("http/json"),
        }),
      );
    });

    it.each([
      ["", []],
      ["a=1", ["a"]],
      ["a=1,b=2", ["a", "b"]],
      ["broken,=v,k=", ["k"]],
      [" a = 1 , b = 2 ", ["a", "b"]],
    ])(
      "should parse OTEL_EXPORTER_OTLP_HEADERS=%j into header key list %j",
      (raw, expected) => {
        vi.stubEnv("OTEL_EXPORTER_OTLP_HEADERS", raw);
        const logger = makeFakeLogger();
        new OtelTelemetry(makeOptions({ logger }));

        expect(logger.info).toHaveBeenCalledWith(
          "telemetry exporter ready",
          expect.objectContaining({ headerKeys: expected }),
        );
      },
    );
  });
});
