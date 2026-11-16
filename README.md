# StoryDream

Windows desktop workbench (Electron 41 + React 19 + Fluent UI 9) for AI-assisted story and short-video production. Text, image, voice and video providers are configured by the user; generation always goes through the user's own API keys.

## Production routes

| Route | What it produces | Main code |
|---|---|---|
| **Template animation (模板动画)** | Storyboard → images → narration → parameterised scene templates → MP4 / Jianying draft | `src/shared/runner.ts`, `electron/director-renderer.ts`, `src/shared/storybound-sidecar.ts` |
| **HTML animation (HTML 动画)** | LLM-authored HyperFrames HTML scenes captured frame by frame | `src/shared/html-video-runner.ts`, `electron/html-video-runtime.ts`, `electron/html-video-renderer.ts` |
| **Creative animation (创意动画 / Lemo)** | Continuous canvas/WebGL films authored by an agent against the pinned Lemo-Opuscar library | `electron/vox-production-runtime.ts`, `electron/lemo-upstream-*.ts` |

All final films are loudness-normalised to **−14 LUFS integrated / −1 dBTP** (two-pass loudnorm, `src/shared/loudness.ts`) unless a project explicitly keeps the original audio (Music MV). Other workspaces: AI 漫剧 (motion comic), editorial collage, Music Lab / MV, image and voice labs, viral reference analysis.

Design documents live in `docs/design/`; the current work list is `docs/design/2026-11-10-project-backlog.md`.

## Prerequisites

- Node.js 20 and npm.
- **Vendored upstream trees (not in Git):** `vendor/lemo-upstream` (Lemo-Opuscar `f17136060781a0068a7951245a3aa7835a7230de`) and `vendor/pixelle-upstream` (Pixelle-Video `848b054e4fae40dabc62ec58e960b573e83793ac`). Import them once from local checkouts:
  ```powershell
  node scripts/import-lemo-upstream.mjs <local-lemo-opuscar-checkout>
  node scripts/import-pixelle-upstream.mjs <local-pixelle-video-checkout>
  ```
  `--verify` checks the SHA-256 inventory in `storydream-upstream.json`; the Electron build refuses to ship a missing or modified tree.
- **Bundled Python runtime:** `vendor/python` (CPython with faster-whisper, PyAV, onnxruntime …) and Playwright browsers in `vendor/python/playwright-browsers`, used for media composition, capture and transcription. Also a local install, not in Git.

## Local workspace

The active checkout on this machine is `I:\项目\story-dream` (moved from the mixed `I:\opc` workspace on 2026-11-16). Open this directory for future StoryDream work. Source code remains at the repository root, linked development checkouts are under `.worktrees/`, and collected machine-local release/QA archives are under `.local-archive/external/` (excluded from Git).

Unrelated OPC and Pingdingshan materials remain in the previous directory. Historical reports may retain their original absolute paths; use the migration path map in `.local-archive/migration-2026-11-16/` when consulting them.

## Commands

Double-click `启动 StoryDream.bat` for one-click startup (delegates to `start-storydream.ps1`).

On this machine the npm script shim can return `Access is denied`; the direct Node commands always work:

```powershell
node node_modules\typescript\bin\tsc -p tsconfig.json --noEmit           # renderer + shared
node node_modules\typescript\bin\tsc -p tsconfig.electron.json --noEmit  # main process
node node_modules\typescript\bin\tsc -p tsconfig.scripts.json --noEmit   # scripts/
node node_modules\eslint\bin\eslint.js src electron scripts tests
node node_modules\vitest\vitest.mjs run --maxWorkers=4                   # full suite (~6 min)
node node_modules\vite\bin\vite.js build
node scripts\build-electron.mjs
```

### Verification gate

```powershell
node scripts/verify.mjs          # upstream hashes → tsc ×3 → eslint → full vitest
node scripts/verify.mjs --fast   # everything except vitest
node scripts/verify.mjs --ci     # skips tests that need the local vendor trees
```

`verify` compares failing tests with `tests/known-failures.json` and fails only on **new** failures; it also lists baseline entries that now pass so they can be removed. The `requiresLocalVendor` list in that file names test files that need `vendor/`. CI runs the `--ci` mode (`.github/workflows/verify.yml`).

### Development

```powershell
npm run dev
```

If npm is blocked by local policy, run the underlying commands separately:

```powershell
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173
$env:NODE_ENV="development"; node node_modules\electron\cli.js .
```

## Reliability rules for paid calls

- Provider failures are classified once (`src/shared/provider-failure.ts`) into *not sent*, *rejected* and *unknown*. Only safe cases are retried automatically; a paid request whose result is unknown is **never resent automatically**.
- Text-model profiles may list fallback models on the same endpoint; the app switches only on definitive refusals (model missing, no channel, overloaded) and records the switch.
- Template and HTML routes write a receipt journal (`llm-receipts.jsonl` in the task folder) before every paid LLM call; the creative route keeps per-node receipts.

## Notes

- SQLite persistence uses `sql.js` to avoid native addon compilation on Windows.
- The draft adapter writes a stable StoryDream draft package (`draft_content.json`, `draft_meta_info.json`, images, audio, subtitles, pipeline artifacts); Jianying compatibility is isolated behind the draft writer.
- Third-party attributions: `THIRD_PARTY_NOTICES.md`.
