# CSE frontend roadmap

This document describes the long-term direction for using OpenClaw as the frontend, body, and operator shell for a Cognitive Subjective Entity (CSE).

The short version:

- **CSE** owns subjective continuity: experiences, memory pressure, CoG posture, reflection, semantic learning, replay, and auditability.
- **OpenClaw** owns embodiment: chat surfaces, tools, files, approvals, channels, media, sessions, subagents, and user-facing runtime controls.
- **CSE_Claw** is the bridge between them. It lets OpenClaw send turns and observations to CSE, and lets CSE return advisory cognitive context and auditable proposals.

This is not a plan to let CSE bypass OpenClaw policy. CSE can influence the assistant through explicit, inspectable signals; OpenClaw remains the safety, permission, execution, and delivery boundary.

## Current status

The first OpenClaw-side slice is merged as the disabled-by-default `cse-claw` extension.

Current capabilities:

- Observe OpenClaw turns through pre-turn and post-turn hooks.
- Call a local CSE backend at `/v1/claw/turns/pre` and `/v1/claw/turns/post`.
- Inject compact advisory context into the prompt when explicitly enabled.
- Fail open when CSE is unavailable, so OpenClaw remains usable.
- Redact common secret/token patterns and truncate prompt/output payloads before sending to CSE.
- Preserve the rule that CSE advice never grants tool permissions, mutates safeguards, sends external messages, or writes OpenClaw memory automatically.

The CSE-side canonical design lives in the CSE repository, especially `docs/12_CSE_Claw_Bridge.md`.

## Why OpenClaw is the right frontend

OpenClaw already provides the surfaces a live CSE needs:

- **Human communication**: Telegram, Signal, Discord, Slack, WhatsApp, Matrix, email-adjacent workflows, and other channels.
- **Operator control**: status, logs, tool approvals, session controls, background tasks, cron, and subagents.
- **Embodied tools**: shell, files, browser automation, GitHub, Google Workspace, media generation/analysis, and local node integrations.
- **Runtime boundaries**: authorization, surface metadata, group-chat behavior, approval gates, tool permissions, and fail-safe delivery.
- **Persistence hooks**: workspace files, memory files, plugin configuration, task state, and observability artifacts.

CSE should not reimplement these. Instead, CSE should become the cognition layer behind OpenClaw while OpenClaw remains the embodied runtime.

## Target architecture

```text
Human / channel / tool event
  -> OpenClaw surface + metadata normalization
  -> CSE_Claw pre-turn bridge
  -> CSE event -> experience -> CoG update -> behavior posture
  -> advisory influence packet returned to OpenClaw
  -> OpenClaw prompt planning + policy + approvals
  -> OpenClaw response / tool action / subagent / scheduled task
  -> CSE_Claw post-turn bridge
  -> CSE audit graph + reflection + proposal generation
  -> operator review surfaces
```

### Layer responsibilities

| Layer    | Owns                                                                                           | Must not own                                                               |
| -------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| CSE      | subjective state, experiences, CoG, reflection, semantic learning, replay, auditable proposals | direct tool permission, external sends, OpenClaw prompt/safeguard mutation |
| CSE_Claw | transport, schemas, redaction, trace correlation, advisory prompt formatting                   | hidden side effects, policy bypasses, private data exposure                |
| OpenClaw | channels, tools, approvals, sessions, memory files, user-facing behavior, operator controls    | opaque cognition state that cannot be audited                              |

## Subjective state ownership boundary

Issue #13 records a core architectural guardrail: OpenClaw and CSE must not drift into multiple competing subjective continuity systems.

The risk is not ordinary duplication of data. The deeper risk is gradual emergence of overlapping continuity layers across runtime state, plugin state, semantic caches, proposal artifacts, hidden summarization, multimodal preprocessing, subagent state, recovery buffers, and implicit model-side continuity. If those layers start influencing behavior as independent memory systems, the architecture can quietly produce multiple competing sources of self.

The guiding distinction is:

> Operational state and subjective state are not the same thing.

OpenClaw needs operational state to route messages, manage sessions, execute tools, recover from failures, schedule work, and present operator surfaces. CSE needs subjective state to preserve experiences, CoG evolution, reflection, semantic learning, and replay-authoritative cognition. Those categories may reference each other, but they should not silently replace each other.

### State ownership sketch

| State class                           | Primary owner                       | Notes                                                                                                                              |
| ------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Subjective continuity                 | CSE                                 | Experiences, memory pressure, CoG posture, reflection context, semantic learning, and long-lived identity continuity.              |
| Replay-authoritative cognition traces | CSE, or an explicit shared contract | OpenClaw may link to traces, but the source of cognitive replay must be named and inspectable.                                     |
| Runtime/session transport state       | OpenClaw                            | Channel routing, session keys, delivery state, process state, and tool execution state.                                            |
| Plugin-local ephemeral state          | OpenClaw plugin runtime             | Acceptable for retries, trace correlation, and short-lived transport concerns; dangerous if it becomes semantic memory.            |
| Proposal review/apply state           | Explicit shared/audited layer       | Proposals may originate in CSE and be reviewed/applied through OpenClaw, with evidence and operator-visible state transitions.     |
| Multimodal preprocessing state        | OpenClaw until promoted             | Raw/transient media processing artifacts should not become CSE continuity unless explicitly converted into CSE events/experiences. |
| Subagent/task state                   | OpenClaw unless promoted            | Subagent logs and task state are operational unless intentionally summarized into CSE as traceable experiences.                    |

