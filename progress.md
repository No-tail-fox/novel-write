# Progress

## 2026-06-08 Feishu Coze Workflow Batch

- Added `scripts/fetch-feishu-coze-workflows.mjs` and `npm run fetch:coze:feishu` to open the Feishu wiki through Chrome CDP, capture document HTML/cookies, resolve file tokens, download `.txt` workflow sources, optionally convert them, and optionally install them into a Storybound DB.
- Stabilized source discovery with three layers: initial Document HTML file records, React fiber `blockManager.getRecord(recordId)` from audit/HTML record seeds, and scrolling runtime capture for virtualized Feishu file cards.
- Added stable record-id-prefixed filenames so repeated Feishu runs accumulate a de-duplicated source set rather than producing index-number duplicates.
- Hardened conversion for Coze video-generation workflows without a Jianying `create_draft` node by generating a reusable default 9:16 draft-template shell with a warning diagnostic.
- Added normal app database seeding for the generated Feishu Coze draft-template bundle, so fresh and existing Storybound databases auto-fill missing `coze-*` draft presets without overwriting locally edited presets.
- Final generated artifacts:
  - `data/coze-workflows/feishu-sources`: 114 downloaded Coze workflow `.txt` files.
  - `data/coze-workflows/feishu-sources-manifest.json`: 114 expected, 114 downloaded, 0 failed.
  - `data/coze-workflows/feishu-draft-templates.json`: 114 templates, 0 conversion failures, 0 duplicate template IDs.
  - `data/coze-workflows/feishu-data.db`: 117 draft templates total, including 114 `coze-*` templates plus 3 built-in presets.
- Verification:
  - Re-ran the real Feishu fetch/convert/install command on 2026-06-09: downloaded 114/114 source files, converted 114 templates, installed 114 templates.
  - Artifact audit: manifest expected/downloaded/failed `114/114/0`; source files `114`; bundle input/templates/failures/installed `114/114/0/114`; duplicate template IDs `0`.
  - DB audit: `data/coze-workflows/feishu-data.db` has 117 draft templates total, 114 `coze-*`, 0 duplicate Coze IDs.
  - Fresh app DB audit: `FileDatabase.open(<new data.db>)` yields 117 draft templates, 114 `coze-*`, and 3 built-in presets.
  - Regression test first failed before the seeding implementation, then passed after the storage change.
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests\feishu-coze-workflow-fetcher.test.ts tests\coze-workflow-converter.test.ts tests\coze-workflow-converter-cli.test.ts`: 3 files, 17 tests passed.
  - `npm run typecheck`: passed.
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests\product-shell-storage.test.ts tests\storage.test.ts tests\coze-workflow-converter-cli.test.ts`: 3 files, 22 tests passed.
  - `npm test`: 38 files, 279 tests passed.
  - `npm run build`: passed.
  - `npm run smoke:electron`: rendered shell and draft-template gallery/editor smoke passed.

## 2026-06-08 Coze Workflow Draft Template Converter

