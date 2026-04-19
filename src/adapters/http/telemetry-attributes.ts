import type { Context } from "hono";
import type { SpanAttributes } from "../../use-cases/ports/telemetry";

/**
 * Collect OpenTelemetry HTTP semantic convention attributes from a Hono
 * request context. Returned attributes are stamped on the Job Worker root
 * span so operators can filter traces in the observability backend.
 */
export function collectHttpSpanAttributes(
  c: Context,
  route: string,
): SpanAttributes {
  const attributes: SpanAttributes = {
    "http.request.method": c.req.method,
    "http.route": route,
    "url.path": c.req.path,
  };

  const userAgent = c.req.header("user-agent");
  if (userAgent) attributes["user_agent.original"] = userAgent;

  const contentLength = c.req.header("content-length");
  if (contentLength !== undefined) {
    const size = Number(contentLength);
    if (Number.isFinite(size)) {
      attributes["http.request.body.size"] = size;
    }
  }

  return attributes;
}
