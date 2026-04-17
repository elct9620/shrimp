import type { Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { Span } from "@opentelemetry/sdk-trace-base";

/**
 * Translates AI SDK's `ai.*` span attributes to OpenTelemetry `gen_ai.*`
 * semantic convention equivalents.
 *
 * Registered before the BatchSpanProcessor in NodeSDK so attribute writes
 * happen prior to export.
 *
 * TODO(#2): bridge ai.toolCall → gen_ai.operation.name, gen_ai.tool.*
 * TODO(#3): bridge ai.toolCall args/result → gen_ai.tool.call.arguments/result
 * TODO(#4): bridge ai.generateText.doGenerate → gen_ai.operation.name=chat
 * TODO(#5): bridge ai.prompt.messages / ai.response.* → gen_ai.input/output.messages
 */
export class GenAiBridgeSpanProcessor implements SpanProcessor {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStart(_span: Span, _parentContext: Context): void {
    // no-op: attribute translation is done at span end
  }

  onEnd(_span: ReadableSpan): void {
    // TODO: items #2–#5 will fill in ai.* → gen_ai.* attribute mappings here
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
