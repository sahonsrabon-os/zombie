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

Edit `.env` before starting:

1. Replace `ADMIN_TOKEN` with a long random secret. Do not leave the example placeholder in a reachable deployment.
2. Keep `HOST=127.0.0.1` for local use and keep `LOCAL_AUTH_BYPASS=false`.
3. Keep `ZOMBIECODER_EXECUTION_MODE=chat-only` for the initial boot.
4. If using Ollama, follow [Configure Ollama](#configure-ollama).

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

Edit `.env`: set a strong `ADMIN_TOKEN`, retain `HOST=127.0.0.1`, leave `LOCAL_AUTH_BYPASS=false`, and start with `ZOMBIECODER_EXECUTION_MODE=chat-only`. Configure a provider before making chat requests.

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

## Tool Execution

Execution is disabled by default. First verify health, provider inference, and streaming. Then run the harmless tool-call integration test and review the tool permissions and project-root boundaries. Only after those checks should you set:

```dotenv
ZOMBIECODER_EXECUTION_MODE=tools-enabled
ZOMBIECODER_TOOLS=read_file,list_directory,grep_search,file_search
```

Add write-capable tools such as `create_file`, `edit_file`, or `apply_diff` only when needed. `run_terminal_command` accepts an argument array and has its own executable/subcommand allowlist; it does not provide an unrestricted shell. Do not enable delete, undo, or revert tools globally unless the deployment specifically requires them.

Three separate checks still apply: the runtime mode and global allowlist, an application-specific tool permission, and request consent for risky operations. A model-generated tool request is not permission by itself. Tool paths are bounded to the project root; a model answer or successful tool return is not automatically verified evidence.

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
