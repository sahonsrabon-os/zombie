# Implementation Checklist

## First milestone: minimal working runtime

- [ ] Create application table/record
- [ ] Create secure API key generation and hashing
- [ ] Add application status and expiry check
- [ ] Add request ID and redacted audit event
- [ ] Add session creation/validation
- [ ] Put existing provider router behind an adapter
- [ ] Return canonical OpenAI-compatible response
- [ ] Add bounded timeout and retry policy
- [ ] Add health endpoint

## Second milestone: MCP

- [ ] Add MCP endpoint registry
- [ ] Add handshake state machine
- [ ] Add connection ID and lease handling
- [ ] Add tool discovery
- [ ] Add tool normalization
- [ ] Add application/session tool allowlist
- [ ] Add input validation and response-size limit
- [ ] Add credential redaction
- [ ] Add explicit confirmation for risky operations

## Third milestone: evidence and agent behavior

- [ ] Add context references instead of full context duplication
- [ ] Add evidence provenance and status
- [ ] Add concise decision trace
- [ ] Add verification result
- [ ] Add unknown/conflict handling
- [ ] Add resource-pressure stop conditions

## Completion definition

A feature is complete only when:

1. Its contract is documented.
2. Its permission boundary is explicit.
3. Its failure behavior is tested.
4. Its logs are redacted.
5. Its resource limits are bounded.
6. Its behavior is reflected in this documentation.
