## 0.43.0 — Phase 43 External MCP loader parity

- Hardened legacy external MCP declaration resolution, disabled-server handling, duplicate identity detection, and safe error reporting.
- Added tests based on the supplied legacy loader contract. Individual legacy MCP server sources remain missing from the supplied archive; no behavioral parity is claimed for those servers.

## 0.39.0 — Phase 39

- Frontend legacy compatibility adapters for model/chat/SSOT/context views.
- Runtime-resolved tool catalog injected into system prompt.
- Ollama OpenAI-compatible/native deterministic integration coverage.
- Admin route inventory endpoint and documentation.
- Provider streaming fallback now refuses replay after emitted chunks.

## 0.38.0

- Closed the normal chat lifecycle from session archive through bounded context, provider response, evidence observation and session persistence.
- Persisted provider observations against session context without treating them as verified execution evidence.
- Included a bounded set of session evidence in compiled context.
- Added controlled runtime end-to-end smoke coverage for authenticated session continuity and SQLite evidence persistence.
- 121 tests pass.

# CHANGELOG

## 0.36.0 — Boot, Provider Persistence & Runtime Connectivity Verification

- Added boot-time provider upsert verification and SQLite persistence coverage.
- Added explicit Ollama Cloud OpenAI-compatible (`https://ollama.com/v1`) and native (`https://ollama.com/api/*`) example configurations.
- Fixed native Ollama adapter authentication headers for model, chat, and streaming requests.
- Added Phase 36 boot/provider runtime verification tests and documentation.

## 0.35.0 — Session/Prompt Lifecycle + Provider ENV Example

- Session history is included in bounded prompt context for chat and streaming chat.
- Runtime persists the exact latest user message and generated assistant response.
- Streaming chat persists accumulated assistant content/tool calls after successful provider completion.
- Shell-safe provider key mapping supports hyphenated provider IDs via underscore env names.
- `.env.example` documents Ollama, Gemini, Groq, Cloudflare Workers AI, OpenCode-compatible, and generic custom providers.

## 0.34.0 — Runtime Reliability & Agent Integration Verification

- Outbound circuit-breaker semantics and runtime reliability hardening.
- Agent registry/persona/runtime audit and package-derived runtime version.
- 113-test verification baseline.


## 0.48.0 — Runtime Operations + Admin Control Plane

- Cross-platform launcher root resolution, Node.js >=22.5.0 preflight, strict port validation, listener-owner diagnostics, and PID command-line verification.
- Linux systemd setup uses the selected port for runtime/Nginx and checks writable paths; Windows PowerShell launcher and optional Task Scheduler logon task.
- Request peer/local socket logging, provider/model bootstrap diagnostics, explicit local-no-token test mode, and preserved case for project root paths.
- Admin UI at `/admin` with provider/model CRUD and status/priority/defaults, provider catalog/model sync, agent CRUD, persona edit/disable, model mapping and runtime metrics.
- 175 automated tests passed in this local Node.js 22.16.0 environment; no live provider or Windows/systemd compatibility claim.
