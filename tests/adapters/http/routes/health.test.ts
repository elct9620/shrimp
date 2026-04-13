import { describe, expect, it } from "vitest";
import { createHealthRoute } from "../../../../src/adapters/http/routes/health";

describe("GET /health", () => {
  it("should return 200 with ok status when service is running", async () => {
    const app = createHealthRoute();
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
