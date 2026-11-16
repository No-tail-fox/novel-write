# Pi native gateway

Import `PiRequestLedger` and `startPiGateway` from `./index`. Open a ledger with an absolute private directory and `maxRequests` (1–1000), then start the gateway:

```ts
const ledger = await PiRequestLedger.open(privateDirectory, 10);
const gateway = await startPiGateway({
  ledger,
  provider: {
    protocol: 'openai-responses', // or anthropic / openai-chat
    upstreamUrl: 'https://provider.example/custom/v1/responses',
    apiKey: providerKey,
    auth: 'bearer', // or x-api-key
    model: 'fixed-model',
  },
  timeoutMs: 120000,
});
// Give Pi gateway.baseUrl and gateway.localToken, never providerKey.
// OpenAI SDK base URL generally appends /v1; Anthropic SDK uses the origin.
// On shutdown:
await gateway.close();
await ledger.close();
```

The local authenticated routes are `/v1/messages`, `/v1/chat/completions`, and `/v1/responses`; only the configured protocol route is enabled. Upstream URL is the exact endpoint, without query, fragment, or userinfo. HTTPS is required except explicit `allowLoopbackTestProvider` for HTTP 127.0.0.1 mocks. Local authentication accepts Bearer or x-api-key. The configured model must match the request. All JSON bytes, including tools, images and stream options, pass unchanged. No shared LLM provider adapter is used.

The host must configure Pi/SDK retries off. The gateway performs no retries, redirects, endpoint fallback, model fallback, or response replay. Concurrent requests receive 409; they are not queued. Duplicate canonical request bodies are rejected. Limits are maxRequests, timeoutMs and optional maxRequestBytes/maxResponseBytes (defaults 8/32 MiB). No monetary or cumulative token budget is claimed.

An optional `beforeSubmit(body)` async host admission hook runs inside the exclusive request window, before ledger submission or upstream dispatch. It receives a structured copy of the validated body. Rejection returns PI_GATEWAY_ADMISSION_REJECTED and leaves request counts unchanged; the host may implement budget checks using this hook. Hooks should finish promptly and must not perform model calls themselves.

Usage is required to authorize subsequent requests. For streamed OpenAI Chat requests, configure `stream_options: { include_usage: true }` in Pi; this field is preserved rather than injected. Receipts preserve native usage details. A complete terminal reply without usable input/output token counts is recorded as `received`, `usageStatus: 'unknown'`, and delivered, but blocks further spending. `summary().usageUnknown` counts these separately from transport/protocol `unknown`. Known usage is evidence reported by the provider, not billing settlement.

Full JSON/SSE is buffered until terminal evidence is verified. Anthropic requires message_stop (stream) or stop_reason (JSON); Chat requires all choices finished plus [DONE] (stream); Responses requires a completed, incomplete, or failed response status with its matching terminal event for streams. Known incomplete replies retain the provider's reason (such as max_output_tokens) and are received; known failed replies are also received evidence but block subsequent calls. Neither is mislabeled as a missing transport terminal. The host can inspect `ledger.receipts()` for detached snapshots with native usage, including nested cache details. Optional `transport: typeof fetch` supports a trusted host proxy transport, which must honor abort signals and manual redirect handling. The complete response and receipt manifest are written and fsynced in private-responses before the ledger settlement is synced and the reply is delivered. requests.jsonl contains request fingerprints and receipt metadata, not prompt bodies or credentials; private responses contain model output and require host-enforced private directory ACLs, particularly on Windows. File fsync does not claim power-loss atomicity of directory renames on every filesystem.

Submission is durable before dispatch. Interruptions, timeout, disconnect, malformed terminal evidence, response limits, 5xx and redirects block further calls as unknown; definitive 4xx rejection also blocks. Closing the gateway aborts active calls and waits for durable settlement before ledger.close releases ownership. A process crash retains owner.lock; locks are never automatically stolen. Recovery is deliberately manual: preserve artifacts, inspect evidence, and do not reissue a potentially charged request. Reopening a cleanly closed ledger retains unknown/usage-unknown blocking and request counts.
