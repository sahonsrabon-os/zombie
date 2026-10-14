# Client Integration Patterns

## 1. Purpose

This document describes how an approved client application connects to ZombieCoder Runtime without knowing provider credentials, internal routing, or MCP authentication details.

The client only needs:

- Runtime base URL
- Application API key
- OpenAI-compatible endpoint
- Model identifier permitted by the application
- Optional session identifier

## 2. Standard OpenAI-compatible client pattern

```text
Client application
    -> Authorization: Bearer <application_api_key>
    -> POST /v1/chat/completions
    -> ZombieCoder authenticates application
    -> Runtime resolves policy/session/context
    -> Provider or local model is selected
    -> Response is normalized
    -> Client receives OpenAI-compatible JSON
```

### Environment variables

```env
ZOMBIECODER_BASE_URL=https://runtime.example.com/v1
ZOMBIECODER_API_KEY=replace_with_application_key
ZOMBIECODER_MODEL=approved-model-id
```

Never commit the API key to source control. Prefer environment variables or the host application's secret manager.

## 3. JavaScript client example

```js
const response = await fetch(
  `${process.env.ZOMBIECODER_BASE_URL}/chat/completions`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ZOMBIECODER_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.ZOMBIECODER_MODEL,
      messages: [
        { role: "user", content: "Hello from the client application." },
      ],
      stream: false,
    }),
  }
);

if (!response.ok) {
  throw new Error(`ZombieCoder request failed: ${response.status}`);
}

const data = await response.json();
console.log(data.choices?.[0]?.message?.content ?? "");
```

## 4. Python client example

```python
import os
import requests

response = requests.post(
    f"{os.environ['ZOMBIECODER_BASE_URL']}/chat/completions",
    headers={
        "Authorization": f"Bearer {os.environ['ZOMBIECODER_API_KEY']}",
        "Content-Type": "application/json",
    },
    json={
        "model": os.environ["ZOMBIECODER_MODEL"],
        "messages": [
            {"role": "user", "content": "Hello from the client application."}
        ],
        "stream": False,
    },
    timeout=60,
)

response.raise_for_status()
payload = response.json()
print(payload["choices"][0]["message"]["content"])
```

## 5. Laravel/PHP integration pattern

Keep the runtime key in server-side configuration, not in browser JavaScript.

```php
$response = Http::withToken(config('services.zombiecoder.key'))
    ->timeout(60)
    ->post(
        rtrim(config('services.zombiecoder.url'), '/') . '/chat/completions',
        [
            'model' => config('services.zombiecoder.model'),
            'messages' => [
                ['role' => 'user', 'content' => $message],
            ],
            'stream' => false,
        ]
    );

$response->throw();

$content = data_get($response->json(), 'choices.0.message.content');
```

Suggested configuration:

```php
// config/services.php
'zombiecoder' => [
    'url' => env('ZOMBIECODER_BASE_URL'),
    'key' => env('ZOMBIECODER_API_KEY'),
    'model' => env('ZOMBIECODER_MODEL'),
],
```

Do not expose `ZOMBIECODER_API_KEY` through frontend bundles, public endpoints, logs, or exception pages.

## 6. Session pattern

A client may send a stable session identifier when the runtime supports it.

```json
{
  "model": "approved-model-id",
  "messages": [
    {"role": "user", "content": "Continue the previous task."}
  ],
  "metadata": {
    "session_id": "session_123"
  }
}
```

The runtime must validate that the session belongs to the authenticated application. A client-provided session ID is a reference, not proof of ownership.

## 7. MCP client visibility pattern

The client does not need to know the provider token or external MCP credential.

The intended sequence is:

1. Admin registers the MCP endpoint.
2. Admin configures its credential reference.
3. Runtime performs handshake.
4. Runtime discovers tools.
5. Permission engine filters tools.
6. Approved tools are exposed to the agent runtime.
7. The client receives the resulting answer or approved tool result.

The client must not submit arbitrary external MCP URLs for immediate execution unless an explicit administrative policy permits registration.

## 8. Transport selection pattern

| Client situation | Recommended transport |
|---|---|
| Same host/process family | UDS or local HTTP according to deployment |
| Trusted private network | HTTPS, or explicitly controlled HTTP |
| Public/remote client | HTTPS |
| Streaming response | Supported HTTP streaming/SSE contract |
| MCP endpoint | Its declared and validated MCP transport |

Do not silently downgrade remote HTTPS to HTTP. Do not assume gRPC is required for every MCP endpoint.

## 9. Client error handling

Clients should handle:

- `401` — missing or invalid application key
- `403` — application, model, session, or tool not permitted
- `404` — unknown endpoint or resource
- `409` — state or handshake conflict
- `408`/`504` — timeout
- `429` — rate/resource limit
- `500`/`502`/`503` — runtime/provider/MCP failure

The client should show a useful error without exposing raw provider credentials, internal stack traces, or private context.

## 10. Client integration checklist

- [ ] Store the application key server-side.
- [ ] Configure the runtime base URL.
- [ ] Use only an approved model ID.
- [ ] Add timeout handling.
- [ ] Avoid unbounded retries.
- [ ] Log request IDs, not secrets.
- [ ] Validate response shape.
- [ ] Handle expiry and revocation.
- [ ] Keep browser clients behind the application's own backend.
