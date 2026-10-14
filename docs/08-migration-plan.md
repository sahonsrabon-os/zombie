# Migration Plan

## Phase 0 — Baseline

- Freeze current behavior with endpoint snapshots.
- Record environment variables and startup order.
- Capture representative provider and MCP responses.
- Add request IDs and safe structured logs if absent.

## Phase 1 — Contracts before extraction

- Define canonical response schema.
- Define application authentication interface.
- Define provider adapter interface.
- Define MCP endpoint/tool interface.
- Add contract tests against the existing implementation.

## Phase 2 — Add application authentication

- Create application record and key verification.
- Add status and expiry checks.
- Keep current provider logic behind the new authentication boundary.
- Verify that the agent never receives raw keys.

## Phase 3 — Add MCP registry and permission layer

- Register endpoints through admin control.
- Perform handshake and tool discovery.
- Store normalized tool metadata.
- Filter tools by application and session policy.
- Add timeout, size, and confirmation limits.

## Phase 4 — Extract adapters

Extract in this order:

1. response normalizer
2. provider registry/router
3. session service
4. context resolver
5. MCP connection manager
6. tool permission engine
7. orchestration loop
8. HTTP route handlers

## Phase 5 — Regression and cleanup

- Run old/new response comparisons.
- Run failure-path tests.
- Run resource-limit tests.
- Remove only code proven to be unused.
- Update this documentation after each completed migration step.

## Extraction safety

Marker-based extraction is only a starting aid. Every extraction requires dependency mapping, side-effect review, initialization review, and tests.
