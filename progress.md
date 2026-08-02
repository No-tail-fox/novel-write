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

## 2026-07-31 Storyboard Response Compatibility

- 收到用户实际错误：模型分镜响应顶层返回 `tail anchor`，而不是约定的 `scenes`。
- 开始检查 Step 2 提示词、响应解析器和现有 runner 测试。
- 根因确认：解析器支持锚点数组和多种包装键，但遗漏了模型返回的单数空格键 `tail anchor`；提示词已经要求直接返回数组。
- 新增用户实际响应形状的回归用例；修复前定向测试稳定复现 `Received keys: tail anchor`。
- 键名归一化兼容已实现，用户实际的 `tail anchor` 定向用例通过；继续扩展多形状回归矩阵。
- 多形状回归矩阵共 6 个用例全部通过：英文键变体、中文键、字符串化数组、嵌套容器、编号文本列表、未知单字段包装。
- `tests/runner.test.ts` 全量 71 个测试通过；`npm run typecheck` 通过。
- 首次全仓测试为 1584 通过、1 个无关 HTML 封面临时路径用例失败；准备隔离重跑。
- 隔离重跑仍失败；当前机器没有 `I:` 盘，而该测试直接对 `I:/managed/covers` 调用 `mkdir`。记录为既有环境相关测试问题。
- `npm run build` 通过；仅出现项目既有的 `node:* externalized for browser compatibility` 警告。
- `npm run smoke:electron` 通过：main、preload、IPC、窗口策略和 shell 全部为 true。
- `git diff --check` 通过；本次修改保持在分镜解析、runner 回归测试和计划记录内。
- 最终代码复核通过：锚点语义键优先于容器键，未知键仅允许单字段兜底，未放宽原有顺序匹配和全文覆盖校验。

## 2026-07-31 Storyboard Format Failure Recovery

- 收到新的 Step 2 失败样本：`{ "error": "strict JSON schema conflict" }` 被误判为尾部锚点。
- 开始对照 `E:\Storybound` 的分镜输出协议和失败处理路径。
- 定位最新版与 E 盘参考前端 bundle，确认参考程序也采用尾部锚点协议。
- 恢复最新版 Step 2 `qM()` 完整逻辑，确认三轮反馈式重试、旧格式兼容、命中/覆盖/数量校验及最终失败边界。
- 定位本项目协议冲突：Step 2 要数组，但 OpenAI/Anthropic JSON 适配器都强制顶层对象。
- 确定实现边界：共享 LLM 请求增加 JSON 根类型，Step 2 增加三轮内容级反馈重试，网络瞬态重试保持原样。
- 识别受影响测试：LLM provider 请求体、Anthropic tool 行为、Step 2 首次 provider 失败的暂停/续跑场景。
- 新增回归测试并确认修复前失败：OpenAI 仍有 `json_object`、Anthropic 仍有 object tool、`error` 对象仍被误判为锚点。
- 核心 3 个新测试已通过；首轮类型检查暴露两个共享构造器旧签名调用，正在修正。
- 修正模型测试调用后 `npm run typecheck` 通过；开始完整 provider/runner 回归。
- `tests/llm-provider.test.ts` 23/23、`tests/runner.test.ts` 72/72 通过。
- `npm run build` 与 `npm run smoke:electron` 通过；进入最终边界审查。
- 完成嵌套错误对象与诊断序列化边界修复；复跑类型检查和两套测试共 95/95 通过。
- 核对当前 E 盘 exe 元数据与哈希，确认它已更新且不同于六月旧包。
- 最终 `npm run build` 通过；仅有项目既有的 `node:* externalized for browser compatibility` 警告。
- 最终 `npm run smoke:electron` 通过：main、preload、IPC 状态与动作、窗口策略、渲染壳层全部为 true。
- `git diff --check` 通过；UTF-8 回读中文提示、测试和记录正常。
- 最终边界审查确认：数组根模式只影响 Step 2 及其数量修复，对象型 LLM 任务维持原结构化输出；现有无关工作区改动未触碰。

## 2026-08-01 Settings Save Recovery

