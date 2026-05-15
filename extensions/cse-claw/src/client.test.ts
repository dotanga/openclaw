import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchWithSsrFGuardMock } = vi.hoisted(() => ({
  fetchWithSsrFGuardMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/ssrf-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/ssrf-runtime")>();
  return {
    ...actual,
    fetchWithSsrFGuard: fetchWithSsrFGuardMock,
  };
});

import {
  CSE_CLAW_BRIDGE_CAPABILITIES,
  CSE_CLAW_BRIDGE_SCHEMA_VERSION,
  CseClawClient,
} from "./client.js";
import { resolveCseClawConfig } from "./config.js";

type GuardRequest = {
  url: string;
  init?: RequestInit;
  auditContext?: string;
  policy?: unknown;
};

function queueGuardedResponse(response: Response): { release: ReturnType<typeof vi.fn> } {
  const release = vi.fn(async () => {});
  fetchWithSsrFGuardMock.mockResolvedValueOnce({ response, release });
  return { release };
}

function lastGuardRequest(): GuardRequest {
  const call = fetchWithSsrFGuardMock.mock.calls.at(-1);
  if (!call) {
    throw new Error("fetchWithSsrFGuard was not called");
  }
  return call[0] as GuardRequest;
}

afterEach(() => {
  fetchWithSsrFGuardMock.mockReset();
  vi.restoreAllMocks();
});

describe("CSE_Claw client", () => {
  it("posts pre-turn JSON to the configured backend", async () => {
    const { release } = queueGuardedResponse(
      new Response(
        JSON.stringify({
          schema_version: "cse-claw.bridge.v1",
          trace_id: "trace-1",
          event_id: "event-1",
          experience_id: "exp-1",
          cog_snapshot_id: "cog-1",
          behaviour_id: "behaviour-1",
          advisory_context: "steady",
        }),
        { status: 200 },
      ),
    );

    const client = new CseClawClient(
      resolveCseClawConfig({ endpoint: "http://127.0.0.1:9999/", timeoutMs: 500 }),
    );

    await expect(
      client.preTurn({
        schema_version: CSE_CLAW_BRIDGE_SCHEMA_VERSION,
        capabilities: [...CSE_CLAW_BRIDGE_CAPABILITIES],
        event: {
          kind: "TurnPreEvent",
          turn_id: "run-1",
          channel: "telegram",
          source_id: "openclaw",
          user_text: "hello",
          trusted_metadata: { runId: "run-1" },
          context_refs: [],
        },
        turn_id: "run-1",
        channel: "telegram",
        source_id: "openclaw",
        user_text: "hello",
        trusted_metadata: { runId: "run-1" },
        context_refs: [],
      }),
    ).resolves.toMatchObject({ trace_id: "trace-1", advisory_context: "steady" });

    expect(fetchWithSsrFGuardMock).toHaveBeenCalledTimes(1);
    const request = lastGuardRequest();
    expect(request.url).toBe("http://127.0.0.1:9999/v1/claw/turns/pre");
    expect(request.auditContext).toBe("cse-claw");
    expect(request.policy).toStrictEqual({ allowedHostnames: ["127.0.0.1"] });
    expect(request.init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const requestBody = request.init?.body;
    expect(typeof requestBody).toBe("string");
    expect(JSON.parse(requestBody as string)).toMatchObject({
      schema_version: "cse-claw.bridge.v1",
      capabilities: expect.arrayContaining(["structured_events", "replay_references"]),
      event: {
        kind: "TurnPreEvent",
        turn_id: "run-1",
        source_id: "openclaw",
        user_text: "hello",
      },
      turn_id: "run-1",
      source_id: "openclaw",
      user_text: "hello",
    });
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("throws a bounded error body for non-2xx responses and releases the fetch", async () => {
    const { release } = queueGuardedResponse(new Response("x".repeat(400), { status: 503 }));
    const client = new CseClawClient(resolveCseClawConfig({ endpoint: "http://cse.test" }));

    await expect(
      client.postTurn({
        schema_version: CSE_CLAW_BRIDGE_SCHEMA_VERSION,
        capabilities: [...CSE_CLAW_BRIDGE_CAPABILITIES],
        event: {
          kind: "TurnPostEvent",
          trace_id: "trace-1",
          assistant_text: "nope",
          tool_calls: [],
          outcome: "agent_end_error",
          metadata: {},
        },
        trace_id: "trace-1",
        assistant_text: "nope",
        tool_calls: [],
        outcome: "agent_end_error",
        metadata: {},
      }),
    ).rejects.toThrow(/CSE backend 503/);

    expect(release).toHaveBeenCalledTimes(1);
  });
});
