import { afterEach, describe, expect, it, vi } from "vitest";

const { operatorStatusMock, operatorTraceMock, postTurnMock, preTurnMock } = vi.hoisted(() => ({
  operatorStatusMock: vi.fn(),
  operatorTraceMock: vi.fn(),
  postTurnMock: vi.fn(),
  preTurnMock: vi.fn(),
}));

vi.mock("./src/client.js", () => ({
  CSE_CLAW_BRIDGE_SCHEMA_VERSION: "cse-claw.bridge.v1",
  CSE_CLAW_BRIDGE_CAPABILITIES: [
    "structured_events",
    "replay_references",
    "structured_influence_packets",
    "bounded_advisory_context",
  ],
  CseClawClient: vi.fn(function CseClawClientMock() {
    return {
      operatorStatus: operatorStatusMock,
      operatorTrace: operatorTraceMock,
      preTurn: preTurnMock,
      postTurn: postTurnMock,
    };
  }),
}));

import { registerCseClawPlugin } from "./index.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>;
type Command = {
  handler: (ctx: { args?: string; [key: string]: unknown }) => Promise<{ text: string }>;
};

function createApi(pluginConfig: Record<string, unknown>) {
  const commands: Command[] = [];
  const handlers = new Map<string, Handler>();
  const gatewayMethods = new Map<string, Handler>();
  const api = {
    logger: { warn: vi.fn() },
    on: vi.fn((eventName: string, handler: Handler) => {
      handlers.set(eventName, handler);
    }),
    registerCommand: vi.fn((command: Command) => {
      commands.push(command);
    }),
    pluginConfig,
    registerGatewayMethod: vi.fn((method: string, handler: Handler) => {
      gatewayMethods.set(method, handler);
    }),
    runtime: {},
  };
  registerCseClawPlugin(api as never);
  return { api, commands, gatewayMethods, handlers };
}

function createResponder() {
  return vi.fn();
}

afterEach(() => {
  operatorStatusMock.mockReset();
  operatorTraceMock.mockReset();
  postTurnMock.mockReset();
  preTurnMock.mockReset();
  vi.restoreAllMocks();
});

