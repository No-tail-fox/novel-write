# Findings

## 2026-08-01 最终封面元数据与双层字幕拆分

- 用户截图中的封面区在改写阶段显示“等待封面标题、摘要、标签和评论”，确认封面元数据是独立生成结果，应该在最终文案锁定后一次性回填主标题与副标题。
- 当前 `runner.ts` 先用改写候选生成封面，再追加固定开头和结尾 CTA；因此封面模型看不到最终落盘文案，且钩子化后的 `cover.title` 被错误拿来替换 `{主角}`。
- 当前 `story.ts` 一条分镜只生成一条 SRT；草稿模板虽有 `caption.maxCharsPerLine`，它只在剪映桥接层生效，任务预览与流水线字幕仍会显示整条长分镜。
- 最小兼容方案是在 `SubtitleCue` 增加可选 `sceneId`，共享构建器按分镜生成多条短字幕；旧产物在预览、重跑和导出时从 scenes 重建，不迁移数据库结构。
- 分镜继续作为图片/TTS 的语义单元，推荐 25-45 字并硬限制 55 字；短字幕默认 12 字、限制 6-24 字，去除展示标点并按可见字符权重分配镜头内时间。

## Storybound Parity Update

- `storybound_e_prompt_dump_2026-06-24.json` now has a direct inventory check in `tests/prompt-templates.test.ts`; it locks the 9 system templates, 5 global step templates, and version hash against the recovered dump.
- `src/shared/runner.ts` now runs Step 1 as 3 rewrite rounds plus a dedicated `rewrite-evaluation` request, then selects the best round before any target-length repair.
- The selected rewrite round now drives `01-rewritten-copy.md`, `00-cover-title.json`, and `01-rewrite-evaluations.json`; repair only runs after selection.
- Step 1 event flow now includes round-by-round progress, self-eval completion, best-round selection, and cover-title/comment generation notices.
- The new path is covered by full runner tests and typecheck, so the three-round flow should not silently regress back to a single rewrite call.

## Current Project

- 当前分支已切到 `codex/storybound-cn-full-replica`。
- 项目是 React + Vite + Electron + sql.js，主 UI 在 `src/main.tsx`，主要样式在 `src/styles.css`，本地数据库在 `src/shared/storage.ts`。
- 现有代码已经包含旧 Storybound parity 工作：语音实验室、画图实验室、音乐 MV、爆款拆解、提示词模板、草稿模板、设置、账号和激活页。
- 当前 `ShellView` 已有 `new-task`、`queue`、`history`、`task-detail`、`image-lab`、`voice-lab`、`music-mv`、`viral-analyzer`、`prompt-templates`、`draft-templates`、`settings`、`account`、`activation`。
- 终端显示中文时会出现 mojibake，但 Node 读取确认文件内存在真实中文，例如 `新建任务`、`任务队列`、`画图实验室`。

## Reference App

- 参考应用目录：`E:\Storybound`。
- 参考可执行文件：`storybound.exe`、`draft-generator.exe`、`uninstall.exe`。
- 参考资源：`resources/default-bgm.mp3`。
- 参考本地配置：`C:\Users\Administrator\AppData\Local\com.dudumd.storybound\config.json`。
- 参考配置内容：
  - LLM: custom/openai protocol, `base_url: https://input.codes`, `model: gpt-5.5`。
  - Image: `gpt_image` 为当前 provider；即梦模型 `jimeng-4.5`；自定义生图默认模型 `gpt-image-1`。
  - TTS: `volcengine` 当前 provider；火山默认 speaker `zh_male_dongfanghaoran_moon_bigtts`；MiniMax 默认模型 `speech-2.8-hd`。
  - Jianying: `draft_path` 字段存在但为空。
  - UI: dark theme。

## Reference Database

- 数据库：`C:\Users\Administrator\AppData\Local\com.dudumd.storybound\data.db`。
- 表结构：
  - `tasks` 1 row。
  - `task_events` 25 rows。
  - `draft_templates` 4 rows。
  - `user_prompt_templates` 0 rows。
  - `playground_jobs` 0 rows。
  - `minimax_clone_voices` 0 rows。
  - `credits_transactions` 0 rows。
  - `custom_styles` 0 rows。
  - `custom_cover_templates` 0 rows。
- `tasks` 参考字段强调 Storybound 主工作流：`material_source`、`task_type`、`pipeline_step`、`pipeline_data`、`target_length`、`target_scenes`、`script_format`、`podcast_*`、`video_intro_*`、`cover_image_mode`、`cover_template_id`。
- `user_prompt_templates` 参考字段包含：`step1_rewrite_system_prompt`、`step1_metadata_system_prompt`、`step3_system_prompt`、`style_id`、`image_seed_pools_json`、`needs_character_card`、`step3_skeleton_modules_json`、`reference_kind`、市场分享/统计字段。
- 当前项目的数据层已经有对应超集或近似实体，但缺少参考表名/语义的显式 playground job 与 credits 表名兼容层。

## UI Gap

- 当前壳层功能已经丰富，但主线/次级区分不够明确；爆款拆解和扩展模块与 Storybound 主工作流同级。
- 计划要求重新变成 Storybound-first：新建任务、任务队列、历史任务、实验室、模板、设置、账户、激活为主；爆款拆解等扩展放次级区。
- 用户反馈“爆款怎么没有了”说明爆款拆解放入次级区会被理解为入口消失；当前实现应将爆款拆解保留在主线工作流中。
- 顶部需要恢复试用/激活条、积分/账户入口、最近任务和可见中文状态。
- 页面需要更好看，但仍保持工具型：低圆角、密集表单、状态芯片、双栏设置面板、可扫描列表。

## Testing Direction

- 先新增/改造文件级契约测试，断言所有主要入口、标题、按钮、空态和流水线状态为中文。
- 再跑现有 runtime tests，确保三轮改写、自评、主角档案、暂停/续跑、草稿输出不被 UI 重排破坏。

## 2026-06-26 HTML Video Correction

- Recovered HTML video should be modeled as a Storybound pipeline workspace, not as a third `TaskKind`.
- The reference route `/html-video` creates a normal task row with `task_type = 'html-video'`, then drives `pipeline_step` and `pipeline_data` through dedicated stages.
- User-visible workflow labels are Chinese: `改写 + 分句`, `场景规划`, `素材（图片）`, `配音`, `动画预览`, `出片`; tabs are `文案`, `素材`, `配音`, `动画预览`, `封面`, `出片`.
- Local implementation must avoid `createAndRunTask` for this entry; it should create and inspect the HTML video task snapshot first, leaving actual render orchestration to a later dedicated pipeline.

---

# 2026-06-23 G:\Storybound Backend Reverse Findings

## Scope

- 新参考目录改为 `G:\Storybound`。
- 本轮目标是静态逆向本地后端/业务逻辑，而不只是 UI parity。
- 分析范围包括：封装格式、前后端边界、IPC/API、SQLite schema、配置、任务流水线、模型 provider 适配、prompt/template、剪映草稿导出。
- 排除范围：激活绕过、授权破解、可用密钥提取或复用。

## G:\Storybound Directory Shape

- `G:\Storybound` 顶层只有 9 个条目：`storybound.exe`、`draft-generator.exe`、`uninstall.exe`、`onnxruntime.dll`、`onnxruntime_providers_shared.dll`、`sherpa-onnx-c-api.dll`、`sherpa-onnx-cxx-api.dll`、`resources/`。
- `resources/` 目前只发现 `default-bgm.mp3`，没有 `app.asar`、可见 JS bundle、Python 包或普通配置文件。
- 初步判断：这版 `G:\Storybound` 不像未封装 Electron app；更可能是 Rust/Go/C++/Tauri/pyinstaller/nuitka 一类单文件/少文件分发，或将前后端资源嵌入 exe。
- ONNX Runtime 与 sherpa-onnx DLL 表明本地可能包含语音识别/语音处理/模型推理相关能力，但具体调用逻辑需要继续从 exe 字符串和导入表确认。

## Binary / Backend Shape

- `storybound.exe` PE metadata: ProductName/FileDescription `Storybound`，CompanyName `dudumd`，Version `0.1.0`，未签名，Windows GUI x64。
- `storybound.exe` PDB hint 暴露为 `storybound.pdb`，字符串中出现 `src\lib.rs`、`C:\Users\DuDuMD\.cargo\registry\...`、`tauri-2.10.3`、`tauri_runtime_wry`、`tokio`、`serde`、`sqlx-sqlite-0.8.6`，可确认主程序是 Rust + Tauri 2.x + SQLx SQLite。
- `storybound.exe` imports include `ws2_32.dll` and `sherpa-onnx-c-api.dll`；sherpa imports include VAD/offline recognizer methods such as `SherpaOnnxCreateVoiceActivityDetector`、`SherpaOnnxCreateOfflineRecognizer`、`SherpaOnnxDecodeOfflineStream`、`SherpaOnnxGetOfflineStreamResultAsJson`。
- Tauri command strings reveal likely backend command surface:
  - local/system: `greet`、`allow_external_path`、`save_secret`、`load_secret`、`delete_secret`、`capture_webview_hwid_fingerprint`、`license_verify`。
  - HTTP/download/image proxy: `http_request`、`http_download`、`gpt_image_submit`、`gpt_image_edit`、`gpt_image_poll`、`gpt_image_test`。
  - browser/app control: `capture_webview_by_label`、`capture_webview`、`eval_in_window`、`check_update`、`apply_update`、`launch_program`。
  - ASR: `asr_transcribe` with `audioPath`、`tokensPath`、`vadPath`、`language` args.
