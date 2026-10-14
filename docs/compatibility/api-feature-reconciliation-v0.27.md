# Phase 27 — Legacy API Purpose Reconciliation

## Decision

Phase 27 does **not** copy legacy `api.js` features into the modular runtime.
It reconciles the **purpose** of those capabilities with the runtime boundaries
that already exist.

The legacy source remains evidence for what existed; it is not the authority for
what the new runtime must implement.

## Anti-Dote decision

Legacy Anti-Dote documented a six-step chain:

1. validateInput
2. checkProof
3. getUserConsent
4. setGoalContract
5. execute
6. verifyOutput

The legacy source also explicitly described a non-blocking monitor that continued
execution after validation/proof failure. That behavior is not adopted as the
verification contract.

The modular runtime keeps the purpose across existing boundaries:

- goal/plan/consent → `src/execution/contract.js`
- evidence and success claims → `src/evidence/gate.js`
- task-specific evidence/tool scope → `src/execution/task-policy.js`

A check may report that something is unverified, but it must never manufacture a
verified result. A function does not need to invoke a separate legacy checker if
the same invariant is already enforced by the runtime boundary.

## Minimal task surfaces

| Task purpose | Minimum evidence | Minimum tool surface | Consent |
|---|---|---|---|
| answer | source/claim evidence | none | no |
| web research | external source | `web_search` | no |
| file + line answer | file + locator | `read_file` | no |
| workspace write | post-write observation | `read_file`, `write_file` | yes |
| compile/test | execution/test evidence | `read_file`, `exec`, `compiler_check` | yes |
| browser workflow | browser observation | `browser_cdp` | yes |

Tool IDs in these profiles are **hints**, not permission grants. Application
tool permissions and MCP permissions remain independent enforcement layers.

## Model capability rule

The runtime does not treat a provider/model's preferred tool-call wire format as
a universal truth. A model may return structured tool calls, textual markers, or
plain language. The adapter/parser boundary may normalize supported forms.

However, unsupported capability must remain visible. If the model cannot produce
a usable authentication JSON object, the runtime must not invent one; it should
return an explicit inability/unverified state instead of silently stopping or
fabricating execution.

## Local vs cloud

The runtime does not assign trust based on the word `local` or `cloud`.
Both are processes running on computing infrastructure. Trust comes from the
transport, authentication, permission, scope, evidence, and verification
contracts.

Local-first therefore means honest boundary selection, not a claim that network
data can never leave the machine.

## Reconciliation decisions

- **KEEP** — current modular boundary already owns the purpose.
- **REPLACE** — legacy implementation is replaced by a purpose-specific boundary.
- **MERGE** — the purpose is retained across existing boundaries instead of a
  separate legacy feature.
- **DEPRECATE** — no demonstrated requirement justifies carrying the legacy
  capability into the core runtime.
- **BLOCK** — the capability is outside the current trust boundary until a
  separately audited design exists.

The machine-readable decision set is exported by
`src/compatibility/legacy/reconciliation.js` and exposed through the admin API.

## Verification rule

This phase does not claim behavioral parity with legacy `api.js`.
The correct claim is narrower: the identified purposes now have explicit
architectural decisions and a minimal task-policy boundary.
