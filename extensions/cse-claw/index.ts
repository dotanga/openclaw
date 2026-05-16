import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { resolveLivePluginConfigObject } from "openclaw/plugin-sdk/plugin-config-runtime";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  CSE_CLAW_BRIDGE_CAPABILITIES,
  CSE_CLAW_BRIDGE_SCHEMA_VERSION,
  CseClawClient,
  type CseClawOperatorStatus,
  type CseClawOperatorTrace,
} from "./src/client.js";
import { resolveCseClawConfig, type CseClawConfig } from "./src/config.js";
import { buildAdvisoryPrompt } from "./src/prompt.js";
import { redactForCse, sanitizeMetadata } from "./src/redaction.js";

type TraceState = {
  traceId: string;
  lastPostAtMs?: number;
};

type BridgeFailure = {
  phase: "pre" | "post" | "status" | "trace";
  atMs: number;
  message: string;
};

type BridgeHealthState = {
  preTurnSuccessCount: number;
  preTurnFailureCount: number;
  postTurnSuccessCount: number;
  postTurnFailureCount: number;
  lastSuccessAtMs?: number;
  lastFailure?: BridgeFailure;
  lastTraceId?: string;
};

type ChatType = "direct" | "group" | "channel";

const runTraces = new Map<string, TraceState>();
const bridgeHealth: BridgeHealthState = {
  preTurnSuccessCount: 0,
  preTurnFailureCount: 0,
  postTurnSuccessCount: 0,
  postTurnFailureCount: 0,
};

function boundedFailureMessage(error: unknown): string {
  return redactForCse(String(error), 500).replace(/\s+/g, " ").slice(0, 500);
}

function recordBridgeSuccess(phase: "pre" | "post", traceId?: string): void {
  if (phase === "pre") {
    bridgeHealth.preTurnSuccessCount += 1;
  } else {
    bridgeHealth.postTurnSuccessCount += 1;
  }
  bridgeHealth.lastSuccessAtMs = Date.now();
  if (traceId) {
    bridgeHealth.lastTraceId = traceId;
  }
}

function recordBridgeFailure(phase: BridgeFailure["phase"], error: unknown): void {
  if (phase === "pre") {
    bridgeHealth.preTurnFailureCount += 1;
  } else if (phase === "post") {
    bridgeHealth.postTurnFailureCount += 1;
  }
  bridgeHealth.lastFailure = {
    phase,
    atMs: Date.now(),
    message: boundedFailureMessage(error),
  };
}

function bridgeHealthSnapshot(): BridgeHealthState {
  return {
    ...bridgeHealth,
    lastFailure: bridgeHealth.lastFailure ? { ...bridgeHealth.lastFailure } : undefined,
  };
}

function resolveCurrentConfig(api: OpenClawPluginApi): CseClawConfig {
  const runtimePluginConfig = resolveLivePluginConfigObject(
    api.runtime.config?.current ? () => api.runtime.config.current() as OpenClawConfig : undefined,
    "cse-claw",
    api.pluginConfig as Record<string, unknown>,
  );
  return resolveCseClawConfig(runtimePluginConfig);
}

function traceKey(ctx: {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
}): string | undefined {
  return ctx.runId ?? ctx.sessionId ?? ctx.sessionKey;
}

function normalizeChatType(value: unknown): ChatType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "direct" || normalized === "dm") {
    return "direct";
  }
  if (normalized === "group" || normalized === "guild") {
    return "group";
  }
  if (normalized === "channel" || normalized === "room" || normalized === "space") {
    return "channel";
  }
  return undefined;
}

function inferChatType(ctx: Record<string, unknown>): ChatType | undefined {
  const explicit =
    normalizeChatType(ctx.chatType) ??
    normalizeChatType(ctx.ChatType) ??
    normalizeChatType(ctx.chat_type);
  if (explicit) {
    return explicit;
  }
  const sessionKey = typeof ctx.sessionKey === "string" ? ctx.sessionKey.toLowerCase() : "";
  if (sessionKey.includes(":group:")) {
    return "group";
  }
  if (sessionKey.includes(":channel:")) {
    return "channel";
  }
  if (sessionKey.includes(":dm:") || sessionKey.includes(":direct:")) {
    return "direct";
  }
  return undefined;
}

function isSharedChatType(chatType: ChatType | undefined): boolean {
  return chatType === "group" || chatType === "channel";
}

