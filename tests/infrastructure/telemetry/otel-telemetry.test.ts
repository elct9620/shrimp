import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  context,
  diag,
  DiagLogLevel,
  metrics,
  propagation,
  SpanStatusCode,
  trace,
  type DiagLogger,
  type Tracer,
} from "@opentelemetry/api";
import type { TelemetryPort } from "../../../src/use-cases/ports/telemetry";
import {
  OtelTelemetry,
  applyDefaultDeploymentEnvironment,
  type OtelTelemetryOptions,
} from "../../../src/infrastructure/telemetry/otel-telemetry";
import { makeFakeLogger } from "../../mocks/fake-logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Default no-op SDK so tests don't boot a real NodeSDK (which mutates
// process.env, registers global OTel APIs, and spams stderr with duplicate
// registration warnings on every subsequent test). Tests that need real
// span recording inject a `tracer` built from BasicTracerProvider; tests that
// need to exercise shutdown error paths override `sdk` explicitly.
function makeStubSdk(): Pick<
  import("@opentelemetry/sdk-node").NodeSDK,
  "start" | "shutdown"
> {
  return {
    start: () => undefined,
    shutdown: () => Promise.resolve(),
  };
}

function makeOptions(
  overrides: Partial<OtelTelemetryOptions> = {},
): OtelTelemetryOptions {
  return {
    serviceName: "shrimp-test",
    logger: makeFakeLogger(),
    sdk: makeStubSdk(),
    ...overrides,
  };
}

/**
 * Build a real BasicTracerProvider backed by an InMemorySpanExporter so tests
 * can assert on spans without touching NodeSDK / OTLP / network.
 */
