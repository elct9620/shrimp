import { describe, expect, it } from "vitest";
import pino, { type Logger } from "pino";
import {
  PinoLogger,
  createPinoLogger,
} from "../../../src/infrastructure/logger/pino-logger";
import type { LoggerPort } from "../../../src/use-cases/ports/logger";

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
});
