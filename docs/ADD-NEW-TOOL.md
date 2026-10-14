# Add New Tool Contract

A new tool is added in four deliberate steps.

## 1. Declare the tool

Register one stable `toolId` in the Tool Registry. Do not duplicate an existing common tool.

Required fields:

- `id`
- `name`
- `version`
- `entry`
- `capabilities`
- `status`
- `source`
- `metadata.toolSchema`

## 2. Define the execution boundary

Document:

- allowed argument shape
- path/network boundaries
- whether consent is required
- expected evidence
- failure behavior

`registered` does not mean `executable`.

## 3. Attach only to the agents/tasks that need it

Agent tool declarations are advisory capability boundaries. Application capability, permission, task policy, and execution checks remain authoritative.

Example:

```json
{
  "toolBoundaryProfile": {
    "toolIds": ["read_file", "public_api"],
    "externalMcp": ["public-api"]
  }
}
```

## 4. Verify before claiming availability

Track these states separately:

`declared -> configured -> discovered -> permissioned -> tested -> healthy`

A missing server URL must produce `configuration_missing`, not a fake healthy state.

## External MCP drop-in

Place the implementation under:

`external-mcp/servers/<server-id>/`

Declare its environment endpoint in `external-mcp/servers.json` using `urlEnv`.

Do not place credentials in the manifest.

## Phase 47 native tool requirements

- Native defaults live in `src/tools/common-defaults.js`; executable implementations live under `tools/common/`.
- If a model lacks native function-calling support, it may emit the strict JSON envelope documented in [Phase 47](76-phase-47-native-tools-and-json-fallback.md). This fallback does not bypass registry binding, task policy, permission, consent, schema validation or project-root checks.
- Do not register unavailable integrations as `VERIFIED`. `web_search`, `fetch_web_page`, and `delegate_subagent` currently remain `NOT_IMPLEMENTED` until their real backend contracts and tests exist.
