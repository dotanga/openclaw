import { describe, expect, it } from "vitest";
import { resolveCseClawConfig } from "./config.js";

describe("CSE_Claw config", () => {
  it("is disabled by default and points at the local backend", () => {
    expect(resolveCseClawConfig(undefined)).toStrictEqual({
      enabled: false,
      endpoint: "http://127.0.0.1:8000",
      timeoutMs: 1_500,
      maxPromptChars: 2_000,
      maxAssistantChars: 4_000,
      injectAdvisoryContext: true,
      logFailures: true,
    });
  });

  it("normalizes endpoint strings and clamps numeric bounds", () => {
    expect(
      resolveCseClawConfig({
        enabled: true,
        endpoint: " http://localhost:9000/// ",
        timeoutMs: 42,
        maxPromptChars: 99_999,
        maxAssistantChars: 1,
        injectAdvisoryContext: false,
        logFailures: false,
      }),
    ).toStrictEqual({
      enabled: true,
      endpoint: "http://localhost:9000",
      timeoutMs: 100,
      maxPromptChars: 12_000,
      maxAssistantChars: 100,
      injectAdvisoryContext: false,
      logFailures: false,
    });
  });

  it("falls back for invalid config shapes", () => {
    const resolved = resolveCseClawConfig({
      enabled: "yes",
      endpoint: "   ",
      timeoutMs: Number.NaN,
      maxPromptChars: "many",
    });

    expect(resolved.enabled).toBe(false);
    expect(resolved.endpoint).toBe("http://127.0.0.1:8000");
    expect(resolved.timeoutMs).toBe(1_500);
    expect(resolved.maxPromptChars).toBe(2_000);
  });
});
