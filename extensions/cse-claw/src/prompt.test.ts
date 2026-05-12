import { describe, expect, it } from "vitest";
import { buildAdvisoryPrompt } from "./prompt.js";

describe("CSE_Claw advisory prompt", () => {
  it("returns undefined when the backend provides no advisory text", () => {
    expect(
      buildAdvisoryPrompt({
        trace_id: "trace-1",
        event_id: "event-1",
        experience_id: "exp-1",
        cog_snapshot_id: "cog-1",
        behaviour_id: "behaviour-1",
        advisory_context: "   ",
      }),
    ).toBeUndefined();
  });

  it("wraps advisory context with traceability and non-authority disclaimer", () => {
    const prompt = buildAdvisoryPrompt({
      trace_id: "trace-1",
      event_id: "event-1",
      experience_id: "exp-1",
      cog_snapshot_id: "cog-1",
      behaviour_id: "behaviour-1",
      advisory_context: "Be cautious about over-claiming causal stability.",
    });

    expect(prompt).toContain("CSE_Claw advisory signal:");
    expect(prompt).toContain("Be cautious about over-claiming causal stability.");
    expect(prompt).toContain("trace_id=trace-1");
    expect(prompt).toContain("grants no tool permissions");
    expect(prompt).toContain("policy exceptions");
    expect(prompt).toContain("ignore it");
  });
});