- 收到设置页无法保存配置的反馈，开始核对前端、IPC、配置服务、SQLite、JSON 和密钥库完整链路。
- 正式配置和数据库副本通过 IPC 与配置服务保存；实际 Electron `safeStorage` 在正确 `userData` 下通过 8 个密钥槽解密及往返验证。
- 隔离正式数据副本的真实页面操作通过：修改配置名称和 API Key、点击“保存配置”、重新读取均成功。
- 定位交互层缺陷：保存与模型列表/诊断等操作共用 `settingsAction`，忙碌时保存会被静默丢弃。
- 改为独立 `saveAction`，补充忙碌反馈与 UI 回归检查；临时诊断脚本已删除。
- 配置相关 3 个测试文件共 160/160 通过，`npm run typecheck`、`npm run build`、加强后的 `npm run smoke:electron` 和 `git diff --check` 均通过。

## 2026-08-01 Storybound HTML Animation Full Parity

- 用户提供普通任务“图片”页截图：右侧 30 个场景中 9 个标记已生成，但中央 9:16 预览画布仍为空；标题、字幕和位置也未按所选草稿模板呈现。
- 用户要求打开并逆向最新版 `E:\Storybound`，完整复刻 HTML 动画页面与底层功能。
- 启动五阶段工作：现场复现、参考程序逆向、差异设计、实现、视觉与运行时验收。
- 初步定位普通任务断点：右侧完成状态按素材数量推算，顶部主预览没有复用下方图片卡片的本地文件读取逻辑，也没有使用草稿模板字段。
- 盘点确认项目已有专用 HTML 动画 runner/runtime/renderer 与页面模块，下一步重点做最新版 Storybound 的字段级和交互级对照。
- 普通任务主预览缺陷已定位到组件本身：未加载任何图片、完成状态按数组长度推算、未接收草稿模板；开始补齐任务详情页模板传参和主画布渲染。
- 已复用草稿模板编辑器画布完成普通任务主预览实现，中央画布会读取选中场景的真实图片并使用任务模板的几何/文字样式；右侧改为按 `sceneId` 判定完成状态。
- `npm run typecheck` 通过；新增 `task-preview-model` 两个测试通过。旧 UI 契约中两条固定装饰条断言已更新为真实模板/素材同步断言，待复跑。
- 普通任务相关 3 个测试文件共 153/153 通过。
- 发现参考程序实际仍为 1.12，已通过官方更新器升级到 1.17.0 并记录新 exe 哈希；开始以 1.17.0 为唯一参考。
- 已完成 1.17 创建页与已完成任务六个标签页的真实 DOM/截图采集，并抓到播放中 iframe 的标题、前景、字幕和 GSAP 运行态。
- 已提取并格式化 1.17 HTML 动画 lazy chunk，确认 `pipeline_data` 快照、WebView `postMessage` 预览、逐帧离屏截图和 sidecar `compose_render` 主链路。

## 2026-08-01 Storybound HTML animation parity continuation

- 修复 HTML 动画有任务时活动标签的低对比度：浅色抬升背景改用 `--shell-text`，并补充静态样式契约测试。
- `tests/html-video-studio-ui.test.ts`：4/4 通过。
- 直接运行普通任务专项 Electron QA；队列和历史页完成，详情页已加载 `8/12` 图片和草稿画布，但该状态未向主进程上报完成，导致捕获报告为 2/6。正在定位阻断检查。
- 已定位阻断检查：QA 把表示当前场景的 `.task-media-progress` 错当成已生成计数，错误等待 `8 / 12`，而组件正确内容是 `01 / 12`。下一步改为验证当前场景、场景栏计数及两个预览画布中的真实位图。
- 修正 ready 条件后先重建 `dist-electron`，普通任务专项 Electron QA 6/6 通过；截图与报告确认中央工作区和草稿画布均为非空媒体区域。准备补显式自定义模板种子以验证 `task.templateId`。
- 加强为自定义模板后 QA 按预期失败，并证明预览只挂了正确模板 ID、实际仍渲染默认模板参数。开始修复任务详情对草稿模板 detail 的加载链路。
- `TaskDetailPage` 已按任务 `templateId` 懒加载真实模板详情并隔离任务切换竞态；副标题回退不再泄露模板占位文案。
- 普通任务相关测试 `154/154` 通过；自定义模板 Electron QA `6/6` 通过，截图、像素、运行时、媒体和对比度证据均通过。
- 更新 Electron smoke 静态契约，使其验证现行的配置/偏好双保存握手和 Storybound 页内预览结构。

