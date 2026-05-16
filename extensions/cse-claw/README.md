# CSE Claw

Disabled-by-default passive bridge from OpenClaw turns to a local CSE backend.

CSE Claw treats CSE as an auditable cognition/continuity layer and OpenClaw as the body/tools/channels runtime. It is deliberately advisory-only: CSE responses do **not** grant tool permissions, mutate OpenClaw prompts or safeguards, send external messages, or write OpenClaw memory automatically.

For the broader architecture and staged plan, see [`docs/concepts/cse-frontend-roadmap.md`](../../docs/concepts/cse-frontend-roadmap.md).

## Prerequisites

- CSE API running locally, normally from `projects/cse-live`, on `http://127.0.0.1:8080`.
- OpenClaw built or run from this branch with the bundled `cse-claw` extension available.

Quick CSE API checks:

```bash
curl -fsS http://127.0.0.1:8080/readyz
curl -fsS http://127.0.0.1:8080/v1/operator/claw/status | jq .
```

## Enable in OpenClaw config

Put the plugin config under `plugins.entries["cse-claw"].config`:

```json5
{
  plugins: {
    entries: {
      "cse-claw": {
        enabled: true,
        config: {
          enabled: true,
          endpoint: "http://127.0.0.1:8080",
          timeoutMs: 1500,
          injectAdvisoryContext: true,
          sharedContextMode: "audit_only",
          logFailures: true,
        },
      },
    },
  },
}
```

Keep `injectAdvisoryContext: false` if you only want observation/audit recording without adding CSE advisory context to model prompts.

`sharedContextMode` controls group/channel privacy posture:

- `audit_only` (default): CSE can receive redacted turn observations for replay/audit, but its advisory context is not injected into shared prompts.
- `off`: group/channel turns do not call CSE.
- `advisory`: group/channel turns may inject CSE advisory context. Use only when the operator has explicitly decided the shared context may receive CSE-influenced guidance.

## Operator smoke test

With CSE running, send a synthetic pre/post turn directly to the CSE bridge:

```bash
TRACE_ID=$(curl -fsS http://127.0.0.1:8080/v1/claw/turns/pre \
  -H 'content-type: application/json' \
  -d '{"source_id":"openclaw-smoke","channel":"terminal","chat_type":"direct","user_text":"CSE Claw smoke turn: summarize the current safety posture.","context_refs":["operator-smoke"]}' \
  | jq -r .trace_id)

curl -fsS http://127.0.0.1:8080/v1/claw/turns/post \
  -H 'content-type: application/json' \
  -d "{\"trace_id\":\"$TRACE_ID\",\"assistant_text\":\"Synthetic OpenClaw response observed by CSE Claw.\",\"outcome\":\"operator_smoke\"}" \
  | jq .

curl -fsS "http://127.0.0.1:8080/v1/operator/claw/traces/$TRACE_ID" | jq .summary
```

Expected results:

- pre-turn returns `trace_id`, `cog_influence_inputs`, `recommendations`, and `advisory_context`.
- post-turn returns `writes_canonical_openclaw_state: false`.
- trace view shows `CSE_CLAW_PRE_TURN` and `CSE_CLAW_POST_TURN` artifacts.

## Safety contract

- CSE suggestions are advisory context only.
- OpenClaw user/system/developer instructions and approval gates always win.
- CSE Claw redacts common token/password patterns and truncates prompt/output text before sending it to CSE.
- Group/channel contexts default to audit-only so private CSE continuity is not injected into shared conversations by accident.
- Failures are fail-open for OpenClaw operation: the turn continues without CSE advisory context.
