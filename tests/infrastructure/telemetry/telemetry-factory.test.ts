import { describe, it, expect, vi } from "vitest";
import type { TelemetryPort } from "../../../src/use-cases/ports/telemetry";
import type { EnvConfig } from "../../../src/infrastructure/config/env-config";
import type { Tracer } from "@opentelemetry/api";
import { makeFakeLogger } from "../../mocks/fake-logger";
import { NoopTelemetry } from "../../../src/infrastructure/telemetry/noop-telemetry";
import { createTelemetry } from "../../../src/infrastructure/telemetry/telemetry-factory";

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
  skillsBuiltInRoot: "/tmp/skills",
  skillsCustomRoot: "/tmp/.shrimp/skills",
};

function makeStubOtelTelemetry(): TelemetryPort & { tracer: Tracer } {
  return {
    tracer: {} as Tracer,
    runInSpan: vi.fn(async (_name, fn) => fn()),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createTelemetry", () => {
  it("returns a NoopTelemetry instance when telemetryEnabled is false", () => {
    const logger = makeFakeLogger();
    const env: EnvConfig = { ...BASE_ENV, telemetryEnabled: false };

    const { telemetry, tracer } = createTelemetry(env, logger);

    expect(telemetry).toBeInstanceOf(NoopTelemetry);
    expect(tracer).toBeDefined();
  });

  it("routes to the injected OtelTelemetry builder when telemetryEnabled is true", () => {
    const logger = makeFakeLogger();
    const stub = makeStubOtelTelemetry();
    const createOtel = vi.fn(() => stub);
    const env: EnvConfig = {
      ...BASE_ENV,
      telemetryEnabled: true,
      otelServiceName: "my-service",
      otelExporterOtlpEndpoint: "http://otel:4318",
    };

    const { telemetry, tracer } = createTelemetry(env, logger, { createOtel });

    expect(createOtel).toHaveBeenCalledOnce();
    expect(telemetry).toBe(stub);
    expect(tracer).toBe(stub.tracer);
  });

  it("passes serviceName and logger to the OtelTelemetry builder", () => {
    const logger = makeFakeLogger();
    const stub = makeStubOtelTelemetry();
    const createOtel = vi.fn(() => stub);
    const env: EnvConfig = {
      ...BASE_ENV,
      telemetryEnabled: true,
      otelServiceName: "shrimp-service",
      otelExporterOtlpEndpoint: "http://otel:4318",
      otelExporterOtlpHeaders: "Authorization=Bearer token123",
      telemetryRecordInputs: false,
      telemetryRecordOutputs: false,
    };

    createTelemetry(env, logger, { createOtel });

    // OTEL_EXPORTER_OTLP_* env vars are pass-through to the OTel SDK
    // (SPEC §Telemetry); they are intentionally NOT forwarded into the adapter.
    expect(createOtel).toHaveBeenCalledWith({
      serviceName: "shrimp-service",
      logger,
    });
  });
});
