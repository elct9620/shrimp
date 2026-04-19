import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { collectHttpSpanAttributes } from "../../../src/adapters/http/telemetry-attributes";

async function runRoute(
  handler: (capture: (attrs: unknown) => void) => Hono,
  init: RequestInit = {},
  path = "/target",
) {
  let captured: unknown;
  const app = handler((v) => {
    captured = v;
  });
  await app.request(path, { method: "POST", ...init });
  return captured;
}

describe("collectHttpSpanAttributes", () => {
  it("returns OTel HTTP semconv attributes from a Hono request", async () => {
    const captured = await runRoute((capture) => {
      const app = new Hono();
      app.post("/target", (c) => {
        capture(collectHttpSpanAttributes(c, "/target"));
        return c.body(null, 202);
      });
      return app;
    });

    expect(captured).toMatchObject({
      "http.request.method": "POST",
      "http.route": "/target",
      "url.path": "/target",
    });
  });

  it("records user-agent and content-length when the headers are present", async () => {
    const body = JSON.stringify({ hi: true });
    const captured = (await runRoute(
      (capture) => {
        const app = new Hono();
        app.post("/target", (c) => {
          capture(collectHttpSpanAttributes(c, "/target"));
          return c.body(null, 202);
        });
        return app;
      },
      {
        headers: {
          "User-Agent": "TelegramBot",
          "Content-Type": "application/json",
          "Content-Length": String(body.length),
        },
        body,
      },
    )) as Record<string, unknown>;

    expect(captured["user_agent.original"]).toBe("TelegramBot");
    expect(captured["http.request.body.size"]).toBe(body.length);
  });

  it("omits optional attributes when the headers are absent", async () => {
    const captured = (await runRoute((capture) => {
      const app = new Hono();
      app.post("/target", (c) => {
        capture(collectHttpSpanAttributes(c, "/target"));
        return c.body(null, 202);
      });
      return app;
    })) as Record<string, unknown>;

    expect(captured["user_agent.original"]).toBeUndefined();
    expect(captured["http.request.body.size"]).toBeUndefined();
  });
});