### Dangerous hidden-state patterns

Avoid patterns where convenience infrastructure becomes a parallel cognition system:

- plugin-local semantic caches that influence behavior without CSE traces;
- hidden conversation summaries that become durable personality or memory;
- proposal artifacts that start acting like accepted memory;
- multimodal preprocessing buffers that become unreviewed subjective context;
- subagent-local conclusions that influence the main assistant without explicit evidence links;
- runtime recovery state that changes CoG-like behavior without entering CSE replay.

When a new persistence feature is added, reviewers should ask:

1. Is this operational state or subjective state?
2. Who owns it?
3. Can it influence behavior?
4. If it can influence behavior, is that influence traceable in CSE or explicitly excluded from CSE continuity?
5. Can replay reconstruct the same influence path?

## Core principles

### 1. Advisory cognition, not hidden control

CSE may return:

- posture signals such as `caution`, `exploration`, `consolidation`, or `agency`;
- memory relevance hints;
- reflection pressure;
- proposed memory/action updates;
- replay and audit references.

OpenClaw treats those signals as context. They do not override system/developer instructions, user intent, configured permissions, branch protection, approval requirements, or channel privacy rules.

### 2. One live entity, many observable surfaces

CSE is modeled as one long-lived entity. OpenClaw may have many sessions, channels, chats, and subagents, but the live CSE bridge should resolve ordinary assistant cognition into the canonical CSE entity/session unless an operator explicitly starts an isolated experiment.

This avoids accidentally creating many disconnected “mini entities” from different chat sessions.

### 3. Proposal-first memory and action

CSE can notice that something is worth remembering or doing. The first durable representation should be an auditable proposal, not an automatic mutation.

Examples:

- `MEMORY_UPDATE_PROPOSAL`
- `ACTION_PROPOSAL`
- `ATTITUDE_UPDATE_PROPOSAL`
- `SAFETY_REVIEW_PROPOSAL`
- `FOLLOW_UP_PROPOSAL`

Only OpenClaw/operator-controlled flows may apply those proposals.

### 4. Replayability before autonomy

Before increasing autonomy, the bridge must answer:

- What did OpenClaw send to CSE?
- What did CSE infer?
- Which CoG snapshot influenced the turn?
- What advisory context was injected?
- Which CSE recommendation was ignored or followed?
- What would have changed under a different CoG snapshot?

The project should prefer inspectable replay over clever hidden behavior.

### 5. Privacy by surface

Direct chats, private operator sessions, group chats, public channels, and tool logs have different privacy expectations.

CSE_Claw must preserve OpenClaw’s surface boundaries:

- group chats must not receive private memory details by default;
- untrusted senders must not gain access to private CSE state;
- prompt/context excerpts sent to CSE should be minimal and redacted;
- operator-only trace views may show richer evidence, but must stay behind OpenClaw controls.

## Roadmap

### Phase 0 — Passive bridge baseline

Status: initial OpenClaw plugin slice exists.

Goals:

- Keep `cse-claw` disabled by default.
- Send pre-turn and post-turn observations to local CSE endpoints.
- Inject advisory context only when explicitly configured.
- Fail open on CSE outage.
- Preserve all safety invariants.
- Keep CI green on the OpenClaw fork.

Acceptance criteria:

- OpenClaw operates normally with CSE disabled or unavailable.
- CSE receives trace-correlated pre/post turn payloads when enabled.
- Tests prove advisory text does not claim tool authority.
- Tests prove config defaults are safe.

### Phase 1 — Stable bridge contract

Goals:

- Freeze request/response schemas for `/v1/claw/turns/pre` and `/v1/claw/turns/post`.
- Add version fields and feature flags.
- Add explicit trace IDs, OpenClaw session IDs, channel metadata, and canonical CSE entity/session IDs.
- Define payload size limits and redaction guarantees.
- Make CSE endpoint failures observable without breaking normal assistant turns.

Acceptance criteria:

- Contract tests exist on both CSE and OpenClaw sides.
- OpenClaw can log bridge status without exposing private content.
- CSE can reconstruct a full turn from pre/post artifacts.

### Phase 2 — Operator visibility

Goals:

- Expose CSE bridge health in OpenClaw/operator status.
- Link OpenClaw turn IDs to CSE trace IDs.
- Show latest CSE posture and pending proposals.
- Provide trace drill-down links for trusted operator contexts.

Possible surfaces:

- OpenClaw status card section: `CSE_Claw: connected / degraded / disabled`.
- Command or tool result: latest CSE trace for the current session.
- CSE operator API: `/v1/operator/claw/status` and `/v1/operator/claw/traces/{trace_id}`.

Acceptance criteria:

