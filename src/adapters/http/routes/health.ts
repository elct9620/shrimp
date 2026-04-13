import { Hono } from "hono";
import type { AppEnv } from "../context-variables";

export function createHealthRoute(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}