- String hits show activation/update/proxy base: `LOCALAPPDATA\Storybound` and `https://jihuo.52aibot.com` plus `/gpt-proxy` and `/v1/images/tasks/`.
- `draft-generator.exe` appears to be Python-packaged, not Rust/Tauri: strings include `asyncio`、`numpy`、`imageio_ffmpeg`、`pyJianYingDraft` modules and source paths such as `pyJianYingDraft\script_file.py`、`template_jianying\draft_meta_info.json`、`generate_draft_lib`.

## Draft Generator Package Shape

- `draft-generator.exe` is a PyInstaller onefile build for Python 3.11.
- TOC entries confirm 260 packaged items, including `draft_generator`, `PYZ.pyz`, `base_library.zip`, `imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe`, and the full `pyJianYingDraft` package source (`.py`) plus cached bytecode (`.pyc`).
- `draft_generator` main script strings show a thin CLI sidecar:
  - banner: `Sidecar CLI 入口 — 接收 JSON stdin 或 --input 参数，输出 JSON stdout`
  - args: `mode`, `story`, `compose_render`, `convert_audio_16k`, `remix_bgm`, `music_mv`, `work_dir`, `audio_path`, `audio_duration`, `material_source`, `assignments`, `lyrics`, `jianying_draft_path`, `task_title`, `template`, `cover_title`, `cover_image_path`, `task_dir`, `bgm_path`.
  - imported orchestrators: `generate_draft_lib.generate`, `generate_music_mv`, `generate_compose_render`, `generate_remix_bgm`, `convert_audio_16k`.
- `PYZ.pyz` contains 904 modules; interesting ones include `generate_draft_lib`, `pyJianYingDraft`, `pyJianYingDraft.animation`, `audio_segment`, `draft_folder`, `script_file`, `template_mode`, `text_segment`, `track`, `video_segment`, and many `metadata.*` modules for CapCut/Jianying effect mappings.

## Draft Generator Backend Logic

- `generate_draft_lib` is the main recoverable backend/business module inside `draft-generator.exe`. Its top-level API includes `generate`, `generate_music_mv`, `generate_compose_render`, `generate_remix_bgm`, and `convert_audio_16k`.
- `convert_audio_16k` converts arbitrary audio/video audio tracks to 16 kHz mono PCM WAV for local ASR.
- `generate_compose_render` renders frame sequences plus narration audio into per-scene MP4 segments, optionally prepends a cover segment, joins or xfade-composes scene clips, preserves a no-BGM `_source.mp4`, then muxes BGM with adaptive loudness.
- `generate_remix_bgm` reuses the common mux path to swap/remix BGM onto an existing video while keeping source video/audio behavior.
- `generate_music_mv` is present as a separate mode; based on recovered names/strings it handles lyrics, assignments, cover title/image, BGM, template data, motion/fade effects, draft path rewriting, and draft metadata writes.
- `pyJianYingDraft` is fully available as source and models Jianying/CapCut draft JSON: `Script_file` owns canvas/fps/duration/materials/tracks, `add_track` and `add_segment` build tracks/materials, `import_srt` creates text segments from subtitles, and `dump/save` writes `draft_info.json`.
- `Draft_folder` wraps Jianying draft directories and supports listing, removing, loading templates, and duplicating a template draft before mutation.
- Packaged `template_jianying` contains the minimal draft folder skeleton: `draft_info.json`, `draft_meta_info.json`, `draft_settings`, `draft_cover.jpg`, `draft_agency_config.json`, `attachment_pc_common.json`, and tmp/backup files.
- `jianying_controller.py` automates Jianying Pro export through Windows UI Automation, with progress states `idle/exporting/finished/error`, draft lookup by `HomePageDraftTitle:<name>`, export settings controls, percent scraping, timeout handling, and optional output file move.

## Tauri Web Asset Extraction

- `storybound.exe` embeds frontend web assets directly in the PE. Asset names such as `/assets/index-*.js`, `/assets/index-*.css`, and `/assets/podcast-cover-prompt-*.js` are followed by Brotli-compressed payloads.
- Extracted 191 web assets to `I:\opc\tmp\storybound-reverse\extracted-web` with a generated `manifest.json`.
- The decompressed JS chunks are readable Vite/browser bundles and can be searched for `window.__TAURI_INTERNALS__.invoke`, sidecar calls, prompt templates, pipeline state, and local business logic.
- This makes the frontend-to-backend contract recoverable at much higher fidelity than strings-only analysis, without modifying or running the reference program.

## 2026-06-23 Backend Contract Addendum

### Architecture Split

- The recoverable backend is not one monolithic server. It is three layers:
  - Rust/Tauri host commands for system capability: HTTP proxy/download, image proxy helpers, keychain secrets, updater, local ASR, WebView capture/eval, external path allowance, and program launch.
  - Browser JS bundles for most business orchestration: task pipeline, prompt assembly, provider adapters, account/license state machine, SQL schema migrations, offscreen HTML render, and sidecar input JSON construction.
  - `draft-generator.exe` Python sidecar for heavy media/draft work: ffmpeg render/mux/remix, audio conversion, Jianying draft JSON generation, music MV draft generation, subtitle/title/cover writing, asset path rewriting, and draft meta patching.

### Tauri IPC Command Shapes

- `http_request` is called as `{ args: { method, url, headers, body?, proxy?, timeoutMs? } }` and returns `{ status, headers, body }`. It is used for LLM calls, MiniMax music, Volcengine ASR, ModelScope, RunningHub, license/account APIs, and remote system-template fetch.
- `http_download` is called as `{ args: { url, savePath, timeoutMs?, proxy? } }`. It downloads generated images/videos/materials to local paths and retries with proxy in some flows.
- `gpt_image_submit` is called with `{ bodyJson, proxy?, email?, fp?, baseUrl? }`; `gpt_image_edit` adds `{ prompt, imagesBase64, filenames, size }`; `gpt_image_poll` uses `{ taskId, proxy?, email?, fp?, baseUrl? }`; `gpt_image_test` uses `{ proxy?, email?, fp?, baseUrl? }`.
- `asr_transcribe` is called after sidecar audio conversion as `{ audioPath, modelPath, tokensPath, vadPath, language }` and returns token timings used to build both sentence segments and word list.
- `capture_webview_by_label` and `eval_in_window` are used by the HTML video renderer. The app creates hidden `hv-render-*` Tauri WebView windows, seeks `window.__tl` to a timestamp, captures JPG frames, then passes the frame directories to `compose_render`.
- `save_secret`, `load_secret`, and `delete_secret` are the keychain abstraction. Confirmed keys include `license.token`, `license.last_heartbeat_at`, `license.last_known_time`, `trial.first_launch_at`, `trial.tasks_used`, `license.bound_count`, `license.bound_max`, `llm.api_key`, `jimeng.session_id`, `tts.*`, `runninghub.api_key`, and `modelscope.api_key`.
- `check_update` is called with `{ currentVersion, fp, proxy?, baseUrl? }`; `apply_update` is called with `{ url, signatureB64, proxy?, baseUrl? }` and emits `updater://progress`.
- `allow_external_path` is used to extend FS access for configured directories/files such as Jianying draft path and imported BGM.
- `launch_program` is used to open Jianying Pro by transforming a configured `JianyingPro Drafts` path to `JianyingPro\JianyingPro.exe`.

### Sidecar Modes

- Step 6 story export constructs:
  - Normal story mode payload: `{ task_dir, cover_title, bgm_path, jianying_draft_path, template, task_title?, cover_image_path? }`.
  - Podcast/music mode payload: `{ mode: "music_mv", work_dir, audio_path, audio_duration, material_source: "ai", assignments, lyrics, jianying_draft_path, task_title?, template, cover_title, cover_image_path? }`.
  - The JS expects stdout JSON on the last non-empty line and requires `success === true`. It reads `draft_dir`, `draft_id`, optional `error`, and optional `traceback`.
- HTML video export constructs `compose_render` payload:
  - `{ mode: "compose_render", work_dir, scenes: [{ frames_dir, audio_path, fps }], output_path, bgm_path?, total_duration_s, bgm_target_db, transition?, cover_path?, cover_duration_s?, canvas_w?, canvas_h? }`.
  - The caller only checks sidecar exit code, then deletes transient frame/segment files.
- BGM replacement constructs `remix_bgm` payload:
  - `{ mode: "remix_bgm", source_path: <taskDir>/_source.mp4, bgm_path?, bgm_target_db, total_duration_s?, output_path }`.
- Local ASR constructs `convert_audio_16k` payload:
  - `{ mode: "convert_audio_16k", audio_path, output_path }`, then calls Rust `asr_transcribe`.

### Python Draft Logic