## Final verification

- `npm run typecheck`: passed.
- 7 个关键 Vitest 文件：244/244 passed。
- `npm run build`: passed。
- `npm run smoke:electron`: 6/6 handshake fields true，包含真实配置与 UI 偏好保存。
- `npm run smoke:html-video`: passed；MP4 有音视频，320x568，缩略图非空，临时帧已清理。
- 普通任务自定义模板 Electron QA：6/6 passed；证据位于 `.artifacts/task-operations-template/`。
- `npm run qa:html-video-ui`: passed；桌面/紧凑布局、字幕重跑、素材恢复、播放器、Range 206、可视编排和 lint 均通过。
- `git diff --check`: passed。

## 2026-08-01 HTML 动画浅色底栏修复

- 收到浅色主题下 HTML 动画底部文字看不清的反馈。
- 核对截图后确认既有浅色证据只覆盖设置页；可视编排截图虽然是浅色 shell，但出片页截图仍是深色主题。
- 定位主题混用：完成任务内容区仍固定深色媒体表面，而输出路径使用浅色 shell 的黑色 `--text`。
- 已将有任务的媒体画布和出片卡切换到 `shell` 主题表面，并为标题、元数据、路径标签和路径设置明确的主题前景色。
- 可视编排状态栏由 `9px / 24px` 提升为 `10px / 28px`，前景色改为 `--media-text`。
- 静态样式契约 4/4、脚本语法、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。
- 完整 HTML 视频 UI QA 通过；新增 `output-light.png`。浅色底栏标题/元数据/路径标签/路径对比度分别为 `17.96:1`、`5.62:1`、`5.62:1`、`17.96:1`，无运行时错误、横向溢出或控件裁切。
- 首次整页专项 QA 检出动画预览场景时长低对比度，修复后场景 1/2/3 分别达到 `5.03:1`、`5.62:1`、`5.62:1`，整页文字对比度失败归零。
- 专项 QA 旧就绪条件和参数顺序检查仍引用改版前 DOM；已同步到 `.hv-reference-thumb`、预览 iframe 和 1.17 左栏区域坐标。
- 最终整页浅色 Editorial QA 2/2 通过，证据已复制到 `.artifacts/html-video-light-editorial/`。
- 最终完整 HTML 视频 UI QA 通过，更新了 `.artifacts/html-video-storybound/output-light.png` 等 10 张截图；无运行时错误、媒体失败、横向溢出或控件裁切。

## 2026-08-01 配置持久化与 HTML 动画失败态复核

- 检查真实 `storydream` 数据目录：迁移标记存在，实际数据库、无秘密的 `config.json` 与加密 `secrets.v1.json` 都在同一目录。
- 修复 `configWithCredentialStatus()`：把活动 LLM、图片与 TTS 档案的密钥“已配置”状态投影到运行时兼容字段，未暴露密钥明文。
- 回归验证：`npm run typecheck` 通过；配置迁移、密钥、LLM JSON、HTML 视频 runner 和 HTML 工作台共 103 个测试通过。
- 实际失败任务确认是旧版本留下的泛化规划错误；不自动重试，避免消耗用户 LLM 服务额度。待重建后的手动“重试”会先尝试兼容调用并在格式冲突时使用本地规划。
- 为预览重做状态保留字幕编辑器，阻断提示会定位到第一个未完成步骤，不再笼统指向素材生成。
- `npm run qa:html-video-ui` 已通过：真实 Electron 中字幕更新会令预览/出片失效、可从断点继续并恢复成片；无运行时错误、横向溢出或控件裁切。

## 2026-08-01 HTML 动画独立创作页

