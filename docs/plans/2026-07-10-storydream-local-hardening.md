# StoryDream Local Hardening And Feature Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the local Electron trust boundary, remove credential and persistence hazards, complete the dedicated HTML-video pipeline, and make long-running state/history/package behavior bounded and verifiable.

**Architecture:** Keep the existing React + Electron + sql.js application, but treat the renderer as untrusted and route privileged work through a validated IPC gateway. Add main-process credential/network/process services, retain existing domain providers, and introduce an injected six-step HTML-video runner with atomic checkpoints.

**Tech Stack:** React 19, TypeScript 6, Electron 41, Vite 8, Vitest 4, Zod 4, sql.js, undici, Node fs/dns/child_process APIs, Python 3.12, Playwright Python APIs, ffmpeg/imageio-ffmpeg.

---

## Working Tree Rules

- The branch already contains approved commit `f0f5acd` and related unstaged audit/dependency work.
- Never reset, checkout, or discard existing changes.
- Inspect `git diff -- <path>` before modifying an already-dirty file.
- Stage explicit paths or hunks; never use `git add -A`.
- Keep `task_plan.md`, `findings.md`, and `progress.md` unstaged until the final documentation task unless deliberately committing them.
- In this environment, use `& 'I:\nodejs\node.exe' ...` until Task 1 proves the npm wrapper works.

## Task 1: Repair Dependency Baseline And Windows npm Entrypoints

**Files:**
- Create: `scripts/run-npm-powershell.cmd`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/startup-script.test.ts`
- Modify: `tests/electron-build.test.ts`

**Step 1: Write failing contract tests**

Add tests requiring:

```ts
expect(packageJson.dependencies).toMatchObject({
  'sql.js': expect.any(String),
  undici: '^6.27.0',
});
expect(packageJson.devDependencies).toMatchObject({
  concurrently: '^10.0.3',
  esbuild: '^0.28.1',
  vite: '^8.1.4',
});
expect(packageJson.scripts.typecheck).toContain('run-npm-powershell.cmd');
expect(wrapper).toContain('%npm_node_execpath%');
expect(wrapper).not.toContain('I:\\nodejs');
```

Keep the existing assertion that `undici` is a runtime dependency and external Electron build module.

**Step 2: Run tests and verify failure**

```powershell
& 'I:\nodejs\node.exe' node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/startup-script.test.ts tests/electron-build.test.ts
```

Expected: FAIL on versions and missing wrapper.

**Step 3: Add a Windows-safe wrapper**

Create `scripts/run-npm-powershell.cmd`:

```bat
@echo off
setlocal
if "%npm_node_execpath%"=="" (
  echo npm_node_execpath is not available. 1>&2
  exit /b 1
)
"%npm_node_execpath%" "%~dp0run-powershell.mjs" "%~1"
exit /b %ERRORLEVEL%
```

Change `typecheck`, `test`, `test:watch`, `build`, `package:win`, and `smoke:electron` to invoke the wrapper with the matching `.ps1` path.

**Step 4: Update dependencies without hiding runtime modules**

Run:

```powershell
npm.cmd install undici@^6.27.0
npm.cmd install --save-dev concurrently@^10.0.3 esbuild@^0.28.1 vite@^8.1.4
npm.cmd audit fix
```

Move build-only packages to `devDependencies`; keep `sql.js` and `undici` in `dependencies`. Re-read the resulting diff and retain the existing runtime-undici test change.

**Step 5: Verify scripts and audit**

```powershell
npm.cmd run typecheck
npm.cmd test -- --runInBand
npm.cmd audit --omit=dev
npm.cmd audit
```

Expected: typecheck/test start without bare-node failure; production high/critical count is zero. Any remaining dev-only advisory must be fixed if `fixAvailable` is true.

**Step 6: Commit**

```powershell
git add scripts/run-npm-powershell.cmd package.json package-lock.json tests/startup-script.test.ts tests/electron-build.test.ts
git commit -m "build: repair windows scripts and dependency baseline"
```

## Task 2: Block Viral Host And Cookie Exfiltration

**Files:**
- Modify: `src/shared/viral-analysis.ts`
- Modify: `src/shared/viral-media-worker.ts`
- Modify: `src/shared/viral-media-worker.py`
- Modify: `tests/viral-analysis.test.ts`
- Modify: `tests/viral-media-worker.test.ts`
- Create: `tests/viral-media-worker-security.test.ts`

**Step 1: Write failing TypeScript URL tests**

Add cases:

```ts
expect(detectViralPlatform('https://www.kuaishou.com/short-video/1')).toBe('kuaishou');
expect(detectViralPlatform('https://evil.example/?next=kuaishou.com')).toBe('unknown');
expect(detectViralPlatform('https://kuaishou.com.evil.example/video/1')).toBe('unknown');
expect(() => assertViralSourceUrl('file:///C:/secret.txt', 'kuaishou')).toThrow(/仅支持 HTTPS/);
expect(() => assertViralSourceUrl('https://www.douyin.com/video/1', 'kuaishou')).toThrow(/平台不匹配/);
```

**Step 2: Write failing Python behavior tests**

In `tests/viral-media-worker-security.test.ts`, execute the worker module with the bundled/system Python and assert JSON results from a small `-c` harness:

```ts
expect(validate('https://evil.example/?q=douyin.com', 'douyin')).toMatchObject({ ok: false });
expect(validate('https://v.douyin.com/abc', 'douyin')).toMatchObject({ ok: true });
expect(cookieHeaderFor('https://media.evil.example/x.mp4')).toBe('');
expect(cookieHeaderFor('https://www.douyin.com/api')).toContain('sessionid=');
```

Also assert a Netscape row for `.douyin.com` is excluded from a Kuaishou request and retains `secure/path/domain` when accepted.

**Step 3: Run focused tests and verify failure**

```powershell
npm.cmd test -- tests/viral-analysis.test.ts tests/viral-media-worker.test.ts tests/viral-media-worker-security.test.ts
```

Expected: attacker hosts are currently misclassified or receive cookies.

**Step 4: Implement exact host policies in TypeScript**

Export shared semantics:

```ts
const VIRAL_SOURCE_DOMAINS = {
  douyin: ['douyin.com', 'iesdouyin.com', 'amemv.com'],
  kuaishou: ['kuaishou.com', 'gifshow.com', 'kwai.com'],
  bilibili: ['bilibili.com', 'b23.tv'],
} as const;