- `generate_draft_lib` top-level functions recovered from the Python 3.11 PYZ are: `generate`, `generate_music_mv`, `generate_compose_render`, `generate_remix_bgm`, `convert_audio_16k`, `build_srt`, `convert_text_to_subtitle`, `prepare_bgm`, `add_cover_title`, `rewrite_draft_asset_paths`, and `_write_draft_meta`.
- `generate()` reads task files such as sentences/segments/images, creates a Jianying script, adds video/image/audio/BGM/subtitle/title tracks, applies image motion/edge fade, optionally inserts a cover image/title, copies the packaged `template_jianying` skeleton, dumps draft JSON, rewrites media paths, converts text to subtitle material, applies draft cover, and writes draft meta.
- `generate_music_mv()` builds an audio-first draft from assignments and lyric timings. It supports video clips and images, clip start/end/speed, cover insertion, lyric phrase splitting into SRT, style/background/border for subtitle text, motion pools, edge fade, draft path rewrite, and metadata output.
- `generate_compose_render()` renders per-scene MP4s from JPG frame sequences plus narration audio, can prepend a cover segment, can xfade scene clips, preserves `_source.mp4`, then muxes BGM using measured loudness and target dB.
- `generate_remix_bgm()` remuxes an existing `_source.mp4` with a new BGM track using the same loudness logic.
- `convert_audio_16k()` uses ffmpeg/pydub to output 16 kHz mono WAV for sherpa-onnx ASR.

### Remote Business APIs

- License/server base URL is selected by probing `https://jihuo.52aibot.com/v1/time`; if blocked it tries `https://api.joy1412.cn/v1/time`, cached under `storybound:license_url_cache`.
- License endpoints seen: `POST /v1/activate`, `POST /v1/heartbeat`, `POST /v1/deactivate`, `POST /v1/trial/init`, `POST /v1/trial/consume`, plus `GET /v1/time`.
- License local trial constants are 7 days and 5 tasks. Local secret keys preserve first launch, tasks used, last known server time, heartbeat time, and bound device counts.
- Account endpoints seen: `/v1/account/email/send-code`, `/verify-code`, `/bind`, `/migrate-licenses`, `/unbind`, `/devices`, `/kick`, plus credits `/balance`, `/deduct`, `/redeem`, `/ledger`.
- Credit cost for built-in image flow is visible as `0.08` per image in newer bundles. Account calls include a `deviceFingerprint` unless explicitly disabled.
- Remote prompt/system template refresh calls `GET /v1/system-templates` with `If-None-Match`, caches `{ schemaVersion, versionHash, cachedAt, templates }`, and merges remote templates over built-in tracks.

### Database / Current Repo Gaps

- Reference JS creates SQLite through `plugin:sql` and `data.db` with `tasks`, `task_events`, `credits_transactions`, and later migrations for `draft_templates`, `user_prompt_templates`, `playground_jobs`, `custom_styles`, `custom_cover_templates`, and `minimax_clone_voices`.
- Reference task defaults include `material_source TEXT NOT NULL DEFAULT 'ai'`; current `I:\opc\src\shared\storage.ts` defaults `material_source` to `'paste'`, which is a parity difference.
- Current repo already has many Storybound-compatible tables/fields, but its runtime is Electron/Node and its draft writer is `src/shared/jianying-bridge.ts`, not the recovered `draft-generator` sidecar contract.
- Current draft bridge writes its own `draft_content.json`/`draft_meta_info.json` flow. Reference sidecar uses packaged `template_jianying`, `draft_info.json`, text-to-subtitle conversion, cover/meta rewrite, ffmpeg BGM preparation, and separate `compose_render`/`music_mv` modes.
- Current repo does not expose Tauri-equivalent IPC commands for `http_request`, `http_download`, `gpt_image_*`, `asr_transcribe`, `capture_webview_by_label`, `eval_in_window`, `allow_external_path`, updater, or system keychain. These are the main backend compatibility gaps if we want behavior parity rather than only UI parity.

---

# 2026-06-24 E:\Storybound Local Audit

## Scope

- User requested a fresh local audit of `E:\Storybound`, including prompt sources and backend/functionality logic.
- Treat as owned software audit. Do not bypass activation, crack authorization, or expose usable secrets.

## Initial Directory Shape

- `E:\Storybound` contains only:
  - `storybound.exe` (60,853,760 bytes)
  - `draft-generator.exe` (77,747,722 bytes)
  - `onnxruntime.dll`, `onnxruntime_providers_shared.dll`
  - `sherpa-onnx-c-api.dll`, `sherpa-onnx-cxx-api.dll`
  - `uninstall.exe`
  - `resources/default-bgm.mp3`
- No visible source tree, `app.asar`, or plain prompt/config files were present in the install directory. Analysis needs to focus on embedded assets and packaged sidecar contents.

## Runtime Data and Prompt Inventory

- `C:\Users\Administrator\AppData\Local\com.dudumd.storybound` contains `config.json`, `data.db`, `bgm/`, `tasks/`, and `EBWebView/`.
- `config.json` provider defaults: custom OpenAI-compatible LLM at `https://input.codes` using model `gpt-5.5`; image provider `gpt_image`; Jimeng model `jimeng-4.5`; custom image model `gpt-image-1`; Volcengine TTS speaker `zh_male_dongfanghaoran_moon_bigtts`; MiniMax TTS model `speech-2.8-hd`; dark UI theme. API key/session/token fields were empty or treated as sensitive.
- `data.db` tables and counts: `tasks` 3, `task_events` 25, `draft_templates` 5, `user_prompt_templates` 0, `custom_styles` 0, `custom_cover_templates` 0, `playground_jobs` 0, `minimax_clone_voices` 0, `credits_transactions` 0.
- No local custom prompt rows are present (`user_prompt_templates` count is 0).
- Exported recovered prompt layer to `storybound_e_prompt_dump_2026-06-24.json`: 9 system task templates, 5 global fallback prompts, shared storyboard prompt/rules, 363,266 bytes.

## E:\Storybound Backend Confirmation

- Direct binary string scan confirms Tauri/host command names in `storybound.exe`: `http_request`, `http_download`, `gpt_image_submit`, `gpt_image_edit`, `gpt_image_poll`, `gpt_image_test`, `asr_transcribe`, `save_secret`, `load_secret`, `delete_secret`, `capture_webview_by_label`, `capture_webview`, `eval_in_window`, `allow_external_path`, `check_update`, `apply_update`, `launch_program`, `license_verify`, `capture_webview_hwid_fingerprint`.
- Direct binary string scan confirms sidecar packaging in `draft-generator.exe`: `pyJianYingDraft`, `template_jianying/draft_info.json`, `template_jianying/draft_meta_info.json`, and modes/modules related to `music_mv`, `compose_render`, `remix_bgm`, and `convert_audio_16k`.
- `task_events` confirms actual observed pipeline: template selection, Step 0 pre-review, Step 1 three rewrite/self-evaluation rounds and cover metadata generation, Step 2 storyboard splitting, Step 3 character card extraction plus batched `desc_prompt` generation, Step 4 credit-gated image generation.

## 2026-06-24 E:\Storybound AI Creation Prompt

- Current embedded entry HTML was recovered from `E:\Storybound\storybound.exe`; it loads `/assets/index-DGyecVzc.js`.
- The "AI 创作" feature is implemented in the current bundle, not in our local project source. Relevant functions are `tH`, `aE`, `U9`, `B9`, `F9`, `h9`, `E9`, `O9`, `sE`, `fs`, and `ps`.
- `aE()` builds a direct system/user prompt and calls the regular LLM adapter with `temperature: 0.8`, `maxTokens: 32768`, dynamic timeout from user prompt length, and `maxRetries: 2`.
- The recovered system prompt starts with `你是一名资深短视频文案创作者，擅长创作原创短视频口播稿。` and dynamically injects the current track name/tag plus one of three material strategies.
- For the default story flow, the track resolves to `人物故事（纪实人物）`.
- The user prompt includes `【关键词】`, optional `【用户额外要求】`, optional `【参考素材】` blocks, and a final instruction to create an original short-video oral narration draft with no extra explanation.
- Full details and exact prompt/call logic are recorded in `storybound_ai_creation_prompt_audit_2026-06-24.md`.

---

# 2026-07-09 Latest Storybound Practical Migration Findings

## Implemented Local Features

- Latest task fields are now persisted locally: `product_info`、`material_person`、`draft_dir`、`fixed_intro`、`outro_cta`、`lock_intro_sentences`.
- `book_selection` is implemented as a local product/book handoff table. It stores `BookProductInfo` JSON and feeds both new tasks and benchmark import.
- Rewrite controls are applied outside the LLM where appropriate: fixed intro is not sent for rewrite, locked intro sentences are preserved for narration scripts, outro CTA is appended after cover metadata, and target-length repair keeps product/promotion context.
- Product prompting carries useful typed fields and aliases such as `category/cat`、`keyword/kw`、`audience`、`persons`、`era`、`price`、`url`、`note`、`sellPoint/sellpt`, while local path fields such as `coverPath` and `materialFolder` are omitted from prompts.
- Person assets are stored under `appDataDir/person-assets/<person>/`; accepted file types are `.jpg`、`.jpeg`、`.png`、`.webp`.
- Local material Step 4 copies person images to `taskDir/images/<sceneId><ext>`, cycles available images across scenes, writes `04-local-meta.json`, and skips AI image generation for `materialSource = local`.
- Electron APIs now expose local book selection and person asset operations through preload/main IPC.
- UI now includes `选品助手`、`对标导入`、`人物素材库`, plus new task controls for `文案把控` and `素材来源`.

