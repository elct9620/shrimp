const MAX_DEPTH = 5;

export type ErrorContext = {
  name: string;
  message: string;
  code?: string | number;
  cause?: ErrorContext;
};

/**
 * Serialize an unknown error value into a plain object that preserves the
 * full `err.cause` chain. Safe to call with any input — it never throws.
 *
 * Recursion is capped at depth 5 to handle circular-cause references.
 *
 * Note: AggregateError's `errors[]` array is intentionally not serialized;
 * `message` carries the summary string, which is sufficient for log context.
 * Callers that need the individual sub-errors should handle them separately.
 */
export function errorContext(err: unknown, depth = 0): ErrorContext {
  if (!(err instanceof Error)) {
    return { name: "NonError", message: String(err) };
  }

  const result: ErrorContext = {
    name: err.name,
    message: err.message,
  };

  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") {
    result.code = code;
  }

  if (depth < MAX_DEPTH - 1) {
    let cause: unknown;
    try {
      cause = err.cause;
    } catch {
      // Some environments (e.g. undici) construct causes lazily via getters
      // that may throw. Treat a throwing getter as "no cause".
      cause = undefined;
    }

    if (cause !== undefined) {
      result.cause = errorContext(cause, depth + 1);
    }
  }

  return result;
}
