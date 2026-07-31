# Storybound 1.16.1 Runtime Parity Matrix

## Scope And Evidence

This is a clean-room behavior comparison between the installed `G:\Storybound` application and StoryDream. Evidence comes from the installed binaries/resources, the live version-30 SQLite database, task artifacts, rendered WebView2 routes, and StoryDream's current source/tests. Proprietary code, binaries, assets, credentials, and private API payloads are not copied.

Storybound is a Tauri/WebView2 shell backed by SQLite plus native `draft-generator.exe`, ONNX Runtime, and Sherpa-ONNX sidecars. StoryDream is an Electron/React application backed by sql.js, provider runtimes, a Python media bridge, and a local HyperFrames-compatible HTML renderer.

## Capability Matrix

| Domain | Storybound evidence | StoryDream state | Classification | Decision |
| --- | --- | --- | --- | --- |
| Task creation and seven-stage production | `tasks`, `task_events`, staged artifacts, Create/Queue/History/Detail routes | Full task pipeline, lifecycle, checkpoints, artifact preview and reruns | Equivalent; StoryDream governance is broader | Preserve |
| Product/rewrite controls | `product_info`, `fixed_intro`, `outro_cta`, `lock_intro_sentences`; rendered Create controls | Persisted and operational in prompts/runner | Equivalent | Preserve |
| Local people/materials | `material_person`; Person Assets route | Person Assets plus local-material handoff | Equivalent | Preserve |
| Book selection and benchmark | Rendered Book Selection/Benchmark routes | Local Book Selection and Benchmark handoff | Similar local implementation | Preserve; no private feed cloning |
| Prompt/style/cover templates | Template tables and rendered editors | Prompt, style, cover and Coze-assisted template editors | Similar; StoryDream is broader | Preserve |
| Draft template core | Live template JSON and editor | Canvas, image, text, caption, disclaimer, audio/effects, camera and frame treatment | Equivalent | Preserve the unified editor |
| Draft camera motion | `image.motion`, `motionStrength`; rendered seven-mode selector and `0.5-2.0` strength | Seven modes, strength, endpoint fades and preview/HTML/Jianying output | Equivalent local | Delivered with legacy defaults |
| Draft frame layout | Live `frame` JSON; rendered master switch, header/footer gradients and image border | Persisted frame, header/footer gradients and directional image border in preview/HTML/Jianying output | Equivalent local | Delivered with legacy defaults |
| HTML animation | Rendered Create route and template note | Six-stage HTML Video plus HyperFrames Player/Studio, lint, timeline and source persistence | Similar; StoryDream is materially broader | Apply selected draft motion/frame without removing Studio |
| Music MV | Rendered Create route | Dedicated Music MV route and runtime | Equivalent | Preserve |
| Image playground basics | `playground_jobs`; rendered text/reference/smart modes | Image Lab text/reference/smart modes and persisted history | Equivalent | Keep one unified Image Lab owner |
| Playground references | One JSON-encoded reference field in local jobs | Up to ten references with managed import | StoryDream-only expansion | Preserve |
| Playground batch dimensions | Rendered multi-ratio selector; same-second jobs across three ratios | Multi-ratio and multi-style selection with stable ratio x style x quantity fanout | Equivalent local | Delivered in the unified Image Lab |
| Playground recovery/tools | Retry-all, row retry, refill prompt, open folder, copy task ID, inline provider switch | Row/batch retry, prompt refill, record-scoped output directory, ID copy and per-request profile selection | Equivalent local | Delivered through existing Image Lab/API owners |
| Playground video result | `video_path` column only; all five local values are null | No Image Lab video result | Unverified schema reservation | Defer until a working rendered/task artifact exists |
| Voice Lab and clone voices | Voice Lab route, `minimax_clone_voices`, Sherpa/ONNX sidecars | Voice Lab and operational MiniMax clone management | Equivalent | Preserve |
| Uploaded task narration | `voice_source`, `uploaded_voice_path`; rendered workflow says STT splits final narration by scene | TTS and clone voices, but no task-level uploaded narration | Storybound-only local, high complexity | Defer until scene-alignment/runtime design is proven |
| Failed-image neighbor borrowing | `auto_borrow_image`; rendered Create toggle | Missing | Storybound-only local | Implement after current image retry semantics are reconciled |
| Cover poster modes | `cover_primary`, `cover_extra`, `cover_local_path`; rendered none/titled/text-free/local modes | Cover generation plus ordinary-task manual cover import | Similar but not equivalent | Extend only with real cover artifact ownership |
| Task favorites | `is_favorite`; rendered Favorites filter and per-row toggle | SQLite-backed favorite state, History filter and active-row star toggle | Equivalent local | Delivered with archive immutability |
| Creation drafts and presets | Rendered save-as-draft and save-preset commands | Complete autosaved creation draft plus named local presets with save/apply/delete and full snapshot ownership | Equivalent local | Delivered; manual cover requires safe re-import |
| Dynamic storyboard | Rendered RunningHub image-to-video controls and key requirement | No equivalent service contract | External-provider capability | Defer pending provider configuration/runtime design |
| Network scene materials | Rendered network-material source | Viral Analyzer can ingest source video, but ordinary tasks do not fetch stock per scene | Similar adjacent capability | Defer pending licensing/source policy |
| Creation Market | Rendered empty point-priced market with buy/publish ownership | Local editors only | Server/account-bound | Do not create a false local market |
| Account, activation and credits | Account/Activation routes and credit tables | Account, activation, credit ledger and provider configuration | Similar local/commercial boundary | Preserve current ownership |

## Implementation Order

1. [Completed] Draft motion and frame contract: strongest evidence, local, output-visible, and compatible with existing template ownership.
2. [Completed] Image Lab batch/recovery tools: verified rendered workflow with matching persisted jobs; unified into the existing route.
3. [Completed] Task favorites: verified column plus rendered filter/action with local persistence and UI ownership.
4. [Completed] Creation drafts/presets: existing complete draft snapshot was retained and extended with bounded named presets instead of duplicating form state.
5. Next evidence gate: neighbor-image fallback, cover-mode expansion, uploaded narration, dynamic storyboards, and network materials require independently proven runtime and artifact semantics before implementation.

## Safety Boundaries

- Missing optional keys must normalize to neutral values so existing templates remain valid.
- New template parameters must affect previews and final output, not merely persist.
- No existing StoryDream route, provider, parameter, HyperFrames tool, multi-reference behavior, or task governance action may be removed.
- Server-bound Market, licensing, billing, and private provider contracts are documented rather than simulated.
