import type { Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { Span } from "@opentelemetry/sdk-trace-base";
import type { Attributes } from "@opentelemetry/api";

/**
 * Translates AI SDK's `ai.*` span attributes to OpenTelemetry `gen_ai.*`
 * semantic convention equivalents.
 *
 * Registered before the BatchSpanProcessor in NodeSDK so attribute writes
 * happen prior to export.
 *
 * TODO(#3): bridge ai.toolCall args/result → gen_ai.tool.call.arguments/result
 * TODO(#4): bridge ai.generateText.doGenerate → gen_ai.operation.name=chat
 * TODO(#5): bridge ai.prompt.messages / ai.response.* → gen_ai.input/output.messages
 */
export class GenAiBridgeSpanProcessor implements SpanProcessor {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStart(_span: Span, _parentContext: Context): void {
    // no-op: attribute translation is done at span end
  }

  onEnd(span: ReadableSpan): void {
    translateToolCallSpan(span);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Detects `ai.toolCall` spans and maps AI SDK attributes to gen_ai.*
 * semantic conventions (gen_ai-tool-calls semconv).
 */
function translateToolCallSpan(span: ReadableSpan): void {
  const attrs = span.attributes;

  const isToolCall =
    span.name === "ai.toolCall" || attrs["ai.toolCall.name"] != null;

  if (!isToolCall) return;

  // We mutate `span.attributes` directly because `SpanImpl.setAttribute`
  // guards against writes after `_ended` is true — which is always the case
  // inside `onEnd`. The underlying `attributes` object is a plain mutable map;
  // direct assignment is the only safe mutation path available at this hook.
  const mutableAttrs = attrs as Attributes;

  setIfAbsent(mutableAttrs, "gen_ai.operation.name", "execute_tool");

  const toolName = attrs["ai.toolCall.name"];
  if (toolName != null) {
    setIfAbsent(mutableAttrs, "gen_ai.tool.name", toolName);
  }

  const toolCallId = attrs["ai.toolCall.id"];
  if (toolCallId != null) {
    setIfAbsent(mutableAttrs, "gen_ai.tool.call.id", toolCallId);
  }

  // AI SDK tools are always function-type per the AI SDK tool model.
  setIfAbsent(mutableAttrs, "gen_ai.tool.type", "function");
}

/** Writes `value` to `attrs[key]` only when the key is not already present. */
function setIfAbsent(
  attrs: Attributes,
  key: string,
  value: NonNullable<Attributes[string]>,
): void {
  if (!Object.prototype.hasOwnProperty.call(attrs, key)) {
    (attrs as Record<string, unknown>)[key] = value;
  }
}
