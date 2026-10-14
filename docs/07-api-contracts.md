# API Contracts

## Runtime endpoint

`POST /v1/chat/completions`

Required behavior:

- OpenAI-compatible request shape
- Application authentication
- Session association
- Model allowlist check
- Bounded context resolution
- Canonical OpenAI-compatible response
- Stable error envelope

## Session endpoints

- `POST /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/close`

A session must belong to an authenticated application. A user association is optional.

## Admin application endpoints

- `POST /api/admin/applications`
- `GET /api/admin/applications`
- `POST /api/admin/applications/:id/rotate-key`
- `POST /api/admin/applications/:id/revoke`
- `POST /api/admin/applications/:id/extend`
- `GET /api/admin/applications/:id/usage`

The raw application key is returned only at creation or rotation time.

## Admin MCP endpoints

- `POST /api/admin/mcp/endpoints`
- `POST /api/admin/mcp/endpoints/:id/handshake`
- `POST /api/admin/mcp/endpoints/:id/refresh-tools`
- `POST /api/admin/mcp/endpoints/:id/disable`
- `GET /api/admin/mcp/endpoints`
- `GET /api/admin/mcp/tools`

The agent sees only the filtered, normalized tools made available by policy.
