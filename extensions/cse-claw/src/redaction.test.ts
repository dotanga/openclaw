import { describe, expect, it } from "vitest";
import { redactForCse, sanitizeMetadata, truncateText } from "./redaction.js";

describe("CSE_Claw redaction", () => {
  it("redacts common secret shapes before export", () => {
    const redacted = redactForCse(
      [
        "api_key=abc123",
        "Bearer abcdefghijklmnopqrstuvwxyz1234567890",
        "password: hunter2",
        "sk-abcdefghijklmnopqrstuvwxyz1234567890",
      ].join("\n"),
      1_000,
    );

    expect(redacted).toContain("api_key=[REDACTED]");
    expect(redacted).toContain("password=[REDACTED]");
    expect(redacted).toContain("Bearer [REDACTED]");
    expect(redacted).toContain("[REDACTED_API_KEY]");
    expect(redacted).not.toContain("hunter2");
  });

  it("truncates text with an explicit marker", () => {
    expect(truncateText("abcdefghij", 8)).toBe("…[truncated 2 chars]");
    expect(truncateText("short", 10)).toBe("short");
  });

  it("keeps only safe primitive metadata allowlist entries", () => {
    expect(
      sanitizeMetadata({
        runId: "run-1",
        agentId: "main",
        sessionKey: "session-1",
        workspaceDir: "/tmp/workspace",
        unknownSecret: "do-not-export",
        trigger: { nested: true },
        channelId: 123,
        chatType: "group",
      }),
    ).toStrictEqual({
      runId: "run-1",
      agentId: "main",
      sessionKey: "session-1",
      workspaceDir: "/tmp/workspace",
      channelId: 123,
      chatType: "group",
    });
  });
});
