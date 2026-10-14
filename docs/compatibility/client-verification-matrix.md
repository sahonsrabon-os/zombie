# Client and OS Verification Matrix

This is a checklist, not a claim of compatibility. A generic HTTP probe cannot prove that a specific IDE, extension, browser, or operating system invokes tools correctly.

| Target | API/model catalog | TLS | Chat | Streaming | Tool calls | Current status |
|---|---|---|---|---|---|---|
| Linux + Node runtime, loopback HTTP | Local smoke passed | Not applicable to loopback HTTP | Not tested with a real provider key in this phase | Not tested with a real provider key in this phase | Blocked by default `chat-only` gate | Locally smoke-tested only |
| Linux + systemd service installer | Installer syntax checked; not installed on this host | Not verified on a deployed domain | Not verified | Not verified | Not enabled | Implemented, deployment pending |
| Windows + Cursor / VS Code extension | Not tested | Not tested | Not tested | Not tested | Not tested | Not verified |
| Windows + Windsurf / Kilo Code | Not tested | Not tested | Not tested | Not tested | Not tested | Not verified |
| OpenCode | Not tested | Not tested | Not tested | Not tested | Not tested | Not verified |
| Browser-based client | Not tested | Not tested | Not tested | Not tested | Not tested | Not verified |
| macOS + launchd | Not implemented in this phase | Not tested | Not tested | Not tested | Not tested | Pending |

## How to promote a row

For each exact client/version and OS, record the build hash, endpoint URL (never credentials), authentication result, model ID, response status, streaming completion, harmless tool-call request/result, and log/request ID. Only mark a capability verified after that exact test succeeds. Keep chat-only mode until the target client and tool path are proven.