describe("CSE_Claw plugin hooks", () => {
  it("registers an operator-visible status command", async () => {
    operatorStatusMock.mockResolvedValueOnce({
      mode: "operator_claw_status",
      entity_session_id: "cse-entity-main",
      latest_cog: { cog_snapshot_id: "cog-1" },
      pending_proposals: 2,
      safety: {
        cse_suggestions_are_tool_permissions: false,
        automatic_openclaw_memory_writes: false,
        system_prompt_override_enabled: false,
      },
    });
    const { api, commands } = createApi({ enabled: true, endpoint: "http://127.0.0.1:8000" });

    expect(api.registerCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "cse",
        acceptsArgs: true,
        requiredScopes: ["operator.read"],
      }),
    );

    const result = await commands[0]?.handler({ args: "status", channel: "telegram" });

    expect(operatorStatusMock).toHaveBeenCalledTimes(1);
    expect(result?.text).toContain("CSE_Claw plugin:");
    expect(result?.text).toContain("Schema: cse-claw.bridge.v1");
    expect(result?.text).toContain("CSE_Claw backend: reachable");
    expect(result?.text).toContain("CSE suggestions are tool permissions: no");
  });

  it("keeps status local when disabled", async () => {
    const { commands } = createApi({ enabled: false, endpoint: "http://127.0.0.1:8000" });

    const result = await commands[0]?.handler({ args: "status", channel: "telegram" });

    expect(operatorStatusMock).not.toHaveBeenCalled();
    expect(result?.text).toContain("Enabled: no");
    expect(result?.text).toContain("Backend not queried because the bridge is disabled.");
  });

  it("formats bounded trace summaries", async () => {
    operatorTraceMock.mockResolvedValueOnce({
      mode: "operator_claw_trace",
      trace_id: "trace-1",
      counts: { events: 1, experiences: 1, model_artifacts: 2 },
      timeline: [{ kind: "event" }, { kind: "artifact" }],
      summary: { kind: "TraceAuditSummary" },
    });
    const { commands } = createApi({ enabled: true, endpoint: "http://127.0.0.1:8000" });

    const result = await commands[0]?.handler({ args: "trace trace-1", channel: "telegram" });

    expect(operatorTraceMock).toHaveBeenCalledWith("trace-1");
    expect(result?.text).toContain("CSE_Claw trace: trace-1");
    expect(result?.text).toContain("Counts: events=1, experiences=1, artifacts=2, timeline=2");
  });

  it("records a pre-turn trace and injects bounded advisory context", async () => {
    preTurnMock.mockResolvedValueOnce({
      trace_id: "trace-1",
      event_id: "event-1",
      experience_id: "experience-1",
      cog_snapshot_id: "cog-1",
      behaviour_id: "behaviour-1",
      advisory_context: "Prefer careful verification.",
    });
    const { handlers } = createApi({ enabled: true, endpoint: "http://127.0.0.1:8000" });

    const result = await handlers.get("before_prompt_build")?.(
      { prompt: "hello token=super-secret" },
      {
        runId: "run-1",
        agentId: "agent-1",
        sessionKey: "session-key-1",
        sessionId: "session-1",
        messageProvider: "telegram",
        channelId: "telegram",
        chatType: "direct",
      },
    );

    expect(preTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema_version: "cse-claw.bridge.v1",
        capabilities: expect.arrayContaining(["structured_events", "replay_references"]),
        event: expect.objectContaining({
          kind: "TurnPreEvent",
          turn_id: "run-1",
          source_id: "openclaw",
          chat_type: "direct",
          user_text: "hello token=[REDACTED]",
        }),
        turn_id: "run-1",
        channel: "telegram",
        chat_type: "direct",
        source_id: "openclaw",
        user_text: "hello token=[REDACTED]",
      }),
    );
    expect(result).toStrictEqual({
      prependContext: expect.stringContaining("Prefer careful verification."),
    });
    expect(JSON.stringify(result)).toContain("grants no tool permissions");
  });

  it("exposes disabled CSE_Claw status without probing the backend", async () => {
    const { api, gatewayMethods } = createApi({ enabled: false });
    const respond = createResponder();

    await gatewayMethods.get("cseClaw.status")?.({ respond }, {});

    expect(api.registerGatewayMethod).toHaveBeenCalledWith("cseClaw.status", expect.any(Function), {
      scope: "operator.read",
    });
    expect(operatorStatusMock).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        enabled: false,
        backend: { reachable: false, reason: "disabled" },
        bridge: expect.objectContaining({
          preTurnSuccessCount: expect.any(Number),
          postTurnFailureCount: expect.any(Number),
        }),
      }),
    );
  });

  it("tracks healthy bridge state and exposes backend status", async () => {
    preTurnMock.mockResolvedValueOnce({
      trace_id: "trace-healthy",
      event_id: "event-1",
      experience_id: "experience-1",
      cog_snapshot_id: "cog-1",
      behaviour_id: "behaviour-1",
      advisory_context: "steady",
    });
    postTurnMock.mockResolvedValueOnce({
      trace_id: "trace-healthy",
      event_id: "event-2",
      artifact_id: "artifact-1",
      outcome: "llm_output",
      writes_canonical_openclaw_state: false,
    });
    operatorStatusMock.mockResolvedValueOnce({ ready: true });
    const { gatewayMethods, handlers } = createApi({
      enabled: true,
      endpoint: "http://127.0.0.1:8000",
    });

    await handlers.get("before_prompt_build")?.({ prompt: "hello" }, { runId: "run-healthy" });
    await handlers.get("llm_output")?.(
      { runId: "run-healthy", sessionId: "session-1", assistantTexts: ["assistant"] },
      { runId: "run-healthy" },
    );
    const respond = createResponder();
    await gatewayMethods.get("cseClaw.status")?.({ respond }, {});

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        enabled: true,
        backend: { reachable: true, status: { ready: true } },
        bridge: expect.objectContaining({
          lastTraceId: "trace-healthy",
          preTurnSuccessCount: expect.any(Number),
          postTurnSuccessCount: expect.any(Number),
        }),
        evaluation: expect.objectContaining({
          metrics: expect.objectContaining({
            preCallCount: expect.any(Number),
            postCallCount: expect.any(Number),
            averagePreCallLatencyMs: expect.any(Number),
            averagePostCallLatencyMs: expect.any(Number),
            advisoryInjectionRate: expect.any(Number),
            backendFailureRate: expect.any(Number),
          }),
          recentOutcomes: expect.arrayContaining([
            expect.objectContaining({
              traceId: "trace-healthy",
              turnId: "run-healthy",
              outcome: "llm_output",
              postLatencyMs: expect.any(Number),
            }),
          ]),
          authorityBoundary: {
            evaluationSignalsGrantToolPermissions: false,
            evaluationSignalsOverridePolicy: false,
            confidenceKind: "empirical_causal_stability_only",
          },
        }),
      }),
    );
  });

  it("reports disconnected backend status with bounded redacted failure details", async () => {
    operatorStatusMock.mockRejectedValueOnce(
      new Error("CSE backend 503 token=super-secret " + "x".repeat(800)),
    );
    const { gatewayMethods } = createApi({ enabled: true, endpoint: "http://127.0.0.1:8000" });
    const respond = createResponder();

    await gatewayMethods.get("cseClaw.status")?.({ respond }, {});

    const payload = respond.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.backend).toMatchObject({ reachable: false });
    expect(JSON.stringify(payload)).toContain("token=[REDACTED]");
    expect(JSON.stringify(payload)).not.toContain("super-secret");
    expect(JSON.stringify(payload.backend).length).toBeLessThan(700);
  });

  it("fetches an operator trace by trace id", async () => {
    operatorTraceMock.mockResolvedValueOnce({ trace_id: "trace-1", events: [] });
    const { gatewayMethods } = createApi({ enabled: true, endpoint: "http://127.0.0.1:8000" });
    const respond = createResponder();

    await gatewayMethods.get("cseClaw.trace")?.({ params: { traceId: "trace-1" }, respond }, {});

    expect(operatorTraceMock).toHaveBeenCalledWith("trace-1");
    expect(respond).toHaveBeenCalledWith(true, { trace_id: "trace-1", events: [] });
  });

  it("keeps shared contexts audit-only by default", async () => {
    preTurnMock.mockResolvedValueOnce({
      trace_id: "trace-group",
      event_id: "event-1",
      experience_id: "experience-1",
      cog_snapshot_id: "cog-1",
      behaviour_id: "behaviour-1",
      advisory_context: "private continuity hint",
    });
    const { handlers } = createApi({ enabled: true, endpoint: "http://127.0.0.1:8000" });

    const result = await handlers.get("before_prompt_build")?.(
      { prompt: "hello from group" },
      {
        runId: "run-group",
        sessionKey: "agent:main:discord:group:general",
        messageProvider: "discord",
        channelId: "discord",
      },
    );

    expect(preTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          chat_type: "group",
          user_text: "hello from group",
        }),
        chat_type: "group",
      }),
    );
    expect(result).toBeUndefined();
  });

  it("can disable CSE entirely for shared contexts", async () => {
    const { handlers } = createApi({
      enabled: true,
      endpoint: "http://127.0.0.1:8000",
      sharedContextMode: "off",
    });

    const result = await handlers.get("before_prompt_build")?.(
      { prompt: "hello from channel" },
      {
        runId: "run-channel",
        sessionKey: "agent:main:slack:channel:general",
      },
    );

    expect(result).toBeUndefined();
    expect(preTurnMock).not.toHaveBeenCalled();
  });

  it("allows explicit advisory injection in shared contexts", async () => {
    preTurnMock.mockResolvedValueOnce({
      trace_id: "trace-channel",
      event_id: "event-1",
      experience_id: "experience-1",
      cog_snapshot_id: "cog-1",
      behaviour_id: "behaviour-1",
      advisory_context: "shared-safe hint",
    });
    const { handlers } = createApi({
      enabled: true,
      endpoint: "http://127.0.0.1:8000",
      sharedContextMode: "advisory",
    });

    const result = await handlers.get("before_prompt_build")?.(
      { prompt: "hello from channel" },
      {
        runId: "run-channel",
        sessionKey: "agent:main:slack:channel:general",
      },
    );

    expect(result).toStrictEqual({
      prependContext: expect.stringContaining("shared-safe hint"),
    });
  });

  it("posts assistant output back to the same CSE trace without OpenClaw writes", async () => {
    preTurnMock.mockResolvedValueOnce({
      trace_id: "trace-1",
      event_id: "event-1",
      experience_id: "experience-1",
      cog_snapshot_id: "cog-1",
      behaviour_id: "behaviour-1",
      advisory_context: "steady",
    });
    postTurnMock.mockResolvedValue({
      trace_id: "trace-1",
      event_id: "event-2",
      artifact_id: "artifact-1",
      outcome: "llm_output",
      writes_canonical_openclaw_state: false,
    });
    const { handlers } = createApi({ enabled: true, endpoint: "http://127.0.0.1:8000" });

    await handlers.get("before_prompt_build")?.({ prompt: "hello" }, { runId: "run-1" });
    await handlers.get("llm_output")?.(
      {
        runId: "run-1",
        sessionId: "session-1",
        assistantTexts: ["assistant token=hidden"],
        provider: "provider-1",
        model: "model-1",
      },
      { runId: "run-1", agentId: "agent-1" },
    );

    expect(postTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema_version: "cse-claw.bridge.v1",
        capabilities: expect.arrayContaining(["structured_events", "replay_references"]),
        event: expect.objectContaining({
          kind: "TurnPostEvent",
          trace_id: "trace-1",
          assistant_text: "assistant token=[REDACTED]",
        }),
        trace_id: "trace-1",
        assistant_text: "assistant token=[REDACTED]",
        tool_calls: [],
        outcome: "llm_output",
      }),
    );
  });

  it("does nothing when disabled", async () => {
    const { handlers } = createApi({ enabled: false });

    await handlers.get("before_prompt_build")?.({ prompt: "hello" }, { runId: "run-1" });
    await handlers.get("llm_output")?.(
      { runId: "run-1", assistantTexts: ["assistant"] },
      { runId: "run-1" },
    );

    expect(preTurnMock).not.toHaveBeenCalled();
    expect(postTurnMock).not.toHaveBeenCalled();
  });
});
