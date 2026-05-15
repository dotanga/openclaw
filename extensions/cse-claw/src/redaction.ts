const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED]",
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]"],
];

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const prefix = text.slice(0, Math.max(0, maxChars - 32));
  const marker = `…[truncated ${text.length - maxChars} chars]`;
  return prefix ? `${prefix}\n${marker}` : marker;
}

export function redactForCse(text: string, maxChars: number): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return truncateText(result, maxChars);
}

export function sanitizeMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const allowedKeys = new Set([
    "runId",
    "agentId",
    "sessionKey",
    "sessionId",
    "workspaceDir",
    "modelProviderId",
    "modelId",
    "messageProvider",
    "trigger",
    "channelId",
  ]);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowedKeys.has(key)) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    }
  }
  return output;
}
