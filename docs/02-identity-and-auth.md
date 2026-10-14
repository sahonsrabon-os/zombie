# Identity and Authentication

## 1. Application is the primary client identity

For the first version, an **application** represents an approved integration such as:

- A Laravel application
- A VS Code/editor runtime
- A local script
- A service running on a VPS

The application is not a public subscription customer account. It is a controlled integration record used for authentication, policy, expiry, usage, and audit.

## 2. Optional user identity

A `users` table is optional and should not be mandatory in V1.

Use it only when one application needs to distinguish individual human users. If the runtime is operated by one administrator and one application represents the whole integration, the session can be associated directly with `application_id`.

## 3. Identity terms

| Identity | Purpose |
|---|---|
| `application_id` | Approved integration/client |
| `user_id` | Optional human user inside an application |
| `runtime_id` | Running runtime process or installation |
| `instance_id` | Specific deployment instance |
| `client_id` | Logical client software identity |
| `connection_id` | One MCP/network connection |
| `session_id` | Conversation or working session |
| `request_id` | One API request |
| `task_id` | One planned/executed task |

Do not use one identifier for all of these purposes.

## 4. API key lifecycle

- Generate a high-entropy key at creation time.
- Display the complete key only once.
- Store only a secure hash or keyed digest.
- Never place the raw key in logs, database rows, error messages, or agent context.
- Support revoke and rotate.
- Separate application API keys from administrator authentication.
- Apply expiry and status checks before provider or MCP execution.

## 5. Minimal application record

Suggested fields:

- `id`
- `name`
- `slug`
- `status` (`active`, `suspended`, `revoked`, `expired`)
- `key_hash`
- `key_prefix`
- `expires_at`
- `allowed_models`
- `allowed_mcp_endpoints`
- `policy_version`
- `created_at`
- `updated_at`
- `last_seen_at`

## 6. Basic flow

```text
Admin creates application
    -> application receives expiry date
    -> runtime API key is shown once
    -> client sends Authorization: Bearer <key>
    -> runtime hashes/verifies key
    -> runtime checks status and expiry
    -> runtime creates or validates session
    -> only approved providers/models/tools become available
```

This is access control and entitlement management, not a full subscription billing system.
