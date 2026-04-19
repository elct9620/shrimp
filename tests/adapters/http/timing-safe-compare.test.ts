import { describe, expect, it } from "vitest";
import { timingSafeEqualStr } from "../../../src/adapters/http/timing-safe-compare";

describe("timingSafeEqualStr", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualStr("s3cret", "s3cret")).toBe(true);
  });

  it("returns false when values differ at equal length", () => {
    expect(timingSafeEqualStr("abcdef", "abcxyz")).toBe(false);
  });

  it("returns false when lengths differ (without throwing)", () => {
    expect(timingSafeEqualStr("short", "shorter-token")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeEqualStr("", "")).toBe(true);
  });
});
