# CSE Claw

Disabled-by-default passive bridge from OpenClaw turns to a local CSE backend.

CSE Claw treats CSE as an auditable cognition/continuity layer and OpenClaw as the body/tools/channels runtime. It is deliberately advisory-only: CSE responses do **not** grant tool permissions, mutate OpenClaw prompts or safeguards, send external messages, or write OpenClaw memory automatically.

For the broader architecture and staged plan, see [`docs/concepts/cse-frontend-roadmap.md`](../../docs/concepts/cse-frontend-roadmap.md). The operator-mediated proposal inbox design is in [`docs/concepts/cse-proposal-inbox.md`](../../docs/concepts/cse-proposal-inbox.md).

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
        enabled: false,
        config: {
          enabled: false,
          endpoint: "http://127.0.0.1:8080",
          timeoutMs: 1500,
          maxPromptChars: 2000,
          maxAssistantChars: 4000,
          injectAdvisoryContext: true,
          sharedContextMode: "audit_only",
          logFailures: true,
        },
      },
    },
  },
}
```

Minimal local-only enabled config:

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
          maxPromptChars: 2000,
          maxAssistantChars: 4000,
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

### Config reference

| Field                   | Default                 | Purpose                                                                                                         |
| ----------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `false`                 | Opt-in switch for CSE_Claw. When false, the extension registers diagnostics but does not call CSE during turns. |
| `endpoint`              | `http://127.0.0.1:8080` | Base URL for the CSE API. Keep this loopback/local unless you have explicitly secured a different deployment.   |
| `timeoutMs`             | `1500`                  | Per-call CSE timeout. Failures and timeouts fail open so OpenClaw continues without advisory context.           |
| `maxPromptChars`        | `2000`                  | Maximum redacted user prompt characters sent in `TurnPreEvent.user_text`.                                       |
| `maxAssistantChars`     | `4000`                  | Maximum redacted assistant/output characters sent in `TurnPostEvent.assistant_text`.                            |
| `injectAdvisoryContext` | `true`                  | Allows CSE pre-turn advisory text to be prepended to the model context. Set false for observe-only/audit mode.  |
| `sharedContextMode`     | `audit_only`            | Privacy posture for group/channel turns. See shared-context modes below.                                        |
| `logFailures`           | `true`                  | Logs skipped CSE bridge calls at warning level while preserving fail-open behavior.                             |

`sharedContextMode` controls group/channel privacy posture:

- `audit_only` (default): CSE can receive redacted turn observations for replay/audit, but its advisory context is not injected into shared prompts.
- `off`: group/channel turns do not call CSE.
- `advisory`: group/channel turns may inject CSE advisory context. Use only when the operator has explicitly decided the shared context may receive CSE-influenced guidance.

### Data sent to CSE

When enabled, CSE_Claw sends versioned bridge envelopes to the configured CSE backend:

- Pre-turn: `schema_version`, capability flags, `TurnPreEvent`, source/channel/chat type, bounded redacted user text, bounded trusted runtime metadata, and context reference ids.
- Post-turn: `schema_version`, capability flags, `TurnPostEvent`, trace id, bounded redacted assistant/output text, tool-call summary placeholder, outcome, and bounded metadata.
- Operator diagnostics: status and trace lookup requests can query CSE operator endpoints, but OpenClaw-side status does not include raw prompts, assistant text, tokens, or secrets.

Redaction is best-effort for common token/password patterns, then truncation is applied. Treat the CSE endpoint as local/private infrastructure, not as a generic external webhook.

### Evaluation metrics

`cseClaw.status` exposes local evaluation-only counters under `evaluation`:

- pre-call and post-call latency samples, including latest and average latency in milliseconds
- advisory injection rate, based on turns where advisory context was eligible to be injected
- backend failure rate across observed CSE backend failures
- recent outcome artifacts that correlate CSE trace ids with OpenClaw turn outcomes

These metrics are diagnostic artifacts. They are not tool permissions, policy input, approval state, or system-prompt authority. The status payload marks this boundary explicitly with `authorityBoundary.evaluationSignalsGrantToolPermissions: false` and `authorityBoundary.evaluationSignalsOverridePolicy: false`.

Do not treat extractor confidence as the same thing as empirical causal stability confidence. CSE_Claw evaluation metrics only support later replay/evaluation of whether CSE traces correlate with better outcomes; they do not make runtime safety or permission decisions.

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
- CSE proposals are pending evidence artifacts until a trusted operator or approved OpenClaw workflow accepts them.
- OpenClaw user/system/developer instructions and approval gates always win.
- CSE Claw redacts common token/password patterns and truncates prompt/output text before sending it to CSE.
- Group/channel contexts default to audit-only so private CSE continuity is not injected into shared conversations by accident.
- Failures are fail-open for OpenClaw operation: the turn continues without CSE advisory context.