- HTML 动画首次进入固定显示独立创作页，不再自动打开第一条历史任务；文案默认留空。
- 创作页按文案、画面、封面海报、配音、输出五段组织全部 14 个受管参数；可以从“已有任务”直接进入六步工作区。
- 创建成功后才切换工作区；工作区“新建”会返回创作页，旧的隐藏创建表单和 CSS 已删除。
- 生成场景补齐 HyperFrames `hf-preview` runtime 协议，解决 `storydream-media:` 跨源 iframe 二次挂载 `ready=false`。
- `npm run typecheck` 通过；HTML/HyperFrames 4 个专项测试文件 108/108 通过；完整 `npm run qa:html-video-ui` 通过，运行时错误为 0。
- Electron 证据位于 `.artifacts/html-video-ui-current/`；创作页桌面和 1080×720 紧凑视口均无横向溢出或控件裁切。

## 2026-08-01 网页搜索 Fake-IP 兼容

- 定位“搜索文案”显示 `fetch failed` 的根因：Clash Fake-IP `198.18.0.0/15` 被 SSRF 网络策略误拦截。
- 增加仅限域名 DNS 结果的 Fake-IP 兼容，保留字面 IP、私网、回环和其他保留地址拦截。
- 展开 Undici 隐藏的网络策略 cause，并在搜索 IPC 返回中文错误提示。
- `npm run typecheck` 通过；网络策略、搜索和 AI 搜索流程专项测试 68/68 通过；`npm run build` 通过。
- 真实搜索“李明博”成功返回候选，模型服务域名成功到达服务端；应用已重启并加载新构建。

## 2026-08-01 自定义模板删除与任务详情标题栏

- 自定义草稿模板卡片新增垃圾桶按钮和二次确认；系统默认模板不提供删除入口，数据库层也拒绝删除系统模板。
- 删除操作已贯通数据库、IPC、preload、renderer API、浏览器回退和状态增量同步；历史任务引用已删除模板时会回退到默认模板。
- 任务详情标题栏原先因 identity/actions 的 flex 基准过大而在 1290px 窗口中换行，同时状态徽标重复显示 `5/7`。
- 状态徽标现在只显示任务状态；进度只保留在右侧“当前步骤”。桌面标题栏固定单行，左侧信息可收缩省略，右侧指标和操作按钮保持同一基线。
- `npm run typecheck`、5 个相关测试文件 244/244、`npm run build` 和 `git diff --check` 均通过。
- 任务操作专项 Electron QA 4/4 通过；无交互重叠或主控件裁切，最终截图位于 `.artifacts/task-detail-alignment/task-detail-operations-desktop.png`。

## 2026-08-01 任务详情草稿模板切换

- 任务详情新增“草稿模板”选择器；选择后中央草稿画布即时预览，点击“应用模板”后才持久化，另有入口可直接打开草稿模板管理页。
- 新增 `task:update-template` 完整链路并记录 `template_updated` 事件；普通入口拒绝修改 HTML 动画任务，模板不存在时也会明确报错。
- 已完成且已有草稿的任务应用模板后只从第 6 步重新导出，不重新生成图片或配音；运行中任务会在实际导出前读取最新 `templateId`。
- 模板操作使用独立忙碌状态，不会与暂停、重试、取消等任务操作互相锁死。
- `npm run typecheck`、7 个相关测试文件 333/333、`npm run build` 和 `git diff --check` 均通过。
- Electron 任务操作专项 6/6 通过；模板工具条无错行、裁切、交互重叠或低对比度，证据归档于 `.artifacts/task-template-switcher/`。

## 2026-08-01 草稿模板卡片操作区对齐

- 定位到错位来自 `.row-actions` 内混用 34px 文字按钮和固定尺寸 `icon-button`，删除按钮因此表现为孤立的窄控件。
- 模板卡改为固定的预览、元数据、操作三段网格；系统模板使用两列操作，自定义模板使用三列等宽操作。
- 删除按钮改为 `Trash2 + 删除`，与编辑、复制同高、同宽、同一基线，并保留危险操作样式和二次确认。
- Editorial QA 新增自定义模板种子和按钮几何检查，要求三按钮顶边、底边和宽度误差均不超过 1px；删除按钮也纳入主题对比度检查。
- `npm run typecheck`、3 个相关测试文件 167/167、`npm run build` 和 `git diff --check` 均通过；系统专项 Electron QA 20/20 通过。
- 深浅主题和桌面/紧凑证据归档于 `.artifacts/draft-template-actions-alignment/`。

