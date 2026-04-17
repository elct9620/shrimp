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
    translateChatMessages(span);
    translateChatTools(span);
    renameToCanonicalForm(span);
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

// ---------------------------------------------------------------------------
// Structured message translation (item #5)
// ---------------------------------------------------------------------------

/** A single content part in an AI SDK message content array. */
interface AiSdkPart {
  type: string;
  // text parts
  text?: unknown;
  // tool-call parts
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  // tool-result parts
  output?: unknown;
}

/** An AI SDK message as found in ai.prompt.messages. */
interface AiSdkMessage {
  role?: unknown;
  content?: unknown;
}

/** A gen_ai text part. */
interface GenAiTextPart {
  type: "text";
  content: string;
}

/** A gen_ai tool_call part. */
interface GenAiToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  arguments: unknown;
}

/** A gen_ai tool_call_response part. */
interface GenAiToolCallResponsePart {
  type: "tool_call_response";
  id: string;
  response: unknown;
}

type GenAiPart = GenAiTextPart | GenAiToolCallPart | GenAiToolCallResponsePart;

interface GenAiMessage {
  role: string;
  parts: GenAiPart[];
}

/**
 * Maps a single AI SDK message content part to the gen_ai equivalent.
 * Returns `null` for part types that have no gen_ai mapping (e.g. reasoning,
 * file) — callers must drop null values silently.
 */
function mapAiSdkPart(part: AiSdkPart): GenAiPart | null {
  switch (part.type) {
    case "text":
      return { type: "text", content: String(part.text ?? "") };
    case "tool-call":
      return {
        type: "tool_call",
        id: String(part.toolCallId ?? ""),
        name: String(part.toolName ?? ""),
        arguments: part.input,
      };
    case "tool-result":
      return {
        type: "tool_call_response",
        id: String(part.toolCallId ?? ""),
        response: part.output,
      };
    default:
      // reasoning, file, and any future unknown types — drop silently
      return null;
  }
}

/**
 * Converts the AI SDK `ai.prompt.messages` array to the gen_ai input messages
 * format. Pure function — no span dependency.
 *
 * - String content → single text part.
 * - Array content → mapped via mapAiSdkPart; null results dropped.
 * - Messages that produce zero parts after mapping are dropped entirely
 *   (e.g. reasoning-only messages).
 */
export function toGenAiInputMessages(aiMessages: unknown[]): GenAiMessage[] {
  const result: GenAiMessage[] = [];

  for (const msg of aiMessages) {
    if (msg == null || typeof msg !== "object") continue;
    const { role, content } = msg as AiSdkMessage;
    if (typeof role !== "string") continue;

    let parts: GenAiPart[];

    if (typeof content === "string") {
      parts = [{ type: "text", content }];
    } else if (Array.isArray(content)) {
      parts = (content as AiSdkPart[])
        .map(mapAiSdkPart)
        .filter((p): p is GenAiPart => p !== null);
    } else {
      // Unexpected content shape — skip the message
      continue;
    }

    // Drop messages that become empty after part mapping
    if (parts.length === 0) continue;

    result.push({ role, parts });
  }

  return result;
}

/**
 * Builds the gen_ai output messages array from AI SDK response attributes.
 * Pure function — no span dependency.
 *
 * Returns an array with ONE assistant message containing:
 * - A text part when `text` is a non-empty string.
 * - Tool call parts for each entry in `toolCalls`.
 *
 * Returns an empty array when both inputs are absent/empty — callers must
 * skip setting `gen_ai.output.messages` in that case.
 */
export function toGenAiOutputMessages(
  text: unknown,
  toolCalls: unknown[],
): GenAiMessage[] {
  const parts: GenAiPart[] = [];

  if (typeof text === "string" && text.length > 0) {
    parts.push({ type: "text", content: text });
  }

  for (const tc of toolCalls) {
    if (tc == null || typeof tc !== "object") continue;
    const { toolCallId, toolName, input } = tc as {
      toolCallId?: unknown;
      toolName?: unknown;
      input?: unknown;
    };
    parts.push({
      type: "tool_call",
      id: String(toolCallId ?? ""),
      name: String(toolName ?? ""),
      arguments: input,
    });
  }

  if (parts.length === 0) return [];
  return [{ role: "assistant", parts }];
}

/**
 * Bridges `ai.prompt.messages`, `ai.response.text`, and
 * `ai.response.toolCalls` into structured `gen_ai.input.messages` /
 * `gen_ai.output.messages` attributes on LLM-call chat spans.
 *
 * Gating:
 * - Only runs on chat spans (reuses isChatSpan guard).
 * - Input messages: skipped when `ai.prompt.messages` is absent (recordInputs=false).
 * - Output messages: skipped when both response attrs are absent (recordOutputs=false).
 * - Uses setIfAbsent so pre-existing gen_ai.* attrs are never overwritten.
 * - JSON parse errors are caught and silently ignored — telemetry must not crash.
 */
