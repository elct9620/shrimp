import { describe, expect, it } from "vitest";
import { Priority, comparePriority } from "../../src/entities/priority";

describe("Priority", () => {
  it("has p1 value", () => {
    expect(Priority.p1).toBe(1);
  });

  it("has p2 value", () => {
    expect(Priority.p2).toBe(2);
  });

  it("has p3 value", () => {
    expect(Priority.p3).toBe(3);
  });

  it("has p4 value", () => {
    expect(Priority.p4).toBe(4);
  });
});

describe("comparePriority", () => {
  it("returns negative when a is higher priority than b (p1 > p2)", () => {
    expect(comparePriority(Priority.p1, Priority.p2)).toBeLessThan(0);
  });

  it("returns positive when a is lower priority than b (p3 < p2)", () => {
    expect(comparePriority(Priority.p3, Priority.p2)).toBeGreaterThan(0);
  });

  it("returns zero when priorities are equal", () => {
    expect(comparePriority(Priority.p2, Priority.p2)).toBe(0);
  });

  it("orders p1 highest among all priorities", () => {
    const priorities = [Priority.p4, Priority.p2, Priority.p3, Priority.p1];
    const sorted = [...priorities].sort(comparePriority);
    expect(sorted).toEqual([
      Priority.p1,
      Priority.p2,
      Priority.p3,
      Priority.p4,
    ]);
  });

  it("produces a stable sort when all priorities are the same value", () => {
    const priorities = [Priority.p3, Priority.p3, Priority.p3];
    const sorted = [...priorities].sort(comparePriority);
    expect(sorted).toEqual([Priority.p3, Priority.p3, Priority.p3]);
  });

  it("sorts a single-element array unchanged", () => {
    const sorted = [Priority.p2].sort(comparePriority);
    expect(sorted).toEqual([Priority.p2]);
  });

  it("accepts raw numeric values that coincide with Priority members at runtime", () => {
    // Priority is a plain const object; the comparator is `a - b` with no
    // runtime guard. Passing a numeric literal that matches a member value
    // behaves identically — this documents the current runtime contract.
    expect(comparePriority(1 as Priority, 4 as Priority)).toBe(-3);
  });
});