## 2026-08-01 草稿模板下拉主题适配

- 根因是 Windows 原生 `select` 的展开层不受应用深色主题可靠控制，因此出现白底和低可读性文字。
- 任务详情的模板选择已改为应用内 `listbox`；菜单使用 `--shell-surface` 灰色背景，选中项使用轻量主题强调色并显示勾选。
- 保留选择后即时预览、点击“应用模板”后才保存的业务行为；补齐方向键、Home/End、Enter/Space、Esc、Tab 与点击外部关闭。
- `npm run typecheck`、3 个相关测试文件 176/176、`npm run build` 和 `git diff --check` 均通过。
- Electron `task-operations` 专项 7/7 通过；菜单非白色、未越界、无重叠、裁切、低对比度或运行时错误，证据归档于 `.artifacts/task-template-menu-theme/`。

## 2026-08-01 人物故事封面标题钩子化

- 定位到 Storybound 人物故事旧提示词明确要求 `cover.title` 输出主角姓名，导致姓名占据草稿模板最重要的主标题位置。
- 新增人物故事封面展示硬约束：主标题必须是 6-14 字的冲突、反差、数字、悬念或结果钩子，姓名只进入标签或简介；副标题提供 1-2 条递进钩子。
- 新增共享兼容层：旧任务或不合格模型输出若是纯人物姓名，会把第一条已有反差副标题提升为主标题，剩余钩子作为副标题；缺少副标题时才从正文确定性提取。
- 预览、流水线落盘和剪映导出都使用同一共享结果；非 `character-story` 轨道不受影响，避免破坏民间故事等固定栏目标题。
- 用真实“李明博”任务产物验证：`李明博 / 他曾靠酒糟充饥 / 66岁生日赢得大选` 被解析为 `他曾靠酒糟充饥 / 66岁生日赢得大选`。
- `npm run typecheck`、5 个相关测试文件 118/118、`npm run build` 和 `git diff --check` 均通过。
- Electron `task-operations` 专项 7/7 通过；实机 DOM 必须显示“深宫沉默十二年 / 最后走成唯一女皇”，运行时错误、媒体失败、交互重叠和对比度失败均为 0。证据归档于 `.artifacts/cover-hook-real-task/`。

## 2026-08-01 去 AI 味 Skill GitHub 可检索性梳理

- 接收用户提供的 CSDN 文章清单，准备合并重复 Skill 并核验 GitHub 可检索性。
- 已读取 `planning-with-files` 技能说明；当前目录已有 `task_plan.md`、`findings.md`、`progress.md`，本任务使用追加记录方式。
- 已去重得到 22 个唯一名称；文章中所谓 40 个条目主要是四个类别里的重复引用。
- GitHub API、网页搜索与普通页面请求交叉核验后，22 个候选仓库页面均可打开；其中 `WRITING.md`、`anti-slop-writing`、`humanize-text`、`writing-agent` 等属于泛化名称，需带 owner 或完整仓库名搜索。

## 2026-08-01 任务已应用模板持久化

- 任务详情将数据库已应用模板与本页候选模板显式分离；只有候选为有效且不同的模板时才允许执行 `updateTaskTemplate`。
- 已应用状态显示“已应用”；候选变化后显示“应用模板”，珊瑚色按钮使用跨深浅主题固定黑色 `--shell-accent-contrast: #101214`。
- 已应用模板缺失时不再静默显示列表第一项，而是保留原 ID 并提示重新选择；模板列表重排不会改变任务已应用值。
- `npm run typecheck` 通过；模板选择、任务操作和存储专项 50/50，通过关闭并重开数据库验证模板 ID 持久化。
- 扩展任务页、产品壳和状态增量测试 204/204 通过；`npm run build` 与 `git diff --check` 通过。
- Electron `task-operations` 专项 7/7 通过；候选切换后按钮计算色为 `rgb(16, 18, 20)`，直接读取任务仍返回原已应用模板，运行时错误、对比度失败、交互重叠和裁切均为 0。
- 正式应用已使用最新构建重启；根进程 PID `31684`，重启后真实“李明博”任务仍保存原模板 ID `25e35765-4a84-4726-8ade-83e3e48c9db3`。

