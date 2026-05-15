import {
  fetchWithSsrFGuard,
  ssrfPolicyFromHttpBaseUrlAllowedHostname,
} from "openclaw/plugin-sdk/ssrf-runtime";
import type { CseClawConfig } from "./config.js";
import type { CseClawPreTurnResponse } from "./prompt.js";

export const CSE_CLAW_BRIDGE_SCHEMA_VERSION = "cse-claw.bridge.v1" as const;

export const CSE_CLAW_BRIDGE_CAPABILITIES = [
  "structured_events",
  "replay_references",
  "structured_influence_packets",
  "bounded_advisory_context",
] as const;

export type CseClawBridgeCapability = (typeof CSE_CLAW_BRIDGE_CAPABILITIES)[number];

export type CseClawTurnPreEvent = {
  kind: "TurnPreEvent";
  turn_id?: string;
  channel?: string;
  chat_type?: string;
  source_id: "openclaw";
  user_text: string;
  trusted_metadata: Record<string, unknown>;
  context_refs: string[];
};

export type CseClawTurnPostEvent = {
  kind: "TurnPostEvent";
  trace_id: string;
  assistant_text: string;
  tool_calls: Array<Record<string, unknown>>;
  outcome: string;
  metadata: Record<string, unknown>;
};

export type CseClawPreTurnRequest = {
  schema_version: typeof CSE_CLAW_BRIDGE_SCHEMA_VERSION;
  capabilities: CseClawBridgeCapability[];
  event: CseClawTurnPreEvent;
  turn_id?: string;
  channel?: string;
  chat_type?: string;
  source_id: "openclaw";
  user_text: string;
  trusted_metadata: Record<string, unknown>;
  context_refs: string[];
};

export type CseClawPostTurnRequest = {
  schema_version: typeof CSE_CLAW_BRIDGE_SCHEMA_VERSION;
  capabilities: CseClawBridgeCapability[];
  event: CseClawTurnPostEvent;
  trace_id: string;
  assistant_text: string;
  tool_calls: Array<Record<string, unknown>>;
  outcome: string;
  metadata: Record<string, unknown>;
};

export type CseClawPostTurnResponse = {
  schema_version?: string;
  accepted_capabilities?: string[];
  trace_id: string;
  event_id: string;
  artifact_id: string;
  outcome: string;
  writes_canonical_openclaw_state: boolean;
  replay_reference?: Record<string, unknown>;
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