## Safety And Scope Notes

- The migration intentionally keeps all benchmark and selection behavior local. No private Storybound remote benchmark endpoints were implemented.
- Credit refund/server ledger behavior remains out of scope.
- Local materials currently copy original images rather than crop or auto-retouch them. This keeps the first version dependency-free and auditable.
- The new UI preflights local-person tasks so empty or missing person libraries are caught before running the expensive pipeline.

---

# 2026-07-31 Storyboard Response Compatibility Findings

- 实际失败响应是合法 JSON，但顶层字段为 `tail anchor`，值是按顺序排列的中文旁白句数组；当前解析器只接受 `scenes`，因此未尝试恢复。
- 需要区分“可恢复的句子数组”和“无法验证的任意对象”，避免为了兼容而吞掉真正的模型格式错误。
- `src/shared/runner.ts` 已包含 tail-anchor 到 `StoryboardScene[]` 的恢复路径；故障点很可能是顶层键名别名未覆盖单数带空格形式 `tail anchor`。
- 现有测试已覆盖 `storyboard` 包装和字符串化 `scenes`，需要把用户这次的原始形状加入同一层 runner 回归测试。
- `extractStoryboardTailAnchors()` 当前白名单包含 `anchors`、`tailAnchors`、`tail_anchors` 等，但不包含模型实际使用的 `tail anchor`；数组本身以及恢复、顺序匹配、全文覆盖校验均已实现。
- 因为后续恢复会逐个锚点匹配改写稿并验证拼接后全文一致，增加这个明确别名不会放宽场景内容正确性。
- Step 2 提示词明确要求直接输出 JSON 字符串数组，并明确禁止 `scenes/storyboard/sentences` 对象键；模型仍自行包装成了语义相同的 `tail anchor`。因此提示词本身无需改成对象格式，解析层应兼容这类常见包装偏差。
- 用户要求扩大兼容面；实现采用键名归一化和受限递归，而不是继续堆叠精确字符串。未知包装只在对象仅有一个字段时兜底，最终仍执行原文顺序命中和全文覆盖检查。
- 全仓唯一失败项 `html-video-cover.test.ts` 使用硬编码 `I:/managed` 作为真实 `mkdir` 目标；当前工作区在 `D:`，该失败与分镜解析改动无调用关系。将隔离重跑并以定向 runner/typecheck/build 作为本修复的主要验证。
- 最终兼容范围包括：直接字符串数组；空格/下划线/连字符和大小写键名；中英文锚点键；字符串化 JSON；`data/result/output/items/list` 等嵌套容器；编号或项目符号纯文本；未知单字段包装。

---

# 2026-07-31 Storyboard Format Failure Recovery Findings

- 新错误不是分镜内容，而是供应商/模型返回的显式错误对象：`{ "error": "strict JSON schema conflict" }`。
- 上轮“未知单字段包装”兜底过宽：`error` 恰好只有一个字段，因此其字符串值被解析为单个尾部锚点，掩盖了真正的协议冲突。
- 已定位两个可读参考前端包：`.reverse/storybound-latest-assets/assets/index-B3u53m9X.js` 和 `.reverse/storybound-e-assets/assets/index-4x08xVVG.js`。
- 两个参考版本都明确要求 Step 2 输出每个分镜的“尾部锚点”，由客户端按锚点从改写稿还原 `cap`；这与本项目当前协议方向一致，差异应在调用重试和失败降级层。
- 最新参考 bundle 的 Step 2 主函数是 `qM()`，应用层重试常量 `BM = 3`；每次底层 LLM 调用还传入 `maxRetries: 5`、`temperature: 0.3`、`maxTokens: 32768` 和 `expectArray: true`。
- 每次失败会把错误前 300 字附到下一轮用户提示中；格式、锚点命中率、全文覆盖和建议数量都分别产生可执行反馈。
- 参考版兼容旧对象数组 `{ id, cap }`。字符串锚点中，匹配率低于 70% 会重试；匹配达到阈值后继续检查全文覆盖和数量范围。
- 3 次后若至少得到过一个可解析候选，会保存最后候选并显示覆盖/数量警告；若始终没有可解析候选，则抛出 `Step 2 分句失败`。
- 本地 `Nj()` 按双换行、单换行、句末标点拆分，只在 `skipSentencing`（直接模式）启用，不是普通格式错误的自动兜底。
- 本项目 `createOpenAiCompatibleJsonLlm()` 当前固定发送 `response_format: { type: "json_object" }`，而 Step 2 明确要求顶层 JSON 数组；这是实际 `strict JSON schema conflict` 的协议根因。
- Anthropic JSON 路径在未提供专用 schema 时也固定使用顶层 object 工具，因此 Step 2 的数组协议同样需要一个不启用 object 强制格式的 JSON-value 模式。
- 正确修复应让 LLM 请求声明预期根类型：对象任务维持当前结构化输出；数组任务关闭 OpenAI `json_object` 和 Anthropic object tool，但仍用现有 JSON 内容解析器校验返回。
- `LlmJsonStepRequest` 和 `BaseLlmJsonRequest` 当前没有根类型字段；`runLlmJson()` 也只透传 step/name/messages/signal。需要在共享请求契约上新增数组根声明，才能同时修正 OpenAI 与 Anthropic。
- 网络层已有传输错误重试，但它只针对 HTTP 瞬态状态码；HTTP 200 内的 `{ error: ... }` 属于内容级失败，必须由 Step 2 的三轮反馈循环处理。
- 现有 runner 测试把 Step 2 第一次 provider 异常视为立即暂停；移植参考版三轮内容重试后，该用例必须改为连续三次失败才进入暂停，第二次任务运行再恢复。
- 现有尾部锚点端到端测试可直接扩展断言 `jsonRoot = array`；另需新增错误对象首次返回、第二次返回有效锚点的反馈重试用例。
- 最终差异审查确认数组根模式只用于 Step 2 初次分镜和目标数量修复；其他 review/rewrite/cover/image-prompt 对象任务仍保留原有结构化对象模式。
- 还需收口两个边界：嵌套 provider 错误对象应被识别；错误值序列化为 `undefined` 时不能在诊断代码里再次抛错。
- `.reverse/storybound-latest-assets/manifest.json` 与 E 盘提取资产清单都记录了 `/assets/index-B3u53m9X.js`，当前分析的 Step 2 bundle 有双重提取记录支持。
- 当前 `E:\Storybound\storybound.exe`：71,734,784 字节，修改时间 2026-07-08 19:38:22，File/Product Version 均为 `0.1.0`，SHA-256 `211265313C9CA9F2A66D54B8C23CAEC87F77D210D888DA4B6F00DB35CE391463`。
- 该哈希与 2026-06-24 旧审计的 `9BDC...DEA8` 不同，证明本轮确实分析了更新后的安装包资产。
- 最终验证通过：provider 23/23、runner 72/72、合计 95/95，另通过 typecheck、build、Electron smoke 和 `git diff --check`。

---

# 2026-08-01 Settings Save Recovery Findings

- 正式 `config.json`、SQLite 配置和规范化后的配置均通过 `app:save-config` IPC 输入校验。
- 配置服务在正式数据库副本上可完整完成密钥规范化、SQLite 更新和 JSON 写入。
- 使用 StoryDream 实际 `userData` 身份时，Electron `safeStorage` 可解密当前 8 个密钥槽并完成加解密往返；密钥库未损坏。
- 在隔离的正式数据副本中，真实设置页修改普通字段和 API Key 后均显示 `[pass] 配置已保存`，重新读取确认两者都已持久化。
- 设置页的 `commitAndApplySettingsDraft()` 原来复用 `settingsAction`；模型列表、诊断或其他设置操作占用该动作时，`run()` 会以 `busy` 返回，保存调用被静默跳过，而保存按钮仍可点击。
- 保存现已使用独立 `saveAction`，不会再被无关设置操作拦截；重复保存会显示明确的忙碌提示。
- Electron 冒烟握手现在必须真实执行一次 `saveConfig` 和一次 `saveUiPreferences` 才算 preload 动作成功。

---

# 2026-08-01 Storybound HTML Animation Full Parity Findings