export function hostnameMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  const base = domain.toLowerCase();
  return host === base || host.endsWith(`.${base}`);
}
```

`assertViralSourceUrl` must require HTTPS, reject credentials, match selected platform, and reject unknown hosts before starting Python.

**Step 5: Preserve structured cookies in Python**

Replace flattened header-only state with:

```py
@dataclass(frozen=True)
class StoredCookie:
    name: str
    value: str
    domain: str
    path: str = "/"
    secure: bool = True
    expires: int | None = None
```

Implement `domain_matches`, `cookie_matches_url`, `validate_platform_url`, and `cookie_header_for_url`. Parse Netscape domain/path/secure/expiry columns. Playwright receives only matching cookies with original attributes.

**Step 6: Stop credential forwarding to media hosts**

- Define separate platform media-domain allowlists.
- Validate every source redirect and media/cover URL.
- Pass no Cookie header to CDN downloads by default.
- Permit first-party cookies only when the exact target matches a source domain and the cookie itself matches.
- Add maximum streamed bytes and delete partial output on overflow.

**Step 7: Run tests**

```powershell
npm.cmd test -- tests/viral-analysis.test.ts tests/viral-media-worker.test.ts tests/viral-media-worker-security.test.ts
```

Expected: PASS, including executable Python policy tests.

**Step 8: Commit**

```powershell
git add src/shared/viral-analysis.ts src/shared/viral-media-worker.ts src/shared/viral-media-worker.py tests/viral-analysis.test.ts tests/viral-media-worker.test.ts tests/viral-media-worker-security.test.ts
git commit -m "fix: prevent viral cookie exfiltration"
```

## Task 3: Harden Electron Window Navigation And Origins

**Files:**
- Create: `electron/security.ts`
- Modify: `electron/main.ts`
- Modify: `electron/html-video-renderer.ts`
- Modify: `index.html`
- Modify: `tests/electron-window.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`

**Step 1: Write failing pure policy tests**

Test:

```ts
expect(validateDevServerUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/');
expect(() => validateDevServerUrl('https://evil.example')).toThrow(/loopback/);
expect(isAllowedRendererNavigation('file:///app/dist-renderer/index.html', policy)).toBe(true);
expect(isAllowedRendererNavigation('https://evil.example', policy)).toBe(false);
expect(isAllowedDouyinLoginNavigation('https://www.douyin.com/passport/login')).toBe(true);
expect(isAllowedDouyinLoginNavigation('https://evil.example/douyin.com')).toBe(false);
```

Add source-contract assertions for `sandbox: true`, `will-navigate`, and `setWindowOpenHandler`.

**Step 2: Run and verify failure**

```powershell
npm.cmd test -- tests/electron-window.test.ts tests/electron-ipc-contract.test.ts
```

**Step 3: Implement `electron/security.ts`**

Export:

```ts
export function validateDevServerUrl(value: string): string;
export function attachMainWindowSecurity(win: BrowserWindow, rendererPolicy: RendererPolicy): void;
export function attachDouyinLoginSecurity(win: BrowserWindow): void;
export function attachLocalHtmlSecurity(win: BrowserWindow, taskRoot: string): void;
export function isTrustedRendererSender(event: IpcMainInvokeEvent, win: BrowserWindow, policy: RendererPolicy): boolean;
```

Default window-open behavior is deny. HTTPS external links are opened only by an explicit main-process command after validation.

**Step 4: Apply policies to all BrowserWindows**

- Main: context isolation, sandbox, no Node, approved preload.
- Login: sandbox, no preload, Douyin navigation only.
- HTML: sandbox, no preload, local task root only.
- Reject invalid `VITE_DEV_SERVER_URL` before `loadURL`.

Add a production CSP in `index.html`; development allowances must be limited to the loopback origin.

**Step 5: Run tests and Electron build**

```powershell
npm.cmd test -- tests/electron-window.test.ts tests/electron-ipc-contract.test.ts
npm.cmd run build
```

**Step 6: Commit**

```powershell
git add electron/security.ts electron/main.ts electron/html-video-renderer.ts index.html tests/electron-window.test.ts tests/electron-ipc-contract.test.ts
git commit -m "fix: harden electron window trust boundaries"
```

## Task 4: Add Trusted IPC Registration And Runtime Schemas

**Files:**
- Create: `src/shared/ipc-contract.ts`
- Create: `electron/ipc.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Create: `tests/ipc-contract.test.ts`

**Step 1: Write failing schema tests**

Cover empty/oversized text, non-finite scene IDs, invalid task status, traversal paths, excessive arrays, unknown fields, and valid current payloads.

```ts
expect(() => createTaskSchema.parse({ inputText: 'x'.repeat(MAX_TASK_TEXT + 1) })).toThrow();
expect(() => sceneActionSchema.parse({ id: 't', sceneId: Infinity })).toThrow();
expect(taskStatusSchema.parse({ id: 't', status: 'paused' })).toEqual({ id: 't', status: 'paused' });
```

**Step 2: Write failing handler tests**

Inject a fake event/window:

```ts
await expect(invokeFrom(attackerWebContents, 'app:get-state')).rejects.toThrow(/IPC_SENDER_REJECTED/);
await expect(invokeFrom(mainWebContents, 'task:create-and-run', badInput)).rejects.toThrow(/IPC_INVALID_INPUT/);
```

**Step 3: Implement the contract and gateway**

```ts
export function trustedHandle<I, O>(
  channel: string,
  schema: ZodType<I>,
  handler: (event: IpcMainInvokeEvent, input: I) => Promise<O> | O,
): void {
  ipcMain.handle(channel, async (event, raw) => {
    assertTrustedSender(event);
    const input = schema.parse(raw);
    return toIpcResult(() => handler(event, input));
  });
}
```

Use `z.void()` for no-input channels. Define centralized limits and schema inventory for every exposed preload channel.

**Step 4: Convert all handlers**

Replace direct `ipcMain.handle` registrations. Do not leave a privileged channel outside the registry. Preserve renderer method names; preload unwraps `IpcResult` and rejects normalized failures.

**Step 5: Verify**

```powershell
npm.cmd test -- tests/ipc-contract.test.ts tests/electron-ipc-contract.test.ts
npm.cmd run typecheck
```

**Step 6: Commit**

```powershell
git add src/shared/ipc-contract.ts electron/ipc.ts electron/main.ts electron/preload.ts src/vite-env.d.ts tests/ipc-contract.test.ts tests/electron-ipc-contract.test.ts
git commit -m "feat: validate trusted ipc requests"
```

## Task 5: Build Secret Inventory And Encrypted Credential Vault

**Files:**
- Create: `src/shared/config-secrets.ts`
- Create: `electron/credential-vault.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/config-secrets.test.ts`
- Test: `tests/credential-vault.test.ts`

**Step 1: Write failing inventory tests**

Create a config with unique sentinel values in every secret field/profile and assert:

```ts
const extracted = extractConfigSecrets(config);
expect(Object.values(extracted)).toEqual(expect.arrayContaining(allSentinels));
expect(JSON.stringify(stripConfigSecrets(config))).not.toMatch(/sentinel-/);
expect(applyConfigSecrets(stripConfigSecrets(config), extracted)).toEqual(config);
```

The inventory must include active and inactive LLM/image/TTS profiles, Jimeng session/access/secret keys, speech-to-text, IMA, and viral vision.

**Step 2: Write failing vault tests**

Use an injected fake safeStorage adapter. Test encrypt/decrypt, atomic temp replacement, corrupt ciphertext, unavailable encryption, and no plaintext on disk.

**Step 3: Implement pure secret mapping**

Define stable IDs such as:

```ts
export type SecretId =
  | `llm/${string}/apiKey`
  | `image/${string}/apiKey`
  | `image/${string}/accessKeyId`
  | `image/${string}/secretAccessKey`
  | `tts/${string}/apiKey`
  | 'speechToText/apiKey'
  | 'ima/apiKey'
  | 'viralVision/apiKey';
```

Export `extractConfigSecrets`, `stripConfigSecrets`, `applyConfigSecrets`, `secretStatus`, and redaction token collection.

**Step 4: Implement the vault**

`CredentialVault` accepts `encryptString`, `decryptString`, `isEncryptionAvailable`, and atomic-file dependencies for testability. Persist one versioned encrypted JSON payload; do not log plaintext or ciphertext.

**Step 5: Verify**

```powershell
npm.cmd test -- tests/config-secrets.test.ts tests/credential-vault.test.ts
```

**Step 6: Commit**

```powershell
git add src/shared/config-secrets.ts electron/credential-vault.ts src/shared/types.ts tests/config-secrets.test.ts tests/credential-vault.test.ts
git commit -m "feat: add encrypted provider credential vault"
```

## Task 6: Migrate Config And Remove Renderer Secret Exposure

**Files:**
- Create: `electron/config-service.ts`
- Modify: `src/shared/config-file.ts`
- Modify: `src/shared/storage.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/main.tsx`
- Modify: `tests/storage.test.ts`
- Modify: `tests/config-utils.test.ts`
- Modify: `tests/product-shell-ui.test.ts`
- Create: `tests/config-migration.test.ts`

**Step 1: Write failing migration tests**

With temp SQLite/config/vault paths:

```ts
expect(await readText(vaultPath)).not.toContain('legacy-secret');
expect(await readText(configPath)).not.toContain('legacy-secret');
expect(JSON.stringify((await db.getState()).config)).not.toContain('legacy-secret');
expect(publicState.secretStatus['llm/default-llm/apiKey']).toBe(true);
expect(publicState.config.llm.apiKey).toBe('');
```

Inject a vault write failure and assert legacy SQLite/JSON values remain unchanged. Test repeated migration is idempotent.

**Step 2: Write failing browser fallback/UI tests**

Assert localStorage persistence calls `stripConfigSecrets`, secret inputs use `type="password"`, reveal is icon-based, and save distinguishes untouched/set/clear.

**Step 3: Implement `ConfigService`**

Responsibilities:

```ts
getPublicState(): Promise<PublicAppState>;
getRuntimeConfig(): Promise<AppConfig>;
save(input: SaveConfigInput): Promise<PublicAppState>;
migrateLegacySecrets(): Promise<void>;
```

Migration order: collect -> vault atomic write/read verify -> sanitized DB -> sanitized JSON -> version marker. Never create a plaintext backup.

**Step 4: Replace direct config reads in main**

All provider/task/viral/diagnostic calls use `getRuntimeConfig`; all renderer responses use public/sanitized state. Remove direct `saveConfigToFile(fullConfig)` calls.

**Step 5: Update settings and fallback**

- Maintain `secretChanges` separately from public draft.
- Untouched empty fields preserve stored secrets.
- Explicit clear sends `null`.
- Stored secret values never populate DOM inputs or `maskConfigured`.
- Browser fallback strips secrets before localStorage and never claims secure persistence.

**Step 6: Verify**

```powershell
npm.cmd test -- tests/config-migration.test.ts tests/config-utils.test.ts tests/storage.test.ts tests/product-shell-ui.test.ts
npm.cmd run typecheck
```

**Step 7: Commit**

```powershell
git add electron/config-service.ts src/shared/config-file.ts src/shared/storage.ts electron/main.ts electron/preload.ts src/vite-env.d.ts src/main.tsx tests/config-migration.test.ts tests/config-utils.test.ts tests/storage.test.ts tests/product-shell-ui.test.ts
git commit -m "fix: migrate and redact provider secrets"
```

## Task 7: Serialize And Atomically Persist sql.js

**Files:**
- Modify: `src/shared/storage.ts`
- Modify: `electron/main.ts`
- Modify: `tests/storage.test.ts`
- Create: `tests/storage-reliability.test.ts`

**Step 1: Write failing concurrency/fault tests**

Test 50 concurrent task/event/config mutations, injected delayed writes, replace failure/retry, temp-file recovery, ENOENT creation, EACCES propagation, malformed quarantine, and close waiting for pending commits.

```ts
await Promise.all(Array.from({ length: 50 }, (_, i) => db.addTaskEvent(task.id, { type: 'tick', detail: String(i) })));
await db.close();
const reopened = await FileDatabase.open(file);
expect((await reopened.getState()).events).toHaveLength(50);
```

**Step 2: Run and verify current failures or race evidence**

```powershell
npm.cmd test -- tests/storage-reliability.test.ts tests/storage.test.ts
```

**Step 3: Add commit queue and atomic writer**

Use one private promise chain and a `commit` helper:

```ts
private enqueueCommit<T>(mutation: () => T): Promise<T> {
  const operation = this.writeTail.then(async () => {
    if (this.closing) throw new Error('Database is closing.');
    const value = mutation();
    await atomicWriteDatabase(this.file, this.db.export());
    return value;
  });
  this.writeTail = operation.then(() => undefined, () => undefined);
  return operation;
}
```

All public mutations execute their SQL inside the queued mutation, not before it.

**Step 4: Implement open/close semantics**

- ENOENT creates.
- SQL format error quarantines.
- Other read errors propagate.
- `close()` marks closing, waits tail, writes final snapshot, then closes once.
- Electron `before-quit` prevents default until runners and DB close exactly once.

**Step 5: Verify**

```powershell
npm.cmd test -- tests/storage-reliability.test.ts tests/storage.test.ts tests/runner.test.ts
```

**Step 6: Commit**

```powershell
git add src/shared/storage.ts electron/main.ts tests/storage.test.ts tests/storage-reliability.test.ts
git commit -m "fix: serialize and atomically persist local database"
```

## Task 8: Add Purpose-Bound Network Fetching

**Files:**
- Create: `src/shared/network-policy.ts`
- Modify: `src/shared/research.ts`
- Modify: `src/shared/http.ts`
- Modify: `src/shared/llm-provider.ts`
- Modify: `src/shared/viral-runtime.ts`
- Modify: `tests/research.test.ts`
- Create: `tests/network-policy.test.ts`

**Step 1: Write failing URL/DNS/redirect/body tests**

Cover loopback/private/link-local/reserved IPv4/IPv6, encoded hosts, URL credentials, redirect to private, redirect header stripping, DNS rebinding lookup pinning, excess redirects, and streaming byte limits.

**Step 2: Define policy profiles**

```ts
export type NetworkPurpose = 'public-research' | 'ima-api' | 'ima-document' | 'provider-api';

export interface NetworkPolicy {
  allowPrivate: boolean;
  allowLoopback: boolean;
  allowedSchemes: readonly string[];
  maxRedirects: number;
  maxBytes: number;
  timeoutMs: number;
  allowedRequestHeaders: readonly string[];
}
```

Provider APIs allow HTTPS and loopback HTTP; private LAN requires the explicit config flag. Public/IMA documents reject all private targets.

**Step 3: Implement bounded fetch**

Resolve and validate before connect, pin lookup for the request, use manual redirects, strip sensitive headers on host changes, and expose `readTextBounded`/`readJsonBounded`.

**Step 4: Convert research/IMA**

- Search pages and result pages use public policy.
- IMA API uses fixed-host policy.
- IMA document headers are allowlisted and scoped to original host.
- Remove all unbounded `response.text()` paths for untrusted responses.

**Step 5: Convert shared provider requests**

Use provider policy without breaking explicitly enabled localhost/LAN model endpoints.

**Step 6: Verify**

```powershell
npm.cmd test -- tests/network-policy.test.ts tests/research.test.ts tests/llm-provider.test.ts tests/viral-runtime.test.ts
```

**Step 7: Commit**

```powershell
git add src/shared/network-policy.ts src/shared/research.ts src/shared/http.ts src/shared/llm-provider.ts src/shared/viral-runtime.ts tests/network-policy.test.ts tests/research.test.ts
git commit -m "fix: bound and validate outbound network requests"
```

## Task 9: Add Bounded Process Execution And Sidecar Cleanup

**Files:**
- Create: `src/shared/process-runner.ts`
- Modify: `src/shared/storybound-sidecar.ts`
- Modify: `src/shared/viral-runtime.ts`
- Modify: `src/shared/viral-media-worker.py`
- Modify: `tests/storybound-sidecar.test.ts`
- Modify: `tests/viral-runtime.test.ts`
- Create: `tests/process-runner.test.ts`

**Step 1: Write failing timeout/cancel/output tests**

Test normal exit, nonzero exit, timeout, AbortSignal, stdout/stderr overflow, and a child process that spawns a grandchild. On Windows, assert both child and grandchild terminate.

**Step 2: Implement `runBoundedProcess`**

```ts
export interface BoundedProcessOptions {
  cwd: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}
```

Use `spawn` with argument arrays and `windowsHide`. On cancel/timeout, terminate the process tree using a bounded Windows-native strategy and wait for exit.

**Step 3: Convert sidecars**

- Storybound sidecar accepts timeout/signal and bounded output.
- Viral runtime uses the same runner.
- Python ffmpeg calls use timeout and cleanup partial files.
- Redact secrets from process errors.

**Step 4: Guarantee renderer cleanup**

Wrap every hidden-window lifecycle in `try/finally`; add ready/scene timeouts and destroy on any error.

**Step 5: Verify**

```powershell
npm.cmd test -- tests/process-runner.test.ts tests/storybound-sidecar.test.ts tests/viral-runtime.test.ts tests/html-video.test.ts
```

**Step 6: Commit**

```powershell
git add src/shared/process-runner.ts src/shared/storybound-sidecar.ts src/shared/viral-runtime.ts src/shared/viral-media-worker.py electron/html-video-renderer.ts tests/process-runner.test.ts tests/storybound-sidecar.test.ts tests/viral-runtime.test.ts tests/html-video.test.ts
git commit -m "fix: bound sidecar and media processes"
```

## Task 10: Normalize Errors And Cover Async UI Actions

**Files:**
- Create: `src/shared/app-error.ts`
- Create: `src/ui/async-action.ts`
- Modify: `electron/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Create: `tests/app-error.test.ts`
- Modify: `tests/product-shell-ui.test.ts`

**Step 1: Write failing error/redaction tests**

Assert API keys, Cookie, Authorization, query tokens, and nested causes are absent. Test cancellation classification and diagnostic IDs.

**Step 2: Write failing UI contracts**

Require visible error handling for viral start/template saves, BGM/reference selection, music MV, HTML video, queue actions, reruns, regeneration, template CRUD, account/activation, and settings helpers.

**Step 3: Implement AppError**

```ts
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly diagnosticId = randomUUID(),
    readonly field?: string,
  ) { super(message); }
}
```

Add `toAppErrorPayload`, `redactErrorText`, `isCancellation`, and safe unknown-error mapping.

**Step 4: Implement async action helper**

Provide a hook/helper that guarantees one active invocation, stable busy state, normalized message, cancellation handling, and `finally` cleanup. Use local inline banners; reserve a global banner for startup/state failures.

**Step 5: Convert all privileged handlers**

Do not stop after HTML/music examples. Use the audit inventory and verify every `async function` triggered by a button either catches visibly or delegates to the action helper.

**Step 6: Verify**

```powershell
npm.cmd test -- tests/app-error.test.ts tests/product-shell-ui.test.ts
npm.cmd run typecheck
```

**Step 7: Commit**

```powershell
git add src/shared/app-error.ts src/ui/async-action.ts electron/ipc.ts electron/preload.ts src/main.tsx src/styles.css tests/app-error.test.ts tests/product-shell-ui.test.ts
git commit -m "fix: surface safe actionable ui errors"
```

## Task 11: Replace Browser-Only Smoke With Real Electron Smoke

**Files:**
- Modify: `electron/main.ts`
- Modify: `scripts/smoke-electron.cjs`
- Modify: `scripts/smoke-electron.ps1`
- Modify: `tests/electron-build.test.ts`
- Create: `tests/electron-smoke-contract.test.ts`

**Step 1: Write failing smoke contract tests**

Require the smoke launcher to execute the application main entry, use a temporary `userData`, verify `window.storydream`, invoke `getState`, and assert a preload-backed action. Forbid constructing a separate no-preload BrowserWindow in the harness.

**Step 2: Add test-only smoke handshake**

When `STORYDREAM_SMOKE_OUTPUT` is set, main uses the supplied temporary userData before ready, evaluates only fixed smoke assertions after load, writes JSON, and exits through the normal close path. No arbitrary code or production remote control channel is added.

**Step 3: Rewrite the launcher**

Spawn `electron .` with temporary paths and a timeout. Assert:

```json
{
  "mainLoaded": true,
  "preloadExposed": true,
  "ipcStateLoaded": true,
  "windowPolicyInstalled": true,
  "shellRendered": true
}
```

**Step 4: Verify**

```powershell
npm.cmd run build
npm.cmd run smoke:electron
```

**Step 5: Commit**

```powershell
git add electron/main.ts scripts/smoke-electron.cjs scripts/smoke-electron.ps1 tests/electron-build.test.ts tests/electron-smoke-contract.test.ts
git commit -m "test: exercise real electron main and preload"
```

## Task 12: Version The HTML Video Six-Step Contract

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/html-video-workflow.ts`
- Modify: `src/shared/storage.ts`
- Modify: `tests/html-video.test.ts`
- Modify: `tests/storage.test.ts`