function translateChatMessages(span: ReadableSpan): void {
  if (!isChatSpan(span)) return;

  const attrs = span.attributes;
  const mutableAttrs = attrs as Attributes;

  // --- input messages ---
  const rawPrompt = attrs["ai.prompt.messages"];
  if (rawPrompt != null) {
    try {
      const parsed: unknown = JSON.parse(String(rawPrompt));
      if (Array.isArray(parsed)) {
        const inputMessages = toGenAiInputMessages(parsed);
        setIfAbsent(
          mutableAttrs,
          "gen_ai.input.messages",
          JSON.stringify(inputMessages),
        );
      }
    } catch {
      // Malformed JSON — skip silently
    }
  }

  // --- output messages ---
  const rawText = attrs["ai.response.text"];
  const rawToolCalls = attrs["ai.response.toolCalls"];

  if (rawText == null && rawToolCalls == null) return;

  let toolCallsArray: unknown[] = [];
  if (rawToolCalls != null) {
    try {
      const parsed: unknown = JSON.parse(String(rawToolCalls));
      if (Array.isArray(parsed)) {
        toolCallsArray = parsed;
      }
    } catch {
      // Malformed JSON — skip silently; build output from text only
    }
  }

  const outputMessages = toGenAiOutputMessages(rawText, toolCallsArray);
  if (outputMessages.length > 0) {
    setIfAbsent(
      mutableAttrs,
      "gen_ai.output.messages",
      JSON.stringify(outputMessages),
    );
  }
}

// ---------------------------------------------------------------------------
// Span name canonicalization (item #14)
// ---------------------------------------------------------------------------

/**
 * Rewrites AI SDK span names to the OTel gen_ai semconv SHOULD form:
 *   chat spans   → `chat {gen_ai.request.model}`
 *   tool-call spans → `execute_tool {gen_ai.tool.name}`
 *
 * WHY direct `name` assignment: `ReadableSpan.name` is `readonly` in the
 * TypeScript interface, but `SpanImpl.name` is a plain public field at runtime
 * (node_modules/@opentelemetry/sdk-trace-base/build/src/Span.d.ts line 42).
 * `SpanImpl.updateName()` guards against writes after `_ended` is true (Span.js
 * line 241), making it a silent no-op inside `onEnd` — the same constraint as
 * `setAttribute`. Direct assignment via cast is the only viable mutation path,
 * using the same pattern already applied to `span.attributes` elsewhere in this
 * file.
 *
 * Foreign-span guard: only rewrites spans whose name starts with `ai.` — spans
 * from other libraries are left untouched.
 */
function renameToCanonicalForm(span: ReadableSpan): void {
  // Protect non-AI-SDK spans from accidental renaming.
  if (!span.name.startsWith("ai.")) return;

  const attrs = span.attributes;
  const mutable = span as unknown as { name: string };

  if (isChatSpan(span)) {
    const model = attrs["gen_ai.request.model"];
    if (model != null) {
      mutable.name = `chat ${String(model)}`;
    }
    return;
  }

  if (isToolCallSpan(span)) {
    // gen_ai.tool.name is written by translateToolCallSpan before this runs.
    const toolName = attrs["gen_ai.tool.name"];
    if (toolName != null) {
      mutable.name = `execute_tool ${String(toolName)}`;
    }
  }
}

/**
 * Bridges `ai.prompt.tools` (AI SDK JSON-stringified tool definitions) into
 * `gen_ai.tool.definitions` on LLM-call chat spans.
 *
 * WHY Option A (pass-through verbatim): AI SDK emits `ai.prompt.tools` as a
 * `string[]` — each element is already a JSON-stringified tool definition
 * (node_modules/ai/dist/index.mjs lines 4307–4310). The OTel attribute value
 * is therefore already a `string[]` with no further transformation required.
 * Passing through verbatim (Option A) is lossless and avoids an unnecessary
 * parse+re-stringify round-trip. Downstream consumers decode per element.
 *
 * Gating:
 * - Only runs on chat spans (reuses isChatSpan guard).
 * - Skipped when `ai.prompt.tools` is absent — no invented defaults.
 * - Uses setIfAbsent so pre-existing `gen_ai.tool.definitions` is preserved.
 */
function translateChatTools(span: ReadableSpan): void {
  if (!isChatSpan(span)) return;

  const tools = span.attributes["ai.prompt.tools"];
  if (tools == null) return;

  setIfAbsent(span.attributes as Attributes, "gen_ai.tool.definitions", tools);
}