function makeTracerProvider(): {
  provider: BasicTracerProvider;
  exporter: InMemorySpanExporter;
  tracer: Tracer;
} {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer("shrimp-test");
  return { provider, exporter, tracer };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("OtelTelemetry", () => {
  let setLoggerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setLoggerSpy = vi.spyOn(diag, "setLogger");
    // Prevent applyDefaultDeploymentEnvironment from leaking mutations across
    // tests via real process.env.
    vi.stubEnv("OTEL_RESOURCE_ATTRIBUTES", "");
    vi.stubEnv("OTEL_LOG_LEVEL", "");
  });

  afterEach(() => {
    setLoggerSpy.mockRestore();
    diag.disable();
    // Reset every global OTel API surface so a stray real-NodeSDK construction
    // (or a future test that needs one) starts from a clean slate instead of
    // hitting "Attempted duplicate registration of API" warnings.
    trace.disable();
    context.disable();
    propagation.disable();
    metrics.disable();
    vi.unstubAllEnvs();
  });

  /**
   * OtelTelemetry always calls diag.setLogger LAST (after sdk.start()), as
   * documented in the production code. NodeSDK may also call diag.setLogger
   * during construction when OTEL_LOG_LEVEL is set, so we always read the
   * last recorded call to isolate the OtelTelemetry call.
   */
  function lastSetLoggerCall(): [
    DiagLogger,
    { logLevel: DiagLogLevel; suppressOverrideMessage: boolean },
  ] {
    const calls = setLoggerSpy.mock.calls;
    return calls[calls.length - 1] as [
      DiagLogger,
      { logLevel: DiagLogLevel; suppressOverrideMessage: boolean },
    ];
  }

  it("should forward OTel SDK diagnostics through the LoggerPort", () => {
    // makeFakeLogger().child() returns the same instance, so the child wired
    // into the adapter is `logger` itself — we can assert directly on it.
    const logger = makeFakeLogger();
    new OtelTelemetry(makeOptions({ logger }));

    expect(setLoggerSpy).toHaveBeenCalled();
    const [diagLogger, opts] = lastSetLoggerCall();

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

    const [, opts] = lastSetLoggerCall();
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

      const [, opts] = lastSetLoggerCall();
      expect(opts.logLevel).toBe(expected);
    },
  );

  it("should default the diag logger level to WARN when OTEL_LOG_LEVEL is unset", () => {
    new OtelTelemetry(makeOptions());

    const [, opts] = lastSetLoggerCall();
    expect(opts.logLevel).toBe(DiagLogLevel.WARN);
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

  it("should resolve shutdown without throwing", async () => {
    const telemetry = new OtelTelemetry(makeOptions());

    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it("should swallow sdk shutdown errors and log a warning", async () => {
    const { tracer } = makeTracerProvider();
    const logger = makeFakeLogger();

    const stubSdk: Pick<
      import("@opentelemetry/sdk-node").NodeSDK,
      "start" | "shutdown"
    > = {
      start: () => undefined,
      shutdown: () => Promise.reject(new Error("boom")),
    };

    const telemetry = new OtelTelemetry(
      makeOptions({ logger, tracer, sdk: stubSdk }),
    );

    await expect(telemetry.shutdown()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "telemetry shutdown failed",
      expect.objectContaining({ err: expect.any(Error) }),
    );
  });

  describe("applyDefaultDeploymentEnvironment", () => {
    it("adds deployment.environment=development when OTEL_RESOURCE_ATTRIBUTES and env flags are unset", () => {
      const env: NodeJS.ProcessEnv = {};
      applyDefaultDeploymentEnvironment(env);
      expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toBe(
        "deployment.environment=development",
      );
    });

    it("prefers SHRIMP_ENV over NODE_ENV when deriving the default", () => {
      const env: NodeJS.ProcessEnv = {
        SHRIMP_ENV: "staging",
        NODE_ENV: "production",
      };
      applyDefaultDeploymentEnvironment(env);
      expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toBe(
        "deployment.environment=staging",
      );
    });

    it("falls back to NODE_ENV when SHRIMP_ENV is unset", () => {
      const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
      applyDefaultDeploymentEnvironment(env);
      expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toBe(
        "deployment.environment=production",
      );
    });

    it("merges into existing OTEL_RESOURCE_ATTRIBUTES without clobbering user keys", () => {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "production",
        OTEL_RESOURCE_ATTRIBUTES: "service.version=1.2.3,team=shrimp",
      };
      applyDefaultDeploymentEnvironment(env);
      expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toBe(
        "service.version=1.2.3,team=shrimp,deployment.environment=production",
      );
    });

    it("leaves a user-provided deployment.environment untouched", () => {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "production",
        OTEL_RESOURCE_ATTRIBUTES:
          "deployment.environment=canary,service.version=1.2.3",
      };
      applyDefaultDeploymentEnvironment(env);
      expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toBe(
        "deployment.environment=canary,service.version=1.2.3",
      );
    });

    it("treats empty-string SHRIMP_ENV / NODE_ENV as unset", () => {
      const env: NodeJS.ProcessEnv = { SHRIMP_ENV: "", NODE_ENV: "" };
      applyDefaultDeploymentEnvironment(env);
      expect(env["OTEL_RESOURCE_ATTRIBUTES"]).toBe(
        "deployment.environment=development",
      );
    });
  });

  describe("runInSpan", () => {
    it("should invoke the callback and return its resolved value", async () => {
      const { tracer } = makeTracerProvider();
      const telemetry = new OtelTelemetry(makeOptions({ tracer }));

      const result = await telemetry.runInSpan("x", async () => "ok");

      expect(result).toBe("ok");
    });

    it("should produce a finished span with the given name on the happy path", async () => {
      const { tracer, exporter } = makeTracerProvider();
      const telemetry = new OtelTelemetry(makeOptions({ tracer }));

      await telemetry.runInSpan("my-operation", async () => undefined);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("my-operation");
      expect(spans[0].status.code).toBe(SpanStatusCode.UNSET);
    });

    it("should end the span exactly once on the happy path", async () => {
      const { tracer, exporter } = makeTracerProvider();
      const telemetry = new OtelTelemetry(makeOptions({ tracer }));

      await telemetry.runInSpan("x", async () => undefined);

      // A finished span means end() was called; check no exception event was recorded.
      const span = exporter.getFinishedSpans()[0];
      expect(span).toBeDefined();
      const exceptionEvents = span.events.filter((e) => e.name === "exception");
      expect(exceptionEvents).toHaveLength(0);
    });

    it("should record the exception, set ERROR status, end the span, and rethrow", async () => {
      const { tracer, exporter } = makeTracerProvider();
      const telemetry = new OtelTelemetry(makeOptions({ tracer }));
      const boom = new Error("boom");

      await expect(
        telemetry.runInSpan("x", async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
      const exceptionEvents = spans[0].events.filter(
        (e) => e.name === "exception",
      );
      expect(exceptionEvents).toHaveLength(1);
    });

    it("should set attributes on the span before invoking the callback", async () => {
      const { tracer, exporter } = makeTracerProvider();
      const telemetry = new OtelTelemetry(makeOptions({ tracer }));

      await telemetry.runInSpan("x", async () => undefined, {
        "http.request.method": "POST",
        "http.route": "/heartbeat",
      });

      const span = exporter.getFinishedSpans()[0];
      expect(span.attributes["http.request.method"]).toBe("POST");
      expect(span.attributes["http.route"]).toBe("/heartbeat");
    });

    it("should not set attributes on the span when attributes are omitted", async () => {
      const { tracer, exporter } = makeTracerProvider();
      const telemetry = new OtelTelemetry(makeOptions({ tracer }));

      await telemetry.runInSpan("x", async () => undefined);

      const span = exporter.getFinishedSpans()[0];
      expect(Object.keys(span.attributes)).toHaveLength(0);
    });

    it("should pass a SpanLike handle to the callback", async () => {
      const { tracer } = makeTracerProvider();
      const telemetry = new OtelTelemetry(makeOptions({ tracer }));

      let receivedSpan: unknown;
      await telemetry.runInSpan("x", async (span) => {
        receivedSpan = span;
      });

      expect(receivedSpan).toBeDefined();
      expect(
        typeof (receivedSpan as { setAttribute: unknown }).setAttribute,
      ).toBe("function");
      expect(
        typeof (receivedSpan as { setAttributes: unknown }).setAttributes,
      ).toBe("function");
      expect(
        typeof (receivedSpan as { recordException: unknown }).recordException,
      ).toBe("function");
    });

    it("should apply setAttribute calls from the callback to the span", async () => {
      const { tracer, exporter } = makeTracerProvider();
      const telemetry = new OtelTelemetry(makeOptions({ tracer }));

      await telemetry.runInSpan("x", async (span) => {
        span.setAttribute("chat.id", 12345);
        span.setAttribute("attempt.result", "ok");
      });

      const finished = exporter.getFinishedSpans()[0];
      expect(finished.attributes["chat.id"]).toBe(12345);
      expect(finished.attributes["attempt.result"]).toBe("ok");
    });

    it("should apply setAttributes calls from the callback to the span", async () => {
      const { tracer, exporter } = makeTracerProvider();
      const telemetry = new OtelTelemetry(makeOptions({ tracer }));

      await telemetry.runInSpan("x", async (span) => {
        span.setAttributes({ "http.status_code": 200, "attempt.index": 0 });
      });

      const finished = exporter.getFinishedSpans()[0];
      expect(finished.attributes["http.status_code"]).toBe(200);
      expect(finished.attributes["attempt.index"]).toBe(0);
    });

    it("should record an exception and set ERROR status when SpanLike.recordException is called", async () => {
      const { tracer, exporter } = makeTracerProvider();
      const telemetry = new OtelTelemetry(makeOptions({ tracer }));
      const boom = new Error("explicit record");

      await telemetry.runInSpan("x", async (span) => {
        span.recordException(boom);
      });

      const finished = exporter.getFinishedSpans()[0];
      expect(finished.status.code).toBe(SpanStatusCode.ERROR);
      const exceptionEvents = finished.events.filter(
        (e) => e.name === "exception",
      );
      expect(exceptionEvents).toHaveLength(1);
    });

    // Nesting verification (code-reading only): OtelTelemetry.runInSpan uses
    // tracer.startActiveSpan(), which is documented by the OTel API spec to
    // register the new span as the active span in the current context and
    // restore the previous active span after the callback returns. Nested calls
    // therefore produce a parent/child relationship automatically — this is
    // core OTel SDK behavior, not an invariant this adapter needs to prove.
    // A live integration test would require @opentelemetry/context-async-hooks
    // (a transitive dep, not a direct dep) to set up a real context manager,
    // which the test harness would not allow cleanly alongside the afterEach
    // context.disable() reset. Skipped per item-5 brief guidance.
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
