# Execution Planning — Provider-Neutral OpenAI-Compatible Gateway

**Status:** Proposed execution plan; not a claim of complete implementation or 100% correctness.

## 1. Purpose

ZombieCoder should expose one stable, documented interface to agents and compatible clients while executing requests through each upstream provider's real documented protocol. Clients and providers are not required to change their own rules. ZombieCoder adapts between contracts and must report incompatibilities instead of pretending they do not exist.

The OpenAI-compatible surface is a compatibility target, not a guarantee that every endpoint supports every OpenAI feature. Chat Completions, Responses, tool calling, multimodal input, JSON modes, and streaming can differ by client, provider, and model.

## 2. The three independent contracts

1. **Application/API contract:** routes, headers, authentication, request schema, response schema, errors, SSE framing, and model IDs expected by the client.
2. **Transport/security contract:** DNS, TCP connectivity, TLS certificate chain, hostname verification, proxy/tunnel state, authentication at the edge, and upstream trust.
3. **Execution/capability contract:** model availability, tool-call schema, argument assembly, tool authorization, result injection, stream termination, and fallback rules.

Passing one contract does not imply the other two passed. Keep separate status fields and test records.

## 3. GitHub is not a runtime tunnel

GitHub can authenticate source-control operations and manage repository history, branches, pull requests, CI workflows, and deployment artifacts. A Git remote named `origin` is a source-control reference; it does not automatically expose a developer's local `127.0.0.1:3000` service, issue a TLS certificate for that service, or create a public HTTPS endpoint for arbitrary clients.

Use GitHub for reviewed source and reproducible builds. Use a separate, explicitly configured network/edge solution if a client must reach a local runtime from outside the machine/network. Do not store tunnel tokens, provider keys, private certificates, or `.env` files in Git.

## 4. Transport options and when to use them

| Option | Best fit | Important limit |
|---|---|---|
| Loopback HTTP (`127.0.0.1`) | Client and runtime on the same machine, if the client permits it | Not a public endpoint; some clients may require HTTPS for particular features or policies |
| Private network/VPN (e.g. Tailscale Serve/tailnet) | Access limited to trusted devices/users | Requires membership and access policy; not equivalent to a public endpoint |
| Managed tunnel with HTTPS (e.g. Cloudflare Tunnel or Tailscale Funnel) | Expose a local service without router port-forwarding/public IP | Public exposure must be authenticated and minimized; tunnel health is not application health |
| Reverse proxy + domain + publicly trusted certificate (e.g. Caddy/Nginx with suitable certificate automation) | A stable domain and operator-managed deployment | Requires DNS, firewall/proxy setup, certificate renewal, and secure origin configuration |
| Hosted server with HTTPS | Production endpoint for clients that cannot reach a private network | Requires server hardening, secret management, updates, monitoring, and cost planning |

Cloudflare Tunnel is one option, not a universal requirement. For public exposure, the public URL must use a valid trusted TLS certificate, and the application still needs its own authentication and authorization. TLS encrypts transport; it does not prove that a model/tool call is correct or authorized.

### Cloudflare-specific configuration policy

If Cloudflare support is implemented later, keep it as an optional deployment adapter. Example variables may include `CLOUDFLARE_TUNNEL_ENABLED`, `CLOUDFLARE_TUNNEL_TOKEN`, `CLOUDFLARE_PUBLIC_URL`, and `CLOUDFLARE_ORIGIN_URL`. These names are proposals, not confirmation that the current runtime reads them.

- Never commit a tunnel token or print it in logs.
- A tunnel token authenticates the tunnel connector; it is not the same as the API's client token or TLS certificate.
- Do not mark the endpoint ready merely because a token exists or the tunnel process is running.
- Verify DNS/route, HTTPS certificate/hostname, edge access policy, origin reachability, API authentication, `/v1/models`, chat, stream, and tools separately.
- Prefer private access when the client can join the private network. If exposing a public URL, use an explicit allow/auth policy and do not expose admin routes unintentionally.

## 5. Provider and model identity

Expose stable ZombieCoder model aliases, for example `zombie-mini`, `zombie-lite`, and `zombie-classic`, only when each alias has an explicit mapping and policy. These are routing aliases, not claims of separately trained models. The public `/v1/models` list must reflect configured, intentionally exposed aliases and their state; it must not invent upstream models.

Keep upstream provider ID, upstream model ID, credentials, and routing priority server-side. Never trust a client-provided provider ID to bypass policy. Admin APIs may show sanitized mapping metadata to authorized administrators.

## 6. Provider onboarding checklist

For each provider, record all fields below independently:

