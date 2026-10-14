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
