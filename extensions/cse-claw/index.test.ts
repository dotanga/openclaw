import { afterEach, describe, expect, it, vi } from "vitest";

const { postTurnMock, preTurnMock } = vi.hoisted(() => ({
  postTurnMock: vi.fn(),
  preTurnMock: vi.fn(),
}));

vi.mock("./src/client.js", () => ({
  CseClawClient: vi.fn(function CseClawClientMock() {
    return {
      preTurn: preTurnMock,
      postTurn: postTurnMock,
    };
  }),
}));

import { registerCseClawPlugin } from "./index.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>;

function createApi(pluginConfig: Record<string, unknown>) {
  const handlers = new Map<string, Handler>();
  const api = {
    logger: { warn: vi.fn() },
    on: vi.fn((eventName: string, handler: Handler) => {
      handlers.set(eventName, handler);
    }),
    pluginConfig,
    runtime: {},
  };
  registerCseClawPlugin(api as never);
  return { api, handlers };
}

afterEach(() => {
  postTurnMock.mockReset();
  preTurnMock.mockReset();
  vi.restoreAllMocks();
});

describe("CSE_Claw plugin hooks", () => {
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
      },
    );

    expect(preTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        turn_id: "run-1",
        channel: "telegram",
        source_id: "openclaw",
        user_text: "hello token=[REDACTED]",
      }),
    );
    expect(result).toStrictEqual({
      prependContext: expect.stringContaining("Prefer careful verification."),
    });
    expect(JSON.stringify(result)).toContain("grants no tool permissions");
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
