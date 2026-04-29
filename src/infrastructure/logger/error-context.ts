const MAX_DEPTH = 5;

export type ErrorContext = {
  name: string;
  message: string;
  code?: string | number;
  errno?: number;
  syscall?: string;
  address?: string;
  port?: number;
  cause?: ErrorContext;
  errors?: ErrorContext[];
};

/**
 * Serialize an unknown error value into a plain object that preserves the
 * full `err.cause` chain plus `AggregateError.errors[]`. Safe to call with
 * any input — it never throws.
 *
 * Recursion is capped at depth 5 to handle circular-cause references.
 *
 * AggregateError sub-errors are expanded because fetch failures (e.g. from
 * connection-level errors) surface real diagnostics (per-IP
 * `syscall`/`address`/`port`/`code`) only inside `.errors[]`; the wrapper's
 * `message` is empty.
 */
export function errorContext(err: unknown, depth = 0): ErrorContext {
  if (!(err instanceof Error)) {
    return { name: "NonError", message: String(err) };
  }

  const result: ErrorContext = {
    name: err.name,
    message: err.message,
  };

  const raw = err as {
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
    address?: unknown;
    port?: unknown;
  };
  if (typeof raw.code === "string" || typeof raw.code === "number") {
    result.code = raw.code;
  }
  if (typeof raw.errno === "number") result.errno = raw.errno;
  if (typeof raw.syscall === "string") result.syscall = raw.syscall;
  if (typeof raw.address === "string") result.address = raw.address;
  if (typeof raw.port === "number") result.port = raw.port;

  if (depth < MAX_DEPTH - 1) {
    let cause: unknown;
    try {
      cause = err.cause;
    } catch {
      // Some fetch implementations construct causes lazily via getters that
      // may throw. Treat a throwing getter as "no cause".
      cause = undefined;
    }

    if (cause !== undefined) {
      result.cause = errorContext(cause, depth + 1);
    }

    const errors = (err as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      result.errors = errors.map((e) => errorContext(e, depth + 1));
    }
  }

  return result;
}
