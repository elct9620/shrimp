/**
 * Structured logger port. Each method accepts an optional `context` object
 * (`Record<string, unknown>`) as its second argument.
 *
 * **Error-field convention** — always pass Error values under the `err` key:
 *
 * ```ts
 * logger.warn("something failed", { err });
 * ```
 *
 * The pino serializer (wired in `infrastructure/logger/pino-logger.ts`) will
 * automatically serialize any value stored at `err` through `errorContext`
 * (`infrastructure/logger/error-context.ts`), preserving the full `err.cause`
 * chain up to depth 5.
 *
 * The `cause` key is also serialized for transitional compatibility, but new
 * code must use `err`. Ad-hoc keys such as `error: err.message` are legacy.
 */
export interface LoggerPort {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  /** Log a warning. Pass Error values as `{ err }` — see interface jsdoc. */
  warn(message: string, context?: Record<string, unknown>): void;
  /** Log an error. Pass Error values as `{ err }` — see interface jsdoc. */
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): LoggerPort;
}
