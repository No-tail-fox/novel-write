# E:\Storybound Reverse Audit

Date: 2026-06-24

## Scope

- Target: `E:\Storybound`
- Method: read-only static inspection plus local runtime-state/database inspection.
- Boundary: no activation bypass, no license cracking, no usable secret extraction.
- Full prompt dump: `storybound_e_prompt_dump_2026-06-24.json`

## Binary Fingerprint

| File | SHA-256 |
| --- | --- |
| `E:\Storybound\storybound.exe` | `9BDC43B03B49A70968B2F4BD0D1301AAD5C6B62E753DA57EE240B7FD6BCBDEA8` |
| `E:\Storybound\draft-generator.exe` | `CF271ACF6E7FC350A90C5D928CC621FA80BD9709AB7F5A080FFBA2B0427356E1` |

## Install Layout

`E:\Storybound` is a compact binary distribution:

- `storybound.exe` (main desktop app)
- `draft-generator.exe` (media/Jianying sidecar)
- `onnxruntime.dll`
- `onnxruntime_providers_shared.dll`
- `sherpa-onnx-c-api.dll`
- `sherpa-onnx-cxx-api.dll`
- `uninstall.exe`
- `resources/default-bgm.mp3`

No loose source tree, `app.asar`, or plain prompt/config files are present in the install directory.

## Runtime Data

Runtime directory:

- `C:\Users\Administrator\AppData\Local\com.dudumd.storybound`

Observed files/directories:

- `config.json`
- `data.db`
- `bgm/`
- `tasks/`
- `EBWebView/`

The roaming path exists but did not show useful files in this pass.

## Config Summary

`config.json` shows these provider defaults:

- LLM: custom OpenAI-compatible protocol, base URL `https://input.codes`, model `gpt-5.5`.
- Image: `gpt_image`; Jimeng model `jimeng-4.5`; custom image default model `gpt-image-1`.
- TTS: Volcengine default, speaker `zh_male_dongfanghaoran_moon_bigtts`; MiniMax default model `speech-2.8-hd`.
- Jianying draft path: empty.
- IMA knowledge-base fields present.
- UI theme: dark.

Key/session/token fields were empty in this local config or treated as sensitive.

## Prompt Inventory

`data.db` has `user_prompt_templates`, but it currently has `0` rows. That means no local custom prompt rows were present in AppData during this audit.

The recovered system prompt layer contains:

- 9 system task templates.
- 5 global fallback step templates.
- A shared storyboard prompt/rule set.
- A `podcast-cover` cover prompt asset in the cover template layer.

The full prompt text was exported to:

- `storybound_e_prompt_dump_2026-06-24.json`

Prompt dump size: 363,266 bytes.

### System Task Templates

Each system task template carries:

- `step1RewriteSystemPrompt`
- `step1MetadataSystemPrompt`
- shared `storyboard` prompt
- `step3SystemPrompt`

| Template ID | Name | Default Style | Character Policy | Reference Kind | Rewrite | Metadata | Step 3 |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| `character-story` | 人物故事 | `black-white` | force | character | 1,822 | 3,896 | 11,297 |
| `culture-knowledge` | 文化科普 | `ancient-cinematic` | skip | product | 3,747 | 4,523 | 8,950 |
| `ecommerce` | 电商带货 | `realistic` | skip | product | 3,847 | 4,399 | 7,871 |
| `folk-tale` | 民间故事 | `folk-tale-gongbi` | force | character | 4,247 | 7,464 | 13,717 |
| `food-vlog` | 美食探店V2 | `vintage-film` | skip | product | 1,568 | 1,960 | 4,860 |
| `general` | 通用故事 | `realistic` | follow | character | 1,548 | 2,776 | 9,439 |
| `health-book` | 健康图书 | `oil-painting` | skip | product | 4,369 | 4,069 | 8,487 |
| `inspirational` | 心灵鸡汤 | `cinematic` | skip | character | 3,176 | 3,941 | 7,664 |
| `picture-book` | 绘本故事 | `pixar-3d` | force | character | 3,767 | 3,897 | 7,448 |

### Global Fallback Prompts

| ID | Type | Purpose |
| --- | --- | --- |
| `builtin-review` | review | Clean source material into a fact brief. |
| `builtin-rewrite` | rewrite | Generic rewrite fallback. |
| `builtin-cover` | cover | Generic cover/title/summary/tags/comments fallback. |
| `builtin-storyboard` | storyboard | Tail-anchor based storyboard splitting. |
| `builtin-image-prompt` | image-prompt | Generic image prompt generation fallback. |

