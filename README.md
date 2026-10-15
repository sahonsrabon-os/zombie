# ZombieCoder Runtime

ZombieCoder is a local-first, provider-neutral AI runtime. It exposes an OpenAI-compatible chat API and adds agent routing, context and session handling, optional native tools, MCP boundaries, and an admin control plane.

> **Status:** This project does not claim universal provider/client compatibility. A configured provider or model is not necessarily live-verified. Check the deployment report and test the exact model, authentication, streaming, and tools you plan to use.

## Features

- OpenAI-compatible chat completions, model catalog, and Server-Sent Events (SSE) streaming.
- Provider adapters and routing for Ollama, Gemini, Groq, Cloudflare Workers AI, and generic OpenAI-compatible endpoints. Optional providers remain disabled until configured.
- Built-in agent and persona registry, request routing, session lifecycle, and bounded context from project SSOT, syllabus, and memory.
- SQLite-backed runtime state, structured logs, request IDs, rate/concurrency controls, and outbound circuit breaking.
- Optional native tools for workspace reading/search, scoped file changes, Git status/diff, and allowlisted command execution.
- Optional MCP integrations, with separate permissions and outbound network policy.
- Admin UI at `/admin` and authenticated admin APIs for providers, models, agents, applications, and tool permissions.
- A portable, dependency-free runtime build (`npm run build`) that excludes `.env`, databases, logs, tests, and source-worktree state.
- HTTP by default; HTTPS and Unix-domain socket transports are optional.

Some capabilities are intentionally not implemented: built-in web search, general webpage fetching, and sub-agent delegation. See [Add New Tool Contract](docs/ADD-NEW-TOOL.md) before adding tools.

## Requirements

- Node.js **22.5 or later** (`node:sqlite` is used).
- Windows 10/11 with PowerShell, or Linux. The included Linux service installer requires systemd.
- Ollama is optional. Install it separately if you want to run local models.
- No third-party npm packages are currently declared; `npm install` is not required for the runtime as checked into this repository.

## Quick Start: Windows

Clone the repository, then open PowerShell in its folder:

```powershell
git clone https://github.com/sahonsrabon-os/zombie.git
Set-Location .\zombie
node --version
Copy-Item .env.example .env
```

