# Proposed Folder Structure

```text
zombiecoder-runtime/
├── README.md
├── package.json
├── .env.example
├── config/
│   ├── runtime.config.js
│   ├── auth.config.js
│   ├── transport.config.js
│   ├── provider.config.js
│   └── mcp.config.js
├── src/
│   ├── bootstrap/
│   │   ├── start.js
│   │   ├── shutdown.js
│   │   └── health.js
│   ├── http/
│   │   ├── server.js
│   │   ├── routes/
│   │   │   ├── openai-compatible.js
│   │   │   ├── admin.js
│   │   │   ├── sessions.js
│   │   │   └── mcp.js
│   │   └── middleware/
│   │       ├── request-id.js
│   │       ├── authenticate-application.js
│   │       ├── rate-limit.js
│   │       └── error-handler.js
│   ├── identity/
│   │   ├── application-service.js
│   │   ├── user-service.js
│   │   ├── session-service.js
│   │   └── runtime-identity.js
│   ├── auth/
│   │   ├── key-generator.js
│   │   ├── key-verifier.js
│   │   ├── entitlement-service.js
│   │   └── admin-auth.js
│   ├── orchestrator/
│   │   ├── request-orchestrator.js
│   │   ├── planning-loop.js
│   │   ├── goal-contract.js
│   │   └── verification.js
│   ├── context/
│   │   ├── context-resolver.js
│   │   ├── ssot-reader.js
│   │   ├── syllabus-reader.js
│   │   ├── memory-reader.js
│   │   └── evidence-store.js
│   ├── providers/
│   │   ├── provider-registry.js
│   │   ├── provider-router.js
│   │   ├── provider-adapter.js
│   │   ├── local/
│   │   ├── openai-compatible/
│   │   └── normalizer/
│   │       ├── canonical-response.js
│   │       └── error-normalizer.js
│   ├── mcp/
│   │   ├── endpoint-registry.js
│   │   ├── handshake.js
│   │   ├── connection-manager.js
│   │   ├── discovery.js
│   │   ├── permission-engine.js
│   │   ├── tool-normalizer.js
│   │   ├── tool-executor.js
│   │   └── adapters/
│   ├── policy/
│   │   ├── policy-engine.js
│   │   ├── resource-limits.js
│   │   └── confirmation-rules.js
│   ├── audit/
│   │   ├── audit-writer.js
│   │   ├── redaction.js
│   │   └── event-types.js
│   ├── storage/
│   │   ├── repositories/
│   │   ├── migrations/
│   │   └── database.js
│   └── shared/
│       ├── errors.js
│       ├── schemas.js
│       ├── logger.js
│       └── constants.js
├── schemas/
│   ├── application.schema.json
│   ├── session.schema.json
│   ├── canonical-response.schema.json
│   ├── mcp-tool.schema.json
│   └── audit-event.schema.json
├── docs/
│   ├── 00-system-overview.md
│   ├── 01-current-state.md
│   ├── 02-identity-and-auth.md
│   ├── 03-mcp-architecture.md
│   ├── 04-context-and-evidence.md
│   ├── 05-request-lifecycle.md
│   ├── 06-folder-structure.md
│   ├── 07-api-contracts.md
│   ├── 08-migration-plan.md
│   ├── 09-implementation-checklist.md
│   └── decisions/
└── tests/
    ├── unit/
    ├── contract/
    ├── security/
    ├── transport/
    └── regression/
```

## Structure rule

The folder structure is a target boundary, not permission to move everything at once. Start with interfaces and adapters around the existing monolith, then extract one bounded responsibility at a time.
