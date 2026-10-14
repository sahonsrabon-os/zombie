# Current State

## Source-derived observations

The existing `api.md` contains:

- Mission Barisal v3 identity and evidence-driven rules.
- Multi-agent persona definitions.
- A six-step Anti-dote chain:
  1. validateInput
  2. checkProof
  3. getUserConsent
  4. setGoalContract
  5. execute
  6. verifyOutput
- Custom provider configuration and priority-based fallback.
- A response normalizer that targets OpenAI-compatible output.
- Session and memory concepts using SSOT, syllabus, and memory.
- HTTP, SSE, WebSocket, and UDS transport concepts.
- An explicit distinction that outbound provider calls use HTTP/HTTPS while UDS/SSE/WebSocket are inbound/server-side transport concerns.

## Current limitations to preserve during migration

The existing implementation is large and monolithic. Extraction must not assume that a function is independent merely because it has a recognizable marker.

Before moving code:

- Map imports and shared variables.
- Identify closures and side effects.
- Identify initialization order.
- Record endpoint behavior.
- Record response shapes and error codes.
- Run dry-run extraction first.
- Compare old and new behavior before deleting old code.

## Status labels

Use these labels in future records:

- `observed` — directly verified in the running code or logs
- `implemented` — code exists and passed the relevant test
- `planned` — design decision, not yet implemented
- `unknown` — not verified
- `deprecated` — retained only for migration history
