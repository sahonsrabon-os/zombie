# ZombieCoder Documentation Index

> **Status: planning and evidence ledger — not a certification.** These documents describe intended architecture and verification steps. They do not prove that every provider, client, tool call, stream, TLS route, or production deployment works. Do not describe an item as verified unless a dated test record identifies the exact runtime build, endpoint class, test performed, and result.

## Start here

- [Execution Planning](execution-planning/README.md) — provider-neutral execution contract, transport/TLS choices, client compatibility matrix, and staged verification plan.
- [Local Agent Planning](local-agent-planning.md) — how local agents should consume the contract, handle capabilities, and avoid claiming unverified execution.
- [Compatibility records](compatibility/) — legacy compatibility and reconciliation notes.
- [Architecture decisions](decisions/) — recorded design decisions.

## Language used in these documents

- **Intended**: a design goal, not necessarily implemented.
- **Implemented**: code exists in a named build; this alone does not prove correct behavior.
- **Locally tested**: an automated/local test passed; this does not prove a remote provider or third-party client works.
- **Live verified**: an explicitly identified real endpoint/client test passed at a stated time.
- **Not verified**: evidence is missing, incomplete, or not repeatable.

Never promote `intended`, `implemented`, or `locally tested` to `live verified` without new evidence. A successful `/health` response only verifies the health route, not the whole execution lifecycle.

## Scope and separation

These planning documents are documentation-only. They do not configure a tunnel, alter DNS, install certificates, create provider credentials, change runtime routes, or enable tool execution. Runtime behavior must be inspected and tested separately before a deployment claim is made.
- [Phase 46 — OS runtime and deployment verification gate](75-phase-46-os-runtime-verification-gate.md)
- [Client and OS verification matrix](compatibility/client-verification-matrix.md)
- [Phase 47 — Native tools and JSON tool-call fallback](76-phase-47-native-tools-and-json-fallback.md)

- [Phase 48 — Runtime operations and admin control plane](77-phase-48-runtime-and-admin-control-plane.md)
