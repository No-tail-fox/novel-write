# Progress

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