function logBridgeFailure(api: OpenClawPluginApi, config: CseClawConfig, message: string): void {
  if (config.logFailures) {
    api.logger.warn(`cse-claw: ${message}`);
  }
}

function formatBool(value: unknown): string {
  return value === true ? "yes" : value === false ? "no" : "unknown";
}

function formatScalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "present";
}

function formatLatestCog(latestCog: Record<string, unknown> | null | undefined): string {
  if (!latestCog) {
    return "none";
  }
  const id = latestCog.cog_snapshot_id ?? latestCog.snapshot_id ?? latestCog.id ?? "present";
  const scope = latestCog.scope ? ` scope=${formatScalar(latestCog.scope)}` : "";
  return `${formatScalar(id)}${scope}`;
}

function formatOperatorStatus(status: CseClawOperatorStatus): string {
  return [
    "CSE_Claw backend: reachable",
    `Entity session: ${status.entity_session_id}`,
    `Latest CoG: ${formatLatestCog(status.latest_cog)}`,
    `Pending proposals: ${status.pending_proposals}`,
    "Safety:",
    `- CSE suggestions are tool permissions: ${formatBool(status.safety.cse_suggestions_are_tool_permissions)}`,
    `- Automatic OpenClaw memory writes: ${formatBool(status.safety.automatic_openclaw_memory_writes)}`,
    `- System prompt override enabled: ${formatBool(status.safety.system_prompt_override_enabled)}`,
  ].join("\n");
}

function formatTrace(trace: CseClawOperatorTrace): string {
  const artifactCount = trace.counts.model_artifacts ?? trace.counts.artifacts ?? 0;
  const eventCount = trace.counts.events ?? 0;
  const experienceCount = trace.counts.experiences ?? 0;
  const timelineCount = trace.timeline.length;
  const summaryKind = typeof trace.summary.kind === "string" ? trace.summary.kind : "trace_audit";
  return [
    `CSE_Claw trace: ${trace.trace_id}`,
    `Summary: ${summaryKind}`,
    `Counts: events=${eventCount}, experiences=${experienceCount}, artifacts=${artifactCount}, timeline=${timelineCount}`,
    "Replay reference: use this trace id with the CSE operator trace endpoint for full audit details.",
  ].join("\n");
}