## 2026-08-01 最终封面元数据与双层字幕拆分

- 完成 Storybound 1.17 对照：画面分镜推荐 25-45 字、硬上限 55 字；每个分镜另按默认 12 字拆成无标点画面短字幕。
- 确认当前封面生成早于固定开头/结尾追加，当前 SRT 构建器则是一镜一条字幕；开始修改共享构建、导出和预览链路。
- 改写流程现在先追加锁定开头和结尾 CTA，形成最终成稿后再生成一次封面元数据；`{主角}` 使用任务主体，不再误用钩子式封面标题。
- 分镜提示词加入 Storybound 画面语义规则：推荐 25-45 字、硬上限 55 字、首句独立、短片段合并；模型异常超长输出会本地无损拆分并重新编号。
- 共享字幕构建器按默认 12 字（可配置 6-24）进行中文语义断行，去除展示标点、保护年份与分词词组、避免行首“的”，并按字数比例无缝覆盖每个镜头时长。
- `SubtitleCue` 增加可选 `sceneId`；任务预览会按当前草稿模板从 scenes 重建旧字幕，配音卡按镜头汇总多条短字幕。
- 草稿导出和 Python 剪映桥接统一接收 `captions[]`；桥接器只根据真实音频时长重新分配时间，不再把短字幕合并回长句。
- `npm run typecheck`、构建通过；runner/core/draft/jianying/preview/壳层相关 441 条专项测试通过。全量 1621/1626 通过，5 条既有失败与本次行为无关。
- Electron `task-operations` QA 7/7 通过，运行时错误、重叠、媒体失败和对比度失败均为 0；证据位于 `.artifacts/final-cover-caption-splitting/`。
- 正式应用已用最新构建启动，主进程 PID `35616`。

## 2026-08-01 人名关键词搜索偏移排查

- 收到“李在明”搜索却返回“李姓/李氏”泛化页面的截图，开始追踪查询构造、搜索源、候选解析与排序链路。
- 已定位主实现为 `src/shared/research.ts`，页面调用在 `NewTaskPage.searchWebSources()`；开始核对查询归一化、中文补充源和相关度词项。
- 已确认前端与 IPC 都原样传递“李在明”；不存在页面层分词，当前核心嫌疑点是 `buildStrongSearchTerms()` 与 `rankSearchItems()` 的弱命中保留逻辑。
- 逐行核对后排除了单字分词假设：纯人名查询只使用完整人名做相关度命中；准备用当前源码重放真实搜索。
- 首次通过 `tsx.cmd -e` 重放时未产生输出；确认为 cmd shim 参数传递问题，改用 Node ESM loader。
- 当前源码真实联网重放成功：10 条候选均与“李在明”直接相关，未复现截图的李姓泛化结果。开始对比源码、`dist-electron` 与正在运行的应用进程。
- 已确认当前 Electron 主进程与 `dist-electron` 是同一次 22:55 构建，且编译包含完整人名过滤。转向排查截图时间和前端旧结果状态。
- 截图时间确认为 23:04，排除旧构建。已发现输入变更不会使旧结果过期，且“搜索摘要入选、抓取正文展示”存在语义错位；开始核对截图中搜狐页面的伪命中证据。
- 已实请截图中两个搜狐页面：文章内完全不含“李在明”。同时确认搜索按钮存在共享忙碌时静默丢弃、旧结果不清除的状态缺口。
- 受控重放已证明“搜索摘要推荐词含完整人名、实际正文不含人名”的页面会通过当前过滤。
- 诊断完成：不是前端或搜索请求把“李在明”拆成“李”，而是摘要伪命中未复核，再被旧结果状态缺口放大。本轮未修改搜索业务代码。

