import { afterEach, describe, expect, it, vi } from "vitest";
import { CseClawClient } from "./client.js";
import { resolveCseClawConfig } from "./config.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("CSE_Claw client", () => {
  it("posts pre-turn JSON to the configured backend", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
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
    global.fetch = fetchMock as typeof fetch;

    const client = new CseClawClient(
      resolveCseClawConfig({ endpoint: "http://127.0.0.1:9999/", timeoutMs: 500 }),
    );

    await expect(
      client.preTurn({
        turn_id: "run-1",
        channel: "telegram",
        source_id: "openclaw",
        user_text: "hello",
        trusted_metadata: { runId: "run-1" },
        context_refs: [],
      }),
    ).resolves.toMatchObject({ trace_id: "trace-1", advisory_context: "steady" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:9999/v1/claw/turns/pre");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      turn_id: "run-1",
      source_id: "openclaw",
      user_text: "hello",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws a bounded error body for non-2xx responses", async () => {
    global.fetch = vi.fn(async () => new Response("x".repeat(400), { status: 503 })) as typeof fetch;
    const client = new CseClawClient(resolveCseClawConfig({ endpoint: "http://cse.test" }));

    await expect(
      client.postTurn({
        trace_id: "trace-1",
        assistant_text: "nope",
        tool_calls: [],
        outcome: "agent_end_error",
        metadata: {},
      }),
    ).rejects.toThrow(/CSE backend 503/);
  });
});