- 用户截图中的任务处于 Step 4：顶部显示 `5 / 7 当前步骤`，右侧图片列表显示 `9 / 30 已生成`，但中央预览画布只显示占位图标，证明“生成状态”与“可解析预览素材”已分离。
- 当前预览叠加的是固定的“人物故事 · 第 1 幕 / 武则天回宫 / 场景 09/30”样式；用户明确要求由任务草稿模板决定位置、字体和内容。
- HTML 动画目标不是普通视频流水线的一个样式，而是 Storybound 独立的六步创作工作台与专用渲染/导出链路。
- 当前普通任务主预览位于 `TaskArtifactPreview.tsx` 顶部区域；它用 `imageAssets.length` 推导当前场景和列表完成状态，没有按 `sceneId` 判断每个场景是否已有素材。
- 同文件后半段的图片卡片已经实现 `api.readLocalImage(path)`，但顶部主画布没有复用该路径解析结果，因此会出现“右侧已生成、中央仍为空”。
- 当前主画布的标题、副标题和场景计数是普通任务固定展示结构，尚未读取 `DraftTemplate` 的 canvas/title/subtitle/caption/disclaimer 几何与字体字段。
- 仓库已经有较完整的专用 HTML 动画模块：`HtmlVideoPage`、`HtmlVideoAuthoringWorkspace`、`html-video-runner`、`html-video-runtime`、`html-video-renderer`、`html-video.ts`；问题更像参考程序行为/页面未完全对齐，而不是从零缺失。
- `html-video.ts` 已能把草稿模板转换为 HTML 布局并生成图片区域与动画时间线；需要核对页面是否传入正确模板、素材是否映射到每个场景，以及现有 UI 是否暴露了参考程序完整控制面。
- 普通任务顶部 `task-media-canvas` 只渲染固定的标题、摘要、计数和进度条，完全没有 `<img>`、素材 URL 状态或 `readAssetDataUrl()` 调用；这就是右侧已有图片但中央画布空白的直接原因。
- 同一组件的 `ImageGenerationGallery` 已按 `sceneId` 建立素材映射并通过 `api.readAssetDataUrl(asset.path)` 读取本地图片；主画布应复用同一资产协议，并按当前选中场景解析，而不是再维护第二套路径转换。
- 右侧场景状态当前以 `index < imageAssets.length` 判断，遇到跳号生成、单场景重生成或部分失败时会把错误场景标成完成；状态和计数都必须改为按 `sceneId` 查找实际资产。
- `ArtifactPreviewContent` 当前只接收 `task/config/snapshot`，没有接收 `DraftTemplate`；虽然 `Task.templateId` 已持久化，页面还需要从全局 `state.draftTemplates` 解析并传入对应模板。
- 草稿模板编辑器已有 `DraftTemplatePreview`，其 `draftLayerPositionStyle()` 使用 `left=((x+1)/2)*100%`、`top=((y+1)/2)*100%` 和中心平移，且已实现文字描边、透明度、对齐、字距/行距、字幕背景、图片区域和画框；普通任务无需另造坐标转换器。
- 剪映草稿导出在 `resolveOverlayText()` 中以 `cover.title -> task.title -> template.title.text` 解析主标题，以 `cover.subtitle` 多行 -> `cover.summary` -> `template.subtitle.text` 解析副标题；任务预览已按同一优先级实现，场景 `cap` 作为当前字幕。
- 普通任务主预览第一版修复已实现：任务模板传参、真实图片 data URL、当前场景切换、模板文字层、`sceneId` 状态映射和增量素材刷新；类型检查通过，新增纯模型测试通过。
- 实际启动参考程序后确认原 `E:\Storybound\storybound.exe` 仍是 UI `v1.12.0`，并收到 `1.17.0` 官方更新；已通过程序内更新器升级并重启到 `v1.17.0`。新版 exe 为 82,576,896 字节，SHA-256 `437B489473C1A6A0004CD9279F20846C055F9462BCB23A59048E86F4F87723B0`。
- Storybound 1.17 HTML 动画任务详情是固定双栏：左侧 320px 任务摘要和 6 步状态轨，右侧顶部 6 个内容标签（文案、素材、配音、动画预览、封面、出片），不是普通任务详情页的复用皮肤。
- 参考任务六步严格为：改写+分句、场景规划、素材（图片）、配音、动画预览、出片；步骤 2/3 可从头重跑，图片可重出，配音可重配，成片可重出，并复用前置产物。
- 文案页每场景持久化：原旁白、动态版式模板、可隐藏/编辑的大标题、可单独编辑但不重配音的字幕分段、背景提示词、0..N 个前景提示词。
- 素材页按场景显示 1 张背景和 0..N 张透明前景；每个素材具备放大、重画、编辑提示词、本地替换，前景另有去背景、显隐和删除；支持补空槽及全部前景批量去背景。
- 配音页允许在豆包/MiniMax、1.0/2.0、音色间切换，并对每个场景独立试听、显示秒数和重配。
- 动画预览使用 `iframe srcDoc` 加载每场景完整 HTML，父子窗口通过 `postMessage` 的 play/pause/seek/restart 与 `hvtick` 同步；预览手机框与输出逐帧截图使用同一 HTML，符合“所见即所得”。
- 实际播放场景 HTML 包含固定画布 `.scene`、背景 Ken Burns、shade/deco 层、独立标题层、0..N 前景图层、按时间逐条出现的字幕层；运行态示例标题 108px、字幕 58px，并根据 iframe 视口缩放整个固定画布。
- 出片端逐帧 `eval_in_window` seek GSAP 时间线、`capture_webview_by_label` 截图，再调用 `draft-generator` 的 `compose_render`；参数包含场景帧、配音、转场、BGM、画布尺寸和可选封面，最终生成 mp4。
- 1.17 新增的字幕所见即所得逻辑会在 iframe 内用 Canvas 测量 nowrap 字幕，超过画面 84% 宽时按比例缩小字号；父页面还提供“重新对齐本场景字幕”走本地 ASR，不重出图、不重配音。
- 新版主 bundle 为 `index-B_XgV9A-.js`，HTML 动画懒加载 chunk 为 `HtmlVideoPage-1jcx2WCs.js`；已通过运行中 WebView 提取并用 esbuild 展开到 `.reverse/storybound-1.17-assets/` 供字段级分析。

## 2026-08-01 普通任务专项 QA 阻断原因

- `task-detail-operations-desktop` 的 ready 条件错误地要求 `.task-media-progress` 包含 `8 / 12`。
- 当前组件中 `.task-media-progress` 的语义是“当前场景 / 场景总数”，首场景正确显示 `01 / 12`；已生成数量位于 `.task-scene-rail`，显示 `8 / 12 已生成`。
- 因此页面和数据已经就绪，但 QA 条件恒为 false，最终只完成队列、历史两个截图。
- 修复应继续验证场景栏生成数量，并直接检查中央原图和草稿模板画布内的图片已完成解码且 `naturalWidth > 0`，这样才能覆盖用户反馈的两项核心问题。
- 直接 QA 命令启动 `dist-electron`；修改 `electron/*.ts` 后必须先运行 `npm run build`。此前三次重复 2/6 是旧构建造成的，重建后普通任务专项 QA 立即 6/6 通过。
- `task-detail-operations-desktop` 截图中，中央预览已显示模板标题、副标题、图片区域和分区布局；不是旧的固定占位预览。
- QA 报告中 `task-artifact` 与 `draft-canvas` 两个媒体区域均有独立 SHA-256，像素方差分别为 `459.904` 和 `1314.1775`，无媒体失败，证明截图区域非空且模板画布实际参与渲染。
- 当前 QA 任务没有显式设置自定义 `templateId`，真实 Electron 验证仍应加强为非默认模板种子，才能覆盖“所选模板”而不仅是默认模板。
- `FileDatabase` 已提供 `getDraftTemplateDetail()` 和 `upsertDraftTemplate()`；QA 可以克隆内置模板为非默认自定义模板，再通过正常 `createTask({ templateId })` 链路关联，不需要注入数据库旁路。
- 当前 `DraftTemplate` 的标题、副标题、字幕和免责声明结构只有 `fontSize`、颜色、粗体、对齐、字距、行距与描边，没有 `fontFamily`/字体资源字段；现有预览只能还原字号和字形样式，无法声称严格还原模板字体族。需要对照 Storybound/导入模板数据确认字段并贯通预览与导出。
- 最新 Storybound 1.17 bundle 中没有发现普通草稿模板的 `fontName`/`font_family`/`fontId` 数据字段；`fontFamily` 仅用于渲染样式，HTML 动画明确固定为 `"Microsoft YaHei","PingFang SC",sans-serif`。兼容实现应统一预览与导出的中文字体回退栈，并严格还原现有模板的字号、粗细、描边、颜色和位置，不虚构参考程序没有的字体选择字段。
- 显式自定义模板实机 QA 揭露了真实业务缺陷：DOM 上 `data-draft-template-id="qa-selected-draft-template"` 正确，但渲染参数仍是默认模板（图片 `top=0%/height=100%`、标题 `25px/#FFDE00`、默认副标题），而种子模板要求 `22%/44%`、`31px/#38F2B0`。说明任务 ID 映射成功，但详情模板没有进入预览，必须修复模板详情加载/缓存链路。
- `TaskDetailPage` 懒加载真实模板后，实机诊断已变为正确的 `22%/44%`、`31px/#38F2B0`，字体栈和图片解码也正确。
- 当前唯一剩余内容错误来自 `resolveTaskPreviewContent()`：任务没有 cover 元数据时，副标题回退到模板占位文案“副标题示例文字”，而当前场景文案只用于字幕。任务预览不应泄露模板编辑占位文案；cover 摘要缺失时应以当前场景文案作为副标题回退。
- 修复内容回退后，自定义模板普通任务专项 Electron QA 6/6 通过。最终截图显示 4:3 图片框位于自定义 `22%/44%` 区域、绿色边框、31px 绿色标题、当前场景副标题/字幕和已解码生成图。
- 最终报告中 `task-artifact`/`draft-canvas` 像素方差为 `514.9297`/`1690.3416`；runtime console/page/render errors、媒体失败和文字对比度失败均为 0。
- `tests/electron-smoke-contract.test.ts` 两个失败均为静态源码契约滞后：设置握手已从单个 `saved` 扩展为 `savedConfig` + `savedPreferences` 双保存校验；HTML 预览已从旧 `.hv-media-item` 迁移到 `.hv-reference-thumb` + `.hv-reference-phone iframe`。测试应跟随现行且更严格的真实行为。

