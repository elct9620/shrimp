import { describe, expect, it } from "vitest";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ROOT_CONTEXT } from "@opentelemetry/api";
import { GenAiBridgeSpanProcessor } from "../../../src/infrastructure/telemetry/gen-ai-bridge-span-processor";

function makeFakeSpan(overrides?: Partial<ReadableSpan>): ReadableSpan {
  return {
    name: "test.span",
    kind: 0,
    spanContext: () => ({
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      traceFlags: 1,
    }),
    startTime: [0, 0],
    endTime: [0, 0],
    status: { code: 0 },
    attributes: {},
    links: [],
    events: [],
    duration: [0, 0],
    ended: true,
    resource: {} as ReadableSpan["resource"],
    instrumentationScope: { name: "test" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  } as unknown as ReadableSpan;
}

describe("GenAiBridgeSpanProcessor", () => {
  it("should instantiate without error", () => {
    expect(() => new GenAiBridgeSpanProcessor()).not.toThrow();
  });

  it("onStart should be a no-op and not throw", () => {
    const processor = new GenAiBridgeSpanProcessor();
    const fakeSpan = makeFakeSpan();
    expect(() =>
      processor.onStart(
        fakeSpan as unknown as Parameters<typeof processor.onStart>[0],
        ROOT_CONTEXT,
      ),
    ).not.toThrow();
  });

  it("onEnd should not throw with a minimal fake ReadableSpan", () => {
    const processor = new GenAiBridgeSpanProcessor();
    const span = makeFakeSpan();
    expect(() => processor.onEnd(span)).not.toThrow();
  });

  it("onEnd should not mutate span attributes (no mappings yet)", () => {
    const processor = new GenAiBridgeSpanProcessor();
    const span = makeFakeSpan({
      attributes: { "ai.toolCall.name": "my_tool" },
    });
    const attrsBefore = { ...span.attributes };
    processor.onEnd(span);
    expect(span.attributes).toEqual(attrsBefore);
  });

  it("shutdown should resolve", async () => {
    const processor = new GenAiBridgeSpanProcessor();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });

  it("forceFlush should resolve", async () => {
    const processor = new GenAiBridgeSpanProcessor();
    await expect(processor.forceFlush()).resolves.toBeUndefined();
  });
});