**Step 1: Write failing state/migration tests**

Assert visible steps map to `rewrite/planning/assets/voice/preview/render`, `done` is terminal only, old `plan` snapshots normalize, and malformed/oversized pipeline JSON is rejected.

**Step 2: Define version 2 pipeline state**

```ts
export interface HtmlVideoPipelineDataV2 {
  version: 2;
  revision: number;
  current: HtmlVideoPipelineStep;
  warnings: string[];
  steps: Record<HtmlVideoVisibleStep, HtmlVideoStepState>;
  scenes: HtmlVideoScenePlan[];
  assets: HtmlVideoAsset[];
  voices: HtmlVideoVoiceClip[];
  compositions: HtmlVideoCompositionSnapshot[];
  output?: HtmlVideoOutput;
  config: HtmlVideoJobConfig;
}
```

**Step 3: Add compatibility parsing and DB patch support**

Normalize old data without losing scenes. Allow `updateTask` to atomically persist `pipelineStep` and `pipelineData` together.

**Step 4: Verify**

```powershell
npm.cmd test -- tests/html-video.test.ts tests/storage.test.ts
```

**Step 5: Commit**

```powershell
git add src/shared/types.ts src/shared/html-video-workflow.ts src/shared/storage.ts tests/html-video.test.ts tests/storage.test.ts
git commit -m "feat: version html video pipeline state"
```

