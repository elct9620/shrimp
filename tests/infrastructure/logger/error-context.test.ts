import { describe, expect, it } from "vitest";
import { errorContext } from "../../../src/infrastructure/logger/error-context";

describe("errorContext", () => {
  describe("plain Error", () => {
    it("returns name and message for a plain Error", () => {
      // Arrange
      const err = new Error("something went wrong");

      // Act
      const result = errorContext(err);

      // Assert
      expect(result).toEqual({
        name: "Error",
        message: "something went wrong",
      });
    });
  });

  describe("Error subclass with code", () => {
    it("includes code when the error has a string or numeric code property", () => {
      // Arrange
      const err = new TypeError("bad type") as TypeError & { code: string };
      err.code = "ERR_BAD_TYPE";

      // Act
      const result = errorContext(err);

      // Assert
      expect(result).toMatchObject({
        name: "TypeError",
        message: "bad type",
        code: "ERR_BAD_TYPE",
      });
    });

    it("includes a numeric code", () => {
      // Arrange
      const err = new Error("status error") as Error & { code: number };
      err.code = 404;

      // Act
      const result = errorContext(err);

      // Assert
      expect(result).toMatchObject({ code: 404 });
    });
  });

  describe("Error with cause", () => {
    it("recursively serializes a single cause", () => {
      // Arrange
      const cause = new Error("root cause");
      const err = new Error("wrapper", { cause });

      // Act
      const result = errorContext(err);

      // Assert
      expect(result).toEqual({
        name: "Error",
        message: "wrapper",
        cause: { name: "Error", message: "root cause" },
      });
    });

    it("recursively serializes three levels of nested causes", () => {
      // Arrange
      const level3 = new Error("level 3");
      const level2 = new Error("level 2", { cause: level3 });
      const level1 = new Error("level 1", { cause: level2 });

      // Act
      const result = errorContext(level1);

      // Assert
      expect(result.message).toBe("level 1");
      expect(result.cause?.message).toBe("level 2");
      expect(result.cause?.cause?.message).toBe("level 3");
      expect(result.cause?.cause?.cause).toBeUndefined();
    });
  });

  describe("depth cap", () => {
    it("omits the 6th-level cause to prevent unbounded recursion", () => {
      // Arrange — build a 6-level chain (indices 0–5)
      let deepest = new Error("level 6");
      for (let i = 5; i >= 1; i--) {
        deepest = new Error(`level ${i}`, { cause: deepest });
      }

      // Act
      const result = errorContext(deepest);

      // Assert — follow the chain; level 6 (depth 5) should be absent
      const l1 = result;
      const l2 = l1.cause!;
      const l3 = l2.cause!;
      const l4 = l3.cause!;
      const l5 = l4.cause!;

      expect(l1.message).toBe("level 1");
      expect(l2.message).toBe("level 2");
      expect(l3.message).toBe("level 3");
      expect(l4.message).toBe("level 4");
      expect(l5.message).toBe("level 5");
      expect(l5.cause).toBeUndefined();
    });
  });

  describe("cycle protection", () => {
    it("terminates without throwing when cause points back to itself", () => {
      // Arrange — manually create a circular cause reference
      const err = new Error("cyclic") as Error & { cause: Error };
      err.cause = err;

      // Act & Assert — must not throw or recurse infinitely
      expect(() => errorContext(err)).not.toThrow();

      const result = errorContext(err);
      expect(result.name).toBe("Error");
      expect(result.message).toBe("cyclic");
    });
  });

  describe("non-Error inputs", () => {
    it.each([
      ["a string", "hello", "hello"],
      ["a number", 42, "42"],
      ["null", null, "null"],
      ["undefined", undefined, "undefined"],
      ["a plain object", { foo: "bar" }, "[object Object]"],
    ] as const)(
      "returns NonError with String(%s) as message for %s",
      (_label, input, expectedMessage) => {
        // Act
        const result = errorContext(input);

        // Assert
        expect(result).toEqual({ name: "NonError", message: expectedMessage });
      },
    );
  });

  describe("cause getter throws", () => {
    it("does not propagate the getter error and treats cause as absent", () => {
      // Arrange — simulate undici-style lazy getter that throws
      const err = new Error("fetch failed");
      Object.defineProperty(err, "cause", {
        get() {
          throw new Error("getter exploded");
        },
        configurable: true,
      });

      // Act & Assert
      expect(() => errorContext(err)).not.toThrow();

      const result = errorContext(err);
      expect(result).toEqual({ name: "Error", message: "fetch failed" });
      expect(result.cause).toBeUndefined();
    });
  });
});