- Added a Coze workflow clipboard parser/converter that reads copied `coze-workflow-clipboard-data`, flattens nested workflow blocks, extracts Jianying plugin nodes, maps `create_draft` dimensions into Storybound `DraftTemplate` canvas presets, and preserves unsupported or asset-specific workflow details as diagnostics.
- Copied the pasted real workflow into `tests/fixtures/coze-workflow-emotion-sample.json` and verified it maps to `coze-7629256239332032548`, `16:9`, `1920x1080`, with pipeline diagnostics for videos, audio, captions, effects, images, and keyframes.
- Added the draft-template page Coze import panel with preview, single import, and batch import actions; browser smoke on `http://127.0.0.1:5173` confirmed the panel, preview result, and 8 visible diagnostics render with the real fixture pasted.
- Added `scripts/convert-coze-workflows.mjs` and `npm run convert:coze` for batch converting copied workflow files into a JSON bundle containing `templates`, `diagnostics`, and `failures`.
- Fixed CLI argument handling so both `--out output.json input.json` and positional `output.json input.json` forms work under npm/PowerShell argument forwarding.
- Verified:
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/coze-workflow-converter.test.ts tests/coze-workflow-converter-cli.test.ts tests/product-shell-ui.test.ts tests/storage.test.ts tests/product-shell-storage.test.ts tests/draft-template-normalization.test.ts tests/draft.test.ts`: 7 files, 101 tests passed.
  - `npm run typecheck`: passed.
  - `npm test`: 37 files, 270 tests passed.
  - CLI smoke with `npm run convert:coze -- <temp>/draft-templates.json tests\fixtures\coze-workflow-emotion-sample.json`: generated one valid JSON template bundle; Node `JSON.parse` confirmed id `coze-7629256239332032548`, ratio `16:9`, diagnostics count `29`.

## 2026-06-08 Storybound Draft Preset Parity

- Re-read Storybound SQLite `draft_templates` rows and replaced built-in draft presets with exact `默认竖屏`, `竖屏4:3`, and `横屏16:9` config values.
- Extended title/subtitle/disclaimer text layers with Storybound style fields: bold, underline, align, letter spacing, line spacing, and border.
- Added compact editor controls and preview styles for those fields; increased text border width control max to 60 so Storybound default width 40 is editable without clamping.
- Extended draft payload and pyJianYingDraft bridge export so title/subtitle/disclaimer are written as text tracks with `TextSegment`, `TextStyle`, and `TextBorder`.
- Verified Storybound draft-template parity:
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/draft-template-normalization.test.ts tests/draft.test.ts tests/jianying-bridge.test.ts tests/product-shell-ui.test.ts`
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-storage.test.ts tests/draft-template-normalization.test.ts tests/draft.test.ts tests/jianying-bridge.test.ts tests/product-shell-ui.test.ts`
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/jianying-bridge.test.ts`
  - `npm run typecheck`
  - `npm test`: 34 files, 239 tests passed.
- Browser smoke verified `http://localhost:5173` draft-template editor opens, title controls show `下划线` / `对齐` / `字间距` / `行间距`, text border width is value `40` with max `60`, and screenshot saved to `tmp/draft-template-storybound-parity-ui.png`.

- Started reference-replication discovery for `G:\Storybound`.
- Loaded required process skills: using-superpowers, brainstorming, planning-with-files, and test-driven-development.
- Checked current workspace and confirmed `main` is already up to date while preserving a dirty working tree.
- Reset `task_plan.md`, `findings.md`, and `progress.md` for this task.
- Scanned current repo for voice, prompt, and draft references.
- Scanned `G:\Storybound` and found a Tauri-style app exe plus a Python draft generator bundle with embedded Jianying template resources.
- Located reference app local state under `AppData\Local\com.dudumd.storybound`.
- Read reference config/database schema and compared it against the current app's prompt, draft, and TTS models.
- Found the most concrete gaps: standalone voice lab, legacy prompt-content presets/model vocabulary, and text stroke/border support in draft templates.
- Created and switched to branch `codex/storybound-reference-parity`.
- Added tests first for voice lab UI, prompt seed-pool persistence/UI, draft text border payload/UI, and Python bridge stroke support.
- Implemented voice lab data/model/storage/provider/IPC flow and shell UI.
- Implemented reference-style prompt content editor fields with `imageSeedPoolsJson`.
- Implemented draft template text border controls, preview stroke styling, and pyJianYingDraft bridge payload/script support.
- Verified targeted tests:
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts tests/storage.test.ts tests/draft.test.ts tests/jianying-bridge.test.ts`
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/draft-template-normalization.test.ts tests/storage.test.ts tests/media-providers.test.ts tests/electron-ipc-contract.test.ts tests/product-shell-ui.test.ts tests/draft.test.ts tests/jianying-bridge.test.ts tests/prompt-templates.test.ts`
- Verified `npm run typecheck`.
- Verified `npm test`: 34 files, 235 tests passed.
- Fixed the draft template editor UI density issue: checkbox/toggle controls now render as compact 24px controls instead of inheriting full-width input sizing, and text border controls live inside their matching title/subtitle/caption/disclaimer groups instead of occupying the top of the controls pane.
- Verified the draft template UI fix with Chrome screenshot output at `tmp/draft-template-ui-verify-after.png`: no top-level `draft-border-compact-panel`, right pane starts with canvas/image controls, checkbox input remains 16px hidden behind a 24px visual toggle.
- Re-verified after the UI fix:
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts`
  - `npm run typecheck`
  - `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/draft-template-normalization.test.ts tests/draft.test.ts tests/jianying-bridge.test.ts`
  - `npm test`: 34 files, 236 tests passed.
- Browser smoke verified localhost app renders the new `配音实验室` nav/page and records a browser-preview TTS failure instead of fake success.