## Task 13: Implement Checkpointed HTML Video Runner Core

**Files:**
- Create: `src/shared/html-video-runner.ts`
- Modify: `src/shared/html-video-workflow.ts`
- Modify: `src/shared/task-runtime-providers.ts`
- Create: `tests/html-video-runner.test.ts`

**Step 1: Write failing fake-runtime tests**

Cover:

- Six steps run in order.
- Missing LLM records split-only warning.
- Planning schema validation.
- Asset/TTS failure stops at exact step.
- Checkpoint resume skips validated upstream steps.
- Rerun invalidates only selected/downstream steps.
- Cancel persists cancelled state.
- Duplicate runner for the same task is rejected.

**Step 2: Define injected dependencies**

```ts
export interface HtmlVideoRunnerOptions {
  workDir: string;
  signal?: AbortSignal;
  rewrite?: (input: RewriteInput) => Promise<RewriteOutput>;
  plan?: (input: PlanInput) => Promise<PlanOutput>;
  generateAssets: (input: AssetInput) => Promise<HtmlVideoAsset[]>;
  synthesizeVoices: (input: VoiceInput) => Promise<HtmlVideoVoiceClip[]>;
  createPreviews: (input: PreviewInput) => Promise<PreviewOutput>;
  render: (input: RenderInput) => Promise<HtmlVideoOutput>;
  onCheckpoint: (state: HtmlVideoPipelineDataV2) => Promise<void>;
}
```

