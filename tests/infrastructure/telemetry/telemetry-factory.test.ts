import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TelemetryPort } from "../../../src/use-cases/ports/telemetry";
import type { EnvConfig } from "../../../src/infrastructure/config/env-config";
import { makeFakeLogger } from "../../mocks/fake-logger";
import { NoopTelemetry } from "../../../src/infrastructure/telemetry/noop-telemetry";

// Captured spy so we can assert on constructor calls.
const MockOtelTelemetry = vi.fn(function (this: Record<string, unknown>) {
  this.tracer = {};
  this.runInSpan = vi
    .fn()
    .mockImplementation(
      async (
        _name: string,
        fn: () => Promise<unknown>,
        _attributes?: Record<string, string | number | boolean>,
      ) => fn(),
    );
  this.shutdown = vi.fn().mockResolvedValue(undefined);
});

vi.mock("../../../src/infrastructure/telemetry/otel-telemetry", () => ({
  OtelTelemetry: MockOtelTelemetry,
}));

// Import after mock so the mocked version is used
const { createTelemetry } =
  await import("../../../src/infrastructure/telemetry/telemetry-factory");
const { OtelTelemetry } =
  await import("../../../src/infrastructure/telemetry/otel-telemetry");

const BASE_ENV: EnvConfig = {
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiApiKey: "sk-test",
  aiModel: "gpt-4o",
  aiMaxSteps: 50,
  aiReasoningEffort: undefined,
  todoistApiToken: "todoist-token",
  todoistProjectId: "project-123",
  port: 3000,
  logLevel: "info",
  telemetryEnabled: false,
  telemetryRecordInputs: true,
  telemetryRecordOutputs: true,
  otelServiceName: undefined,
  otelExporterOtlpEndpoint: undefined,
  otelExporterOtlpHeaders: undefined,
  channelsEnabled: false,
  telegramBotToken: undefined,
  telegramWebhookSecret: undefined,
  shrimpHome: "/tmp/.shrimp",
};

describe("createTelemetry", () => {
  beforeEach(() => {
    vi.mocked(OtelTelemetry).mockClear();
  });

  it("returns a NoopTelemetry instance when telemetryEnabled is false", () => {
    const logger = makeFakeLogger();
    const env: EnvConfig = { ...BASE_ENV, telemetryEnabled: false };

    const { telemetry, tracer } = createTelemetry(env, logger);

    expect(telemetry).toBeInstanceOf(NoopTelemetry);
    expect(tracer).toBeDefined();
  });

  it("returns an OtelTelemetry instance when telemetryEnabled is true and required fields are present", () => {
    const logger = makeFakeLogger();
    const env: EnvConfig = {
      ...BASE_ENV,
      telemetryEnabled: true,
      otelServiceName: "my-service",
      otelExporterOtlpEndpoint: "http://otel:4318",
    };

    const { telemetry, tracer } = createTelemetry(env, logger);

    expect(telemetry).toBeInstanceOf(OtelTelemetry);
    expect(tracer).toBeDefined();
  });

  it("passes correct OtelTelemetryOptions to OtelTelemetry constructor", () => {
    const logger = makeFakeLogger();
    const env: EnvConfig = {
      ...BASE_ENV,
      telemetryEnabled: true,
      otelServiceName: "shrimp-service",
      otelExporterOtlpEndpoint: "http://otel:4318",
      otelExporterOtlpHeaders: "Authorization=Bearer token123",
      telemetryRecordInputs: false,
      telemetryRecordOutputs: false,
    };

    createTelemetry(env, logger);

    // OTEL_EXPORTER_OTLP_* env vars are pass-through to the OTel SDK
    // (SPEC §Telemetry); they are intentionally NOT forwarded into the adapter.
    expect(OtelTelemetry).toHaveBeenCalledOnce();
    expect(OtelTelemetry).toHaveBeenCalledWith({
      serviceName: "shrimp-service",
      logger,
    });
  });

  it("always satisfies TelemetryPort interface", () => {
    const logger = makeFakeLogger();
    const env: EnvConfig = { ...BASE_ENV, telemetryEnabled: false };

    // TypeScript compile-time assertion: TelemetryPort is satisfied
    const t: TelemetryPort = createTelemetry(env, logger).telemetry;

    expect(t).toBeDefined();
  });
});
