# Pi worker: initial offline integration

This isolated package pins the npm-registry `@earendil-works/pi-coding-agent` **1.5.2** and `@sinclair/typebox` **0.34.52**, with a package-lock for the complete dependency graph. Registry metadata verified during implementation: Pi requires Node **>=22.19.0**. The machine's PATH Node 20 is too old; verification used Electron 41's Node **24.15.0**. No paid model requests were made.

## Build and offline verification

From repository root with Node >=22.19:

```sh
npm ci --prefix services/pi-agent-worker --ignore-scripts
node services/pi-agent-worker/build.mjs
node scripts/smoke-pi-agent.mjs
```

The build uses the repository's existing esbuild installation without modifying its manifest. It emits `dist/worker.mjs` and a map, leaving Pi dependencies external. Ship that entry plus this package's locked production node_modules; do not copy only the entry. On this Windows checkout, the installed dependency tree measured 117,238,897 bytes / 16,625 files (124 installed dependencies), and the worker entry is approximately 7.3 KB. This is installed size, not compressed installer size. One measured cold process/session startup took 6,800 ms; not a performance benchmark.

Windows verification used:

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& .\node_modules\electron\dist\electron.exe services/pi-agent-worker/build.mjs 2>&1 | Out-String
& .\node_modules\electron\dist\electron.exe scripts/smoke-pi-agent.mjs 2>&1 | Out-String
```

The smoke forks the built worker and binds an offline SSE provider on 127.0.0.1. It asserts exactly seven requests: Anthropic tool call + continuation containing a real image tool result, restored session continuation without tool replay, manual compaction, HTTP 429 without retry, one successful native Chat request, and one successful native Responses request. The fixture uses a long transcript because Pi correctly refuses compaction on tiny sessions. It asserts no `auto_retry_start` events. This is a Node IPC smoke; actual Electron utilityProcess launch belongs to host integration. TypeScript checked with repository compiler, `--ignoreConfig --noEmit --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --types node`.

## Wire contract

Transport is Electron `process.parentPort` when available, Node fork IPC otherwise; newline JSON stdin/stdout is a development fallback. Every command carries `id`, echoed in its response. Native Pi events are forwarded as `{type:'event', event}`. A command failure is `{id,type:'error',error:string}`.

- `{id,type:'start',config,restore?:boolean}` -> `{id,type:'started',sessionFile}`.
- Config requires absolute `cwd`, absolute `sessionDir`, `gatewayBaseUrl` (`http://127.0.0.1` only), `gatewayToken`.
- Optional config: `api` (`anthropic-messages` default, `openai-completions`, `openai-responses`), `modelId`, `modelName`, `contextWindow`, `maxTokens`, `reasoning`, `images`, `thinkingLevel`, `systemPrompt`, `sessionFile`, `tools`.
- For Chat and Responses, `gatewayBaseUrl` must include `/v1`; Anthropic receives the origin. The worker only receives a short-lived local gateway credential, never a real provider credential.
- `tools` is an array of `{name,description,parameters:JSONSchema,executionMode?:'sequential'|'parallel'}`. Defaults are sequential; explicitly opt safe host operations into parallel execution. With no array, a generic `storydream_host({operation,input})` bridge is offered for smoke/bring-up. Production should supply explicit schemas and an allowlist.
- `{id,type:'prompt',text}` -> `{id,type:'settled',sessionFile}`. A settled operation may contain a provider error event: it is not by itself a successful generation receipt.
- `{id,type:'compact',instructions?}` -> `{id,type:'compacted',result,sessionFile}`. This makes a model request through the same gateway and must count against its budget.
- `{id,type:'abort'}` -> `{id,type:'aborted'}`; `{id,type:'shutdown'}` -> acknowledged shutdown and exit.
- Tool calls emit `{type:'tool',toolCallId,name,params}`. Reply `{type:'tool_result',toolCallId,result}` or `{type:'tool_result',toolCallId,error:string}`. A result with `content` is passed through as the Pi tool result (text/image blocks); other JSON is encoded as text. Host owns schema/path policy, rendering, durable receipts and replay reconciliation. Never execute arbitrary operation names solely because they arrived here.

The host associates process traffic with its runId/segment. Do not trust callers to select arbitrary restore files. Host must whitelist process environment variables, put TEMP/TMP under the run directory, enforce budget/unknown blocks in the gateway and kill workers on disconnect. This worker does not provide an OS sandbox.

## Verified SDK surface and isolation

Actual 1.5.2 API uses `ModelRuntime.create()` and `registerProvider('storydream', ...)`; `createAgentSession({modelRuntime,model,resourceLoader,settingsManager,sessionManager,noTools:'builtin',tools,customTools})`; `SessionManager.create(cwd,sessionDir)` and `SessionManager.open(sessionFile,sessionDir,cwd)`. `noTools:'all'` also disables custom tools, so it is unsuitable with an explicit host bridge. Session file names are generated by Pi and returned to the host; do not assume literal `session.jsonl`.

Resource loading uses an isolated agentDir, in-memory settings, `noContextFiles`, `noExtensions`, `noSkills`, `noPromptTemplates`, and `noThemes`; no project/user AGENTS or third-party extensions are loaded. Runtime model network refresh is disabled and models.json loading is disabled. Settings set `retry.enabled=false`, `retry.maxRetries=0`, `retry.provider.maxRetries=0`, `cacheWarming='off'`, `defaultProjectTrust='never'`, `enableInstallTelemetry=false`, `enableAnalytics=false`, and empty default tools. Only explicitly forwarded tools are active; no SDK shell or filesystem tools are active. Compaction remains enabled and uses the gateway. Startup and prompt/compact overlap are rejected.

## Remaining integration gates

Actual utilityProcess packaging/startup, long idle cache observation, abort during a pending provider/tool request, parallel execution timing, dangling tool-call crash reconciliation, and model-specific paid validation remain unverified here. Session restore is proven only after a completed turn. Do not silently replay unreceipted interrupted tools. Automatic overflow compaction can create a summary/continuation request even with retry disabled; the host gateway must remain authoritative for per-segment budget and unknown blocking. The smoke does not replace the gateway's ledger tests. No real rendering, filesystem writes by tools, Python execution, sandbox, budget UI or final media delivery is implemented inside this package.
