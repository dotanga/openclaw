import {
  fetchWithSsrFGuard,
  ssrfPolicyFromHttpBaseUrlAllowedHostname,
} from "openclaw/plugin-sdk/ssrf-runtime";
import type { CseClawConfig } from "./config.js";
import type { CseClawPreTurnResponse } from "./prompt.js";

export type CseClawPreTurnRequest = {
  turn_id?: string;
  channel?: string;
  chat_type?: string;
  source_id: "openclaw";
  user_text: string;
  trusted_metadata: Record<string, unknown>;
  context_refs: string[];
};

export type CseClawPostTurnRequest = {
  trace_id: string;
  assistant_text: string;
  tool_calls: Array<Record<string, unknown>>;
  outcome: string;
  metadata: Record<string, unknown>;
};

export type CseClawPostTurnResponse = {
  trace_id: string;
  event_id: string;
  artifact_id: string;
  outcome: string;
  writes_canonical_openclaw_state: boolean;
};

async function postJson<TResponse>(
  config: CseClawConfig,
  path: string,
  body: unknown,
): Promise<TResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const { response, release } = await fetchWithSsrFGuard({
      url: `${config.endpoint}${path}`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
      policy: ssrfPolicyFromHttpBaseUrlAllowedHostname(config.endpoint),
      auditContext: "cse-claw",
    });
    try {
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `CSE backend ${response.status} ${response.statusText}: ${text.slice(0, 240)}`,
        );
      }
      return (await response.json()) as TResponse;
    } finally {
      await release();
    }
  } finally {
    clearTimeout(timeout);
  }
}

export class CseClawClient {
  constructor(private readonly config: CseClawConfig) {}

  preTurn(request: CseClawPreTurnRequest): Promise<CseClawPreTurnResponse> {
    return postJson<CseClawPreTurnResponse>(this.config, "/v1/claw/turns/pre", request);
  }

  postTurn(request: CseClawPostTurnRequest): Promise<CseClawPostTurnResponse> {
    return postJson<CseClawPostTurnResponse>(this.config, "/v1/claw/turns/post", request);
  }
}
