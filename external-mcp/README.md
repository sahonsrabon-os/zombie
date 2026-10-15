# External MCP registry surface

This directory is the runtime-owned declaration surface for external MCP servers.

- `servers.json` contains non-secret endpoint declarations.
- Environment variables are a fallback when a database record is absent.
- Database endpoint records remain authoritative once registered.
- Secrets/tokens must not be placed in this file.
- Discovery is evidence; declaration alone is not a health claim.

`servers.json` also declares the opt-in `localFallback` entries for the legacy OCR, TTS, and Linux/X11 screen-recorder modules. Set `LOCAL_MCP_FALLBACK_ENABLED=true` to let the runtime launcher start them when no upstream URL or persisted endpoint with the same ID conflicts. They stay on `127.0.0.1`; only their matching fallback URL receives that exact host allowlist. The runtime probes MCP initialization and `tools/list` before registration, then uses the normal MCP permission and audit layers.

Fallback is disabled by default. Missing binaries, unsupported platforms, occupied non-MCP ports, and failed handshakes cause a logged skip rather than replacing an existing module or endpoint. Do not copy credentials from the former Facebook Ads or combined gateway implementations.