**Step 3: Implement atomic checkpointing**

Write `html-video-pipeline.v2.json` via temp/replace. Include input hashes, artifact path/size, revision, warnings, and step errors. Validate files before resume.

**Step 4: Implement steps 1-4**

- Rewrite via configured LLM when present, deterministic sentence split otherwise.
- Plan via structured LLM when present, deterministic current planner otherwise.
- Assets through current image adapter, including optional foreground.
- Voice through current TTS adapter, measuring real duration.
- Missing configured provider produces an actionable step failure, not fake assets.

**Step 5: Verify**

```powershell
npm.cmd test -- tests/html-video-runner.test.ts tests/task-runtime-providers.test.ts
```

**Step 6: Commit**

```powershell
git add src/shared/html-video-runner.ts src/shared/html-video-workflow.ts src/shared/task-runtime-providers.ts tests/html-video-runner.test.ts
git commit -m "feat: add checkpointed html video runner"
```

## Task 14: Connect Electron HTML Preview, Render, And UI Lifecycle

**Files:**
- Create: `electron/html-video-runtime.ts`
- Modify: `electron/html-video-renderer.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `tests/html-video.test.ts`
- Modify: `tests/product-shell-ui.test.ts`
- Create: `tests/html-video-electron.test.ts`

**Step 1: Write failing lifecycle/UI tests**

Require create-and-run, pause/cancel/resume/retry, isolated preview open, exact six statuses, output path/video element/open-folder action, and visible errors.

**Step 2: Build the Electron runtime adapter**

- Map ratio to bounded canvas dimensions.
- Resolve task-local assets only.
- Generate composition HTML and preview thumbnails.
- Open a no-preload local preview window.
- Capture hidden windows serially.
- Preflight total frames and free disk.
- Run `compose_render` with timeout/signal.
- Validate output MP4 and clean temporary frames on success.

**Step 3: Wire task lifecycle**

`html-video:create-task` creates then starts `HtmlVideoRunner`. Add a running-map entry and route existing task status/retry APIs by `taskType`. Startup pauses stale HTML jobs just like ordinary jobs.

**Step 4: Complete the UI**

- Button label reflects actual create-and-run.
- Six-step rail reads V2 state.
- Tabs display real images/audio/compositions/output.
- Add preview, cancel, resume, retry, video playback, and open-directory controls.
- Browser fallback creates preview-only snapshots and states that no privileged render ran.

**Step 5: Add a real low-cost render smoke**

Use 320x568, low FPS, two short scenes, generated tiny images and short WAVs. Assert output exists, is nonempty, and ffprobe duration is within tolerance.

**Step 6: Verify**

```powershell
npm.cmd test -- tests/html-video.test.ts tests/html-video-runner.test.ts tests/html-video-electron.test.ts tests/product-shell-ui.test.ts
npm.cmd run typecheck
```

**Step 7: Commit**

```powershell
git add electron/html-video-runtime.ts electron/html-video-renderer.ts electron/main.ts electron/preload.ts src/vite-env.d.ts src/main.tsx src/styles.css tests/html-video.test.ts tests/html-video-runner.test.ts tests/html-video-electron.test.ts tests/product-shell-ui.test.ts
git commit -m "feat: complete html video rendering workflow"
```

## Task 15: Split Bootstrap State And Push Task Deltas

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/main.tsx`
- Modify: `tests/storage.test.ts`
- Modify: `tests/electron-ipc-contract.test.ts`
- Create: `tests/state-delta.test.ts`

