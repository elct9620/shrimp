// Derive the OTel `gen_ai.provider.name` attribute value from the configured
// OpenAI-compatible base URL. The attribute per OTel GenAI semantic
// conventions identifies the upstream AI provider (e.g. "openai",
// "anthropic", a self-hosted host), NOT the application name.
//
// Derivation:
//   1. Parse baseUrl with new URL().
//   2. Match the hostname suffix against a small table of well-known vendors.
//   3. Fall back to the raw lowercased hostname (no port).
//   4. If baseUrl is unparseable, return "openai-compatible" so the attribute
//      is never empty.

const KNOWN_VENDORS: ReadonlyArray<{ suffix: string; label: string }> = [
  { suffix: "api.openai.com", label: "openai" },
  { suffix: "api.anthropic.com", label: "anthropic" },
  { suffix: "generativelanguage.googleapis.com", label: "google" },
  { suffix: "api.mistral.ai", label: "mistral" },
  { suffix: "api.deepseek.com", label: "deepseek" },
  { suffix: "api.groq.com", label: "groq" },
  { suffix: "openrouter.ai", label: "openrouter" },
];

export function deriveGenAiProviderName(baseUrl: string): string {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "openai-compatible";
  }

  if (hostname === "") return "openai-compatible";

  for (const { suffix, label } of KNOWN_VENDORS) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) {
      return label;
    }
  }

  return hostname;
}