## 2026-08-02 多渠道精准网页检索

- 用户将目标收紧为“精准对接想搜的主题，并使用必应、百度、头条等明确信息源”；开始实现多渠道搜索、渠道归属和抓取后精准复核。
- 已盘点当前契约：网页结果只标识为 `web`，无渠道元数据/状态，实际仅调用必应与搜狗。准备以向后兼容的可选字段扩展类型。
- 已真实连通百度与头条搜索页：两者均 200；百度可从 HTML 结果标题解析，头条需从页面内嵌数据恢复结果。
- 已定位头条公开搜索页的候选字段和百度结果标题/跳转链接形态；实现将保持旧底层默认渠道，由 UI 显式开启新渠道。
- 已确认头条 `ala-data` 每条候选包含可独立 JSON 解析的 `data` 对象；确定使用结构化解析而非正则跨整页猜测。
- 已确定 UI 状态落点：新增可持久到本地草稿的渠道选择，搜索使用独立异步动作，关键词变更使当前结果失效。
- 已定义回归边界：四渠道解析/归属、摘要伪命中抓取后排除、单渠道故障隔离、IPC provider 白名单与 UI 查询归属。
- 新增 3 个搜索回归用例并确认红测试：`searchWebSourcesDetailed` 尚未存在；原有 23 个用例保持通过。
- 完成底层类型、四渠道适配、渠道状态、抓取后精准校验与来源多样化初版；新增 3 个用例全通过，发现 3 个旧排序/数量契约需调整。
- 修复 3 个旧契约冲突后，`tests/research.test.ts` 26/26 通过；完整查询、单渠道 10 条和百科优先级均已纳入回归。
- 已进入 IPC/UI 阶段：将增加字符串/结构化请求兼容、渠道白名单、独立搜索动作、关键词失效和渠道状态展示。
- 完成 IPC/preload/API/browser fallback 结构化请求链路和创作页四渠道选择、状态展示、旧结果失效、独立忙碌反馈。
- `tests/research.test.ts`、`tests/ipc-contract.test.ts`、`tests/task-drafts.test.ts`、`tests/product-shell-ui.test.ts` 共 188/188 通过；`npm run typecheck` 通过。
- 实机首轮搜索发现并修复搜狗反爬中间页泄漏；新增用例后 `tests/research.test.ts` 27/27 通过，真实结果中反爬 URL 和同标题重复数均为 0。
- 最终四个专项文件 189/189、`npm run typecheck`、`npm run build`、`git diff --check` 和 `npm run smoke:electron` 均通过。
- Electron 真实 AI 创作态截图位于 `C:\Windows\TEMP\storydream-editorial-artifacts-uTsZsk\captures\new-task-material-desktop.png`：实际查询为“李在明”，四渠道状态可见，运行时错误、低对比度、交互重叠和裁切均为 0。

## 2026-08-02 草稿模板画布与属性面板联动