## Observed Pipeline Logic

The local `data.db.task_events` confirms this actual task flow:

1. Template selection: `character-story (system)`.
2. Step 0: pre-review and source cleanup.
3. Step 1: standard rewrite plus self-evaluation iteration.
4. Step 1 runs three rewrite/self-evaluation rounds, then chooses the best round.
5. Step 1 generates cover title and seed comments.
6. Step 2: storyboard sentence splitting.
7. Step 3: protagonist/character card extraction.
8. Step 3: batched `desc_prompt` generation, e.g. batch 1/2 for scenes 1-12 and batch 2/2 for scenes 13-18.
9. Step 4: batch image generation with credit enforcement.

Observed credit rule from task events:

- Image cost: `0.08` credits per image.
- Example failure: 18 images required 1.44 credits, balance was 0.00.

Observed artifacts:

- `00-reviewed.txt`
- `01-rewritten-copy.md`
- `00-cover-title.json`
- `02-sentences.json`
- image output directory

## Main App Backend Shape

`storybound.exe` string evidence confirms:

- Rust/Tauri 2.x host.
- SQLx/SQLite usage.
- WebView/Tauri IPC bridge.
- ONNX/sherpa local ASR support.
- Update/license/account network support.

Confirmed Tauri command surface:

- System/local: `greet`, `allow_external_path`, `save_secret`, `load_secret`, `delete_secret`, `capture_webview_hwid_fingerprint`, `license_verify`.
- HTTP/download/image proxy: `http_request`, `http_download`, `gpt_image_submit`, `gpt_image_edit`, `gpt_image_poll`, `gpt_image_test`.
- Browser/window/rendering: `capture_webview_by_label`, `capture_webview`, `eval_in_window`.
- Updater/app control: `check_update`, `apply_update`, `launch_program`.
- ASR: `asr_transcribe`.

Observed remote/update strings:

- `https://jihuo.52aibot.com`
- `jihuo.52aibot.com`
- `updates.52aibot.com`
- `/v1/update/check`

## Sidecar Backend Shape

`draft-generator.exe` is a PyInstaller Python 3.11 sidecar.

Recovered package/module evidence:

- `pyJianYingDraft`
- `pyJianYingDraft.script_file`
- `pyJianYingDraft.draft_folder`
- `pyJianYingDraft.text_segment`
- `pyJianYingDraft.video_segment`
- `pyJianYingDraft.jianying_controller`
- `template_jianying/draft_info.json`
- `template_jianying/draft_meta_info.json`
- `template_jianying/draft_cover.jpg`

Recovered sidecar modes:

- `story`
- `music_mv`
- `compose_render`
- `remix_bgm`
- `convert_audio_16k`

Sidecar responsibilities:

- Build Jianying draft folders and metadata.
- Write `draft_info.json` / `draft_meta_info.json`.
- Convert text to subtitle materials.
- Attach images, narration, BGM, title overlays, subtitles.
- Compose frame/audio scene renders into video.
- Remix BGM onto existing source video.
- Convert audio to 16 kHz mono WAV for local ASR.
- Automate Jianying Pro export through UI automation modules.

## Database Schema

Observed `data.db` tables and row counts:

| Table | Rows |
| --- | ---: |
| `tasks` | 3 |
| `task_events` | 25 |
| `draft_templates` | 5 |
| `user_prompt_templates` | 0 |
| `custom_styles` | 0 |
| `custom_cover_templates` | 0 |
| `playground_jobs` | 0 |
| `minimax_clone_voices` | 0 |
| `credits_transactions` | 0 |

Important table meanings:

- `tasks`: task pipeline state, template selection, target length/scenes, task type, cover mode, podcast/video fields.
- `task_events`: pipeline audit trail and step progress.
- `user_prompt_templates`: custom prompt template storage; empty in this local run.
- `draft_templates`: Jianying/export draft presets.
- `playground_jobs`: image playground/generation history.
- `credits_transactions`: billing/credit ledger.
- `minimax_clone_voices`: voice clone storage.

## Bottom Line

The app is not a simple web bundle on disk. It is a Tauri/Rust desktop host with embedded web assets, a SQLite runtime store, and a PyInstaller media sidecar. Most business orchestration lives above the host command layer: prompt template selection, Step 0-4 LLM/image pipeline, credit checks, and sidecar payload construction. Heavy local media work is delegated to `draft-generator.exe`.
