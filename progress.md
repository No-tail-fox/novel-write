# Progress

## 2026-06-16

- Loaded required process/design skills: `using-superpowers`, `brainstorming`, `planning-with-files`, `frontend-design`, `test-driven-development`, `writing-plans`, `verification-before-completion`, and `systematic-debugging`.
- Created and switched to branch `codex/storybound-cn-full-replica`.
- Read existing project plan/history files and confirmed a previous Storybound reference parity pass already exists.
- Inspected project shape: React/Electron/sql.js app, `src/main.tsx` as large single-file UI, `src/shared/storage.ts` as SQLite layer.
- Located reference app at `E:\Storybound`.
- Read reference config at `C:\Users\Administrator\AppData\Local\com.dudumd.storybound\config.json`.
- Inspected reference SQLite tables and counts from `C:\Users\Administrator\AppData\Local\com.dudumd.storybound\data.db`.
- Refreshed `task_plan.md`, `findings.md`, and `progress.md` for this full Chinese Storybound replica pass.
- Added failing contract tests for Storybound-first Chinese shell and Storybound-compatible SQLite structure.
- Implemented primary/secondary navigation groups, recent tasks, trial activation bar, credit/account actions, and compact sidebar styling.
- Renamed visible pipeline steps to Storybound step labels.
- Added Storybound-compatible SQLite tables and task workflow fields.
- Made Storybound task fields optional in TypeScript while persisting defaults in storage for compatibility.
- Fixed `80年代闭达` typo to `80年代街拍`.
- Browser smoke verified the new shell and new-task page at `http://127.0.0.1:5173`; no console errors.
- Added `frontend-design` follow-up tests for a restrained storyboard-console visual system and Chinese browser-preview fallback errors.
- Refined the shell visual system with blueprint grid texture, cyanprint/timeline/amber tokens, clearer active navigation, stable focus rings, and tighter panel hierarchy.
- Chinese-localized browser preview fallback errors and ordinary settings labels such as supplier, interface address, interface key, draft directory, timestamp granularity, and knowledge base.
- Browser smoke rechecked shell and settings at `http://127.0.0.1:5173`; Storybound shell entries and settings labels are visible in Chinese with no checked fallback English leaks.
- Restored “爆款拆解” to the main workflow navigation after feedback that the secondary placement made it look missing.
- Verification passed:
  - `npm run typecheck`
  - `npm test` -> 39 files, 318 tests
  - `npm run build` -> passed with the existing large chunk warning
  - `npm run smoke:electron` -> shell/new-task/draft-template smoke true

## 2026-06-23

- Started new reverse-engineering pass for `G:\Storybound`, focused on local backend/business logic rather than UI only.
- Preserved safety boundary: no activation bypass, no license cracking, no usable secret extraction.
- `planning-with-files` catchup first failed because the documented `.claude` script path is absent on this machine; reran successfully with the installed `.codex` skill path.
- Updated `task_plan.md` and `findings.md` with the new `G:\Storybound` backend reverse scope.
- Probed `G:\Storybound`: top-level files are `storybound.exe`, `draft-generator.exe`, ONNX/sherpa DLLs, `uninstall.exe`, and `resources/default-bgm.mp3`; no visible `app.asar` or source bundle at directory depth 4.
- Inspected PE metadata/imports and string indices: `storybound.exe` is Rust/Tauri 2.x with SQLx SQLite, sherpa-onnx ASR/VAD calls, HTTP/image proxy/update/license Tauri commands; `draft-generator.exe` is PyInstaller Python 3.11.
- Parsed `draft-generator.exe` PyInstaller TOC and extracted analysis copies under `I:\opc\tmp\storybound-reverse\draft-generator-extract`; recovered `pyJianYingDraft` source files and confirmed `generate_draft_lib` in `PYZ.pyz`.
- Read the recovered `generate_draft_lib` summary and confirmed it covers audio conversion, frame/audio scene rendering, BGM mux/remix, subtitle building, cover/title handling, draft asset path rewriting, and music MV draft generation.
- Read core `pyJianYingDraft` source files. `Script_file` writes Jianying `draft_info.json`, `Draft_folder` copies/loads draft folders, and `jianying_controller.py` automates Jianying Pro export and progress reporting through Windows UI Automation.
- Checked available local Python runtimes; only Python 3.12/3.13 are installed, so Python 3.11 bytecode disassembly is not directly reliable here without an additional compatible tool/runtime.
- Extracted and decompressed 191 embedded web assets from `G:\Storybound\storybound.exe` into `I:\opc\tmp\storybound-reverse\extracted-web`, including Vite JS chunks, CSS, and the `podcast-cover-prompt` module.
- Continued reversing `G:\Storybound` backend/business logic from the extracted JS bundles.
- Recovered Tauri IPC command shapes for HTTP, download, image, ASR, updater, keychain, WebView capture/eval, and shell helpers.
- Recovered `draft-generator.exe` mode payloads for `story`, `compose_render`, `remix_bgm`, `convert_audio_16k`, and `music_mv`.
- Confirmed the reference app is layered: Rust/Tauri host, browser orchestration bundles, and Python sidecar draft generation.
- Compared the reference backend contract against the current `I:\opc` implementation and logged the major parity gaps in `findings.md`.

## 2026-06-24

