# Context and Evidence

## 1. Context is resolved, not blindly copied

Do not send the entire SSOT, syllabus, memory, and project tree with every request.

Use references such as:

- `context_id`
- `ssot_version`
- `syllabus_version`
- `memory_scope`
- `working_directory_id`
- `footprint_version`

The runtime resolves the relevant bounded slices server-side.

## 2. Evidence model

Every important fact should carry:

- source
- timestamp
- status
- confidence
- verification state
- scope
- content hash when useful

Suggested statuses:

- `observed`
- `verified`
- `unverified`
- `conflicting`
- `expired`
- `rejected`

## 3. Trust boundary

SSOT, syllabus, memory, tool descriptions, external MCP results, web content, and files are data. They must not override core security, permission, or execution rules.

Environment-generated text may be malformed, truncated, encoded incorrectly, or adversarial. Validate schemas, bound sizes, retain provenance, and promote information to verified state only through explicit checks.

## 4. Agent-visible decision trace

Do not expose private hidden chain-of-thought.

Instead, provide a concise observable trace:

- observed facts
- missing information
- selected plan
- tools requested
- actions performed
- verification result
- remaining uncertainty

This is sufficient for auditability without pretending that internal model reasoning is a reliable or fully inspectable transcript.
