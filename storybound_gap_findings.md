# Storybound Gap Audit Findings

## Requirements

- User wants the current software compared against the desktop Storybound reference.
- Output should identify missing features and areas where the replica is weaker.
- Goal is actionable replication guidance.

## Current Project Findings

- Project is an Electron + Vite + React desktop app named `Storybound Replica`.
- README says the intended clean-room loop includes source text review, short-video rewrite, cover metadata, storyboard sentence splitting, image prompts, subtitle timeline, and local draft package output.
- Repo contains many additional modules beyond the README baseline: viral analysis/download/runtime, image lab, Jianying bridge/effects/paths, Coze workflow conversion/fetching, prompt templates, provider profiles, pipeline cache, TTS voices, research, and storage.
- Existing root `task_plan.md` / `findings.md` / `progress.md` are for a separate viral-analysis debugging task and should not be reused for this audit.
- Historical parity docs exist under `docs/plans`, including `2026-06-08-storybound-reference-parity*.md`.
- Current shell navigation includes: new task, queue, history, image lab, voice lab, viral analyzer, prompt templates, draft templates, settings, account, activation.
- Current data model already covers many reference task fields: mode, AI keyword/sources, selected sources, reference image path, rewrite intensity, narrative POV, keep-promotion, TTS provider/speed, storyboard scene count, and Step 3 prompt snapshot.
- Current draft template model covers the reference core draft fields and adds useful extras: text width, transitions, background image, BGM library/default, and richer editor controls.
- Current prompt template model covers core content fields, character policy, Step 3 skeleton modules, reference kind, market tags, image seed pools, import/export/clone, and AI-assisted image-style template generation.
- Current queue/task detail UI supports artifact preview, per-step rerun/rewrite, per-scene image regeneration, per-scene narration regeneration, pause/cancel/retry, and diagnostics.
- Current runtime does not implement the reference app's observed 3-round rewrite + self-evaluation loop. It performs one rewrite/cover LLM call.
- Current runtime does not implement an explicit Step 3 protagonist/character-card extraction stage as shown in the reference task events. It exposes character policy/reference-kind metadata and asks the image-prompt step to return `characterProfile`.
- Current "processing mode" advanced control is UI-only: it is fixed to `full-auto`, `onChange` is a no-op, and no task field carries full-auto/semi-auto/clip-only behavior.
- Current pause-point choices are stored, but no runner branch appears to pause at "critical", "every step", or custom checkpoints.
- Current account, activation, and credit systems are local simulations. They show balance/status but do not enforce or sync real billing/licensing.
- Current MiniMax clone voice support is only storage/default count plus a future-facing settings note. No clone API/UI flow exists.
- Current prompt template "market" is metadata-only. There is no real market browse/download/share/rating/sync flow even though reference schema reserves those fields.

## Desktop Storybound Findings

- Found a `Storybound.lnk` shortcut in the Start Menu programs directory. The desktop directory did not directly reveal a Storybound shortcut in the first listing.
- Shortcut target: `E:\Storybound\storybound.exe`; working directory: `E:\Storybound`.
- Reference install contents are minimal: `storybound.exe`, `draft-generator.exe`, `uninstall.exe`, and `resources/default-bgm.mp3`.
- Reference app version info: Storybound `0.1.0`.
- Runtime data path: `C:\Users\Administrator\AppData\Local\com.dudumd.storybound`; roaming path also exists.
- Reference database tables: `tasks`, `task_events`, `credits_transactions`, `minimax_clone_voices`, `user_prompt_templates`, `custom_styles`, `draft_templates`, `playground_jobs`.
- Reference `tasks` table includes fields not just for basic generation, but also mode, prompt template selection/type, reference image path, rewrite intensity, narrative POV, promotion retention, TTS provider/speed, and Step 3 prompt snapshot.
- Reference `user_prompt_templates` table includes market/share metadata, usage stats, rating fields, character-card extraction flag, Step 3 skeleton modules JSON, and reference-kind (`character` / `product`).
- Reference `playground_jobs` includes image playground history with prompt, style, provider, ratio, image path, reference image path, upstream task id, status, and error.
- Reference config confirms provider defaults include custom OpenAI-compatible LLM, GPT Image, Jimeng, custom image provider, Volcengine/MiniMax TTS, Jianying draft path, IMA knowledge base settings, and dark theme.
- Reference task event sample shows a richer Step 1 flow: "standard rewrite + self-evaluation iteration", three rewrite/evaluation rounds, best-round selection, cover title and seed-comment generation, and warning when word count is outside target range.
- Reference task event sample shows Step 3 protagonist extraction before image prompt generation, then batched image-prompt generation with scene ranges and per-batch style/camera hints.
- Reference task sample failed at image generation due to credit shortage: "needs 1.44 credits (18 images x 0.08), balance 0.00", confirming cost enforcement before image generation.
- Reference output folder for the failed task contains `00-cover-title.json`, `00-reviewed.txt`, `01-rewritten-copy.md`, `02-sentences.json`, and an `images` directory.
- Launching `E:\Storybound\storybound.exe` showed a `Storybound` WebView2 window, but the captured screen was a game battle scene, not the writing workbench. Treat this as an entry/state anomaly and rely primarily on database/task artifacts for this audit unless the user provides a different visible reference window.
- User-provided screenshot `C:\Windows\TEMP\codex-clipboard-26fc2c99-ef5b-4b12-af07-8928e2536b6f.png` is treated as the correct reference UI.
- Reference screenshot shows top trial strip: "试用已用尽 | 旧任务可继续执行，激活后可新建任务" and a top-right "获取激活码" action.
- Reference screenshot shows sidebar entries: 新建任务, 任务队列, 历史任务, 画图实验室, 配音实验室, 音乐MV, 提示词模板, 草稿模板, 系统设置, 账号管理, 激活管理.
- Reference screenshot shows a "最近" sidebar block with the failed task `20260526 · 苗木诚`, directly supporting old-task continuation.
- Reference screenshot shows bottom compact credit chip "全能绘图积分" and "意见反馈".
- Reference screenshot settings page uses a two-pane layout with category tabs and status pills; LLM main pane says "LLM 配置", "已保存 1 个配置", "新建配置", selected green outlined profile card, edit icon, and overflow menu.
- Reference screenshot version label is `v1.3.0 · beta`.

