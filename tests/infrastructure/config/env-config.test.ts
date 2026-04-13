import { describe, expect, it } from "vitest";
import {
  EnvConfigError,
  loadEnvConfig,
} from "../../../src/infrastructure/config/env-config";

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
        todoistApiToken: "todoist-token",
        todoistProjectId: "project-123",
        port: 3000,
        logLevel: "info",
      });
    });

    it("should throw EnvConfigError when OPENAI_BASE_URL is missing", () => {
      const { OPENAI_BASE_URL: _, ...env } = REQUIRED_ENV;

      expect(() => loadEnvConfig(env)).toThrow(EnvConfigError);
      expect(() => loadEnvConfig(env)).toThrow("OPENAI_BASE_URL");
    });

    it("should throw EnvConfigError when OPENAI_API_KEY is missing", () => {
      const { OPENAI_API_KEY: _, ...env } = REQUIRED_ENV;

      expect(() => loadEnvConfig(env)).toThrow(EnvConfigError);
      expect(() => loadEnvConfig(env)).toThrow("OPENAI_API_KEY");
    });

    it("should throw EnvConfigError when AI_MODEL is missing", () => {
      const { AI_MODEL: _, ...env } = REQUIRED_ENV;

      expect(() => loadEnvConfig(env)).toThrow(EnvConfigError);
      expect(() => loadEnvConfig(env)).toThrow("AI_MODEL");
    });

    it("should throw EnvConfigError when TODOIST_API_TOKEN is missing", () => {
      const { TODOIST_API_TOKEN: _, ...env } = REQUIRED_ENV;

      expect(() => loadEnvConfig(env)).toThrow(EnvConfigError);
      expect(() => loadEnvConfig(env)).toThrow("TODOIST_API_TOKEN");
    });

    it("should throw EnvConfigError when TODOIST_PROJECT_ID is missing", () => {
      const { TODOIST_PROJECT_ID: _, ...env } = REQUIRED_ENV;

      expect(() => loadEnvConfig(env)).toThrow(EnvConfigError);
      expect(() => loadEnvConfig(env)).toThrow("TODOIST_PROJECT_ID");
    });

    it("should throw ONE EnvConfigError listing all missing required variables", () => {
      expect(() => loadEnvConfig({})).toThrow(EnvConfigError);

      let error: EnvConfigError | undefined;
      try {
        loadEnvConfig({});
      } catch (e) {
        if (e instanceof EnvConfigError) error = e;
      }

      expect(error).toBeDefined();
      expect(error!.message).toContain("OPENAI_BASE_URL");
      expect(error!.message).toContain("OPENAI_API_KEY");
      expect(error!.message).toContain("AI_MODEL");
      expect(error!.message).toContain("TODOIST_API_TOKEN");
      expect(error!.message).toContain("TODOIST_PROJECT_ID");
    });
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
      expect(() =>
        loadEnvConfig({ ...REQUIRED_ENV, LOG_LEVEL: "verbose" }),
      ).toThrow(EnvConfigError);
      expect(() =>
        loadEnvConfig({ ...REQUIRED_ENV, LOG_LEVEL: "verbose" }),
      ).toThrow("verbose");
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
});
