import pino, { type Logger, type DestinationStream } from "pino";
import { trace } from "@opentelemetry/api";
import type { LogLevel } from "../config/env-config";
import type { LoggerPort } from "../../use-cases/ports/logger";
import { errorContext } from "./error-context";

const INVALID_TRACE_ID = "00000000000000000000000000000000";

function otelMixin(): Record<string, unknown> {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  if (ctx.traceId === INVALID_TRACE_ID) return {};
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

type LogMethod = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export class PinoLogger implements LoggerPort {
  constructor(private readonly pinoLogger: Logger) {}

  private delegate(
    method: LogMethod,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (context !== undefined) {
      this.pinoLogger[method](context, message);
    } else {
      this.pinoLogger[method](message);
    }
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.delegate("trace", message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.delegate("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.delegate("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.delegate("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.delegate("error", message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.delegate("fatal", message, context);
  }

  child(bindings: Record<string, unknown>): LoggerPort {
    return new PinoLogger(this.pinoLogger.child(bindings));
  }
}

export type CreatePinoLoggerOptions = {
  level: LogLevel;
  pretty?: boolean;
  destination?: DestinationStream;
};

export type CreatePinoLoggerResult = {
  logger: LoggerPort;
  pino: Logger;
};

/**
 * Field-name convention — why pino defaults are the conformant choice:
 *
 * Pino inherits the bunyan JSON-logging lineage (https://github.com/trentm/node-bunyan),
 * which established `level` (numeric), `time` (epoch ms), and `msg` as the de-facto
 * Node.js structured-log baseline. This is the convention, not just a default.
 *
 * OTel Logs Data Model (https://opentelemetry.io/docs/specs/otel/logs/data-model/) defines
 * its own abstract field names (`SeverityText`, `SeverityNumber`, `Timestamp`, `Body`), but
 * these are internal model fields — the OTel Collector maps from whatever JSON field names
 * you emit via `parse_from` rules; there is no prescribed stdout JSON wire format.
 * `@opentelemetry/instrumentation-pino` bridges pino → OTel SDK in-process without
 * requiring field renames in the emitted JSON.
 *
 * Renaming to OTel or ECS field names (`severity_text`, `@timestamp`, `message`) would:
 *   - break Dozzle's level coloring (which uses the `level` field for color coding)
 *   - provide no collector benefit (the collector is configured to suit the source)
 *   - diverge from the bunyan convention that pino intentionally follows
 *
 * Verdict: `{level: <number>, time: <epoch ms>, msg: "..."}` is the standard here.
 */
export function createPinoLogger(
  options: CreatePinoLoggerOptions,
): CreatePinoLoggerResult {
  const pinoOptions: pino.LoggerOptions = {
    level: options.level,
    mixin: otelMixin,
    serializers: {
      err: (value: unknown) => errorContext(value),
      cause: (value: unknown) => errorContext(value),
    },
  };

  let pinoInstance: Logger;
  if (options.destination) {
    pinoInstance = pino(pinoOptions, options.destination);
  } else if (options.pretty) {
    pinoInstance = pino({
      ...pinoOptions,
      transport: { target: "pino-pretty" },
    });
  } else {
    pinoInstance = pino(pinoOptions);
  }

  return {
    logger: new PinoLogger(pinoInstance),
    pino: pinoInstance,
  };
}