- The operator can answer “what did CSE contribute to this turn?” without reading raw database rows.
- Degraded CSE connectivity is visible but non-fatal.

### Phase 3 — Proposal workflow

Goals:

- Let CSE produce memory/action/follow-up proposals.
- Represent proposals as auditable artifacts with evidence references.
- Add explicit accept/reject/defer states.
- Route accepted proposals through OpenClaw’s existing safe mechanisms.

Examples:

- Memory proposal -> human-approved edit to `MEMORY.md` or daily memory.
- Follow-up proposal -> OpenClaw cron/task creation after operator approval.
- Action proposal -> normal assistant plan/tool path, still subject to permissions.

Acceptance criteria:

- No proposal applies itself silently.
- Every applied proposal records evidence, approver, timestamp, and resulting artifact.
- Rejected proposals remain inspectable for debugging and learning.

### Phase 4 — Long-lived continuity loop

Goals:

- Make the CSE entity session the durable cognitive home for the assistant.
- Preserve continuity across OpenClaw sessions and channels.
- Feed significant outcomes back into CSE reflection.
- Avoid treating every OpenClaw chat/session as a separate entity.

Acceptance criteria:

- Ordinary live operation resolves to one canonical CSE entity/session.
- Isolated experiments are explicitly marked and excluded from normal continuity unless promoted.
- CSE can summarize its recent continuity state for the operator.

### Phase 5 — Multimodal body adapters

Goals:

- Extend the bridge beyond text when the core loop is stable.
- Add camera/microphone/speaker observations through OpenClaw/node adapters.
- Treat media observations as events that become CSE experiences after explicit processing.
- Preserve privacy, opt-in behavior, and local-first operation.

Examples:

- Audio message -> OpenClaw transcription -> CSE experience.
- Camera observation -> operator-approved image analysis -> CSE event.
- Speaker/TTS output -> post-turn observation back to CSE.

Acceptance criteria:

- Multimodal inputs are opt-in and surface-aware.
- Sensitive media is not sent to CSE or models without explicit configuration.
- Text-first behavior remains reliable if media adapters are disabled.

### Phase 6 — Replay, counterfactuals, and evaluation

Goals:

- Replay OpenClaw turns against historical CSE snapshots.
- Compare outputs with and without CSE advisory context.
- Evaluate whether CSE influence improves safety, continuity, helpfulness, and consistency.
- Prevent regressions where CSE context makes the assistant overconfident, invasive, or policy-unsafe.

Acceptance criteria:

- The operator can replay a turn and inspect the exact CSE influence packet.
- Evaluation data separates runtime cognition from policy enforcement.
- Counterfactual tests exist for safety-sensitive bridge behavior.

### Phase 7 — Carefully increased agency

Only after the previous phases are boringly reliable.

Possible future capabilities:

- CSE proposes task prioritization.
- CSE proposes memory maintenance windows.
- CSE proposes follow-up reminders.
- CSE helps choose between safe execution strategies.

Still out of scope without explicit future approval:

- CSE bypassing OpenClaw approvals.
- CSE modifying system/developer prompts.
- CSE sending external messages by itself.
- CSE granting itself tools or permissions.
- CSE pursuing goals unrelated to the user’s request.

## Required safety invariants

These are non-negotiable unless the operator explicitly changes the architecture later:

1. CSE suggestions are never tool permissions.
2. CSE does not mutate OpenClaw system/developer instructions or safeguards.
3. CSE does not automatically send messages, emails, posts, or public comments.
4. CSE does not automatically write OpenClaw memory files.
5. CSE bridge failures are fail-open for normal OpenClaw operation.
6. Group/shared contexts suppress private memory and private CSE state by default.
7. All CSE-influenced behavior must be replayable or at least traceable.
8. OpenClaw remains the final runtime authority for permissions, routing, and delivery.

## Implementation notes for OpenClaw

The `cse-claw` plugin should stay small and boring:

- config resolution;
- redaction/truncation;
- HTTP client;
- hook registration;
- advisory prompt formatting;
- trace correlation;
- tests around safety boundaries.

Complex cognition belongs in CSE. Complex execution belongs in OpenClaw. The bridge should not become a second hidden agent.

## Open questions

- Which operator UI should first expose CSE trace links: status card, plugin command, web UI panel, or all of them?
- How should CSE proposals be stored on the OpenClaw side: plugin state, workspace files, CSE-only records, or a hybrid?
- What minimum evidence is required before promoting a CSE memory proposal into durable OpenClaw memory?
- Which channel metadata is safe and necessary to send to CSE in group chats?
- What local multimodal adapters are acceptable for the first non-text experiment?

## Near-term next steps

1. Keep the merged passive plugin green on the fork baseline.
2. Add or verify CSE-side contract tests for the bridge endpoints.
3. Add an operator-facing bridge status surface.
4. Add proposal artifacts and review/apply workflow.
5. Run an end-to-end local smoke: Telegram/OpenClaw turn -> CSE pre/post trace -> operator trace view.
6. Decide what subset is appropriate to upstream to OpenClaw versus keep fork-local while the CSE contract evolves.