Edit `.env` before starting. For normal authenticated operation, set a long random `ADMIN_TOKEN` and keep `LOCAL_AUTH_BYPASS=false`. For a direct local development session only, leave `ADMIN_TOKEN` empty and set `LOCAL_AUTH_BYPASS=true`; retain `HOST=127.0.0.1`. The runtime rejects this bypass for requests carrying Cloudflare or forwarded-proxy headers. It is not a public-access setting. Start in `chat-only` until you finish the verification steps. If using Ollama, follow [Configure Ollama](#configure-ollama).

You can generate a URL-safe token in PowerShell and paste its output into `.env`:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$rng.Dispose()
$token
```

Run tests and start the runtime:

```powershell
npm test
npm start
```

To create a portable runtime copy, run `npm run build`. The default output is `dist/zombiecoder-runtime`; copy `.env.example` to `.env` inside that package and configure it there. Each package uses its own relative `data/` and `logs/` directories, so separate installations do not share SQLite state or runtime caches. The build refuses to overwrite an unmanaged output directory.

Alternatively, use the Windows preflight launcher:

```powershell
.\scripts\windows\start-runtime.ps1
```

Check health in another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

Stop with `node start.js --stop`. The launcher checks the recorded process before stopping it; it does not kill arbitrary Node processes.

## Quick Start: Linux

Install Node.js 22.5+ from a trusted package source, clone the repository, then enter its folder:

```bash
git clone https://github.com/sahonsrabon-os/zombie.git
cd zombie
node --version
cp .env.example .env
chmod 600 .env
```

Edit `.env`: for authenticated operation, set a strong `ADMIN_TOKEN` and leave `LOCAL_AUTH_BYPASS=false`. A direct local development setup may instead leave the token empty and set `LOCAL_AUTH_BYPASS=true`; retain `HOST=127.0.0.1`. Forwarded and Cloudflare requests are denied by this bypass. Start with `ZOMBIECODER_EXECUTION_MODE=chat-only` and configure a provider before making chat requests.

```bash
npm test
npm start
```

In another shell, verify the local service:

```bash
curl --fail http://127.0.0.1:3000/health
```

For a persistent Linux service, review the script and its prompts first, then run:

```bash
sudo bash scripts/setup-os-runtime.sh
```

The helper currently supports Linux/systemd. Its service starts in `chat-only` mode. The optional Nginx path needs an existing trusted certificate and explicitly asks before installing Nginx. The script does not configure Cloudflare Tunnel, DNS, or a certificate authority.

## Configure Ollama

Install and start Ollama separately, then pull a model and inspect its exact model ID:

```bash
ollama pull llama3.2
ollama list
```

In `.env`, edit the `ollama-local` object in `PROVIDER_CONFIG_JSON`: set `defaultModel` to an ID returned by `ollama list`, and set `models` to the models you want to expose. For example, the ID may be `llama3.2:latest`; use the ID reported by your own Ollama installation. Set:

```dotenv
PROVIDER_MODELS_REFRESH_ON_START=true
ALLOW_PLAINTEXT_HTTP=true
PROVIDER_ALLOW_PRIVATE_NETWORK=true
PROVIDER_ALLOW_PRIVATE_HOSTS=127.0.0.1
PROVIDER_ALLOW_HOSTS=127.0.0.1
```

These switches are for a local HTTP Ollama endpoint. The provider host allowlist restricts outbound provider requests to the listed hosts; do not copy these values blindly when adding a remote provider. MCP has a separate, stricter policy. Restart the runtime after editing `.env` and verify the refreshed catalog at `/health` or `GET /v1/models`.

For cloud providers, set the matching `PROVIDER_KEY_<ID>` variable and configure the provider endpoint/model in `PROVIDER_CONFIG_JSON`. Keep unused providers disabled. Never put real keys in `.env.example`, source code, screenshots, or README examples.

The local Ollama OpenAI-compatible base URL is `http://127.0.0.1:11434/v1`; the adapter calls `/models` and `/chat/completions` beneath it. Native Ollama uses `http://127.0.0.1:11434` and `/api/*`. Keep local host allowlisting enabled. `PROVIDER_REQUEST_TIMEOUT_MS` defaults to 180000 ms (maximum 600000) to allow cold/slow local inference; restart after changing it.

Public client model IDs keep the built-in `zombie-mini`, `zombie-lite`, and `zombie-classic` names. Add or override aliases with `ZOMBIECODER_MODELS_JSON` without source edits; optional paired `providerId` and `model` fields force a configured target. Agent IDs remain in the separate `agent`/`persona` fields.

## Authentication and Chat API

Admin routes require `Authorization: Bearer <ADMIN_TOKEN>`. Client chat requests require an application API key; create one through the admin API and store the returned key securely. Do not use the admin token as a client key.

Create an application key with the admin token. The response contains a one-time `apiKey`; store it in a secret manager or a local environment variable, and never commit it:

```bash
curl --fail-with-body -X POST http://127.0.0.1:3000/v1/admin/applications \
	-H "Authorization: Bearer $ADMIN_TOKEN" \
	-H 'Content-Type: application/json' \
	-d '{"name":"local-client"}'
```

PowerShell equivalent:

```powershell
$headers = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }
$app = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/v1/admin/applications' -Method Post -Headers $headers -ContentType 'application/json' -Body '{"name":"local-client"}'
$env:APP_API_KEY = $app.apiKey
```

Example chat request (replace the model and application key with your configured values):

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
	-H "Authorization: Bearer $APP_API_KEY" \
	-H 'Content-Type: application/json' \
	-d '{"model":"llama3.2:latest","agent":"code-guru","messages":[{"role":"user","content":"Explain how AI works in a few words"}]}'
```

On Windows, use `curl.exe` (PowerShell's `curl` name may resolve to `Invoke-WebRequest`) or `Invoke-RestMethod`. The chat response uses a compatibility envelope; provider identity may be masked. For streaming, send `"stream": true` and consume SSE events through the final `[DONE]` marker.

The admin UI is available at `http://127.0.0.1:3000/admin`. The unauthenticated `/health` response is for service health only; it is not proof that chat or tools work.

For direct local development without API keys, set `ADMIN_TOKEN=` and `LOCAL_AUTH_BYPASS=true` in `.env`, then restart. Requests must be direct loopback requests with a loopback `Host`; requests carrying Cloudflare/forwarded-proxy headers are rejected. The local identity is `local-development`. Never combine this mode with a publicly reachable listener or disable the proxy-header guard.

## Tool Execution

Execution is disabled by default. First verify health, provider inference, and streaming. Then run the harmless tool-call integration test and review the tool permissions and project-root boundaries. After those checks, `ZOMBIECODER_EXECUTION_MODE=tools-enabled` activates the execution routes. To allow all implemented native tools in a local development environment, set:

```dotenv
ZOMBIECODER_EXECUTION_MODE=tools-enabled
ZOMBIECODER_TOOLS=runtime_echo,read_file,write_file,list_directory,create_file,edit_file,apply_diff,delete_file,list_dir,read_directory,grep_search,regex_search,file_search,find_files,view_symbol,code_graph,run_terminal_command,execute_bash,kill_process,undo,revert_file,git_diff,git_status,task_planner,todo_manager
```

The built-in tools still enforce task policy, project-root boundaries, tool-specific arguments, explicit consent for risky operations, and an executable/subcommand allowlist for terminal commands. `run_terminal_command` does not provide an unrestricted shell. `web_search`, `fetch_web_page`, and `delegate_subagent` are not implemented; legacy external MCP tool entries are not runnable without configured MCP endpoints.

Three separate checks still apply: the runtime mode and global allowlist, an application-specific tool permission, and request consent for risky operations. A model-generated tool request is not permission by itself. Tool paths are bounded to the project root; a model answer or successful tool return is not automatically verified evidence.

In local no-token mode, the synthetic application ID is `local-development`; grant native tool permissions to that identity through the localhost-only admin API if the tool policy denies a call. Do not treat this shortcut as suitable for public clients.

## MCP Endpoints

The runtime exposes an authenticated, stateless Streamable HTTP MCP gateway at `POST /mcp`; `POST /v1/mcp` is a compatibility alias. `GET /mcp` preserves the older tool-list response. `initialize`, `tools/list`, and `tools/call` use JSON-RPC 2.0. The gateway lists permission-approved external MCP tools and native internal tools in one standard catalog, but dispatches them through separate existing execution adapters. It does not provide an SSE stream transport.

- MCP tool catalog (admin): `GET /v1/admin/mcp/tools`
- Upstream endpoint registry: `GET /v1/admin/mcp/endpoints`
- MCP tool call: `POST /mcp` (`tools/call`)
- REST compatibility call: `POST /v1/mcp/tools/call`
- Runtime MCP config: `GET /api/config/mcp`

Upstream servers must use their actual URLs, for example `EXTERNAL_MCP_PUBLIC_API_URL` or `EXTERNAL_MCP_OCR_URL`. HTTPS uses Node's default certificate/hostname verification. Plain HTTP and private destinations stay denied without explicit host allowlisting. Browser clients need an exact `MCP_ALLOWED_ORIGINS` entry; wildcard origins are not accepted. With no external endpoint configured, native workspace tools can still appear after an application-scoped permission grant.

## Workspace and Agent Context

The runtime is separate from the editor and does not guess an editor's active folder. Bind a workspace once with the admin token; this creates `.zombiecoder/`, generates a full SSOT only when one does not already exist, and ensures the syllabus and project memory files. Assign it to an application so subsequent requests can omit `projectRoot`:

```powershell
$headers = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/set-working-dir' -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ applicationId = $app.application.id; directory = (Get-Location).Path } | ConvertTo-Json)
```

The directory-binding route accepts the admin token, or an application API key from a direct loopback request with no proxy headers; forwarded/public requests cannot expand their filesystem boundary. An application key may bind only its own workspace. Explicit project roots on normal APIs must already be statically configured or approved by this route. Rebinding without `refreshSSOT=true` preserves a manually maintained SSOT; set that flag only to request a full rescan.

Session messages are persisted in the runtime's per-install SQLite database. The model receives at most 10 recent messages, plus up to 6 query-relevant excerpts from previous sessions belonging to the same application and exact workspace. SSOT sections, syllabus entries, and memory notes are separately relevance-ranked and byte-bounded. Full transcripts are not copied into project files; the project `.zombiecoder/agents/memory.json` is for durable project notes.

`ADMIN_UI_ENABLED=false` disables only the optional HTML dashboard. The HTTP APIs, MCP gateway, authentication, and runtime startup do not depend on the admin page being present.

### Legacy local fallback

The old OCR, TTS, and screen-recorder servers can be used as a fallback without replacing the current registry. Set `LOCAL_MCP_FALLBACK_ENABLED=true`, `MCP_ALLOW_HTTP=true`, and `MCP_ALLOW_PRIVATE_NETWORK=true` in local `.env`, then start with `npm start` or `node start.js`. Ready endpoints use `http://127.0.0.1:3100` (OCR), `:3102` (TTS), and `:3101` (screen-recorder, Linux/X11 only). The fallback only binds/probes `127.0.0.1`, skips any service with an explicitly configured upstream URL, validates `initialize`/`tools/list` before registration, discovers tools through the existing registry, grants discovered fallback tools only to `local-development` when loopback no-token mode is active, and stops only child processes it spawned. Services missing dependencies or failing readiness checks are skipped and logged. The fallback is off in `.env.example` by default.

Install the tool-specific local dependencies before expecting calls to work: OCR requires Tesseract (ImageMagick is additionally needed for crop/preprocessing); TTS requires the `edge-tts` executable (installable with `python -m pip install edge-tts`); screen recording requires Linux/X11, `ffmpeg`, and `xdpyinfo` and is intentionally skipped on Windows. Startup reports missing dependencies rather than registering an unusable local endpoint. No legacy Facebook Ads credential or public combined gateway is copied or auto-started.

## Verify a Deployment

Basic local checks:

```bash
node scripts/verify-deployment.mjs
```

Authenticated chat and streaming checks require a valid application key and model ID:

```bash
ZC_VERIFY_API_KEY="$APP_API_KEY" \
ZC_VERIFY_MODEL="llama3.2:latest" \
node scripts/verify-deployment.mjs --chat --stream
```

Windows PowerShell:

```powershell
$env:ZC_VERIFY_API_KEY = '<application-api-key>'
$env:ZC_VERIFY_MODEL = 'llama3.2:latest'
.\scripts\windows\verify-deployment.ps1 --chat --stream
Remove-Item Env:ZC_VERIFY_API_KEY, Env:ZC_VERIFY_MODEL
```

The report is written to `data/deployment-verification.json` (ignored by Git). The script checks health, model catalog, and optionally chat/streaming. It **does not** verify tool calling or TLS when the target uses HTTP; run a separate harmless tool-call test and use verified HTTPS for public deployments.

## Optional Windows Start at Logon

To register a per-user Windows Task Scheduler entry:

```powershell
.\scripts\windows\register-startup-task.ps1
```

This is a scheduled task, not a Windows service. The runtime reads `.env` from the repository directory. Restrict access to that file and the Windows account that owns the task.

## Public Access and Cloudflare Tunnel

Keep the runtime bound to loopback (`HOST=127.0.0.1`) behind a tunnel or reverse proxy. Configure Cloudflare Access (or an equivalent authenticated access layer) before publishing an origin. Protect `/admin` and `/v1/admin/*`; admin-token authentication remains required as defense in depth. A healthy tunnel does not prove that the origin is safely configured. Do not commit tunnel tokens, tunnel credential JSON, DNS credentials, or private keys. This repository does not provision or modify tunnel routes.

HTTPS is disabled by default. For public traffic, use verified HTTPS at the edge and an appropriate trusted origin setup. Do not enable plaintext public access or `LOCAL_AUTH_BYPASS` on a server.

## Environment and Local Files

- `.env.example` is a template; copy it to `.env` and replace placeholders locally.
- `.env`, local databases, logs, runtime data, tunnel credentials, and certificates are ignored by Git.
- Provider API keys use `PROVIDER_KEY_<PROVIDER_ID>`; provider IDs are uppercased and hyphens become underscores.
- `HOST`, `PORT`, `DATA_DIR`, `SQLITE_PATH`, `LOG_DIR`, provider/model settings, tool limits, and network policies are configurable in `.env`.
- Keep the default loopback bind unless you have configured and verified an authenticated public edge.

## Project Documentation

- [Documentation index](docs/README.md)
- [System overview](docs/00-system-overview.md)
- [Identity and authentication](docs/02-identity-and-auth.md)
- [MCP architecture](docs/03-mcp-architecture.md)
- [Request lifecycle](docs/05-request-lifecycle.md)
- [API contracts](docs/07-api-contracts.md)
- [Migration plan](docs/08-migration-plan.md)
- [Add a new tool](docs/ADD-NEW-TOOL.md)
- [Linux/systemd setup helper](scripts/setup-os-runtime.sh)
- [Windows launch helper](scripts/windows/start-runtime.ps1)

## Verification Vocabulary

- **Intended:** a design goal; not evidence that it exists.
- **Implemented:** code exists in this version.
- **Locally tested:** a named local test passed; third-party compatibility is not implied.
- **Live verified:** the identified real endpoint/client passed a recorded check.
- **Not verified:** evidence is missing or incomplete.

Always check the exact `package.json` version, health output, current `.env`, and deployment report for the instance you are operating. A fixture test, listed model, or healthy `/health` response alone does not prove every integration works.
