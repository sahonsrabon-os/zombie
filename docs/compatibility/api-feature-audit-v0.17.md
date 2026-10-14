# ZombieCoder Runtime v0.17 — Legacy API Feature Audit

## Purpose

The legacy `api.md` is not used as a runtime dependency. It is used as a feature inventory so that old capabilities are not silently forgotten during modularization.

## Two-stage migration rule

### Stage 1: capability coverage

For every legacy capability:

1. identify the capability in `api.md`;
2. give it a visible modular folder/module target;
3. mark `PRESENT`, `PARTIAL`, `WARNING`, or `NOT_IMPLEMENTED`;
4. expose the warnings to operators/admins;
5. do not claim behavioral parity.

### Stage 2: logic reconciliation

Only after Stage 1 is stable:

- inspect the old implementation/theory;
- compare expected behavior with the modular boundary;
- decide what logic should be migrated;
- write tests for the selected behavior;
- verify actual runtime behavior.

## Important findings carried forward

- Provider outbound SSRF policy is not yet shared with the MCP SSRF boundary.
- Legacy `/api/normalize` behavior is not fully represented by the modular normalizer.
- Legacy WebSocket/UDS listener behavior is not fully represented by the modular transport registry.
- Legacy domain detection/configuration has no dedicated modular boundary.
- Legacy syllabus/auto-SSOT generation needs a dedicated boundary before logic reconciliation.
- Legacy rate-limit, client-list, locks, usage tracking, compiler checks, Pusher configuration and runtime downloader need explicit status rather than being silently assumed to exist.
- Agent/persona identity exists as modular registries, but legacy persona binding and router behavior still require parity review.

## Principle

A warning is better than an invisible missing feature.

## Visible ownership boundaries

Missing legacy capabilities now have explicit folders under `src/compatibility/legacy/boundaries/`. These are ownership markers, not mock implementations.

WebSocket is also visible in the transport registry with `NOT_IMPLEMENTED`, so it cannot silently disappear from the runtime inventory.

## Stage 2 started in v0.18

The first reconciliation slice establishes a shared outbound network policy for provider HTTP/HTTPS and the existing MCP outbound client. Provider requests now pass through the same DNS/private-address policy family instead of bypassing the MCP security boundary. Plain HTTP and private-network provider access require explicit runtime policy. The admin constitution route is also protected by the same admin token boundary used by the other admin endpoints.

Behavioral parity is still not claimed for the remaining legacy features.
