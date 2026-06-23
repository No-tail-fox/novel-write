# Findings

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