1. Configuration source and secret reference (never secret value).
2. Environment variable name and startup loader behavior.
3. Authentication type and a safe invalid-key test.
4. Model-list endpoint and whether the provider actually supports it; manual model entry is acceptable when documented.
5. Exact model IDs returned or manually configured.
6. Non-streaming chat request/response.
7. Streaming: chunk parsing, Unicode fragment preservation, terminal marker, usage/final metadata, cancellation and timeout.
8. Function calling: tool declaration, choice mode, arguments, tool result, and subsequent assistant turn.
9. Native provider adapter where OpenAI compatibility is incomplete.
10. TLS hostname and certificate-chain verification for HTTPS endpoints.
11. Rate limit, quota, timeout, provider error, and safe diagnostic behavior.
12. Database persistence: provider ID, model ID, enabled state, priority, and non-secret metadata; confirm secrets are not accidentally persisted.
13. Live verification timestamp, test environment, runtime version, sanitized evidence, and status.

A model appearing in `/v1/models` proves only that the catalog endpoint listed it. It does not prove authentication, inference, tool calling, or streaming works.

## 7. Priority routing and fallback

- Priority range: `1` through `10`, where `1` is highest.
- A candidate is eligible only if enabled, configured, compatible with the request's required capabilities, and not currently excluded by a circuit/health policy.
- A failed request may move to the next eligible provider before any response bytes have been committed to the client.
- After streaming output has begun, do not append a second provider's response to the same stream. End with a truthful error/status event according to the documented contract.
- Do not retry tool executions with ambiguous external side effects automatically. A model retry and a tool side-effect retry are different operations.
- Record the chosen route, safe error class, fallback reason, and trace ID; never log credentials or raw sensitive prompt content by default.

## 8. Client compatibility strategy

Treat each client as a separate compatibility target. Do not assume a shared protocol name means identical behavior.

| Client/implementation | Documented integration direction | Must verify against ZombieCoder |
|---|---|---|
| Kilo Code | Custom OpenAI-compatible provider, base URL, key/headers, model discovery where supported | `/v1/models`, auth/header expectations, exact chat route, stream, tool calls, cancellation and errors |
| OpenCode | Custom provider with selected SDK/protocol and configured models | Chat Completions vs Responses selection, model IDs, tools, streaming and metadata expectations |
| Ollama OpenAI-compatible API | OpenAI-compatible subset; local and cloud endpoints differ | Supported fields and tool-call behavior for the exact Ollama version/model; don't assume full parity |
| Other OpenAI-compatible clients | Client's published API contract | Run that client's own integration test; record unsupported features explicitly |

A provider can support a feature while a particular model does not. A client can parse a response while still mishandling tool-call lifecycle. Test the full path, not only a single response JSON.

## 9. Verification gate and status model

Use explicit capability states such as `not_configured`, `configured`, `locally_tested`, `live_verified`, `failed`, and `unknown`. Keep capability-specific states for `models`, `chat`, `stream`, `tools`, and `tls`.

Recommended readiness logic:

- **Chat agent:** can be enabled when API authentication and non-streaming chat have passed for the chosen route.
- **Streaming agent:** requires chat plus streaming verification for that route/client.
- **Tool-executing agent:** requires tool declaration/argument/result lifecycle and tool authorization tests; TLS/network checks are additional prerequisites for remote endpoints.
- **Publicly reachable endpoint:** requires valid public HTTPS, edge/origin access policy, API authentication, and a successful end-to-end probe.

Do not call an endpoint `verified` because `/health` returns 200. Health, transport, authentication, inference, streaming, and tools are separate checks.

## 10. Implementation stages

1. **Inventory:** enumerate actual provider adapters, client targets, environment variables, DB schema, endpoints, and tests.
2. **Contract tests:** add fixtures for each provider's documented request and response shape; mark fixture tests as local tests only.
3. **Local integration:** start the runtime and exercise `/v1/models`, chat, stream, tool call, and failure paths through HTTP.
4. **Client integration:** configure Kilo/OpenCode/other clients against a local/private endpoint and capture sanitized evidence.
5. **TLS deployment:** choose private network, managed tunnel, reverse proxy, or hosted server; verify certificate and hostname from the client environment.
6. **Live provider verification:** use operator-owned credentials without printing or committing them; test one provider at a time and respect provider rate limits/terms.
7. **Release gate:** publish a matrix of `verified`, `failed`, and `not tested` with exact build/version. Never imply 100% correctness.

## 11. References

Official documentation consulted for this plan (availability and details can change):

- Kilo Code, OpenAI-compatible providers: https://kilo.ai/docs/ai-providers/openai-compatible
- OpenCode, providers: https://docs.opencode.ai/docs/providers/
- Ollama, OpenAI compatibility: https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx
- Tailscale Funnel: https://tailscale.com/docs/features/tailscale-funnel
- Tailscale Serve and Funnel command reference: https://tailscale.com/docs/reference/tailscale-cli/funnel
- GitHub remotes: https://docs.github.com/en/get-started/git-basics/about-remote-repositories
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

These sources document the products' own capabilities. They do not certify ZombieCoder's implementation.
