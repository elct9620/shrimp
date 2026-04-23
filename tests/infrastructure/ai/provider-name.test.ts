import { describe, it, expect } from "vitest";
import { deriveGenAiProviderName } from "../../../src/infrastructure/ai/provider-name";

describe("deriveGenAiProviderName", () => {
  it("maps the default OpenAI base URL to 'openai'", () => {
    expect(deriveGenAiProviderName("https://api.openai.com/v1")).toBe("openai");
  });

  it("maps the Anthropic base URL to 'anthropic'", () => {
    expect(deriveGenAiProviderName("https://api.anthropic.com/v1")).toBe(
      "anthropic",
    );
  });

  it("maps the Google generative-language base URL to 'google'", () => {
    expect(
      deriveGenAiProviderName(
        "https://generativelanguage.googleapis.com/v1beta",
      ),
    ).toBe("google");
  });

  it("maps the Mistral base URL to 'mistral'", () => {
    expect(deriveGenAiProviderName("https://api.mistral.ai/v1")).toBe(
      "mistral",
    );
  });

  it("maps the DeepSeek base URL to 'deepseek'", () => {
    expect(deriveGenAiProviderName("https://api.deepseek.com/v1")).toBe(
      "deepseek",
    );
  });

  it("maps the Groq base URL to 'groq'", () => {
    expect(deriveGenAiProviderName("https://api.groq.com/openai/v1")).toBe(
      "groq",
    );
  });

  it("maps the OpenRouter base URL to 'openrouter'", () => {
    expect(deriveGenAiProviderName("https://openrouter.ai/api/v1")).toBe(
      "openrouter",
    );
  });

  it("maps a subdomain of a known vendor to the vendor label", () => {
    expect(deriveGenAiProviderName("https://eu.api.mistral.ai/v1")).toBe(
      "mistral",
    );
  });

  it("falls back to the raw hostname for unknown self-hosted endpoints", () => {
    expect(deriveGenAiProviderName("https://llm.internal/v1")).toBe(
      "llm.internal",
    );
  });

  it("lowercases the hostname in the fallback path", () => {
    expect(deriveGenAiProviderName("https://LLM.Example.COM/v1")).toBe(
      "llm.example.com",
    );
  });

  it("omits the port when falling back to the hostname", () => {
    expect(deriveGenAiProviderName("http://llm.internal:8080/v1")).toBe(
      "llm.internal",
    );
  });

  it("returns 'openai-compatible' when the base URL is unparseable", () => {
    expect(deriveGenAiProviderName("not a url")).toBe("openai-compatible");
  });

  it("returns 'openai-compatible' when the base URL is empty", () => {
    expect(deriveGenAiProviderName("")).toBe("openai-compatible");
  });
});