**Step 1: Write failing state-size/contract tests**

Assert bootstrap excludes prompt bodies/all events/secrets, list APIs enforce limits, task events carry monotonic seq, and a heartbeat no longer invokes `getState()`.

**Step 2: Add narrow storage APIs**

Implement cursor/limit queries for tasks, viral records, labs, and events; single-task detail; template libraries on demand. Clamp every limit server-side.

**Step 3: Add delta events**

```ts
type AppDelta =
  | { kind: 'task-upsert'; task: TaskSummary; revision: number }
  | { kind: 'task-event'; event: TaskEvent; revision: number }
  | { kind: 'viral-upsert'; record: ViralAnalysisSummary; revision: number };
```

Runner callbacks publish only changed slices. Use a monotonic revision and targeted reconciliation API.

**Step 4: Update renderer state ownership**

Load bootstrap once, merge deltas by ID/seq, remove one-second full-state polling, and request full task detail/events only for selected tasks. Keep a low-frequency narrow reconciliation after missed revisions.

**Step 5: Verify**

```powershell
npm.cmd test -- tests/state-delta.test.ts tests/storage.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts
npm.cmd run typecheck
```

**Step 6: Commit**

```powershell
git add src/shared/types.ts src/shared/storage.ts electron/main.ts electron/preload.ts src/vite-env.d.ts src/main.tsx tests/state-delta.test.ts tests/storage.test.ts tests/electron-ipc-contract.test.ts
git commit -m "perf: replace full state polling with task deltas"
```

