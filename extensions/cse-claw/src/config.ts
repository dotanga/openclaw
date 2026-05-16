export type CseClawConfig = {
  enabled: boolean;
  endpoint: string;
  timeoutMs: number;
  maxPromptChars: number;
  maxAssistantChars: number;
  injectAdvisoryContext: boolean;
  sharedContextMode: "off" | "audit_only" | "advisory";
  logFailures: boolean;
};

const DEFAULT_ENDPOINT = "http://127.0.0.1:8080";
const DEFAULT_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_PROMPT_CHARS = 2_000;
const DEFAULT_MAX_ASSISTANT_CHARS = 4_000;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asString = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const asSharedContextMode = (value: unknown): CseClawConfig["sharedContextMode"] => {
  if (value === "off" || value === "audit_only" || value === "advisory") {
    return value;
  }
  return "audit_only";
};

const asPositiveInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
};

export function resolveCseClawConfig(input: unknown): CseClawConfig {
  const config = asRecord(input);
  return {
    enabled: asBoolean(config.enabled, false),
    endpoint: asString(config.endpoint, DEFAULT_ENDPOINT).replace(/[/]+$/u, ""),
    timeoutMs: asPositiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 10_000),
    maxPromptChars: asPositiveInteger(config.maxPromptChars, DEFAULT_MAX_PROMPT_CHARS, 100, 12_000),
    maxAssistantChars: asPositiveInteger(
      config.maxAssistantChars,
      DEFAULT_MAX_ASSISTANT_CHARS,
      100,
      20_000,
    ),
    injectAdvisoryContext: asBoolean(config.injectAdvisoryContext, true),
    sharedContextMode: asSharedContextMode(config.sharedContextMode),
    logFailures: asBoolean(config.logFailures, true),
  };
}