## 2026-08-01 HTML 动画浅色底栏

- `theme-light.png` 实际是设置页截图，既有 HTML UI QA 没有在浅色主题下打开完成任务的“出片”标签，因此没有覆盖用户反馈区域。
- 有任务的 Storybound 1.17 面板使用 `--shell-text` / `--shell-muted`，但父级 `.hv-studio-media-canvas` 与 `.hv-video-output` 仍固定使用深色 `--media-bg` / `--media-surface`。
- `.hv-output-path code` 还显式使用 `--text`；浅色主题中它等于 `#15171a`，叠在深色 `--media-surface: #181c20` 上几乎不可见，这是输出路径消失的直接原因。
- 可视编排底部 `.hv-authoring-statusbar` 虽使用可读的媒体色，但只有 `9px` 和 `24px` 行高，实际截图中过小；应提高到稳定的实用字号和高度。
- 整页 Editorial QA 进一步发现 `.hv-studio .hv-tab-content small` 的旧媒体色规则优先级高于 `.hv-reference-scene-strip small`，导致浅色场景卡的时长文字仍只有 `1.84:1` 到 `2.05:1`；需要在有任务作用域统一覆盖 `small/figcaption`。
- Editorial QA 的布局判定仍假设旧版三栏或紧凑纵向堆叠；当前 1.17 页面在桌面和 1080px 紧凑视口均为左侧参数+步骤、右侧画布的双栏结构，验收逻辑需要按三个区域的真实坐标识别。
- 最终 Editorial QA 两个浅色视口均通过，整页文字对比度、媒体、交互重叠和控件裁切失败均为 0；证据保存在 `.artifacts/html-video-light-editorial/`。
- 最终完整 HTML 视频 UI QA 通过，浅色出片标题/元数据/路径标签/路径分别为 `17.96:1`、`5.62:1`、`5.62:1`、`17.96:1`。

## 2026-08-01 配置与 HTML 动画复核

- 实际配置目录为 `C:\Users\Administrator\AppData\Roaming\storydream\storydream`，`config-secrets.v1.migrated` 已存在；重启时 SQLite 必须为唯一事实来源，`config.json` 仅由 SQLite 回写。
- 加密密钥不会回传 renderer。设置页只投影非秘密占位值 `configured` 做校验；此前仅把档案内的 TTS 密钥投影回档案，没有同步到活动运行时 `tts` 字段，导致火山 V3 显示“已配置”但侧栏仍为“待配置”。
- 真实 HTML 任务 `a29e622b-835f-43a0-a019-5f693c9c1be4` 是旧逻辑失败快照：重写完成、规划失败、没有场景，持久化错误仅为 `HTML video planning step failed.`，因此无法从该旧事件恢复供应商细节。
- 新规划逻辑会先以结构化 JSON 调用；识别到 `strict JSON schema conflict`、`response_format`、空/错误 JSON 时无约束重试，再失败则使用本地确定性分镜并写入流水线提示。网络和鉴权失败仍正常中断，不会伪装为成功。
- 失败任务的文案、素材、配音、动画预览、封面和出片标签现在共享一个可重试阻断面板，不再显示不可编辑的下游空壳。

## 2026-08-01 HTML 动画两阶段入口

- Storybound 1.17 在无任务 ID 时显示独立 `hv-config` 创作页，只有创建任务或选择历史任务后才进入 pipeline；当前实现已按该状态机拆分。
- 创作页和工作区必须拥有不同状态，不能通过 CSS 隐藏同一份表单，否则首次导航、历史任务切换和返回新建容易互相污染。
- `storydream-media:` iframe 与 `file:` renderer 不同源，HyperFrames Player 无法靠同源 probe 读取 `window.__timelines`；场景必须主动发送带协议元数据的 `source: 'hf-preview'`、`ready` 和 `timeline` 消息。
- 标准 runtime 消息加入后，桌面与紧凑视口的两次可视编排均为 `ready=true`，可信协议 URL、四个检查面板、T0/T1/T20/T21 轨道和官方 lint 全部通过。

## 2026-08-01 网页搜索 `fetch failed`

- 当前代理启用了 Fake-IP：`cn.bing.com`、`www.bing.com`、`www.sogou.com` 和 `ai.input.im` 都被解析到 `198.18.0.0/15`。
- Node 网络本身可访问这些站点；失败来自 `network-policy.ts` 把该基准测试网段统一当作保留地址拦截，Undici 再把真实 `NETWORK_ADDRESS_BLOCKED` 包成无细节的 `TypeError: fetch failed`。
- 安全兼容只允许“域名经 DNS 解析到 Fake-IP”；URL 直接填写 `198.18.x.x`、私网、回环和其他保留地址仍然拦截。
- `fetchWithNetworkPolicy()` 现在会展开 Undici 的 cause 链，搜索 IPC 会把网络策略、超时和普通连接失败转换成可执行的中文提示。
- 真实搜索“李明博”返回百度百科和知乎等候选；`ai.input.im/v1/models` 返回服务端 `401`，证明 provider 请求也已穿过本地网络策略。

## 2026-08-01 自定义模板删除与任务详情错行

- 草稿模板此前只有编辑、复制与新增链路，没有删除 API；完整删除必须同时更新持久层、IPC 契约、preload、renderer API 和前端增量状态，不能只从卡片列表临时移除。
- `isDefault` 是系统模板的保护边界：前端隐藏删除按钮用于减少误操作，数据库层再次拒绝删除用于防止绕过 UI。
- 用户截图中的“错行”来自 `.task-detail-identity` 与 `.task-detail-actions` 都使用较大的可增长 flex basis；侧栏占用宽度后，内容区不足以容纳两组，父容器的 `flex-wrap: wrap` 把操作区推到下一行。
- 状态徽标中的 `5/7` 与右侧“当前步骤”语义重复，使标题栏更宽且信息噪声更大；徽标应只表达运行状态。
- 修复后桌面标题栏使用 `nowrap`，identity 为 `flex: 1 1 380px`，actions 为 `flex: 0 1 auto` 且内部不换行；1180px 以下仍进入已有紧凑布局。
- Electron 专项截图确认总耗时、当前步骤、事件与操作按钮处于同一水平行；自动证据记录 0 个交互重叠、0 个主控件裁切。

## 2026-08-01 任务详情草稿模板切换

- 任务详情过去只按 `task.templateId` 加载预览，没有修改入口；用户一旦发现版式不合适，只能离开任务重建，且已有图片与配音无法复用。
- 模板选择应分为“候选预览”和“确认应用”两个状态：下拉切换立即刷新画布，但不在误触时写库；显式点击“应用模板”后才更新任务。
- 模板更新必须与暂停、重试等流水线动作使用独立 busy 状态，否则一个非阻塞的版式选择会错误禁用任务控制。
- 已完成任务的图片、配音和分镜与草稿版式无关；更换模板后从第 6 步 `regenerate` 足够，重跑前置步骤会浪费额度并改变已有素材。
- runner 启动时持有任务快照，运行中修改模板后若不在 Step 6 再读数据库，导出仍会使用旧模板；导出前刷新 `templateId` 是运行中切换生效的关键。
- 最终 Electron 截图显示标签、模板选择器、应用按钮和管理图标保持同一基线；1180px 以下按工具条分行，不压缩中央画布。

## 2026-08-01 草稿模板卡片操作区错位

- 页面使用 React 与 Lucide，但卡片操作区沿用了全局可换行 `.row-actions`，同时给删除按钮叠加了 `icon-button` 与 `danger-action` 两套尺寸规则；框架不会自动消解这种局部 CSS 冲突。
- 自定义模板比系统模板多一个操作，稳定布局应由卡片专用网格表达按钮数量，而不是依赖 flex 内容宽度自然排列。
- 图标删除按钮虽然有无障碍名称，但在编辑、复制两个文字按钮旁视觉权重过轻，容易被理解为脱离操作组；显示“删除”后命令含义和按钮轮廓都更一致。
- Electron 几何验收确认自定义模板三按钮宽度、顶边和底边误差均小于等于 1px，四种主题/窗口组合均无交互重叠、文字裁切或对比度失败。

## 2026-08-01 草稿模板原生下拉白底

- Windows 原生 `select` 的展开弹层由系统绘制，Electron 页面 CSS 只能有限影响关闭状态，深色应用中仍可能出现白底和不可读文字。
- 该控件需要应用内 listbox 才能稳定继承 `--shell-surface`、`--shell-text`、`--shell-muted` 与主题强调色，同时维持跨系统一致的几何尺寸。
- 自定义实现不能只覆盖鼠标点击；方向键、Home/End、Enter/Space、Esc、Tab、焦点恢复和点击外部关闭都属于选择器的基本交互契约。
- Electron 深色截图中的菜单背景与灰色字段背景一致，自动读取结果非 `rgb(255, 255, 255)`，且菜单未越出窗口或遮挡后续操作。