- Started fresh local audit of `E:\Storybound` at user request.
- Confirmed the install directory contains the same style of binary distribution: `storybound.exe`, `draft-generator.exe`, ONNX/sherpa DLLs, `uninstall.exe`, and `resources/default-bgm.mp3`.
- No visible loose JS source, config, or prompt files found at the top level.
- Captured SHA-256 hashes for `storybound.exe` and `draft-generator.exe`.
- Read runtime config and SQLite state from `C:\Users\Administrator\AppData\Local\com.dudumd.storybound`; no local custom prompt rows were present.
- Confirmed database task events include 3-round rewrite/self-evaluation, cover metadata generation, storyboard splitting, character-card extraction, batched image prompt generation, and credit-gated image generation.
- Exported full recovered prompt layer to `storybound_e_prompt_dump_2026-06-24.json`.
- Wrote human-readable audit report to `storybound_e_reverse_audit_2026-06-24.md`.
- Implemented local prompt + call-logic parity from the audit: added `docs/plans/2026-06-24-storybound-prompt-logic-parity.md`, locked the prompt dump inventory in tests, and changed Step 1 rewrite from single-round to 3 rewrite rounds plus `rewrite-evaluation` best-round selection.
- Preserved existing target-length repair after best-round selection and added a fallback selection path when evaluation JSON is incomplete.
- Verification passed:
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts` -> 43 tests passed
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/prompt-templates.test.ts` -> 30 tests passed
  - `npm run typecheck`

## Error Log

- Initial inline Node/SQLite query was broken by PowerShell quoting around `length(step1_rewrite_system_prompt)`. Re-ran with a PowerShell here-string piped to Node, which succeeded.

## 2026-06-26 HTML Video Correction

- User corrected the prior HTML video implementation: UI must be Chinese, and the feature must not route through the normal story/video generation runner.
- Root cause identified: current page still uses English labels and calls `createAndRunTask` with `taskKind: 'html-video'`, while the recovered Storybound app uses `task_kind` as normal story/default and distinguishes this feature with `task_type: 'html-video'`, `pipeline_step`, and `pipeline_data`.
- Current implementation target: create a dedicated HTML video task record and show the recovered six-step pipeline workspace (`改写 + 分句`, `场景规划`, `素材（图片）`, `配音`, `动画预览`, `出片`) without starting the ordinary runner.
- Implemented `createHtmlVideoTask` IPC/fallback creation, rewrote the HTML video page as a Chinese pipeline workspace, and added a runner guard so `task_type = html-video` cannot enter the ordinary story runner.
- Browser smoke on `http://127.0.0.1:5173/` verified the HTML video page shows the Chinese title, six recovered steps, six tabs, and no checked old English/technical strings (`HTML Animation`, `Generate HTML Video`, `runner`, `WebView`, `ffmpeg`, `task_type`, `pipeline_step`, `前景 PNG`).
- While running full tests, fixed a storage regression where legacy bundled Coze draft-template cleanup deleted user-imported templates with the same `coze-*` id; cleanup now only removes legacy bundle fingerprints.
- Verification passed:
  - `npm run typecheck`
  - `npm test` -> 44 files, 457 tests passed.

## 2026-06-24 Storybound AI Creation Prompt Follow-up

- User clarified that the current target is not our local implementation, but the `E:\Storybound` reference app's AI creation/copy-generation flow.
- Current focus: identify the exact frontend bundle and prompt assembly logic behind the UI action labeled like `AI 创作`, `生成文案`, or `结合所选页面信息生成文案`.
- Recovered embedded `/index.html` from `E:\Storybound\storybound.exe`; confirmed current runtime entry is `/assets/index-DGyecVzc.js`.
- Located the AI creation implementation in the reference bundle: `tH` UI component, `aE` prompt caller, `U9` system prompt builder, `B9` user prompt builder, Bing/Sogou search helpers, IMA retrieval helpers, and the shared LLM adapter.
- Wrote the detailed audit to `storybound_ai_creation_prompt_audit_2026-06-24.md`.

## 2026-07-09 Latest Storybound Practical Migration

- User selected `方案 B：实用移植版`.
- Created implementation worktree `C:\Users\Administrator\.config\superpowers\worktrees\novel-write\storybound-latest-practical` on branch `codex/storybound-latest-practical`.
- Wrote design and implementation plans:
  - `docs/plans/2026-07-09-storybound-latest-practical-features-design.md`
  - `docs/plans/2026-07-09-storybound-latest-practical-features.md`
- Implemented storage/type contract for latest local fields and `book_selection`.
- Implemented rewrite controls and product prompting, including target-length repair and cover metadata product context.
- Implemented local person asset helper and Step 4 local material copy path.
- Exposed local selection/person APIs through Electron main/preload and required renderer type signatures.
- Added practical UI pages and controls: `选品助手`、`对标导入`、`人物素材库`、`文案把控`、`素材来源`.
- Fixed Task 5 review issues: benchmark session handoff cleanup, local-material preflight validation, and user-facing async error handling.
- Per-task spec and quality reviews were completed; Important review issues were fixed before proceeding.
- Final focused verification passed:
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts` -> 24 tests passed.
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/person-assets.test.ts` -> 1 test passed.
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/runner.test.ts -t "fixed intro|locks the first|product info|local person materials"` -> 10 tests passed, 46 skipped.
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts` -> 90 tests passed.
- Final full verification passed:
  - `npm run typecheck`
  - `npm test` -> 45 files, 477 tests passed.
  - `npm run build` -> passed with the existing large chunk warning.
  - `npm run smoke:electron` -> shell/new-task/queue/draft-template smoke true.
