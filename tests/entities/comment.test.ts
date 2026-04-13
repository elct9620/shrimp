import { describe, expect, it } from "vitest";
import { COMMENT_TAG, isTagged, stripTag } from "../../src/entities/comment";

describe("isTagged", () => {
  it("returns true for text starting with the comment tag", () => {
    expect(isTagged(`${COMMENT_TAG}hello`)).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isTagged("hello world")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isTagged("")).toBe(false);
  });

  it("returns false for partial prefix match", () => {
    expect(isTagged("[Shrimp]no-space")).toBe(false);
  });

  it("returns true for tag-only text with no content after it", () => {
    expect(isTagged(COMMENT_TAG)).toBe(true);
  });
});

describe("stripTag", () => {
  it("removes the comment tag prefix", () => {
    expect(stripTag(`${COMMENT_TAG}hello`)).toBe("hello");
  });

  it("returns empty string when input is exactly the tag", () => {
    expect(stripTag(COMMENT_TAG)).toBe("");
  });
});