## Task 16: Add History Governance And Lazy-Load Heavy Views

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Create: `src/views/PromptTemplatesView.tsx`
- Create: `src/views/SettingsView.tsx`
- Modify: `vite.config.ts`
- Modify: `tests/storage.test.ts`
- Modify: `tests/product-shell-ui.test.ts`
- Create: `tests/history-governance.test.ts`
- Modify: `tests/vite-config.test.ts`

**Step 1: Write failing history tests**

Test archive/restore/permanent delete, active-task refusal, cascade event deletion, task-root path enforcement, viral/lab deletion, and pagination stability.

**Step 2: Add schema and APIs**

Add `archived_at` where needed. Implement archive/restore/delete in queued DB transactions. Permanent file deletion resolves and verifies the target remains under the expected root before removal.

**Step 3: Add UI controls**

Use icon buttons with tooltips for archive/restore/delete. Require confirmation for permanent delete, disable for running jobs, and expose archived filter/pagination without nesting cards.

**Step 4: Split heavy views**

Move settings and prompt/template management into lazy-loaded modules. Ensure `storybound-system-templates.ts` is imported only from the template chunk. Use `React.lazy`/`Suspense` with fixed-size loading surfaces.

**Step 5: Add build budget assertion**

Build and assert the entry chunk no longer contains the system prompt corpus and that a separate lazy chunk exists. Do not hardcode a fragile hash filename.

**Step 6: Verify**

```powershell
npm.cmd test -- tests/history-governance.test.ts tests/storage.test.ts tests/product-shell-ui.test.ts tests/vite-config.test.ts
npm.cmd run build
```

**Step 7: Commit**

```powershell
git add src/shared/types.ts src/shared/storage.ts electron/main.ts electron/preload.ts src/vite-env.d.ts src/main.tsx src/styles.css src/views/PromptTemplatesView.tsx src/views/SettingsView.tsx vite.config.ts tests/history-governance.test.ts tests/storage.test.ts tests/product-shell-ui.test.ts tests/vite-config.test.ts
git commit -m "feat: govern history and lazy load heavy views"
```

## Task 17: Lock And Slim The Windows Runtime Package