## 2026-08-01 人物故事封面标题语义

- 当前人物故事模板并非偶发生成错误：`storybound-system-templates.ts` 的旧规则明确要求 `title` 为“主角人物名字”，示例也使用“启功 / 盛恩颐 / 苏轼”；这与草稿模板顶部主标题应承担点击钩子的产品语义冲突。
- `cover.title` 与 `cover.subtitle` 是同一数据源：任务详情预览由 `resolveTaskPreviewContent()` 读取，剪映导出由 runner 传给 `writeJianyingDraft()`，因此只改 UI 会造成预览与成片不一致。
- 现有 `normalizeCover()` 只检查标题非空，不判断它是否只是姓名；本地 `buildCoverMetadata()` 也把武则天兜底标题硬编码为“武则天”。
- 兼容策略限定在 `character-story`：若标题是 2-6 字的纯人物身份且同时出现在正文和标签中，则提升第一条反差副标题为主标题，剩余副标题继续放在第二层；没有可用副标题时从正文的数字、反差和结果短句中确定性提取。
- “民间故事”等轨道存在固定栏目标题约束，不应被人物故事的修复规则改写。

## 2026-08-01 任务已应用模板持久化

- `TaskDetailPage` 已有候选状态 `templateSelectionId` 和任务持久化字段 `task.templateId`，但候选解析在二者均不在模板摘要列表时会退到 `state.draftTemplates[0].id`。
- 该回退把“保存模板缺失”伪装成“用户选择了默认模板”，因此按钮会在未发生用户选择时进入珊瑚色可应用状态，预览也会切到列表第一项。
- 正确语义是：`task.templateId` 始终代表已应用模板；`templateSelectionId` 只代表本页候选。候选只能由任务加载同步或用户选择产生，不能由列表排序/回退产生。
- 深色主题的 `--shell-focus-contrast` 为黑色，但浅色主题中它是白色；用户要求珊瑚色“应用模板”按钮在所有主题均使用黑色，因此需要按钮专属前景令牌或显式深色值，不能继续复用通用 focus contrast。

## 2026-08-01 去 AI 味 Skill GitHub 检索

- 用户清单去重后初步得到 22 个名称：humanizer、Humanizer-zh、stop-slop、taste-skill、ai-flavor-remover、shuorenhua、nuwa-skill、writing-agent、chatgpt-comparison-detection、De-AI-Prompt-Enhancer、AIGC_text_detector、openai-detector、stop-slop-zh、WRITING.md、humanize-mba-text-skill、qu-ai-wei、anti-slop-writing、humanize-text、writing-style-skill、agent-style、oh-story-claudecode、AIWriteX。
- 第一轮 GitHub/web 精确命中：blader/humanizer、op7418/Humanizer-zh、hardikpandya/stop-slop、Leonxlnx/taste-skill、hylarucoder/ai-flavor-remover、MrGeDiao/shuorenhua、alchaincyf/nuwa-skill、Hello-SimpleAI/chatgpt-comparison-detection、OUBIGFA/De-AI-Prompt-Enhancer-Writer-Booster-SKILL、YuchuanTian/AIGC_text_detector、promptslab/openai-detector、pencil20388-eng/stop-slop-zh、Anbeeld/WRITING.md、stephenlzc/humanize-mba-text-skill、LifelongLazyLearner/qu-ai-wei。
- `WRITING.md` 是高冲突关键词，必须用仓库名 `Anbeeld/WRITING.md` 或加 `"Humanizer"`、`llm-writing` 等限定词搜索。
- `stop-slop-zh`、`shuorenhua`、`humanizer-zh` 有多个派生/同名中文仓库，最终表格应优先标明“精确仓库 + 可能有分叉/变体”。
- 第二轮补查确认：stephenlzc/humanize-mba-text-skill、coderjatin/anti-slop-writing、adewale/anti-slop-writing、lynote-ai/humanize-text、jzOcb/writing-style-skill、yzhao062/agent-style、worldwonderer/oh-story-claudecode、iniwap/AIWriteX 均可打开。
- `anti-slop-writing` 存在至少两个明显相关仓库：coderjatin 版本更像通用 system prompt；adewale 版本更像 Agent Skill。
- `humanize-text` 也属于宽泛名称；当前与文章“开源 AI 文本人性化改写”最贴的是 lynote-ai/humanize-text。
- `openai-detector` 的 GitHub 仓库可搜到，但官方 OpenAI AI classifier 已在 2023-07-20 因准确率低下线，最终输出必须提示其可用性/可信度风险。
- `git ls-remote` 对 GitHub 仓库做批量可达性检查时出现大量假阴性，仅 `op7418/Humanizer-zh` 返回 OK；由于此前 GitHub API/web 页面能返回同一批仓库，最终不采用该命令作为是否存在的判据。
- 改用普通 GitHub 页面请求全量核验，22 个候选仓库页面全部返回 HTTP 200，可作为“GitHub 可打开/可检索”的最终依据。
- 真实数据库中最新“李明博”任务保存的模板为 `25e35765-4a84-4726-8ade-83e3e48c9db3`（名称“新模板”），截图显示的“标准模板”是当前页面候选，尚未写入任务；修复不能擅自修改这条用户数据。
- 新的选择解析器保留 `appliedTemplateId` 与 `candidateTemplateId` 两个独立值；模板列表重排、任务刷新或已应用模板缺失都不会把第一项写成候选。

## 2026-08-01 最终封面元数据与双层字幕拆分

- Storybound 1.17 在 Step 1 选出最终改写稿后调用封面生成；若用户在审核点编辑正文，它会针对编辑后的全文重新生成封面元数据，然后才交给分镜阶段。
- Storybound 的分镜 `cap` 是画面级旁白：第一句单独成镜，后续每镜 1-3 句，推荐 25-45 字、极限 55 字，小于 15 字优先与相邻同画面合并；全文必须逐字覆盖。
- Storybound 另有独立字幕断行阶段：默认每行 12 字，6-24 可配置；在自然语义/配音停顿处拆分，禁止拆开人名、地名、年份、专有名词，禁止“的”字开行，删除标点后逐字校验无增删改。
- 当前 StoryDream 的 `buildSubtitleTrack()` 直接把每个 `scene.cap` 写成一条 cue，没有 Storybound 的第二层短行产物，因此 25-55 字的正常分镜会显示为过长字幕。

## 2026-08-01 人名关键词搜索偏移

- 截图中“李在明”请求已成功取回 10 条候选，但可见结果集中在“李姓起源/李氏帝王”，表现为语义偏移而非网络失败。
- 页面文案显示“已获取前 10 条网页资料”，说明候选展示很可能直接采用搜索源顺序，需查是否缺少完整人名命中过滤或重排。
- 共享搜索实现已有 `rankSearchItems()` 和 `relevanceScore()`；因此需重点查 `buildStrongSearchTerms()` 是否把三字人名拆成过宽的单字/子串，以及无强命中时的过滤回退。
- Bing 请求会经过 `normalizeStoryboundSearchQuery()`，搜狗请求直接使用输入关键词；两路行为并不一致。
- `NewTaskPage.searchWebSources()` 只对输入执行 `trim()`，Electron IPC 处理也只执行 `trim()`；“李在明”在前端和 IPC 层没有被分词或改写。
- `normalizeStoryboundSearchQuery()` 只会去掉末尾的“故事/生平/简介/资料/介绍/经历/传记/传奇/一生/事迹/信息”，对纯人名“李在明”不做修改。
- `searchWebSources()` 合并 Bing 与搜狗候选后先本地排序，再取前 10 条抓取正文；前端只再次截断 10 条，不改变排序。
- `buildStrongSearchTerms('李在明')` 只会产生完整词“李在明”，不会产生单字“李”或双字子串；截图现象不是当前词项生成器直接分词造成。
- 对中文查询，只要任一候选的标题/URL/搜索摘要含完整查询，`rankSearchItems()` 就会过滤所有相关度为 0 的候选。因此需用当前源码实搜，区分运行构建滞后和搜索摘要伪命中。
- `shouldSearchAdditionalChineseSources()` 目前在文件内无调用点，不参与截图中的实际搜索链路。
- 用当前 `src/shared/research.ts` 真实联网执行 `searchWebSources('李在明')`，返回 10 条与人物直接相关的候选：百度百科、访华百科事件、知乎人物评价/简介、快懂百科、搜狐人物报道、中新网、观察者网和搜狗相关资讯。
- 当前源码的真实返回中没有“李姓起源/李氏帝王”页面；截图与当前源码不一致，下一优先级是确认正式应用是否还在运行旧 `dist-electron` 或页面是否保留了旧搜索上下文。
- 正在运行的 Electron 根进程为 PID `27376`，启动时间 `2026-08-01 22:55:08`，命令行直接指向 `D:\opc\novel-write`；`dist-electron/electron/main.js` 同一时间构建。
- 编译后主进程包含与源码一致的 `normalizeStoryboundSearchQuery()`、`rankSearchItems()` 和 `buildStrongSearchTerms()`；当前运行中应用不是明显的旧构建。
- `git diff` 显示 `research.ts` 未提交变更只是新增网络错误中文化；完整人名相关度过滤已在 Git 基线中，不是本轮临时修复。
- 用户截图文件创建于 `2026-08-01 23:04:50`，明确晚于当前应用构建/启动时间；旧构建不是截图的根因。
- 前端关键词 `onChange` 只调用 `setAiKeyword()`，不会清空或标记 `searchContext` 过期；结果区也不显示 `searchContext.query`。因此输入框可以显示新词，同时继续展示旧查询结果。
- 排序阶段使用搜索引擎摘要 `item.content` 判定命中；入选后又用 `fetchPageText()` 抓取的页面正文覆盖 `content`，UI 优先显示覆盖后的 `content` 而不是当初命中的 `snippet`。如果摘要因站点侧栏/推荐词含“李在明”而伪命中，页面会显示与人物无关的真实文章正文，视觉上就像被拆成了“李”。
- 截图中两条可完整识别的搜狐链接为 `https://www.sohu.com/a/955277310_121708006` 和 `https://www.sohu.com/a/920190542_121422609`。实际请求均返回 200，对应“李姓怎么来/历史上姓李的皇帝”与“近 1 亿人的李姓/建立 9 个王朝”文章；两个 HTML 中“李在明”的出现次数均为 0。
- `useAsyncAction.run()` 在共享动作已繁忙时直接返回 `{ ok: false, reason: 'busy' }`，不抛错也不设置反馈。搜索按钮只根据 `searchingSources` 禁用，没有绑定 `taskAction.busy`；因此和其他动作重叠时，用户点击搜索会被静默丢弃，旧结果保持不变。
- 受控重放已稳定证明摘要伪命中：构造标题为“原创‘李’姓是怎么来的”、正文只讲李姓的候选，仅在搜索摘要末尾加“热门推荐：李在明新闻”；现有 `searchWebSources('李在明')` 会把它与真正的人物百科一起返回，而 UI 最终显示不含人名的李姓正文。
- 根因由两个缺口叠加：搜索质量层把“完整人名出现在摘要任意位置”当成有效命中，抓取正文后不二次验证；页面状态层又没有把结果与 `searchContext.query` 显式绑定，关键词变更或忙碌点击丢失后仍显示旧结果。
- 最小修复点：对纯人名/中文主题优先要求标题命中，或在抓取后的标题+正文中再次命中完整主体；关键词变更时清空/标记旧结果，结果标题显示实际查询，搜索使用独立动作状态。

