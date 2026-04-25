import { existsSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvConfigError,
  loadEnvConfig,
} from "../../../src/infrastructure/config/env-config";

/**
 * Assert that calling `fn` throws an EnvConfigError whose `fields` array
 * includes all of the specified `expectedFields`. This checks which
 * configuration keys failed validation, not the error message wording.
 */
function expectEnvConfigFields(
  fn: () => unknown,
  expectedFields: string[],
): void {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(EnvConfigError);
  const err = error as EnvConfigError;
  for (const field of expectedFields) {
    expect(err.fields).toContain(field);
  }
}

const REQUIRED_ENV = {
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  OPENAI_API_KEY: "sk-test-key",
  AI_MODEL: "gpt-4o",
  TODOIST_API_TOKEN: "todoist-token",
  TODOIST_PROJECT_ID: "project-123",
};

describe("loadEnvConfig", () => {
  describe("required variables", () => {
    it("should return fully populated config when all required vars are present", () => {
      const config = loadEnvConfig(REQUIRED_ENV);

      expect(config).toEqual({
        openAiBaseUrl: "https://api.openai.com/v1",
        openAiApiKey: "sk-test-key",
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
        shrimpHome: expect.any(String),
        skillsBuiltInRoot: expect.any(String),
        skillsCustomRoot: expect.any(String),
        heartbeatToken: undefined,
        autoCompactTokenThreshold: undefined,
        autoCompactModel: undefined,
      });
    });

    it.each([
      "OPENAI_BASE_URL",
      "OPENAI_API_KEY",
      "AI_MODEL",
      "TODOIST_API_TOKEN",
      "TODOIST_PROJECT_ID",
    ] as const)(
      "should throw EnvConfigError for %s when it is missing",
      (key) => {
        const { [key]: _, ...env } = REQUIRED_ENV;
        expectEnvConfigFields(() => loadEnvConfig(env), [key]);
      },
    );

    it("should throw ONE EnvConfigError covering all missing required variables", () => {
      expectEnvConfigFields(
        () => loadEnvConfig({}),
        [
          "OPENAI_BASE_URL",
          "OPENAI_API_KEY",
          "AI_MODEL",
          "TODOIST_API_TOKEN",
          "TODOIST_PROJECT_ID",
        ],
      );
    });
  });

  describe("AI_REASONING_EFFORT", () => {
    it("should be undefined when AI_REASONING_EFFORT is absent", () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(config.aiReasoningEffort).toBeUndefined();
    });

    it("should be undefined when AI_REASONING_EFFORT is empty string", () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        AI_REASONING_EFFORT: "",
      });
      expect(config.aiReasoningEffort).toBeUndefined();
    });

    it('should use "high" when AI_REASONING_EFFORT is "high"', () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        AI_REASONING_EFFORT: "high",
      });
      expect(config.aiReasoningEffort).toBe("high");
    });

    it('should use "low" when AI_REASONING_EFFORT is "low"', () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        AI_REASONING_EFFORT: "low",
      });
      expect(config.aiReasoningEffort).toBe("low");
    });

    // The current source does no enum validation on AI_REASONING_EFFORT — it is
    // a raw string pass-through (env["AI_REASONING_EFFORT"] || undefined).
    // The following tests assert current contract: arbitrary non-empty strings
    // are accepted as-is. If enum enforcement is added in future, these should
    // become rejection tests.
    it.each(["medium", "HIGH", "123"])(
      'should pass through "%s" without throwing (no enum validation in source)',
      (value) => {
        const config = loadEnvConfig({
          ...REQUIRED_ENV,
          AI_REASONING_EFFORT: value,
        });
        expect(config.aiReasoningEffort).toBe(value);
      },
    );

    // TODO: AI_REASONING_EFFORT has no schema enforcement. If the source is
    // updated to validate against an enum (e.g. "low"|"medium"|"high"), add
    // rejection tests for values like "", "HIGH", "123", and unknown strings.
    it.todo(
      "should reject AI_REASONING_EFFORT values not in the allowed enum (enforcement not yet implemented in source)",
    );
  });

  describe("AI_MAX_STEPS", () => {
    it("should default to 50 when AI_MAX_STEPS is absent", () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(config.aiMaxSteps).toBe(50);
    });

    it('should default to 50 when AI_MAX_STEPS is "abc" (non-integer)', () => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, AI_MAX_STEPS: "abc" });
      expect(config.aiMaxSteps).toBe(50);
    });

    it('should default to 50 when AI_MAX_STEPS is "0" (non-positive)', () => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, AI_MAX_STEPS: "0" });
      expect(config.aiMaxSteps).toBe(50);
    });

    it('should default to 50 when AI_MAX_STEPS is "-5" (negative)', () => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, AI_MAX_STEPS: "-5" });
      expect(config.aiMaxSteps).toBe(50);
    });

    it('should use 123 when AI_MAX_STEPS is "123"', () => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, AI_MAX_STEPS: "123" });
      expect(config.aiMaxSteps).toBe(123);
    });
  });

  describe("PORT", () => {
    it("should default to 3000 when PORT is absent", () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(config.port).toBe(3000);
    });

    it('should use 8080 when PORT is "8080"', () => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, PORT: "8080" });
      expect(config.port).toBe(8080);
    });

    it('should default to 3000 when PORT is "abc"', () => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, PORT: "abc" });
      expect(config.port).toBe(3000);
    });
  });

  describe("pure function", () => {
    it("should return equivalent configs when called twice with the same env", () => {
      const env = { ...REQUIRED_ENV, AI_MAX_STEPS: "25", PORT: "4000" };
      const config1 = loadEnvConfig(env);
      const config2 = loadEnvConfig(env);
      expect(config1).toEqual(config2);
    });
  });

  describe("TELEMETRY_ENABLED", () => {
    it("should default to false and include undefined OTel fields when TELEMETRY_ENABLED is absent", () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(config.telemetryEnabled).toBe(false);
      expect(config.otelServiceName).toBeUndefined();
      expect(config.otelExporterOtlpEndpoint).toBeUndefined();
      expect(config.otelExporterOtlpHeaders).toBeUndefined();
    });

    it('should parse "true" as true', () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        TELEMETRY_ENABLED: "true",
        OTEL_SERVICE_NAME: "svc",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      });
      expect(config.telemetryEnabled).toBe(true);
    });

    it('should parse "1" as true', () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        TELEMETRY_ENABLED: "1",
        OTEL_SERVICE_NAME: "svc",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      });
      expect(config.telemetryEnabled).toBe(true);
    });

    it('should parse "yes" as false', () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        TELEMETRY_ENABLED: "yes",
      });
      expect(config.telemetryEnabled).toBe(false);
    });

    it('should parse "on" as false', () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        TELEMETRY_ENABLED: "on",
      });
      expect(config.telemetryEnabled).toBe(false);
    });

    it("should parse empty string as false", () => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, TELEMETRY_ENABLED: "" });
      expect(config.telemetryEnabled).toBe(false);
    });

    it("should return config with telemetryEnabled true and OTel values populated when TELEMETRY_ENABLED=true and both required OTel vars are set", () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        TELEMETRY_ENABLED: "true",
        OTEL_SERVICE_NAME: "my-service",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      });
      expect(config.telemetryEnabled).toBe(true);
      expect(config.otelServiceName).toBe("my-service");
      expect(config.otelExporterOtlpEndpoint).toBe("http://otel:4318");
    });

    it.each([
      {
        name: "OTEL_SERVICE_NAME missing",
        extraEnv: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318" },
        expectedFields: ["OTEL_SERVICE_NAME"],
      },
      {
        name: "OTEL_EXPORTER_OTLP_ENDPOINT missing",
        extraEnv: { OTEL_SERVICE_NAME: "my-service" },
        expectedFields: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
      },
      {
        name: "both OTEL_SERVICE_NAME and OTEL_EXPORTER_OTLP_ENDPOINT missing",
        extraEnv: {},
        expectedFields: ["OTEL_SERVICE_NAME", "OTEL_EXPORTER_OTLP_ENDPOINT"],
      },
    ])(
      "should throw EnvConfigError when TELEMETRY_ENABLED=true and $name",
      ({ extraEnv, expectedFields }) => {
        expectEnvConfigFields(
          () =>
            loadEnvConfig({
              ...REQUIRED_ENV,
              TELEMETRY_ENABLED: "true",
              ...extraEnv,
            }),
          expectedFields,
        );
      },
    );

    it("should expose OTEL_EXPORTER_OTLP_HEADERS as-is without parsing when set", () => {
      const headers = "Authorization=Bearer token123,X-Custom=value";
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        TELEMETRY_ENABLED: "true",
        OTEL_SERVICE_NAME: "my-service",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
        OTEL_EXPORTER_OTLP_HEADERS: headers,
      });
      expect(config.otelExporterOtlpHeaders).toBe(headers);
    });
  });

  describe.each([
    {
      envKey: "TELEMETRY_RECORD_INPUTS" as const,
      configKey: "telemetryRecordInputs" as const,
    },
    {
      envKey: "TELEMETRY_RECORD_OUTPUTS" as const,
      configKey: "telemetryRecordOutputs" as const,
    },
  ])("$envKey", ({ envKey, configKey }) => {
    it("should default to true when absent", () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(config[configKey]).toBe(true);
    });

    it.each(["false", "0"])('should parse "%s" as false', (value) => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, [envKey]: value });
      expect(config[configKey]).toBe(false);
    });

    it("should parse any other value as true", () => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, [envKey]: "yes" });
      expect(config[configKey]).toBe(true);
    });
  });

  describe("LOG_LEVEL", () => {
    it('should default to "info" when LOG_LEVEL is absent', () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(config.logLevel).toBe("info");
    });

    it('should accept "debug" as a valid log level', () => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, LOG_LEVEL: "debug" });
      expect(config.logLevel).toBe("debug");
    });

    it('should accept "warn" as a valid log level', () => {
      const config = loadEnvConfig({ ...REQUIRED_ENV, LOG_LEVEL: "warn" });
      expect(config.logLevel).toBe("warn");
    });

    it("should throw EnvConfigError for an invalid log level", () => {
      expectEnvConfigFields(
        () => loadEnvConfig({ ...REQUIRED_ENV, LOG_LEVEL: "verbose" }),
        ["LOG_LEVEL"],
      );
    });
  });

  describe("EnvConfigError", () => {
    it('should set name to "EnvConfigError"', () => {
      let error: EnvConfigError | undefined;
      try {
        loadEnvConfig({});
      } catch (e) {
        if (e instanceof EnvConfigError) error = e;
      }
      expect(error!.name).toBe("EnvConfigError");
    });
  });

  describe("CHANNELS_ENABLED", () => {
    let testStateDir: string;

    afterEach(() => {
      if (testStateDir && existsSync(testStateDir)) {
        rmSync(testStateDir, { recursive: true });
      }
    });

    it("should disable channels, skip TELEGRAM_* validation, and return defaults when CHANNELS_ENABLED is absent", () => {
      const config = loadEnvConfig(REQUIRED_ENV);

      expect(config.channelsEnabled).toBe(false);
      expect(config.telegramBotToken).toBeUndefined();
      expect(config.telegramWebhookSecret).toBeUndefined();
      expect(config.shrimpHome).toBe(join(homedir(), ".shrimp"));
    });

    it("should succeed and create the state directory when CHANNELS_ENABLED=true and both TELEGRAM_* vars are set", () => {
      testStateDir = join(tmpdir(), `shrimp-test-${Date.now()}`);

      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        CHANNELS_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "bot123:TOKEN",
        TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
        SHRIMP_HOME: testStateDir,
        AUTO_COMPACT_TOKEN_THRESHOLD: "100000",
      });

      expect(config.channelsEnabled).toBe(true);
      expect(config.telegramBotToken).toBe("bot123:TOKEN");
      expect(config.telegramWebhookSecret).toBe("webhook-secret");
      expect(config.shrimpHome).toBe(testStateDir);
      expect(existsSync(testStateDir)).toBe(true);
    });

    it.each([
      {
        name: "TELEGRAM_BOT_TOKEN missing",
        extraEnv: { TELEGRAM_WEBHOOK_SECRET: "webhook-secret" },
        expectedFields: ["TELEGRAM_BOT_TOKEN"],
      },
      {
        name: "TELEGRAM_WEBHOOK_SECRET missing",
        extraEnv: { TELEGRAM_BOT_TOKEN: "bot123:TOKEN" },
        expectedFields: ["TELEGRAM_WEBHOOK_SECRET"],
      },
    ])(
      "should throw EnvConfigError when CHANNELS_ENABLED=true and $name",
      ({ extraEnv, expectedFields }) => {
        testStateDir = join(tmpdir(), `shrimp-test-${Date.now()}`);

        expectEnvConfigFields(
          () =>
            loadEnvConfig({
              ...REQUIRED_ENV,
              CHANNELS_ENABLED: "true",
              SHRIMP_HOME: testStateDir,
              ...extraEnv,
            }),
          expectedFields,
        );
      },
    );

    it("should accept the deprecated SHRIMP_STATE_DIR as a fallback for SHRIMP_HOME", () => {
      testStateDir = join(tmpdir(), `shrimp-test-legacy-${Date.now()}`);
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      try {
        const config = loadEnvConfig({
          ...REQUIRED_ENV,
          SHRIMP_STATE_DIR: testStateDir,
        });

        expect(config.shrimpHome).toBe(testStateDir);
        expect(stderrSpy).toHaveBeenCalledWith(
          expect.stringContaining("SHRIMP_STATE_DIR is deprecated"),
        );
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it("should prefer SHRIMP_HOME over the deprecated SHRIMP_STATE_DIR when both are set", () => {
      const homeDir = join(tmpdir(), `shrimp-test-home-${Date.now()}`);
      const legacyDir = join(tmpdir(), `shrimp-test-legacy-${Date.now()}`);
      testStateDir = homeDir;
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      try {
        const config = loadEnvConfig({
          ...REQUIRED_ENV,
          SHRIMP_HOME: homeDir,
          SHRIMP_STATE_DIR: legacyDir,
        });

        expect(config.shrimpHome).toBe(homeDir);
        expect(stderrSpy).not.toHaveBeenCalled();
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it("should throw EnvConfigError when CHANNELS_ENABLED=true and SHRIMP_HOME points to an existing file (not a dir)", () => {
      testStateDir = join(tmpdir(), `shrimp-test-${Date.now()}`);
      // Create a file at the path so mkdir will fail
      writeFileSync(testStateDir, "not a directory");

      expect(() =>
        loadEnvConfig({
          ...REQUIRED_ENV,
          CHANNELS_ENABLED: "true",
          TELEGRAM_BOT_TOKEN: "bot123:TOKEN",
          TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
          SHRIMP_HOME: testStateDir,
        }),
      ).toThrow(EnvConfigError);
    });
  });

  describe("AUTO_COMPACT_*", () => {
    let testStateDir: string;

    const CHANNELS_ON_ENV = {
      ...REQUIRED_ENV,
      CHANNELS_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "bot123:TOKEN",
      TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    };

    afterEach(() => {
      if (testStateDir && existsSync(testStateDir)) {
        rmSync(testStateDir, { recursive: true });
      }
    });

    it("should not read AUTO_COMPACT_* when CHANNELS_ENABLED is off, even if values are invalid", () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        AUTO_COMPACT_TOKEN_THRESHOLD: "not-a-number",
        AUTO_COMPACT_MODEL: "some-model",
      });

      expect(config.autoCompactTokenThreshold).toBeUndefined();
      expect(config.autoCompactModel).toBeUndefined();
    });

    it("should parse AUTO_COMPACT_TOKEN_THRESHOLD as a positive integer when CHANNELS_ENABLED=true", () => {
      testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

      const config = loadEnvConfig({
        ...CHANNELS_ON_ENV,
        SHRIMP_HOME: testStateDir,
        AUTO_COMPACT_TOKEN_THRESHOLD: "120000",
      });

      expect(config.autoCompactTokenThreshold).toBe(120000);
    });

    it("should default AUTO_COMPACT_TOKEN_THRESHOLD to 100000 when CHANNELS_ENABLED=true and it is missing", () => {
      testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

      const config = loadEnvConfig({
        ...CHANNELS_ON_ENV,
        SHRIMP_HOME: testStateDir,
      });

      expect(config.autoCompactTokenThreshold).toBe(100000);
    });

    it("should default AUTO_COMPACT_TOKEN_THRESHOLD to 100000 when set to empty string", () => {
      testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

      const config = loadEnvConfig({
        ...CHANNELS_ON_ENV,
        SHRIMP_HOME: testStateDir,
        AUTO_COMPACT_TOKEN_THRESHOLD: "",
      });

      expect(config.autoCompactTokenThreshold).toBe(100000);
    });

    it.each(["0", "-1", "abc", "1.5"])(
      'should throw EnvConfigError when AUTO_COMPACT_TOKEN_THRESHOLD is "%s"',
      (value) => {
        testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

        expect(() =>
          loadEnvConfig({
            ...CHANNELS_ON_ENV,
            SHRIMP_HOME: testStateDir,
            AUTO_COMPACT_TOKEN_THRESHOLD: value,
          }),
        ).toThrow(EnvConfigError);
        expect(() =>
          loadEnvConfig({
            ...CHANNELS_ON_ENV,
            SHRIMP_HOME: testStateDir,
            AUTO_COMPACT_TOKEN_THRESHOLD: value,
          }),
        ).toThrow("AUTO_COMPACT_TOKEN_THRESHOLD");
      },
    );

    it.each(["abc", "-1", "0"])(
      'should report AUTO_COMPACT_TOKEN_THRESHOLD in EnvConfigError fields when value is "%s"',
      (value) => {
        testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

        expectEnvConfigFields(
          () =>
            loadEnvConfig({
              ...CHANNELS_ON_ENV,
              SHRIMP_HOME: testStateDir,
              AUTO_COMPACT_TOKEN_THRESHOLD: value,
            }),
          ["AUTO_COMPACT_TOKEN_THRESHOLD"],
        );
      },
    );

    it("should expose AUTO_COMPACT_MODEL when set", () => {
      testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

      const config = loadEnvConfig({
        ...CHANNELS_ON_ENV,
        SHRIMP_HOME: testStateDir,
        AUTO_COMPACT_TOKEN_THRESHOLD: "100000",
        AUTO_COMPACT_MODEL: "gpt-4o-mini",
      });

      expect(config.autoCompactModel).toBe("gpt-4o-mini");
    });

    it("should leave AUTO_COMPACT_MODEL undefined when unset (consumer falls back to AI_MODEL)", () => {
      testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

      const config = loadEnvConfig({
        ...CHANNELS_ON_ENV,
        SHRIMP_HOME: testStateDir,
        AUTO_COMPACT_TOKEN_THRESHOLD: "100000",
      });

      expect(config.autoCompactModel).toBeUndefined();
    });

    it("should leave AUTO_COMPACT_MODEL undefined when set to empty string", () => {
      testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

      const config = loadEnvConfig({
        ...CHANNELS_ON_ENV,
        SHRIMP_HOME: testStateDir,
        AUTO_COMPACT_TOKEN_THRESHOLD: "100000",
        AUTO_COMPACT_MODEL: "",
      });

      expect(config.autoCompactModel).toBeUndefined();
    });

    it("should parse AUTO_COMPACT_MAX_OUTPUT_TOKENS when set to a positive integer", () => {
      testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

      const config = loadEnvConfig({
        ...CHANNELS_ON_ENV,
        SHRIMP_HOME: testStateDir,
        AUTO_COMPACT_TOKEN_THRESHOLD: "100000",
        AUTO_COMPACT_MAX_OUTPUT_TOKENS: "2048",
      });

      expect(config.autoCompactMaxOutputTokens).toBe(2048);
    });

    it("should default AUTO_COMPACT_MAX_OUTPUT_TOKENS to 2048 when unset", () => {
      testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

      const config = loadEnvConfig({
        ...CHANNELS_ON_ENV,
        SHRIMP_HOME: testStateDir,
        AUTO_COMPACT_TOKEN_THRESHOLD: "100000",
      });

      expect(config.autoCompactMaxOutputTokens).toBe(2048);
    });

    it.each(["0", "-1", "abc", "1.5"])(
      "should reject AUTO_COMPACT_MAX_OUTPUT_TOKENS=%s as invalid positive integer",
      (value) => {
        testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

        expect(() =>
          loadEnvConfig({
            ...CHANNELS_ON_ENV,
            SHRIMP_HOME: testStateDir,
            AUTO_COMPACT_TOKEN_THRESHOLD: "100000",
            AUTO_COMPACT_MAX_OUTPUT_TOKENS: value,
          }),
        ).toThrow(/AUTO_COMPACT_MAX_OUTPUT_TOKENS/);
      },
    );

    it.each(["abc", "-1", "0"])(
      'should report AUTO_COMPACT_MAX_OUTPUT_TOKENS in EnvConfigError fields when value is "%s"',
      (value) => {
        testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

        expectEnvConfigFields(
          () =>
            loadEnvConfig({
              ...CHANNELS_ON_ENV,
              SHRIMP_HOME: testStateDir,
              AUTO_COMPACT_TOKEN_THRESHOLD: "100000",
              AUTO_COMPACT_MAX_OUTPUT_TOKENS: value,
            }),
          ["AUTO_COMPACT_MAX_OUTPUT_TOKENS"],
        );
      },
    );

    it("should default AUTO_COMPACT_MAX_OUTPUT_TOKENS to 2048 when set to empty string", () => {
      testStateDir = join(tmpdir(), `shrimp-test-ac-${Date.now()}`);

      const config = loadEnvConfig({
        ...CHANNELS_ON_ENV,
        SHRIMP_HOME: testStateDir,
        AUTO_COMPACT_TOKEN_THRESHOLD: "100000",
        AUTO_COMPACT_MAX_OUTPUT_TOKENS: "",
      });

      expect(config.autoCompactMaxOutputTokens).toBe(2048);
    });
  });

  describe("skillsBuiltInRoot", () => {
    it("should resolve to <cwd>/skills by default", () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(config.skillsBuiltInRoot).toBe(join(process.cwd(), "skills"));
    });

    it("should be an absolute path", () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(isAbsolute(config.skillsBuiltInRoot)).toBe(true);
    });
  });

  describe("skillsCustomRoot", () => {
    it("should resolve to <shrimpHome>/skills using default SHRIMP_HOME", () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(config.skillsCustomRoot).toBe(
        join(homedir(), ".shrimp", "skills"),
      );
    });

    it("should resolve to <SHRIMP_HOME>/skills when SHRIMP_HOME is set", () => {
      const customHome = join(tmpdir(), `shrimp-skills-test-${Date.now()}`);
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        SHRIMP_HOME: customHome,
      });
      expect(config.skillsCustomRoot).toBe(join(customHome, "skills"));
    });

    it("should follow SHRIMP_STATE_DIR legacy fallback for skillsCustomRoot", () => {
      const legacyHome = join(tmpdir(), `shrimp-legacy-${Date.now()}`);
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      try {
        const config = loadEnvConfig({
          ...REQUIRED_ENV,
          SHRIMP_STATE_DIR: legacyHome,
        });
        expect(config.skillsCustomRoot).toBe(join(legacyHome, "skills"));
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it("should be an absolute path", () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(isAbsolute(config.skillsCustomRoot)).toBe(true);
    });
  });

  describe("SHRIMP_HEARTBEAT_TOKEN", () => {
    it("should be undefined when absent", () => {
      const config = loadEnvConfig(REQUIRED_ENV);
      expect(config.heartbeatToken).toBeUndefined();
    });

    it("should be undefined when empty string", () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        SHRIMP_HEARTBEAT_TOKEN: "",
      });
      expect(config.heartbeatToken).toBeUndefined();
    });

    it("should expose the configured value when set", () => {
      const config = loadEnvConfig({
        ...REQUIRED_ENV,
        SHRIMP_HEARTBEAT_TOKEN: "s3cret",
      });
      expect(config.heartbeatToken).toBe("s3cret");
    });
  });
});
