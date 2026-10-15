# MCP HTTP compatibility and security

The runtime exposes a stateless Streamable HTTP MCP endpoint at `POST /mcp`; `/v1/mcp` is a compatibility alias. `initialize`, `tools/list`, and `tools/call` use JSON-RPC 2.0. The server negotiates protocol versions `2025-06-18`, `2025-03-26`, and `2024-11-05`, returns `MCP-Protocol-Version`, and accepts `MCP-Session-Id` for upstream connection context. It does not create a stateful MCP session or server-sent-event stream. `GET /mcp` preserves the older tool-list response; a GET requesting `text/event-stream` receives 405.

Internal native tools and discovered external MCP tools share the catalog, but remain on separate execution adapters. External tools require an MCP permission grant; internal tools require a tool-policy grant. Both require an authenticated application except for explicitly enabled loopback-only development mode. Tool calls remain disabled in `chat-only` mode.

Browser clients may use `MCP_ALLOWED_ORIGINS` as a comma-separated list of exact origins, for example `https://infiniteearningzone.com`. Wildcards and path components are not accepted. `OPTIONS` preflight advertises the MCP protocol/session and authorization headers. Same-origin requests need no CORS entry. Do not enable cross-origin origins together with `LOCAL_AUTH_BYPASS=true`.

Outbound HTTPS MCP connections use Node's default TLS certificate and hostname verification. Plain HTTP and private-network destinations remain denied unless explicitly enabled with the exact host allowlist. Never disable certificate verification to work around an endpoint certificate problem.

# Public model aliases

`ZOMBIECODER_MODELS_JSON` optionally adds or overrides public model aliases without source edits. It is a JSON array of `{ "id", "name", "description" }` entries. To force an exact route, include both `providerId` and `model`; the provider must be enabled and the target model must be configured. The built-in `zombie-mini`, `zombie-lite`, and `zombie-classic` IDs remain available unless explicitly overridden. Public aliases are distinct from agent IDs and application identity.

## Optional admin interface

`/admin` serves `public/admin/index.html` lazily; the runtime does not load or require this file during startup or for API/MCP requests. Set `ADMIN_UI_ENABLED=false` to disable the page. Admin APIs remain independently authenticated and usable from terminal clients. Missing dashboard assets return 404 and do not change the runtime API contract.

# MCP Architecture

## 1. MCP principle

The agent must not discover or invoke every MCP tool automatically.

The admin/runtime policy layer decides:

1. Which MCP endpoint is registered.
2. Whether its credentials are configured.
3. Whether the endpoint passed handshake validation.
4. Which tools were discovered.
5. Which tools are allowed for a specific application/session/task.
6. Which input schema and limits apply.
7. Whether the tool result may enter the agent context.

The agent receives only the approved, normalized tool definitions.

## 2. MCP endpoint record

Suggested fields:

- `id`
- `name`
- `endpoint_url`
- `transport` (`streamable_http`, `sse`, `websocket`, `uds`, other supported type)
- `credential_ref` (reference only; never raw credential in agent context)
- `status`
- `allowlist_policy`
- `timeout_ms`
- `max_response_bytes`
- `created_at`
- `updated_at`

## 3. Connection identity

Every connection gets a unique `connection_id`.

Recommended connection metadata:

- `runtime_id`
- `client_id`
- `connection_id`
- `session_id` when applicable
- `endpoint_id`
- `protocol_version`
- `status`
- `last_seen_at`
- `lease_expires_at`

Repeated handshakes should be idempotent or refresh an existing connection. They should not fail simply because the same runtime and client connect again.

## 4. Discovery is not permission

`tools/list` means that a tool exists. It does not mean that the agent may call it.

The permission layer should filter tools by:

- application
- session
- task
- endpoint
- tool name/namespace
- risk level
- input schema
- rate limit
- confirmation requirement

## 5. External MCP safety

External MCP endpoints must be subject to:

- HTTPS preference for remote endpoints
- explicit allowlist
- SSRF protection
- DNS/IP validation
- timeout and response-size limits
- credential isolation
- log redaction
- tool namespace isolation
- no direct database or memory access
- explicit context projection/redaction

An external MCP server receives only the minimum context required for the approved operation.

## 6. Transport compatibility

Do not assume that MCP, gRPC, SSE, WebSocket, and ordinary HTTP are interchangeable.

Each endpoint must declare a transport and use an adapter that matches the actual protocol. A Facebook-related service using JSON-RPC over Streamable HTTP is not automatically a gRPC service.
