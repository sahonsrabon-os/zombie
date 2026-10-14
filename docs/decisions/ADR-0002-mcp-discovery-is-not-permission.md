# ADR-0002: MCP Discovery Is Not Permission

## Decision

A discovered MCP tool is not automatically callable. Tool access is granted only after endpoint validation and policy filtering.

## Consequences

- The agent receives only approved tools.
- Tool lists can vary by application, session, and task.
- External MCP endpoints cannot silently expand their authority.
