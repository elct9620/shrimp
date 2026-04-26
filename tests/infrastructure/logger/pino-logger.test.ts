import { afterEach, describe, expect, it } from "vitest";
import pino, { type Logger } from "pino";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { context, trace } from "@opentelemetry/api";
import {
  PinoLogger,
  createPinoLogger,
} from "../../../src/infrastructure/logger/pino-logger";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";
import type { LogLevel } from "../../../src/infrastructure/config/env-config";

type CaptureResult = {
  pinoInstance: Logger;
  logger: PinoLogger;
  lines: () => Record<string, unknown>[];
};

function makePinoCapture(level = "trace"): CaptureResult {
  const chunks: string[] = [];
  const destination = {
    write: (msg: string) => {
      chunks.push(msg);
    },
  };
  const pinoInstance = pino({ level }, destination);
  const logger = new PinoLogger(pinoInstance);
  return {
    pinoInstance,
    logger,
    lines: () => chunks.map((c) => JSON.parse(c) as Record<string, unknown>),
  };
}

const LEVEL_CODES: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

describe("PinoLogger", () => {
  describe("delegation without context", () => {
    it.each([
      ["trace"],
      ["debug"],
      ["info"],
      ["warn"],
      ["error"],
      ["fatal"],
    ] as const)(
      "should forward message to pino.%s without wrapping when context is absent",
      (method) => {
        const { logger, lines } = makePinoCapture();

        logger[method]("hello");

        const parsed = lines();
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({
          level: LEVEL_CODES[method],
          msg: "hello",
        });
        expect(parsed[0]).not.toHaveProperty("context");
      },
    );
  });

  describe("delegation with context", () => {
    it.each([
      ["trace"],
      ["debug"],
      ["info"],
      ["warn"],
      ["error"],
      ["fatal"],
    ] as const)(
      "should swap argument order so pino.%s receives (context, message)",
      (method) => {
        const { logger, lines } = makePinoCapture();
        const ctx = { requestId: "abc" };

        logger[method]("hello", ctx);

        const parsed = lines();
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({
          level: LEVEL_CODES[method],
          msg: "hello",
          requestId: "abc",
        });
      },
    );
  });

  describe("child()", () => {
    it("should call pino.child(bindings) and wrap the result in a new PinoLogger", () => {
      const { logger, lines } = makePinoCapture();
      const bindings = { module: "test" };
      const child = logger.child(bindings);

      expect(child).not.toBe(logger);
      expect(child).toBeInstanceOf(PinoLogger);

      child.info("from child");
      const parsed = lines();
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        level: 30,
        msg: "from child",
        module: "test",
      });
    });

    it("should return a value that satisfies the LoggerPort interface", () => {
      const { logger } = makePinoCapture();
      const child: LoggerPort = logger.child({ module: "test" });

      expect(child).toBeDefined();
      expect(typeof child.info).toBe("function");
      expect(typeof child.child).toBe("function");
    });
  });

  describe("createPinoLogger factory", () => {
    it("should create a logger that accepts log calls without throwing when pretty is false", () => {
      const { logger } = createPinoLogger({ level: "silent", pretty: false });

      expect(() => logger.info("test message")).not.toThrow();
      expect(() => logger.debug("debug", { key: "value" })).not.toThrow();
    });

    it("should create a logger whose child is a distinct PinoLogger instance", () => {
      const { logger } = createPinoLogger({ level: "silent", pretty: false });
      const child = logger.child({ service: "test" });

      expect(child).toBeInstanceOf(PinoLogger);
      expect(child).not.toBe(logger);
    });

    it("should create a logger with default pretty (undefined) that still accepts log calls", () => {
      const { logger } = createPinoLogger({ level: "silent" });

      expect(() => logger.warn("test")).not.toThrow();
    });

    it("should expose the underlying pino instance so HTTP middleware can share it", () => {
      const { pino } = createPinoLogger({ level: "silent" });

      expect(pino).toBeDefined();
      expect(typeof pino.info).toBe("function");
      expect(typeof pino.child).toBe("function");
    });

    it("should route log output through a custom destination when provided", () => {
      const messages: string[] = [];
      const destination = {
        write: (msg: string) => {
          messages.push(msg);
        },
      };

      const { logger } = createPinoLogger({ level: "info", destination });
      logger.info("captured message", { requestId: "abc-123" });

      expect(messages).toHaveLength(1);
      const parsed = JSON.parse(messages[0]!);
      expect(parsed.msg).toBe("captured message");
      expect(parsed.requestId).toBe("abc-123");
      expect(parsed.level).toBe(30);
    });
  });

  describe("error serialization via errorContext", () => {
    function makeCapture(level: LogLevel = "warn") {
      const messages: string[] = [];
      const destination = {
        write: (msg: string) => {
          messages.push(msg);
        },
      };
      const { logger } = createPinoLogger({ level, destination });
      const parsed = () =>
        messages.map((m) => JSON.parse(m) as Record<string, unknown>);
      return { logger, parsed };
    }

    it("serializes an Error under `err` as a structured object, not a string", () => {
      const { logger, parsed } = makeCapture();

      logger.warn("boom", { err: new Error("boom") });

      const lines = parsed();
      expect(lines).toHaveLength(1);
      expect(lines[0]!.err).toEqual({ name: "Error", message: "boom" });
      expect(typeof lines[0]!.err).not.toBe("string");
    });

    it("serializes nested cause chains recursively under `err`", () => {
      const { logger, parsed } = makeCapture();
      const root = new Error("root", {
        cause: new Error("cause level 1"),
      });

      logger.warn("chained", { err: root });

      const lines = parsed();
      const err = lines[0]!.err as Record<string, unknown>;
      expect(err.message).toBe("root");
      expect(err.cause).toEqual({ name: "Error", message: "cause level 1" });
    });

    it("serializes an Error passed under the `cause` key", () => {
      const { logger, parsed } = makeCapture();

      logger.warn("via cause key", { cause: new Error("from cause") });

      const lines = parsed();
      expect(lines[0]!.cause).toEqual({
        name: "Error",
        message: "from cause",
      });
    });

    it("serializes a non-Error value under `err` as { name: NonError, message: ... }", () => {
      // Transition note: no current call site passes a non-Error under `err`;
      // this test documents the graceful fallback behaviour of errorContext.
      const { logger, parsed } = makeCapture();

      logger.warn("non-error err", { err: "just a string" });

      const lines = parsed();
      expect(lines[0]!.err).toEqual({
        name: "NonError",
        message: "just a string",
      });
    });

    it("passes through non-err/cause fields unchanged", () => {
      const { logger, parsed } = makeCapture();

      logger.warn("mixed", { err: new Error("x"), chatId: 42 });

      const lines = parsed();
      expect(lines[0]!.chatId).toBe(42);
    });

    it("end-to-end: Node-style fetch Error with ENOTFOUND cause preserves full chain including cause.code", () => {
      // This is the regression test for the Telegram-instability blind spot:
      // a fetch wrapper Error with the underlying ENOTFOUND/ECONNRESET attached
      // as `cause` must survive the pino serializer chain intact so operators
      // can diagnose DNS or connectivity failures from log output alone.
      const { logger, parsed } = makeCapture();
      const inner = new Error("ENOTFOUND telegram.org");
      (inner as unknown as Record<string, unknown>).code = "ENOTFOUND";
      const outer = new Error("fetch failed", { cause: inner });

      logger.warn("network failed", { err: outer });

      const lines = parsed();
      expect(lines).toHaveLength(1);
      const err = lines[0]!.err as Record<string, unknown>;
      expect(err.message).toBe("fetch failed");
      const cause = err.cause as Record<string, unknown>;
      expect(cause.message).toBe("ENOTFOUND telegram.org");
      expect(cause.code).toBe("ENOTFOUND");
    });
  });

  describe("OTel trace correlation via mixin", () => {
    // Each test that registers a global provider must reset it afterwards to
    // avoid cross-test contamination (matches the pattern in otel-telemetry.test.ts).
    afterEach(() => {
      trace.disable();
      context.disable();
    });

    function makeOtelCapture() {
      const messages: string[] = [];
      const destination = {
        write: (msg: string) => {
          messages.push(msg);
        },
      };
      const { logger } = createPinoLogger({ level: "info", destination });
      const parsed = () =>
        messages.map((m) => JSON.parse(m) as Record<string, unknown>);
      return { logger, parsed };
    }

    function makeRegisteredProvider() {
      const exporter = new InMemorySpanExporter();
      const provider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      // Register as the global provider and install a real context manager so
      // trace.getActiveSpan() sees spans started via startActiveSpan().
      const contextManager = new AsyncLocalStorageContextManager();
      contextManager.enable();
      context.setGlobalContextManager(contextManager);
      trace.setGlobalTracerProvider(provider);
      return { provider, tracer: provider.getTracer("pino-logger-test") };
    }

    it("does NOT inject trace_id or span_id when no active span is in scope", () => {
      const { logger, parsed } = makeOtelCapture();

      logger.info("outside span");

      const lines = parsed();
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toHaveProperty("trace_id");
      expect(lines[0]).not.toHaveProperty("span_id");
    });

    it("injects trace_id and span_id matching the active span when inside a span", () => {
      const { logger, parsed } = makeOtelCapture();
      const { tracer } = makeRegisteredProvider();

      tracer.startActiveSpan("test-span", (span) => {
        const ctx = span.spanContext();
        logger.info("inside span");
        span.end();

        const lines = parsed();
        expect(lines).toHaveLength(1);
        expect(lines[0]!.trace_id).toBe(ctx.traceId);
        expect(lines[0]!.span_id).toBe(ctx.spanId);
      });
    });
  });
});
