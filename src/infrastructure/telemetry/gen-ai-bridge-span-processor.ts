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
 * TODO(#5): bridge ai.prompt.messages / ai.response.* → gen_ai.input/output.messages
 */
export class GenAiBridgeSpanProcessor implements SpanProcessor {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStart(_span: Span, _parentContext: Context): void {
    // no-op: attribute translation is done at span end
  }

  onEnd(span: ReadableSpan): void {
    const toolCall = isToolCallSpan(span);
    translateToolCallSpan(span, toolCall);
    translateToolCallArgsResult(span, toolCall);
    translateChatSpan(span);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Returns true when the span represents an `ai.toolCall` execution.
 * Shared guard used by both tool-call translators to avoid recomputing.
 */
function isToolCallSpan(span: ReadableSpan): boolean {
  return (
    span.name === "ai.toolCall" || span.attributes["ai.toolCall.name"] != null
  );
}

/**
 * Maps identity attrs (operation, tool name/id, type) for `ai.toolCall` spans.
 */
function translateToolCallSpan(span: ReadableSpan, toolCall: boolean): void {
  if (!toolCall) return;

  const attrs = span.attributes;

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

/**
 * Maps args and result for `ai.toolCall` spans.
 *
 * WHY string pass-through: AI SDK serializes both `ai.toolCall.args` and
 * `ai.toolCall.result` via `JSON.stringify` before setting them as OTel
 * attributes (node_modules/ai/dist/index.mjs lines 2801-2803, 2871-2873).
 * OTel attribute values are primitives, so the values are always strings here;
 * no re-serialization needed.
 *
 * Gating: AI SDK gates both attrs on `recordOutputs` (both use the `output`
 * callback shape). If either attr is absent, the bridge must NOT invent a
 * default — simply skip it.
 */
function translateToolCallArgsResult(
  span: ReadableSpan,
  toolCall: boolean,
): void {
  if (!toolCall) return;

  const attrs = span.attributes;
  const mutableAttrs = attrs as Attributes;

  const args = attrs["ai.toolCall.args"];
  if (args != null) {
    setIfAbsent(mutableAttrs, "gen_ai.tool.call.arguments", args);
  }

  const result = attrs["ai.toolCall.result"];
  if (result != null) {
    setIfAbsent(mutableAttrs, "gen_ai.tool.call.result", result);
  }
}

/**
 * LLM-call span names where AI SDK sets `gen_ai.system` and issues the actual
 * model request. These are the inner spans, distinct from the orchestration
 * wrappers (`ai.generateText`, `ai.streamText`) which do NOT carry gen_ai.system.
 *
 * Source: node_modules/ai/dist/index.mjs lines 4291, 7164.
 */
const CHAT_SPAN_NAMES = new Set([
  "ai.generateText.doGenerate",
  "ai.streamText.doStream",
]);

/**
 * Returns true when the span is an actual LLM chat-completion call issued by
 * AI SDK. Orchestration wrappers and tool-call spans return false.
 */
function isChatSpan(span: ReadableSpan): boolean {
  return CHAT_SPAN_NAMES.has(span.name);
}

/**
 * Adds `gen_ai.operation.name=chat` and mirrors `gen_ai.system` into
 * `gen_ai.provider.name` on AI SDK LLM-call spans.
 *
 * WHY only two attrs: AI SDK already sets all other gen_ai.request.* and
 * gen_ai.response.* attrs on these spans; the bridge must not duplicate or
 * overwrite them. Only `operation.name` (required by semconv) and
 * `provider.name` (alias for `gen_ai.system` per newer semconv) are missing.
 *
 * `gen_ai.provider.name` is best-effort: skipped when `gen_ai.system` is
 * absent (e.g., AI SDK emitted the span without a provider attr).
 */
function translateChatSpan(span: ReadableSpan): void {
  if (!isChatSpan(span)) return;

  const attrs = span.attributes;
  const mutableAttrs = attrs as Attributes;

  setIfAbsent(mutableAttrs, "gen_ai.operation.name", "chat");

  const system = attrs["gen_ai.system"];
  if (system != null) {
    setIfAbsent(mutableAttrs, "gen_ai.provider.name", system);
  }
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
