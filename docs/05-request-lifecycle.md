# Request Lifecycle

```text
1. Receive OpenAI-compatible request
2. Assign request_id
3. Authenticate application key
4. Check application status and expiry
5. Resolve runtime/client/session identity
6. Validate request schema and limits
7. Resolve approved context references
8. Select allowed model/provider
9. Build bounded agent context
10. Plan task and determine whether tools are needed
11. Filter MCP tools through policy
12. Execute model/tool actions with limits
13. Normalize provider/tool outputs
14. Verify against goal contract
15. Record audit/evidence metadata
16. Return canonical OpenAI-compatible response
```

## Failure behavior

- Missing key: reject before provider execution.
- Expired application: reject with a clear status.
- Unknown model: reject or use an explicitly configured fallback.
- MCP handshake failure: mark endpoint unavailable; do not expose its tools.
- Tool permission failure: do not call the tool.
- Timeout: stop according to bounded retry policy.
- Provider failure: use only configured fallback candidates.
- Verification failure: report failure; do not claim success.
- Resource pressure: fail safely rather than entering an unbounded loop.
