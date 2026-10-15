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

## 7. Workspace assignment

- The editor/runtime integration selects a folder explicitly; the server does not infer the editor's active workspace from its process CWD.
- `POST /api/set-working-dir` accepts administrator authorization, or an application API key from a direct loopback request with no proxy headers. An application key may bind only itself. The request accepts `directory`/`path` plus an optional `applicationId`; without an application ID an admin sets the runtime default.
- A bound workspace is persisted in SQLite and added to the filesystem allowlist only after verifying that it is an existing directory. Application API keys cannot expand this boundary.
- Later context/chat/execution requests resolve roots in this order: explicit approved `projectRoot`, application assignment, runtime default, then `DATA_DIR`.
- Workspace setup creates missing `.zombiecoder` SSOT, syllabus, memory, and editor metadata. Existing SSOT is preserved unless `refreshSSOT=true` is explicitly requested.

## 8. Local no-token development

## 7. Local no-token development

- `ADMIN_TOKEN` is a secret, not a boolean. The literal value `false` is still a token and does not turn authentication off.
- For a local-only no-token session, leave `ADMIN_TOKEN` empty and set `LOCAL_AUTH_BYPASS=true`. Startup restricts this mode to a loopback bind.
- Keep `LOCAL_AUTH_BYPASS=false` for public/reverse-proxy deployments. Cross-origin MCP requests are also disabled while bypass mode is enabled.
- A runtime/application ID is not an authenticator. Do not accept a caller-provided ID as a substitute for its API key; IDs can be copied or guessed.
- Native tools still require an application-scoped tool permission, and execution remains subject to the configured execution mode and project-root boundary.
