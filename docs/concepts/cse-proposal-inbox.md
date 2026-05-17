# CSE proposal inbox

This document defines the operator-mediated proposal inbox for CSE_Claw. It is a design contract, not an implementation of autonomous action.

CSE may notice that OpenClaw should remember something, reflect on something, evaluate a behavior, exercise caution, or perform an action. The proposal inbox is the boundary that lets those suggestions become inspectable artifacts without letting CSE apply them silently.

The invariant is simple:

> A proposal is evidence plus intent. It is not permission, memory, policy, or execution.

## Goals

- Let CSE produce typed suggestions that OpenClaw can show to a trusted operator.
- Keep memory writes, external actions, reminders, and safety posture changes behind explicit OpenClaw/operator approval.
- Preserve replay metadata so each proposal can be traced back to CSE/OpenClaw turn artifacts.
- Avoid interrupting normal chat unless the proposal is urgent and operator-visible.

## Non-goals

- CSE does not send messages, emails, posts, tool calls, or public comments by creating a proposal.
- CSE does not write MEMORY.md, workspace memory, plugin config, system prompts, or safeguards by creating a proposal.
- CSE does not grant itself tools, approvals, scopes, or higher authority.
- OpenClaw does not treat pending proposals as accepted subjective memory.

## Proposal types

| Type       | Purpose                                                                             | Example apply path                                                        |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| memory     | Suggest a durable memory update, correction, or deletion.                           | Operator-approved edit to a memory file or CSE canonical memory endpoint. |
| reflection | Suggest that CSE should reflect on a trace, outcome, conflict, or pattern.          | Operator-approved or policy-allowed CSE reflection job.                   |
| action     | Suggest a concrete OpenClaw action that may require tools or external side effects. | Normal OpenClaw plan/tool flow with existing approvals.                   |
| evaluation | Suggest that a behavior, trace, or bridge outcome should enter an evaluation set.   | Append to an eval queue or replay harness after approval.                 |
| caution    | Suggest a temporary caution, risk note, or review requirement.                      | Operator-visible caution flag, never a hidden policy override.            |

Future proposal types must define their authority boundary before they can be accepted by OpenClaw.

## Lifecycle

```text
proposed -> shown -> accepted -> applied
                   -> rejected
                   -> expired
                   -> superseded
```

Lifecycle states:

- proposed: CSE produced the artifact, but OpenClaw has not yet shown it to the operator.
- shown: OpenClaw surfaced the proposal in an operator-visible inbox, status surface, or trace view.
- accepted: A trusted operator or approved OpenClaw workflow accepted the proposal.
- applied: OpenClaw or CSE completed the approved apply path and recorded the resulting artifact.
- rejected: The operator declined the proposal.
- expired: The proposal aged out or became stale before a decision.
- superseded: A newer proposal replaces it.

Only accepted proposals can move to applied. Rejected, expired, and superseded proposals remain inspectable for audit and learning.

## Required proposal envelope

Every proposal should be an explicit artifact with bounded fields:

```json
{
  "schema_version": "cse.proposal.v1",
  "proposal_id": "prop_...",
  "trace_id": "cse_trace_...",
  "type": "memory",
  "title": "Remember Dotan prefers concise Telegram updates",
  "summary": "Dotan explicitly asked to stay in the loop during PR/CI work.",
  "rationale": "Improves collaboration without changing authority.",
  "evidence_refs": [
    {
      "kind": "openclaw_turn",
      "trace_id": "cse_trace_...",
      "artifact_id": "turn_post_..."
    }
  ],
  "risk": {
    "level": "low",
    "requires_external_action": false,
    "requires_memory_write": true,
    "requires_policy_change": false
  },
  "apply": {
    "mode": "operator_approved",
    "target": "openclaw.memory",
    "preview": "- Dotan prefers concise progress updates during PR/CI work."
  },
  "status": "proposed",
  "created_at": "2026-05-17T00:00:00Z",
  "expires_at": "2026-05-24T00:00:00Z"
}
```