**Files:**
- Create: `scripts/requirements-runtime.lock`
- Create: `scripts/runtime-downloads.json`
- Modify: `scripts/prepare-python-runtime.ps1`
- Modify: `scripts/package-win.ps1`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `tests/python-runtime.test.ts`
- Modify: `tests/windows-package.test.ts`
- Modify: `tests/startup-script.test.ts`

**Step 1: Write failing package/runtime tests**

Require exact/hash-locked requirements, download SHA-256 checks, marker lock hash, absence of faster-whisper imports, no Playwright Chromium install, cache ignores, optional signing config, and package content exclusions.

**Step 2: Produce runtime lock**

Generate Windows CPython 3.12 compatible pins and hashes for actual consumers only. Use:

```powershell
& vendor\python\python.exe -m pip download --only-binary=:all: --dest .cache\runtime-wheels -r scripts\requirements-runtime.in
& vendor\python\python.exe -m pip hash .cache\runtime-wheels\*
```

Review transitive packages, then commit only the lock, not wheels/cache. Remove faster-whisper/ctranslate2/torch/model packages after source search and smoke coverage prove no consumer.

**Step 3: Harden runtime preparation**

- Verify Python zip/get-pip hashes from `runtime-downloads.json`.
- Install with `--require-hashes --no-deps -r requirements-runtime.lock` after lock includes full closure.
- Marker includes Python version and SHA-256 of lock/download manifest.
- Detect installed Edge/Chrome for Python Playwright; do not download a second Chromium.
- Import-smoke only retained packages.

**Step 4: Harden packaging**

- Add `__pycache__/`, `*.pyc`, `*.pyo` ignores.
- Exclude caches/tests/dev files from portable output.
- Allow standard electron-builder certificate environment variables; verify Authenticode only when configured.
- Record unpacked/zip sizes and fail on a justified regression budget.

**Step 5: Verify**

```powershell
npm.cmd test -- tests/python-runtime.test.ts tests/windows-package.test.ts tests/startup-script.test.ts
& vendor\python\python.exe -m pip check
npm.cmd run package:win
```

Expected: no faster-whisper stack, no duplicated Python Chromium, package content tests pass, and unsigned local build is reported rather than treated as signed.

**Step 6: Commit**

```powershell
git add scripts/requirements-runtime.lock scripts/runtime-downloads.json scripts/prepare-python-runtime.ps1 scripts/package-win.ps1 package.json package-lock.json .gitignore tests/python-runtime.test.ts tests/windows-package.test.ts tests/startup-script.test.ts
git commit -m "build: lock and slim windows runtime"
```

## Task 18: Full Verification, Visual QA, Review, And Audit Record

**Files:**
- Modify only when a failing verification exposes a scoped defect.
- Modify: `task_plan.md`
- Modify: `findings.md`
- Modify: `progress.md`

**Step 1: Run focused security suites**

```powershell
npm.cmd test -- tests/viral-media-worker-security.test.ts tests/electron-window.test.ts tests/ipc-contract.test.ts tests/config-migration.test.ts tests/storage-reliability.test.ts tests/network-policy.test.ts tests/process-runner.test.ts tests/app-error.test.ts
```

Expected: PASS.

**Step 2: Run HTML and state/history suites**

```powershell
npm.cmd test -- tests/html-video.test.ts tests/html-video-runner.test.ts tests/html-video-electron.test.ts tests/state-delta.test.ts tests/history-governance.test.ts
```

Expected: PASS and real low-resolution MP4 smoke succeeds.

**Step 3: Run full repository checks**

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run smoke:electron
npm.cmd audit --omit=dev
npm.cmd audit
& vendor\python\python.exe -m pip check
git diff --check
```

Expected: all code/build/smoke checks pass; production audit has zero high/critical. Resolve every fixable complete-audit item.

**Step 4: Run package and security scans**

- Build portable package.
- Measure zip/unpacked/runtime size.
- Verify no plaintext test sentinel or real credential in SQLite/config/vault/state/package.
- Verify no `__pycache__`, `.pyc`, faster-whisper, duplicated Chromium, source maps, or dev cache in package.
- Re-run tracked-file secret patterns and Electron dangerous-setting scan.
- Query current locked Python packages against OSV and save the result summary.

**Step 5: Perform rendered UI QA**

Use the frontend testing/debugging workflow. Browser plugin is unavailable, so use the real Electron smoke harness/capture path and record that reason. Capture at minimum 1080x720 and 1440x900:

- Settings secret states and errors.
- Viral invalid-host error.
- HTML video running/completed/output states.
- History archive/delete confirmation.

Inspect screenshots for overlap, clipping, unstable controls, blank preview, and unreadable long errors.

**Step 6: Request and process code review**

Use `superpowers:requesting-code-review` against the approved design and implementation plan. Fix all confirmed critical/high issues and add regression tests before final verification rerun.

**Step 7: Update audit records**

Record exact commands/results, package sizes, vulnerability counts, migration behavior, and residual risks. Code signing remains residual only if no certificate is supplied.

**Step 8: Final commit**

```powershell
git add task_plan.md findings.md progress.md
git commit -m "docs: record local hardening verification"
```

## Execution

This workspace must be executed sequentially in the current session because sub-agent work was not requested and the worktree contains related unstaged baseline changes. Use `superpowers:executing-plans`, stop at each task checkpoint for verification, and preserve all unrelated user changes.