function formatCommandStatus(config: CseClawConfig, backendText?: string): string {
  return [
    "CSE_Claw plugin:",
    `- Enabled: ${config.enabled ? "yes" : "no"}`,
    `- Endpoint: ${config.endpoint}`,
    `- Schema: ${CSE_CLAW_BRIDGE_SCHEMA_VERSION}`,
    `- Capabilities: ${CSE_CLAW_BRIDGE_CAPABILITIES.join(", ")}`,
    `- Advisory injection: ${config.injectAdvisoryContext ? "yes" : "no"}`,
    `- Fail-open: yes`,
    backendText ? `\n${backendText}` : undefined,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

function formatHelp(config: CseClawConfig): string {
  return [
    formatCommandStatus(config),
    "",
    "Commands:",
    "- /cse status — show plugin config and CSE backend status",
    "- /cse trace <trace_id> — show a bounded CSE trace summary",
    "- /cse help — show this help",
  ].join("\n");
}

async function postObservation(params: {
  api: OpenClawPluginApi;
  config: CseClawConfig;
  traceId: string;
  assistantText: string;
  outcome: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    await new CseClawClient(params.config).postTurn({
      schema_version: CSE_CLAW_BRIDGE_SCHEMA_VERSION,
      capabilities: [...CSE_CLAW_BRIDGE_CAPABILITIES],
      event: {
        kind: "TurnPostEvent",
        trace_id: params.traceId,
        assistant_text: redactForCse(params.assistantText, params.config.maxAssistantChars),
        tool_calls: [],
        outcome: params.outcome,
        metadata: params.metadata,
      },
      trace_id: params.traceId,
      assistant_text: redactForCse(params.assistantText, params.config.maxAssistantChars),
      tool_calls: [],
      outcome: params.outcome,
      metadata: params.metadata,
    });
    recordBridgeSuccess("post", params.traceId);
  } catch (error) {
    recordBridgeFailure("post", error);
    logBridgeFailure(params.api, params.config, `post-turn observation skipped: ${String(error)}`);
  }
}

function registerOperatorMethods(api: OpenClawPluginApi): void {
  api.registerGatewayMethod(
    "cseClaw.status",
    async ({ respond }) => {
      const config = resolveCurrentConfig(api);
      const base = {
        enabled: config.enabled,
        endpoint: config.endpoint,
        inject_advisory_context: config.injectAdvisoryContext,
        schema_version: CSE_CLAW_BRIDGE_SCHEMA_VERSION,
        capabilities: [...CSE_CLAW_BRIDGE_CAPABILITIES],
        bridge: bridgeHealthSnapshot(),
      };
      if (!config.enabled) {
        respond(true, { ...base, backend: { reachable: false, reason: "disabled" } });
        return;
      }
      try {
        const status = await new CseClawClient(config).operatorStatus();
        respond(true, { ...base, backend: { reachable: true, status } });
      } catch (error) {
        recordBridgeFailure("status", error);
        respond(true, {
          ...base,
          bridge: bridgeHealthSnapshot(),
          backend: { reachable: false, error: boundedFailureMessage(error) },
        });
      }
    },
    { scope: "operator.read" },
  );

  api.registerGatewayMethod(
    "cseClaw.trace",
    async ({ params, respond }) => {
      const config = resolveCurrentConfig(api);
      const traceIdRaw =
        params && typeof params === "object" && "traceId" in params
          ? (params as { traceId?: unknown }).traceId
          : undefined;
      const traceId = typeof traceIdRaw === "string" ? traceIdRaw.trim() : "";
      if (!traceId) {
        respond(false, undefined, { code: "BAD_REQUEST", message: "traceId is required" });
        return;
      }
      if (!config.enabled) {
        respond(false, undefined, { code: "FAILED_PRECONDITION", message: "CSE_Claw is disabled" });
        return;
      }
      try {
        respond(true, await new CseClawClient(config).operatorTrace(traceId));
      } catch (error) {
        recordBridgeFailure("trace", error);
        respond(false, undefined, {
          code: "CSE_TRACE_UNAVAILABLE",
          message: boundedFailureMessage(error),
        });
      }
    },
    { scope: "operator.read" },
  );
}

export function registerCseClawPlugin(api: OpenClawPluginApi): void {
  registerOperatorMethods(api);

  api.registerCommand({
    name: "cse",
    description: "Inspect the advisory CSE_Claw bridge status and traces.",
    acceptsArgs: true,
    requiredScopes: ["operator.read"],
    handler: async (ctx) => {
      const config = resolveCurrentConfig(api);
      const tokens = (ctx.args ?? "").trim().split(/\s+/).filter(Boolean);
      const action = tokens[0]?.toLowerCase() || "status";

      if (action === "help") {
        return { text: formatHelp(config) };
      }

      if (action === "trace") {
        const traceId = tokens[1];
        if (!traceId) {
          return { text: "Usage: /cse trace <trace_id>" };
        }
        try {
          const trace = await new CseClawClient(config).operatorTrace(traceId);
          return { text: formatTrace(trace) };
        } catch (error) {
          return {
            text: `${formatCommandStatus(config)}\n\nCSE_Claw trace lookup failed: ${String(error)}`,
          };
        }
      }

      if (action !== "status") {
        return { text: `Unknown CSE_Claw command: ${action}\n\n${formatHelp(config)}` };
      }

      if (!config.enabled) {
        return {
          text: formatCommandStatus(config, "Backend not queried because the bridge is disabled."),
        };
      }

      try {
        const status = await new CseClawClient(config).operatorStatus();
        return { text: formatCommandStatus(config, formatOperatorStatus(status)) };
      } catch (error) {
        return {
          text: `${formatCommandStatus(config)}\n\nCSE_Claw backend status failed: ${String(error)}`,
        };
      }
    },
  });

  api.on(
    "before_prompt_build",
    async (event, ctx) => {
      const config = resolveCurrentConfig(api);
      if (!config.enabled) {
        return undefined;
      }
      const prompt = typeof event.prompt === "string" ? event.prompt : "";
      if (prompt.trim().length === 0) {
        return undefined;
      }
      const chatType = inferChatType(ctx);
      if (isSharedChatType(chatType) && config.sharedContextMode === "off") {
        return undefined;
      }
      try {
        const result = await new CseClawClient(config).preTurn({
          schema_version: CSE_CLAW_BRIDGE_SCHEMA_VERSION,
          capabilities: [...CSE_CLAW_BRIDGE_CAPABILITIES],
          event: {
            kind: "TurnPreEvent",
            turn_id: ctx.runId,
            channel: ctx.messageProvider ?? ctx.channelId,
            chat_type: chatType,
            source_id: "openclaw",
            user_text: redactForCse(prompt, config.maxPromptChars),
            trusted_metadata: sanitizeMetadata({
              runId: ctx.runId,
              agentId: ctx.agentId,
              sessionKey: ctx.sessionKey,
              sessionId: ctx.sessionId,
              workspaceDir: ctx.workspaceDir,
              modelProviderId: ctx.modelProviderId,
              modelId: ctx.modelId,
              messageProvider: ctx.messageProvider,
              trigger: ctx.trigger,
              channelId: ctx.channelId,
              chatType,
            }),
            context_refs: [],
          },
          turn_id: ctx.runId,
          channel: ctx.messageProvider ?? ctx.channelId,
          chat_type: chatType,
          source_id: "openclaw",
          user_text: redactForCse(prompt, config.maxPromptChars),
          trusted_metadata: sanitizeMetadata({
            runId: ctx.runId,
            agentId: ctx.agentId,
            sessionKey: ctx.sessionKey,
            sessionId: ctx.sessionId,
            workspaceDir: ctx.workspaceDir,
            modelProviderId: ctx.modelProviderId,
            modelId: ctx.modelId,
            messageProvider: ctx.messageProvider,
            trigger: ctx.trigger,
            channelId: ctx.channelId,
            chatType,
          }),
          context_refs: [],
        });
        const key = traceKey(ctx);
        if (key) {
          runTraces.set(key, { traceId: result.trace_id });
        }
        recordBridgeSuccess("pre", result.trace_id);
        const shouldInjectAdvisory =
          config.injectAdvisoryContext &&
          (!isSharedChatType(chatType) || config.sharedContextMode === "advisory");
        if (!shouldInjectAdvisory) {
          return undefined;
        }
        const advisory = buildAdvisoryPrompt(result);
        return advisory ? { prependContext: advisory } : undefined;
      } catch (error) {
        recordBridgeFailure("pre", error);
        logBridgeFailure(api, config, `pre-turn advisory skipped: ${String(error)}`);
        return undefined;
      }
    },
    { timeoutMs: 11_000 },
  );

  api.on("llm_output", async (event, ctx) => {
    const config = resolveCurrentConfig(api);
    if (!config.enabled) {
      return;
    }
    const key = traceKey(ctx) ?? event.runId ?? event.sessionId;
    const trace = key ? runTraces.get(key) : undefined;
    if (!trace) {
      return;
    }
    trace.lastPostAtMs = Date.now();
    await postObservation({
      api,
      config,
      traceId: trace.traceId,
      assistantText: event.assistantTexts.join("\n\n"),
      outcome: "llm_output",
      metadata: sanitizeMetadata({
        runId: event.runId,
        sessionId: event.sessionId,
        modelProviderId: event.provider,
        modelId: event.model,
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
        messageProvider: ctx.messageProvider,
        channelId: ctx.channelId,
      }),
    });
  });

  api.on("agent_end", async (event, ctx) => {
    const config = resolveCurrentConfig(api);
    if (!config.enabled) {
      return;
    }
    const key = traceKey(ctx) ?? event.runId;
    const trace = key ? runTraces.get(key) : undefined;
    if (!trace) {
      return;
    }
    await postObservation({
      api,
      config,
      traceId: trace.traceId,
      assistantText: event.error ?? "",
      outcome: event.success ? "agent_end_success" : "agent_end_error",
      metadata: sanitizeMetadata({
        runId: event.runId,
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
        sessionId: ctx.sessionId,
        modelProviderId: ctx.modelProviderId,
        modelId: ctx.modelId,
        messageProvider: ctx.messageProvider,
        channelId: ctx.channelId,
      }),
    });
    if (key) {
      runTraces.delete(key);
    }
  });
}

export default definePluginEntry({
  id: "cse-claw",
  name: "CSE_Claw",
  description: "Passive bridge from OpenClaw turns into a local CSE cognition backend.",
  register: registerCseClawPlugin,
});