- 开始追踪草稿模板画布选区与右侧属性折叠面板的状态和滚动关系。
- 已确认选择事件链路正常，问题是右侧折叠项不受选中状态控制；开始实现受控展开和属性栏容器内定位。
- 已完成受控展开、右栏定向滚动和 Electron 自动交互验证；首轮截图发现选中标签对比度不足，已同步修正并准备复验。
- 草稿模板编辑器的共享折叠组件已支持受控/非受控双模式；五类画布图层均可强制展开对应分组，同一图层重复选择也会重新定位。
- 右栏使用自身 `scrollTop` 和目标矩形差值滚动，没有调用 `scrollIntoView()`；Electron 验收确认 `.draft-template-page` 与 `.draft-stage` 的滚动位置保持不变。
- 产品壳、组件架构和 Editorial QA 专项 `209/209` 通过，`npm run typecheck`、`npm run build`、`git diff --check` 通过。
- Electron `system` 范围 20/20 通过；草稿模板深浅主题、桌面/紧凑四个场景均 `draftLayerPanelReady=true`，运行时错误、对比度失败、交互重叠、媒体失败均为 0。证据位于 `C:\Windows\TEMP\storydream-editorial-artifacts-v4i1uD\`。
# 2026-08-02 Storybound HTML 动画工作台深度对齐

- 已读取 `ui-ux-pro-max` 的工作流优先规则和十张用户截图。
- 已确认旧 HTML parity 计划存在，但其验收与用户当前要求不符。
- 已开始盘点 `HtmlVideoPage`、六标签面板、作者工作区、共享 workflow/types、Electron IPC 和本地 Storybound 1.17 资源。
- 已完成六标签工作区：文案可改、素材可预览/替换/重画/新增、配音可选服务/音色/语速并逐场景重配、17 类画面预设可播放、封面可导入/重画、成品可播放和重新出片。
- 已完成可视编排模式：HyperFrames Player、源码、片段属性、官方检查、渲染队列和四轨时间线在桌面与紧凑窗口均可用。
- 已修复错误感叹号垂直居中、封面布局溢出、帧率显示不一致、标签切换滚动位置、封面模板说明英文和出片页停留在旧滚动位置。
- 已实现可选生图质量覆盖：关闭时保留供应商默认；开启后仅覆盖 `quality` 为低/标准/高，不改模型、比例、分辨率或并发参数。
- 已确认 402 文案来自远程图片服务；界面将其解释为供应商余额/套餐额度问题，并明确降低质量不能绕过已无余额的账户。
- 已修复 HyperFrames 组合媒体加载：HTML、脚本、图片和音频全部经任务固定的 `storydream-media://` 提供，目录逃逸与跨任务引用回归测试通过。
- `npm run qa:html-video-ui` 已通过；桌面/紧凑、深色/浅色、六阶段、错误态、封面、成品播放、Range 请求、媒体失败恢复、字幕编辑和可视编排均无运行时错误、横向溢出或控件裁切。
- 最新截图已刷新到 `.artifacts/html-video-storybound/`；人工复核确认封面说明中文化、出片页回到顶部、编排页无破图替代文字或重复裁切标题，失败感叹号居中。

---

## 2026-08-02 Stitch 设计图生成测试

- **Status:** completed_with_backend_timeout
- 已确认用户授权进行真实设计生成测试。
- 已启用文件化计划；保留现有计划内容，仅追加独立测试记录。
- 下一步：读取生成工具 schema，创建专用 Stitch 测试项目并生成单张设计。
- 已完成 schema 读取；生成阶段参数已锁定，准备创建测试项目。
- 已创建私有 Stitch 测试项目 `projects/1675698795742670867`；下一步只调用一次 `generate_screen_from_text`。
- 已提交唯一一次 `generate_screen_from_text`；客户端等待超时，无错误响应。按协议转入 `list_screens` 轮询，不重复生成。
- 屏幕轮询 1/10：空结果，继续按 30 秒间隔等待。
- 屏幕轮询 2/10：仍为空，继续等待，不重复生成。
- 屏幕轮询 3/10：仍为空，认证与读取接口返回 HTTP 200，继续等待。
- 屏幕轮询 4/10：仍为空，继续等待，不重复生成。
- 屏幕轮询 5/10：仍为空，继续等待，不重复生成。
- 屏幕轮询 6/10：仍为空，继续等待，不重复生成。
- 屏幕轮询 7/10：仍为空，继续等待，不重复生成。
- 屏幕轮询 8/10：仍为空，继续等待，不重复生成。
- 屏幕轮询 9/10：仍为空，继续等待，不重复生成。
- 屏幕轮询 10/10：仍为空；完成本轮轮询，未获得可下载屏幕。
- **Final status:** MCP 连接、API Key 认证、项目创建、工具发现和唯一一次生成提交均成功；Stitch 后台未在本轮窗口返回屏幕，因此无法展示设计图或验证截图像素。

### Error Log

| Timestamp | Error | Attempt | Resolution |
| --- | --- | --- | --- |
| 2026-08-02 | Stitch 生成请求等待超过 420 秒 | 1 | 停止重试，查询项目屏幕列表。 |

---