## Gap Backlog

### P0 - Must Replicate for Core Parity

1. `音乐MV` page is missing from the current route model and navigation. Current `ShellView` and `navItems` include image lab, voice lab, viral analyzer, templates, settings, account, activation, but no Music MV view.
2. Real trial/activation gating is missing. Current UI shows the trial message, but default config explicitly says new tasks are not blocked by payment limits and credit transactions are local simulation only.
3. Real credit enforcement is missing. Reference failed image generation before spending because balance was 0; current account balance and credit ledger are display-only and do not gate image count, provider cost, or task creation.
4. Processing mode is nonfunctional. Current advanced control is hard-coded to `full-auto` with a no-op `onChange`, and `Task` has no processing-mode field.
5. Pause checkpoints are not functional. `pausePoints` are stored, but `runner.ts` only pauses on failure/cancellation; it does not stop after critical steps, every step, or custom checkpoints.
6. Step 1 rewrite quality loop is weaker. Reference runs 3 rewrite/evaluation rounds, selects the best version, generates title/seed comments, and warns on word count; current runner performs one rewrite+cover LLM call.
7. Explicit protagonist/character-card extraction before Step 3 is missing. Current image prompts can include `characterProfile`, but there is no dedicated extraction step/artifact before batched image prompt generation.

### P1 - Strong Parity and Product Trust

1. Settings page is close but not exact. Current profile cards exist, but the screenshot-specific copy, "已保存 N 个配置" summary, compact selected-card layout, edit/overflow action behavior, and saved-state indicator should be aligned.
2. Sidebar "最近" task block is missing. Current app has queue/history pages, but not the reference's always-visible recent task quick resume area.
3. Notification bell and feedback are visible but likely passive. They should open real notifications and feedback flows if exact clone behavior is required.
4. MiniMax clone voice is only a placeholder. Current settings show local clone voice count and note "可后续接入", while reference has a `minimax_clone_voices` table implying a real voice-clone management flow.
5. Prompt template market/share/rating is metadata-only. Current templates have `origin`, market tags, and import/export, but no actual market browse/download/share/rating/sync flow.
6. Version and branding are behind the reference. Current code shows `v0.10.4 · beta`; reference screenshot shows `v1.3.0 · beta`.

### P2 - Current Replica Already Stronger or Extra

1. Viral analyzer is an extra capability not visible in the reference screenshot; keep it if product differentiation matters, hide it if strict clone fidelity matters.
2. Draft template editor appears stronger than reference: richer layout controls, BGM library/default, background image, transitions, Coze workflow import.
3. Task detail and artifact tools appear stronger: per-step rerun/rewrite, per-scene image/narration regeneration, diagnostics, artifact preview.
4. Prompt/image template editing is broader than reference schema in some areas, especially AI-assisted image style fields and seed pools.

## Resources

- Current project root: `D:\opc\novel-write`
