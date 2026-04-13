import pino, { type Logger, type DestinationStream } from "pino";
import type { LogLevel } from "../config/env-config";
import type { LoggerPort } from "../../use-cases/ports/logger";

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

export function createPinoLogger(
  options: CreatePinoLoggerOptions,
): CreatePinoLoggerResult {
  const pinoOptions: pino.LoggerOptions = { level: options.level };

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