Minimum required fields:

- schema_version
- proposal_id
- trace_id
- type
- title
- summary
- evidence_refs
- risk
- apply.mode
- status
- created_at

The envelope must not include raw secrets, full private prompts, unrestricted tool payloads, or hidden chain-of-thought text. Evidence references should point to trace artifacts that are available only through trusted operator surfaces.

## Authority boundaries

The inbox must preserve these boundaries:

| Proposal content                                                 | Required approval boundary                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Memory write, correction, or deletion                            | Explicit operator approval before durable write.                                      |
| External message, email, post, PR comment, or public side effect | Existing OpenClaw external-action approval path.                                      |
| Tool execution                                                   | Existing tool permissions and approvals.                                              |
| Reflection job                                                   | CSE/OpenClaw configured reflection policy or operator approval.                       |
| Evaluation queue entry                                           | Safe local append or operator-approved eval selection, depending on data sensitivity. |
| Caution flag                                                     | Operator-visible diagnostic flag only; cannot override policy.                        |
| Prompt, safeguard, or permission change                          | Out of scope for proposals unless a future explicit operator workflow is designed.    |

Pending proposals are not injected into model prompts as accepted facts. If OpenClaw summarizes pending proposals for the operator, the summary must label them as pending.

## Surfacing proposals

Proposal surfacing should be low-friction and non-interruptive by default:

- /cse status can show pending counts by type and highest risk level.
- /cse trace TRACE_ID can list proposals linked to that trace.
- A future /cse inbox command can list pending proposals with compact titles, age, risk, and suggested apply path.
- A future /cse proposal PROPOSAL_ID command can show full rationale, evidence references, and accept/reject controls.

Normal chat should not be interrupted for ordinary low-risk proposals. Interruptive surfacing is reserved for high-risk caution proposals, expiring operator decisions, or user-requested inbox review.

## Apply paths

Accepted proposals should route through existing OpenClaw mechanisms:

- memory: create a reviewed patch or call a trusted memory write workflow; record the resulting file path, line, or CSE memory artifact id.
- reflection: enqueue a CSE reflection job with the proposal id and evidence refs.
- action: convert to a normal OpenClaw task/plan and run it under existing permissions.
- evaluation: append a bounded eval case or replay pointer, avoiding raw private text unless explicitly approved.
- caution: show a diagnostic caution in trusted operator surfaces; do not silently change policy or permissions.

Each applied proposal records:

- approver or approval workflow id;
- applied timestamp;
- resulting artifact ids or file paths;
- whether the apply path created external side effects;
- any failure or partial-apply notes.

## Expiration and deduplication

Proposals should expire when they are no longer useful. Suggested defaults:

- memory: 7 to 30 days, depending on confidence and importance.
- reflection: 7 days.
- action: short, usually 1 to 7 days.
- evaluation: 30 days or until the eval queue is curated.
- caution: short, usually hours to days.

CSE or OpenClaw may mark a proposal superseded when a newer proposal covers the same intent with better evidence. Deduplication should compare proposal type, canonical target, evidence trace, and normalized title/summary. It must not delete old proposals; it should link them.

## Replay and audit requirements

Every proposal must be replayable enough for an operator to answer:

1. Which OpenClaw turn or CSE artifact caused this proposal?
2. What evidence did CSE cite?
3. What exactly would change if accepted?
4. Who accepted or rejected it?
5. Which artifact was created or changed after apply?
6. Did any external side effect occur?

The proposal inbox is therefore part of the audit path, not just a notification list.

## First implementation slice

The smallest useful OpenClaw-side slice should be read-only and local:

1. Extend CSE operator status/trace responses to include bounded proposal summaries.
2. Show pending proposal counts in cseClaw.status.
3. Show trace-linked proposals in cseClaw.trace.
4. Add tests proving proposal summaries do not grant tool permissions or expose raw private text.
5. Leave accept/reject/apply commands for a later PR after the CSE-side proposal API is stable.

This keeps the first inbox surface useful without creating premature write paths.
