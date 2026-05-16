import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCseClawConfig } from "./config.js";

const manifestPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../openclaw.plugin.json",
);

function manifestConfigProperties(): Record<string, { default?: unknown }> {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    configSchema?: { properties?: Record<string, { default?: unknown }> };
  };
  return manifest.configSchema?.properties ?? {};
}

function readReadme(): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../README.md"),
    "utf8",
  );
}

describe("CSE_Claw config", () => {
  it("is disabled by default and points at the local backend", () => {
    expect(resolveCseClawConfig(undefined)).toStrictEqual({
      enabled: false,
      endpoint: "http://127.0.0.1:8080",
      timeoutMs: 1_500,
      maxPromptChars: 2_000,
      maxAssistantChars: 4_000,
      injectAdvisoryContext: true,
      sharedContextMode: "audit_only",
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
        sharedContextMode: "advisory",
        logFailures: false,
      }),
    ).toStrictEqual({
      enabled: true,
      endpoint: "http://localhost:9000",
      timeoutMs: 100,
      maxPromptChars: 12_000,
      maxAssistantChars: 100,
      injectAdvisoryContext: false,
      sharedContextMode: "advisory",
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
    expect(resolved.endpoint).toBe("http://127.0.0.1:8080");
    expect(resolved.timeoutMs).toBe(1_500);
    expect(resolved.maxPromptChars).toBe(2_000);
  });

  it("keeps plugin manifest config fields wired to runtime config fields", () => {
    const properties = manifestConfigProperties();
    expect(Object.keys(properties).toSorted()).toStrictEqual(
      [
        "enabled",
        "endpoint",
        "injectAdvisoryContext",
        "logFailures",
        "maxAssistantChars",
        "maxPromptChars",
        "sharedContextMode",
        "timeoutMs",
      ].toSorted(),
    );

    const resolvedFromManifestDefaults = resolveCseClawConfig(
      Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, value.default])),
    );
    expect(resolvedFromManifestDefaults).toStrictEqual(resolveCseClawConfig(undefined));
  });

  it("honors every non-default config field exposed by the plugin manifest", () => {
    const manifestBackedConfig = {
      enabled: true,
      endpoint: "http://localhost:8765",
      timeoutMs: 3_000,
      maxPromptChars: 777,
      maxAssistantChars: 888,
      injectAdvisoryContext: false,
      sharedContextMode: "off",
      logFailures: false,
    };

    expect(resolveCseClawConfig(manifestBackedConfig)).toStrictEqual(manifestBackedConfig);
  });

  it("documents every operator config field and default in the README", () => {
    const readme = readReadme();
    const properties = manifestConfigProperties();

    for (const [key, property] of Object.entries(properties)) {
      expect(readme).toContain(`\`${key}\``);
      expect(readme).toContain(String(property.default));
    }

    expect(readme).toContain("Minimal local-only enabled config");
    expect(readme).toContain("Failures and timeouts fail open");
    expect(readme).toContain("group/channel privacy posture");
    expect(readme).toContain("Data sent to CSE");
  });
});