## 2026-08-02 多渠道精准网页检索

- 用户明确要求不受控的泛搜索改为可控的精准信息源，期望必应、百度、头条等渠道都可明确识别与管理。
- 实现不能只在现有 Bing+搜狗合并后加一道过滤；需要渠道级适配与状态，再在统一聚合层执行完整主题校验、去重和质量排序。
- 当前 `AiSourceSection.source` 只是任意字符串，网页搜索统一写成 `web`，没有必应/搜狗等渠道归属；`AiSourceContext` 也只有 `query/sections/warnings`，无渠道状态。
- 当前 `searchWebSources()` 只并发 `searchBingHtml()` 和 `searchSogouHtml()`，合并后统一取前 10 条；直接百度与头条检索并未实现。
- 渠道元数据应作为 `AiSourceSection` 的可选增量字段，保留 `source: 'web'` 供现有流水线分类，这样历史任务和已选素材无需迁移。
- 真实请求 `https://www.baidu.com/s?wd=李在明` 返回 200，UTF-8 HTML 约 1.31 MB，可读取到“李在明 - 百度百科”等 `<h3>` 标题；当前网络策略 2 MB 上限可承载。
- 真实请求 `https://so.toutiao.com/search?keyword=李在明&pd=information&source=input` 返回 200，HTML 约 1.40 MB，查询词可见但无普通 `<h3>` 结果，需解析页面内嵌数据，不能复用 Bing/搜狗 HTML 解析器。
- `research:web-search` IPC 当前只接收非空字符串，preload/StoryDream API 也只接收 `query: string`；要支持用户可控渠道，需扩展为有界的 `{ query, providers }` 请求，并保留旧字符串 IPC 输入兼容。
- 头条服务端 HTML 中可见结构化的 `article_url`、`emphasized.title`、`emphasized.summary`、`is_title_full_matched`、`publish_time`等字段，链接为 `https://toutiao.com/group/<id>/...`；可以从公开搜索页服务端数据恢复头条候选，无需调用私有接口。
- 百度真实页面的标题链接为 `<h3>...<a href="http://www.baidu.com/link?url=...">`，标题内用 `<em>` 标注查询词；解析器可从 `h3` 块提取标题与跳转链接，再依靠受限重定向抓取真正正文。
- 旧 `research.test.ts` 用例对“默认只请求 Bing+搜狗”有明确断言。向后兼容策略为：底层 `searchWebSources(query, fetchImpl)` 的旧调用保留原默认，页面通过新请求显式选择百度/头条等渠道。
- 头条每条结果位于独立 `<script data-for="ala-data">`，脚本主体以 `window.T && T.flow({ data: {...} })` 开始，`data` 后是合法纯 JSON 对象。可用考虑字符串转义的平衡花括号扫描取出对象并 `JSON.parse`，不执行任何第三方 JavaScript。
- 头条数据存在多种标题/摘要形态：顶层 `title/abstract`、`display.title.text/display.summary.text` 或 `emphasized.title/emphasized.summary`；链接统一可从 `article_url` 取得。
- 精准聚合应在抓取前按“标题完整主题命中”优先排序，抓取后只保留“标题或正文命中完整主体”的页面；这能排除摘要侧栏伪命中，同时保留标题精准但正文用代词叙述的文章。
- 新建任务草稿 `values` 可向后兼容地增加 `webSearchProviders`；恢复时对数组做允许值过滤即可，无需扩展任务数据库字段。
- 页面当前的搜索和生成文案、选文件等操作共用 `taskAction`；多渠道搜索应拆出 `searchAction`，按钮禁用与反馈都绑定该独立状态。
- `ipc-contract.ts` 已有通用有界 Zod 契约与严格对象模式；`research:web-search` 可以用“旧非空字符串 OR 新严格对象”联合 schema 平滑扩展，新对象限制 1-4 个唯一合法 provider。
- `NewTaskPage.tsx` 当前未提交搜索相关变更只是前一轮把“Bing”文案更正为“Bing+搜狗”；本轮应在该基础上扩展，不回退其他页面改动。
- 旧搜索契约冲突已解决：完整用户查询不再删除“生平”等后缀；候选抓取按渠道轮询且总量最多 20，单渠道可提供最终 10 条；可靠百科层级在精准排序中高于百家号等补充来源。
- 桌面 API 当前仍只接受字符串，创作页仍把搜索复用到 `taskAction`，且关键词变化不会清除旧 `searchContext`；这三处是下一阶段的直接修改点。
- IPC 现已兼容旧字符串与新结构化请求；结构化请求强制 1-4 个不重复的 `bing/baidu/sogou/toutiao` 值，并拒绝未知字段。
- 创作页四渠道默认全选并持久化到本地草稿；关键词或渠道变化会递增请求世代、清空旧候选和旧生成文案，迟到的旧响应无法重新写回。
- 搜索使用独立 `searchAction`，不再因创建任务或选文件动作占用 `taskAction` 而静默丢失；结果区显示实际查询、每渠道 ready/empty/failed 状态和单条渠道徽标。
- Electron 实搜暴露搜狗 `/antispider/` 中间页；最终精准层现会拒绝搜狗、百度、必应和头条已知验证页形态，同一渠道标题完全相同的稿源也会在抓取前去重。
- 渠道状态反映当次真实可用性而非承诺固定数量：真实“李在明”验收中必应和头条有结果，百度/搜狗受当次页面形态或反爬影响时显示“无精准结果”，不会混入泛化页面补数。

## 2026-08-02 草稿模板画布与属性面板联动

- 用户截图显示画布已选中“副标题”边框，但右侧顶部仍展示主标题的颜色、透明度、加粗、下划线、字间距等设置；下方“副标题”折叠区没有自动展开或进入视口。
- 正确行为应由画布选择状态驱动对应属性分组展开，并只滚动右侧属性容器，避免整页或画布区域跳动。
- `EditableDraftCanvas` 已经把 `image/title/subtitle/caption/disclaimer` 选择正确回传给页面；缺口在右侧 `Accordion` 只读取一次 `open` 初值，无法由 `selectedLayer` 驱动。
- `.draft-controls` 本身是带 `overflow-y: auto` 的限高滚动容器；通过目标面板与容器的矩形差值更新它的 `scrollTop`，可以避免 `scrollIntoView()` 连带滚动页面祖先。
- Electron 首轮编辑器截图暴露画布选中标签的珊瑚色文字在深色底上仅 `3.87:1`；改用稳定的近白标签文字以达到正文小字的 `4.5:1` 对比度要求。
- 编辑器画布包含主题化选区和 GPU 渐变，深浅主题截图存在大量仅 1 个色阶的像素差；该交互画布继续严格检查尺寸、非空像素和视觉缺陷，但不适用成片媒体的跨主题精确哈希约束。
