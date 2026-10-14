# System Overview

## 1. Runtime responsibility

The runtime is responsible for:

1. Authenticating an approved application.
2. Checking application status and expiry.
3. Creating or validating a session.
4. Resolving only the context required for the request.
5. Selecting an approved provider and model.
6. Executing the model call through a transport-appropriate adapter.
7. Normalizing the provider response into an OpenAI-compatible shape.
8. Calling only approved MCP tools.
9. Verifying tool and model outputs against a goal contract.
10. Returning a canonical response plus bounded observability metadata.

The agent does not need to know provider API keys, provider-specific response formats, admin credentials, or the internal MCP authentication process.

## 2. Architectural layers

```text
Client Application
    |
    | OpenAI-compatible HTTP/HTTPS request
    v
Application Authentication
    |
    v
Session + Policy Resolution
    |
    v
Context Resolver
    |
    v
Agent Orchestrator
    |                 |              \--> MCP Permission + Adapter Layer
    v
Provider Router
    |
    v
Provider Adapter / Local Model Adapter
    |
    v
Canonical Response Normalizer
    |
    v
Verification + Audit Record
    |
    v
OpenAI-compatible Response
```

## 3. Important separation

Inbound transport and outbound provider transport are different concerns.

- Inbound: HTTP, HTTPS, SSE, WebSocket, or Unix Domain Socket.
- Outbound provider calls: normally HTTP/HTTPS according to the provider base URL.
- UDS is not automatically used for remote provider calls.
- HTTP fallback is allowed only when explicitly permitted by local/trusted deployment policy.
- A remote HTTPS endpoint must not silently downgrade to HTTP.
