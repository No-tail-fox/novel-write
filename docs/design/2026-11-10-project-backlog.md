# StoryDream 剩余工作盘点（backlog review）

> **状态更新（同日，素材通道/生图通道提交之后）**：L-1 素材通道、L-2 可选生图通道、U-3 素材导入界面（来源/许可）已实现，见 §2.2。新增测试 `tests/lemo-upstream-assets.test.ts`（14 个）、`tests/lemo-material-ui.test.ts`（3 个），并在 `tests/lemo-upstream-production.test.ts` 补了 2 个；三套 tsc 都通过。全量 vitest 的历史失败没有变化（见 §1.2 末尾的复测记录）。其余条目仍是盘点时的状态。本文下面的行号以盘点时的 `f30be99` 为准。

- 仓库：`I:\opc`，分支 `feat/route-split-opuscar98`，HEAD `f30be99`（2026-11-10）
- 方法：只读分析。读了 `docs/design/*`、`docs/plans/*`、根目录 md；在 `src/ electron/ scripts/ services/` 里 grep 核对代码；跑了全量 vitest 和三套 tsc。没有改源码、没有提交、没有运行应用、没有发起网络/付费调用。
- 标注：【未核实】= 只有文档依据，或者没能用代码/运行结果确认。
- 行号以 HEAD `f30be99` 为准。运行测试时工作区**没有已跟踪文件的改动**（`git status` 里只有未跟踪项）。

---

## 0. 总览（按优先级各一句话）

- **P0（先做稳定性）**：模型调用层几乎还是空白。代码里没有能力档案/降级链（`fallbackChain`、`model_not_found` 都 grep 不到），没有统一错误分类（只有连接超时会重试一次），跨路线也没有回执账本（`request-ledger.ts` 只在没接生产的 `services/lemo-agent-worker` 里）。另外 HTML 路线吞错的根因在 `normalizeAppError`：不带错误码的普通 Error，原始消息会被丢掉。
- **P1（统一出片质量 + 质量债）**：模板和 HTML 两条路线默认不做响度归一（`director-renderer.ts:213`）；就算打开，目标也是 −16 而不是 −14（`storybound-sidecar.ts:1760`）。全量测试 **19 个文件、44 个用例失败**，远多于此前说的"3 个已知失败"。设置页版本号写死成 `V1.0.0`（包版本 1.0.3）。`result.json` 整文档快照还在写。1.0.3 被 SSH 卡住没发布，安装包也没签名。
- **P2（新架构，只用于新项目）**：VideoSpec、SceneRuntime、CaptureHost、统一执行器都还没开始（grep 结果为 0）。Lemo 素材通道和可选生图通道**已实现**（见 L-1/L-2；还需要用真实素材和真实生图服务商做一次端到端验收）。MoneyPrinter 网络素材、剪映实开验收、音乐 MV 真实验收（被 402 卡住）还没完成。
- **P3（产品化）**：模型分层（T1/T2/T3）和自动推荐路线、真实回归集、成本面板、官方 Agent SDK（H1）生产接线（需要法务和产品决策）、大文件拆分、无障碍专项。
- **仓库整理**：仓库根目录有 100 多个未跟踪项。`vendor/lemo-upstream`（109 MB）和 `vendor/pixelle-upstream` 被已提交的代码和打包配置依赖，但**既没被跟踪也没被忽略**。`.codex-temp`（2.4 GB）没被忽略。有 4 个已合并的 worktree 可以回收。

---

## 1. 质量现状

### 1.1 TypeScript
| 配置 | 结果 |
|---|---|
| `tsconfig.json` | ✅ 退出码 0 |
| `tsconfig.electron.json` | ✅ 退出码 0 |
| `tsconfig.scripts.json` | ✅ 退出码 0 |

### 1.2 Vitest 全量（`node node_modules/vitest/vitest.mjs run --maxWorkers=4`，2026-11-10 12:21 开始，耗时 359 s）
- **Test Files 19 failed / 341 passed（共 360）；Tests 44 failed / 4318 passed（共 4362）；6 个 unhandled errors。**
- 完整输出：`I:\opc\.tmp\vitest-out.txt`（约 7.7 MB）。
- 运行条件：前约 1 分钟和 tsc 并行，期间还有文件系统扫描，所以下面 D 类超时可能是负载造成的。`licensing.test.ts` 这次通过了（已知在并行负载下不稳定）。
- 和文档的对照：`2026-11-10-route-split-and-upstream-render.md:133` 只写了相关 15 个文件里的 3 个失败，`:134` 又说"全量与基线相比没有新增失败"。也就是说，全量本来就有约 40 个历史失败，文档里的"已知 3 个"**明显低估**了。

**失败分类（按根因）：**

| 类 | 文件（失败数） | 原因摘要 | 判断 |
|---|---|---|---|
| A. 源码字符串断言过时 | `director-product-flow`(3)、`draft-font-selection`(1)、`editorial-collage-workbench`(2)、`editorial-qa`(1)、`editorial-workbench-parity`(1)、`history-managed-paths`(3)、`image-lab-managed-import`(1)、`motion-comic-workbench`(1)、`product-shell-ui`(1，已知)、`u04-service-semantics`(3) | 测试用 `toContain` 匹配源码文本，比如期望 `appDataDir()`，实际已改名为 `artifactDataDir()`（见 `electron/main.ts:1132-1133`，`resolveManagedHistoryWorkDir` 仍在用）；`editorial-workbench-parity` 里 shellViews 从 22 个变成 26 个 | 不是功能回归，是测试过脆。改成行为测试，或者更新断言 |
| A'. 版本断言 | `app-version`(1) | 期望 `1.0.0`，实际 `1.0.3` | 测试过时；而且暴露了一个**真实 UI 缺陷**：`src/features/settings/SettingsPage.tsx:876` 写死了 "V1.0.0"，`src/app/browser-fallback.ts:1108` 写死了 `currentVersion: '1.0.0'` |
| B. 源码切片执行的测试骨架缺依赖 | `task-run-lifecycle`(7) + 6 个 unhandled rejection | `ReferenceError: licenseService / resolveShortVideoMaterial / reserveProjectModelGeneration is not defined` | 测试从 `main.ts` 切出处理函数来执行，`main.ts` 新增依赖后骨架没跟上。要修骨架，或者把处理函数抽成可注入模块 |
| C1. 捕获契约（已知） | `html-video`(2) | 实际是 `"Error: Error: HTML scene image failed…"`，比期望多一层 `Error:` 前缀（文案来源 `electron/html-video-scene-ready.ts:16`） | 小缺陷：错误被包装了两次。修实现，不要改断言 |
| C2. 行为变化，需确认是否有意 | `image-lab`(2) | 尺寸映射 `2048x1152` ≠ 期望 `1536x1024`；请求对象多了字段 | 【未核实是否有意】，涉及生图请求参数，可能影响计费和尺寸 |
| C3. 行为变化，需确认是否有意 | `editorial-storytelling`(2) | 提示词里缺 `representing: 茶馆.`；渲染预检新增门禁 `DIRECTOR_RENDER_PREFLIGHT_FAILED`（要求透明主体） | 【未核实】，很可能是新门禁让旧夹具失效 |
| C4. 真实样本回放失败 | `motion-comic-live-sample`(3) | `MOTION_COMIC_PLAN_INVALID: … sourceUnitIds 原文句段不存在：S13–S16` | **可能是真回归**：原文切句规则变了，导致已捕获的真实模型样本对不上。需要优先确认 |
| C5. 测试环境 | `person-assets-preview`(7) | `ReferenceError: localStorage is not defined`（node 环境） | browser-fallback 新用了 localStorage，测试环境没提供 |
| D. 超时（5000 ms） | `ai-research-flow`(1)、`director-batch`(1，1501 节点) | `Test timed out in 5000ms` | 很可能是负载导致；给重测试单独设 `testTimeout`，或串行执行 |

**复测（素材通道/生图通道改动之后）**：Test Files 17 failed / 345 passed（共 362），Tests 42 failed / 4339 passed（共 4381），仍有 6 个 unhandled。和上面的基线逐个文件对比，**没有新增的失败文件**。D 类的两个超时这次没有出现，进一步说明它们是负载造成的。另外，`renderer-command-inventory` 已经为新增的导入按钮补登了命令归属。

---

## 2. 待办清单

> 工作量：S ≤ 1 天，M = 2–5 天，L > 1 周。优先级沿用路线图 P0–P3。

### 2.1 稳定性 / 模型网关

| 编号 | 事项 | 证据（文件:行） | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|---|
| G-1 | **✅ 已实现（文本模型）**：`src/shared/model-capabilities.ts` 按模型名推断档案（T1/T2/T3、识图/工具/推理、输出上限，未知按 T2）；LLM 档案新增“备选模型”（同一端点/Key，最多 4 个）；`createConfigured{Json,Text}Llm` 只在**明确拒绝**（模型不存在/无通道/过载）时依次切换，结果带 `modelUsed/modelFallbacks`，主进程打 `[llm-fallback]` 日志；`unknown`/鉴权/解析失败绝不换模型重发；无备选时行为不变。测试 `tests/model-fallback.test.ts`。默认模型选择仍由用户决定（G-6）。原条目：**模型能力档案 + 自动降级链**：遇到 404 `model_not_found` / 503 时切换到备选模型，并写日志 | 路线图 `technical-roadmap.md:135`（P0-1）。代码里 `fallbackChain`/`model_not_found` 都 grep 不到；现有 `ModelProfile` 只是服务商配置（`electron/config-service.ts:168`、`src/shared/provider-profile-utils.ts:173`），不是能力档案 | P0 | M | — |
| G-2 | **✅ 已实现**：`src/shared/provider-failure.ts` 把网络码/HTTP 状态/错误文本统一分成 `not-sent / rejected / unknown` 三种结果和 `always / idempotent / never` 三种重发策略（521-523=未送达，502/520/524/ECONNRESET/读超时=结果未知），带 Retry-After 解析（封顶 60 s）与指数退避+抖动；LLM 重试改为遵守 Retry-After，并对 521-523 重试、524 不重发。付费非幂等调用遇 `unknown` 一律不自动重发。测试 `tests/provider-failure.test.ts`。原条目：**统一错误分类 + 退避重试**（网络断开、502/503/520/522/524、429、4xx、本地错误） | 目前只有 `fetchWithNetworkPolicy` 对 `UND_ERR_CONNECT_TIMEOUT` 重试一次（`src/shared/network-policy.ts:328-329`）；`ECONNRESET` 只映射成提示文案（`network-policy.ts:679`）。`src/ electron/` 里没有任何 524 处理 | P0 | M | — |
| G-3 | **回执先于解析 + 幂等 key（全路线）**；`unknown` 时先查回执，再决定是否重发 | 账本只在没接生产的 `services/lemo-agent-worker/request-ledger.ts`、`messages-gateway.ts`；Lemo 规划回执在 `electron/lemo-plan-receipt.ts`；VOX 的 unknown 要人工触发 `retry-unknown`（`electron/vox-production-service.ts:163`）。路线图 P0-3（`:137`） | P0 | L | G-2 |
| G-4 | **✅ 已实现**：`describeErrorCause` 沿 cause 链取消息/系统码/主机/HTTP 状态（脱敏、≤400 字），runner 失败消息变为 `HTML video <step> step failed: <原因>`，不改 `normalizeAppError` 语义（`tests/error-cause.test.ts`）。原条目：**HTML runner 保留底层错误**（附主机、错误码） | `src/shared/html-video-runner.ts:457-460` 用 `HTML video ${step} step failed.` 当默认值；**根因**在 `src/shared/app-error.ts:72-76`：普通 Error 如果没有 `CODE:` 前缀，`message = coded?.[2] \|\| defaults.message`，原始消息直接丢掉。建议在 runner 里把原因附在 `cause`/diagnostic 上，不要改全局 `normalizeAppError` 的语义（会影响所有调用方） | P0 | S | — |
| G-5 | **TTS 链路加固**：单段并发上限、断线自动重试、代理/直连可配置 | 路线图 P0-5（`:139`）；实跑出现 ECONNRESET（`route-split…md:101,119`）。代理配置项是否已有【未核实】 | P0 | M | G-2 |
| G-6 | **默认模型决策**：`claude-sonnet-5-5` 在 moeapi 当前 key 分组下返回 404，要么换分组，要么默认改成 `gemini-3.1-pro-preview` | `route-split…md:100`；`technical-roadmap.md:207-209`。代码里没有写死这个模型，问题在用户配置 | P0 | S | 需要用户决策 |
| G-7 | **unknown 节点自动策略 + 统一重试预算**（VOX DAG 和 HTML runner 两套） | `technical-roadmap.md:100,120`；P2-2 | P1 | M | G-3 |
| G-8 | **vllmproxy 524 的空闲超时兜底**（生图），结果未知时不自动重发 | `route-split…md:102,120`；基础设计 S1（`code-video-foundation.md:431`） | P1 | S | G-2、G-3 |
| G-9 | 中转站能力探测：是否支持 `stream_options.include_usage`、reasoning/thinking、提示缓存，以及约 100 s 断流 | `code-video-foundation.md:482`（§13.4）；Lemo 成本取决于缓存（`lemo-faithful-mode.md:196`） | P3 | S | G-1 |

### 2.2 三条制作路线及其他产品线

**创意动画（Lemo v3）**

| 编号 | 事项 | 证据 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|---|
| L-1 | **✅ 已实现（待真实素材验收）**：素材通道。导入图片/视频，要求填写来源与许可；生成 `project/assets/MANIFEST.json`；视频（≤30 s）抽成 24 fps JPEG 序列；Agent 用 `list_files` 只能看到清单，用 `view_asset` 看缩略图，`assets/**` 只读；素材 sha256 写进 `contextHash` 和节点 inputHash；导出前做完整性复核；错误码 `LEMO_ASSET_{MISSING,CHANGED,UNSUPPORTED,TOO_LARGE,TOO_LONG,CORRUPT,CHANNEL,INTEGRITY}`。旧 v3 run（没有 `assetChannel`）的哈希不变 | `electron/lemo-upstream-assets.ts`、`electron/lemo-upstream-agent.ts`、`src/shared/creative-animation/agent-assets.ts`；测试 `tests/lemo-upstream-assets.test.ts` | P1 | — | — |
| L-2 | **✅ 已实现（默认关闭，待真实服务商验收）**：可选生图通道 `request_image`。纪实/证据两类风格禁用；单片上限默认 6 张，最多 12 张；付费调用前先写入 `image.json` 回执；结果未知时节点进入 unknown，不自动重发，用户确认无结果后才凭 `retryOfRequestId` 重试；免费恢复只查不买；透明主体用绿幕生成后在本地抠图 | 同上，加上 `electron/main.ts` 里的生图接线 | P2 | — | — |
| L-2b | 后续：恢复界面显示 `LEMO_IMAGE_REQUEST_UNKNOWN` 的专门文案；纪实类风格在成片里自动标注素材来源（目前只写进 MANIFEST，Agent 是否标注取决于风格文档） | `VoxProductionProgress.tsx` | P2 | S | L-1 |
| L-3 | v3 不支持锁定镜头混合续跑 | `electron/main.ts:3268`（`LEMO_LOCKED_SHOTS`） | P2 | M | — |
| L-4 | Lemo 轮数/预算上限要对用户可见、可配置（一条 16 s 片约 40 轮、14 分钟）。目前只有硬上限 `LEMO_AGENT_MAX_TURNS` | `electron/lemo-upstream-agent.ts:207`；`technical-roadmap.md:210` | P2 | S | 成本面板（U-5） |
| L-5 | 交付后由宿主复检（G6）：时长、24 fps、色彩标签、−14±1 LUFS、黑帧，外加上游 §11 署名 grep | `lemo-faithful-mode.md:176-179`。时长闸门已有（`LEMO_EXPORT_DURATION_MISMATCH`，`technical-roadmap.md:196`），其余几项【未核实】 | P2 | M | E-5 |
| L-6 | 预览一致性测试：`still.mjs` 和应用内预览在同一时刻各截一帧，比较感知哈希 | `lemo-faithful-mode.md:181` | P3 | S | — |
| L-7 | 上游同步到 `143f387a`（自带 Git Bash 分支），更新哈希清单 | `lemo-faithful-mode.md:144,216`（F0）；`vendor/lemo-upstream/storydream-upstream.json` 仍是 `f171360…`，代码里没有 `143f387a` | P3 | M | — |
| L-8 | 官方 Agent SDK（H1）生产接线 + 协议转换网关（F2/F3） | worker 目前只做探测（`findings.md:190`，`electron/lemo-agent-runtime.ts:3` 只引入了 probe 类型）；`messages-gateway.ts` 只接 Anthropic Messages；生产仍是"每轮一个动作"的自研循环（`electron/lemo-upstream-agent.ts:97`）。条款需法务确认（`lemo-faithful-mode.md:117`） | P3 | L | 法务、产品决策 |

**模板动画（Remotion）**

| 编号 | 事项 | 证据 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|---|
| T-1 | **响度 −20.7 → −14 LUFS**（见 E-1） | 实测 `route-split…md:109`；`electron/director-renderer.ts:213` 只在 `authoring.owner === 'creative-production'` 时默认打开 `normalizeAudio` | P1 | M | E-1 |
| T-2 | **✅ 已修复**：`css-register-property-shim.ts` 在 VOX/Lemo 原生场景代码之前注入，重复注册同名属性变为幂等，只吞 InvalidModificationError（`tests/css-register-property-shim.test.ts`）。原条目：**老模板项目动效预览报 `InvalidModificationError`**（预览 iframe 里重复 `CSS.registerProperty`） | `route-split…md:58`；`src/features/director-desk/DirectorMotionPreview.tsx:98` 用 `srcDoc` 的 iframe；全仓 grep `registerProperty` 为 0，没有 shim。修法见 `technical-roadmap.md:147` | P1 | S | — |
| T-3 | 生图 524、配音 unknown 只能人工 `retry-unknown` | `route-split…md:120,127` | P1 | — | G-3、G-7 |

**HTML 动画**

| 编号 | 事项 | 证据 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|---|
| H-1 | **✅ 已实现（随 G-4）**。原条目：吞错（同 G-4）；配音失败的确切请求次数被 `HTML_VIDEO_VOICE_FAILED` 掩盖 | `route-split…md:121` | P0 | S | — |
| H-2 | 响度 −20.9 → −14 LUFS | `src/shared/html-video.ts:294`（`normalizeAudio` 需要显式打开）；实测 `route-split…md:110` | P1 | S | E-1 |
| H-3 | **✅ 已修复**：诊断信息改为 `readinessDiagnostics` 属性和日志，消息去掉重复 `Error:` 和本地路径，`html-video` 2 个捕获契约测试恢复通过。原条目：场景图片加载失败的错误被包了两层 `Error:`（捕获契约 2 个测试失败） | `tests/html-video.test.ts:1957`；`electron/html-video-scene-ready.ts:16` | P1 | S | — |
| H-4 | 分辨率/fps 默认值不一致：实测成片 1280×720；`html-video-runtime.ts:35` 默认 24，而 `:1012` 的兜底是 30 | 【未核实 720p 是否只是这次的配置】 | P2 | S | E-6 |
| H-5 | 生图次数多（一条约 11 次），成本偏高 | `technical-roadmap.md:45,47` | P3 | M | U-5 |
| H-6 | 用户需确认：P0-4 和 P1-1 都要改动 HTML 路线 | `technical-roadmap.md:212` | P0 | — | 用户决策 |

**音乐 MV / AI 漫剧 / 短片（Pixelle、素材池）**

| 编号 | 事项 | 证据 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|---|
| M-1 | 用原曲 + 默认模型完整生成一遍做验收：真实转写返回 HTTP 402（余额不足） | `task_plan_music_mv_sync.md:17`；`task_plan.md:41` | P2 | S | 充值/换服务 |
| M-2 | 不支持逐字 LRC | `src/shared/music-mv-plan.ts:122`；`src/features/music-mv/MusicMvPage.tsx:117` | P3 | M | — |
| C-1 | **漫剧真实样本回放失败**（S13–S16 句段不存在） | `tests/motion-comic-live-sample.test.ts`（3 个失败） | P1 | S–M | — |
| C-2 | 远程连续性、口型、完整上传下载恢复都没验收 | `design-qa.md:132,147` | P3 | L | — |
| S-1 | MoneyPrinter 网络素材检索没接入（代码里没有 pexels/pixabay），专用素材服务的密钥也缺 | `task_plan.md:11,108,132`；`docs/plans/2026-10-24-creative-animation/remaining-work-implementation-plan-2026-10-31.md` §3 | P2 | L | 素材服务密钥 |
| S-2 | 剪映应用实际打开草稿，以及真实 AI 美术/听审验收 | `task_plan.md:12,110,180` | P2 | M | — |

### 2.3 渲染 / 混流

| 编号 | 事项 | 证据 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|---|
| E-1 | **共用 Encoder**：把 `finalizeLemoUpstreamFilm`（两遍 loudnorm −14/TP −1.2、AAC 256k、crf 19）下沉到模板和 HTML 成片之后 | `technical-roadmap.md:143-144`（P1-1）。loudnorm 只出现在 `electron/lemo-upstream-video.ts:402` 和 `src/shared/storybound-sidecar.ts:1760`，后者的目标是 **I=−16/TP=−1.5**，只在 `normalize_audio` 为真时执行（`storybound-sidecar.ts:1906-1913`） | P1 | M | 决策 −14（`code-video-foundation.md:444`） |
| E-2 | **SceneRuntime 协议（`window.__hf`/`__sd`）+ CaptureHost**，替换多套 seek 垫片和采集循环 | grep `SceneRuntime`/`CaptureHost`/`window.__hf` 都是 0；`capturePage(` 分散在 `electron/html-video-renderer.ts:101,226,285`、`electron/lemo-upstream-renderer.ts:204`、`electron/editorial-qa.ts:495` | P2（路线图列为 P1-2） | L | 黄金帧测试 |
| E-3 | AudioTimeline 整条时间线一次性渲染 + 只编码一次（S4） | `code-video-foundation.md:338-349,434`。现有的 `AudioTimeline` 只是数据类型（`src/shared/production-audio.ts:135` 等），和底座设计不是一回事【未核实其语义差异】 | P2 | L | E-2 |
| E-4 | 核实色彩标签：场景段已设 bt709/tv（`storybound-sidecar.ts:1728-1732`），Lemo 用 `LEMO_COLOR`（`lemo-upstream-video.ts:439`）；但时长补齐那次重编码只写了 `-pix_fmt yuv420p`，没带色彩参数（`storybound-sidecar.ts:1884-1893`），可能把标签丢掉 | 历史问题见 `code-video-foundation.md:467`。需要对新成片跑一次 ffprobe【未核实】 | P1 | S | — |
| E-5 | 统一质量闸门：首/中/尾帧黑帧检查、缺字体、错误码前缀、续跑 | `technical-roadmap.md:192-201` | P2 | M | E-1 |
| E-6 | fps 决策（24 还是 30）；采集帧格式（管道 BGRA 还是 JPEG q95）用基准测试决定 | `code-video-foundation.md:443,445,476` | P3 | S | — |
| E-7 | GSAP 许可风险：现在打包的是 3.12.5（devDependencies），生成代码建议改用 WAAPI/CSS/Anime.js | `code-video-foundation.md:479`，待法务确认 | P2 | M | 法务 |

### 2.4 编排 / 存储

| 编号 | 事项 | 证据 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|---|
| O-1 | **去掉整文档快照**：VOX 每个节点写 `{before: 整个文档, result}`；Lemo 每轮写一份 `journal.film` | `electron/main.ts:3221-3223`；`electron/lemo-upstream-agent.ts:255`；`technical-roadmap.md:118`（单个 100–120 KB × 每节点），`code-video-foundation.md:432`（约 1.45 GB） | P1（路线图 P2-3） | M | 恢复逻辑 `main.ts:3225-3231` 依赖 `before` 计算输入 hash，要一起改 |
| O-2 | VideoSpec/Timeline 统一数据模型（只用于新项目） | grep `VideoSpec` 为 0；`technical-roadmap.md:165` | P2 | L | — |
| O-3 | 统一执行器（场景并行、失败隔离、先配音后分镜） | `technical-roadmap.md:166`；目前是两套：`electron/vox-production-runtime.ts` 和 `src/shared/html-video-runner.ts` | P2 | L | O-2、G-7 |
| O-4 | 数据库损坏的兜底：先隔离到 `.malformed`，再尝试恢复 temp，都失败就**静默开一个空库** | `src/shared/storage.ts:883-897`。UI 有没有提示用户【未核实】 | P2 | S | — |
| O-5 | 大文件拆分：`electron/main.ts` 6891 行、`src/shared/storage.ts` 5308、`src/shared/runner.ts` 3225、`electron/editorial-qa.ts` 3206、`electron/html-video-runtime.ts` 2700。`main.ts` 也是 B 类测试脆弱的根源 | 行数统计 | P3 | L | T-2 |
| O-6 | 评估 better-sqlite3（先把大字段移出） | `code-video-foundation.md:446` | P3 | M | O-1 |

### 2.5 UI / UX

| 编号 | 事项 | 证据 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|---|
| U-1 | **✅ 已修复**：`src/app/app-version.ts` 从 package.json 读取，设置页和浏览器兜底都用它；`app-version` 测试改为行为断言。原条目：**版本号写死**：设置页显示 V1.0.0，实际包版本 1.0.3 | `src/features/settings/SettingsPage.tsx:876`；`src/app/browser-fallback.ts:1108` | P1 | S | — |
| U-2 | **✅ 已实现**：摘要显示“与 <主机> 连接中断（ECONNRESET）”、DNS 失败主机、52x 网关错误“结果可能未知”。原条目：错误详情显示底层原因（主机、错误码），比如"与 openspeech… 连接中断（ECONNRESET）" | `technical-roadmap.md:138`；`src/components/ErrorDetails.tsx:26` | P0 | S | G-4 |
| U-3 | **✅ 导入界面已实现**：在“自动制作设置”里导入图片/视频，填写出处、许可和画面说明，并提供“允许 AI 生成插画”开关和数量上限。剩余：纪实类风格在画面上标注来源（见 L-2b） | `CreativeProductionFields.tsx`；测试 `tests/lemo-material-ui.test.ts` | P1 | S | L-1 |
| U-4 | 模型降级记录、unknown 处理策略对用户可见 | P0-1/P0-3 验收 | P1 | S | G-1、G-3 |
| U-5 | 成本面板：按项目统计 LLM/生图/TTS 次数和估算费用 | `technical-roadmap.md:188` | P3 | M | G-3 |
| U-6 | 根据模型能力自动推荐路线（T1/T2/T3）或降级 | `technical-roadmap.md:186` | P3 | M | G-1 |
| U-7 | 无障碍专项：键盘顺序、读屏、系统缩放 | `design-qa.md:78` | P3 | M | — |

### 2.6 测试与 CI

| 编号 | 事项 | 证据 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|---|
| Q-1 | **处理 44 个失败用例**：A 类更新断言或改成行为测试；B 类修骨架；C 类逐个确认（C4 漫剧样本优先）；D 类调超时 | §1.2 | P1 | M | — |
| Q-2 | 源码字符串断言 → 行为断言（降低重构成本） | A/B 类，共约 26 个用例 | P2 | M | O-5 |
| Q-3 | **✅ 已实现**：`npm run verify`（`scripts/verify.mjs`：上游哈希 → tsc×3 → eslint → 全量 vitest，对比 `tests/known-failures.json` 只在**新增**失败时报错，修好的会提示从基线删除）；`npm run lint`（`eslint.config.mjs`，只开会抓真缺陷的规则，顺手修了 `MusicLabPage` 里被误判为 Hook 的 `useInMv`）；`.github/workflows/verify.yml`（`--ci` 模式容忍依赖本地 vendor 的测试）。原条目：**没有 CI**（没有 `.github/`），也没有 lint 配置（没有 eslint/prettier）；`package.json` 没有一键 `verify`（tsc×3 + vitest） | 仓库根目录 | P1 | S | — |
| Q-4 | 本地模拟中转站做故障注入测试（ECONNRESET、TLS、524、429、截断） | P0-2 验收 `technical-roadmap.md:136`；`code-video-foundation.md:399` | P0 | M | G-2 |
| Q-5 | 黄金帧测试、适配器契约测试 | `code-video-foundation.md:386-397` | P2 | M | E-2 |
| Q-6 | 真实回归集（每条路线 2–3 个固定题材，人工触发，有预算，归档成片和响度），以 2026-11-10 那轮为第一版基线 | `technical-roadmap.md:187`；`code-video-foundation.md:421` | P3 | M | U-5 |
| Q-7 | `licensing.test.ts` 在并行负载下不稳定 | 已知 | P2 | S | — |

### 2.7 打包发布

| 编号 | 事项 | 证据 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|---|
| P-1 | **1.0.3 发布受阻**：SSH 在协议握手前就断开，生产签名版本仍是 1.0.2 | `docs/plans/differential-updates/task_plan.md:11-13`；`progress.md`（同目录）"Next action" | P1 | S | 服务器控制台 |
| P-2 | **没有代码签名**：`build.win.signAndEditExecutable: false`；`appId: "local.storydream"` | `package.json` 的 build 段 | P1 | M | 证书采购 |
| P-3 | 在干净 Windows 上做安装验收：`vendor/python`（含 playwright-browsers）、Lemo render root 暂存、ffmpeg 别名都要在安装目录/用户目录下跑通 | `task_plan.md:181`；`electron/lemo-upstream-video.ts:61,165`【未核实安装版】 | P1 | M | — |
| P-4 | SDK worker 和原生 CLI（约 301 MB）没进 `extraResources`（只有走 H1 时才需要） | `findings.md:192` | P3 | S | L-8 |
| P-5 | **✅ 已处理**：`*.bak` 已忽略；硬编码版本由 U-1 的 `app-version` 行为测试守住。原条目：`package.json.bak` 遗留；发版前检查硬编码版本（U-1） | 仓库根目录 | P2 | S | — |
| P-6 | 第三方署名覆盖：HyperFrames Apache-2.0、Lemo 样片 CC-BY-4.0 | `THIRD_PARTY_NOTICES.md`；`code-video-foundation.md:461` 【未核实覆盖是否完整】 | P2 | S | — |

### 2.8 仓库整理（只给建议，没有删除任何东西）

| 编号 | 事项 | 证据 | 优先级 | 工作量 |
|---|---|---|---|---|
| R-1 | **✅ 已处理（选“忽略 + 构建校验”）**：两个上游树加入 `.gitignore`；`build-electron.mjs` 和新的 `scripts/verify.mjs` 都强制跑 `--verify` 哈希校验，缺失时报出导入命令和固定 revision。原条目：**`vendor/lemo-upstream`（109 MB/2520 文件）和 `vendor/pixelle-upstream`（10.6 MB）既没跟踪也没忽略**，但已提交的代码和 `extraResources` 都依赖它们。新克隆的仓库无法构建。二选一：要么加进 `.gitignore`，在构建里强制跑 `scripts/import-lemo-upstream.mjs` / `import-pixelle-upstream.mjs` 并校验哈希；要么纳入跟踪（LFS 或子模块） | `git status`；`.gitignore:11`（只忽略了 `vendor/python/`） | P1 | S |
| R-2 | **✅ 按用户决定只加 `.gitignore`、不移动文件**：①–⑤ 各类已忽略，`git status` 只剩 4 个待归档的过程文档（见 D-2）。原条目：根目录杂项分类：①**非本项目**的申报/汇报材料（平顶山×13、AI·OPC×4 docx、`OPC方案优化研讨.m4a`、PPT 相关 md、`_ppt_outline_*`）→ 移出仓库；②**机器维护脚本**（`disk_*.ps1/md`×13、`configure_pagefile_admin.ps1`、`lghub_cache_result.txt`、`pagefile_config_result.txt`）→ 移到个人工具目录；③**演示/实验产物**（`pelican-*`×21、`fal*.html`、`seedvr2.html`、`flashvsr.html`、`bytedance.html`、`concept-*`、`generate-concept.ps1`、`prompt-scenes-*.txt`）→ 归档；④**临时文件**（`temp_*`、`test_*.txt`、`test_dv.verified.xlsx`、`temp_test.js`、`test-electron-*.{mjs,cjs}`、`.tmp-navigation-new.ts`、`.tmp-settings-config-contract.txt`、`@AutomationLog.txt`、`do_patch.py`、`do_update.py`、`append_all.py`、`build_panel.js`、`package.json.bak`）→ 删除；⑤`free-api-router/`（0.2 MB）判断是否独立仓库 | `git status --short` | P2 | S |
| R-3 | **✅ 已加忽略（没有移动/删除任何文件）**：`.codex-temp/ .tmp/ .tmp-* tmp/ output/ outputs/*/ projects/ concept-output/` 以及 R-2 列出的根目录个人材料/实验产物/临时文件都已加入 `.gitignore`（全部锚定根目录，`src/features/projects/` 不受影响）。`.artifacts` 归档仍需人工决定。原条目：大目录：`.artifacts` 10.3 GB（已忽略）、`release` 4.6 GB（已忽略）、**`.codex-temp` 2.4 GB（没忽略）**、`.worktrees` 2.25 GB、`.codex-audit-temp` 1.25 GB、`.tmp` 535 MB、**`projects/` 370 MB（没忽略）**、`_ppt_outline_qa` 90 MB、`.tmp-codex` 67 MB、`tmp/` 29 MB、`output/` 18 MB。建议把 `.codex-temp/ .tmp/ .tmp-codex/ tmp/ output/ outputs/ projects/` 加进 `.gitignore`；`.artifacts` 按日期归档（保留 `real-route-qa` 基线） | 目录统计 | P2 | S |
| R-4 | worktree 回收：已合并的 4 个可以移除（`codex/storybound-music-mv`、`storyboard-prompt-edit`、`storydream-local-hardening`、`draft-template-export-link`）；没合并的 2 个要决策（`codex/account-credits-implementation` 领先 2 个提交，09-16，涉及积分/商业交付；`codex/storydream-project-plan-20261102-upload` 领先 1 个提交）。本地分支共 20 个 | `git worktree list`；`git rev-list` | P2 | S |

### 2.9 文档

| 编号 | 事项 | 证据 | 优先级 | 工作量 |
|---|---|---|---|---|
| D-1 | README 过时（2026-06）：没写三条路线、vendor 导入、内置 Python/Playwright、`tsconfig.scripts.json`、测试命令和已知失败 | `README.md:1-44` | P2 | S |
| D-2 | 根目录过程文件（`task_plan.md`、`progress.md`、`findings.md`、`*_music_mv_sync.md`、`storybound_gap_*`、`design-qa.md`）→ 移到 `docs/archive/`，并把还没完成的项迁进本清单 | 根目录 | P2 | S |
| D-3 | 修正 `route-split…md:133-134` 的测试结论（全量实际失败 44 个） | §1.2 | P2 | S |
| D-4 | 汇总路线图"风险与待决策"（`technical-roadmap.md:205-217`）、基础设计 §12、faithful §9，做成一份决策记录（ADR） | — | P1 | S |

---

## 3. 已规划但过时 / 可以删除的项

| 项 | 位置 | 判断 |
|---|---|---|
| `FRONTEND_REFACTOR_README.md`、`REFACTOR_COMPLETION_REPORT.md`、`前端重构完成说明.md` | 根目录（未跟踪） | **过时**。标注"版本 2.0.0-refactor，日期 2025-01"，自称"重构已完成"，清单却还开着（`REFACTOR_COMPLETION_REPORT.md:305-361`，`FRONTEND_REFACTOR_README.md:157-163`）。`redesign.css` 等文件还在。建议删除或归档，有价值的 token 规范并入设计系统文档 |
| `storybound_gap_findings/progress/task_plan.md`（06-17） | 根目录 | **基本过时**：MiniMax 克隆音色已经实现（`src/shared/minimax-clone-voices`、`src/app/app-state.ts:10`）；积分扣减在没合并的 worktree 里（R-4） |
| `disk_cleanup_*.md` 和 `disk_*.ps1` | 根目录 | 和项目无关（本机磁盘维护） |
| 平顶山 / AI·OPC 材料 | 根目录 | 和项目无关 |
| 基础设计 S0 的"修好 6 项失败测试" | `code-video-foundation.md:430` | 数字过时（现在是 44 个） |
| 基础设计 §13.5"Remotion 挂在创意动画 → Vox 分层动画下面，建议移到独立入口" | `code-video-foundation.md:489` | **已完成**（路线拆分后有独立的"模板动画"入口，`route-split…md:9-16`） |
| 基础设计 §1/§7.2 关于 Lemo 和成片采集的旧表述 | `code-video-foundation.md:486-487` | 已被 §13.5 和上游出片取代 |
| faithful §4.2 的判断"v3 失败的根本原因是自制协议（每轮 1 个动作）" | `lemo-faithful-mode.md:122` | **被实测推翻了一部分**：现行 v3 仍是每轮一个动作，但用 gemini-3.1-pro-preview 跑 38 轮出了合格成片（`route-split…md:108,119`）。H1/F2/F3 应该从"必须"降为"可选，看质量和成本再说"（L-8） |
| faithful F0"淘汰 `vendor/lemo-opuscar`" | `lemo-faithful-mode.md:216` | **暂时不能删**：v2 旧项目还依赖它（`src/shared/creative-animation/styles.ts:85` 等 13 处引用），要等 v2 迁移或只读兼容方案确定 |
| `docs/plans/2026-11-09-code-video-platform-plan.md`（标"草案，待确认"） | 第 1 行 | 已被 `2026-11-10-technical-roadmap.md` 取代，建议标记 superseded |
| `task_plan.md` 里"第四阶段：Lemo 官方插件与 Agent SDK 宿主" | `task_plan.md:77,109,176` | 并入 L-8 待决策，不再作为默认路径 |
| 基础设计 §13.3"成片帧 PNG 落盘" | `code-video-foundation.md:476` | 文档里已经改成管道或 JPEG，原方案作废 |

---

## 4. 建议的执行顺序（里程碑）

**M0 基线收口（约 2–3 天，零付费）**
1. 决策：默认模型（G-6）、是否允许改 HTML 路线（H-6）、响度目标 −14（E-1）、素材版权口径。整理成决策记录（D-4）。
2. 修小而确定的问题：G-4/H-1（runner 附带原因）、H-3（双层 Error）、T-2（`registerProperty` 用新 iframe 或加 shim）、U-1（版本号从 `package.json` 注入）。
3. 测试：先排查 C4 漫剧样本，然后 Q-1（A/B/C/D 分类处理），Q-3 加 `verify` 脚本。目标是全量绿灯，或者只剩明确登记的豁免。
4. 仓库：R-1（vendor 策略）、R-3（.gitignore）、R-4（回收已合并的 worktree），根目录杂项（R-2）只移动不删除，先征得同意。

**M1 P0 稳定性（约 1.5–2 周）**
G-2 错误分类 + Q-4 故障注入 → G-1 能力档案和降级链 → G-3 回执和幂等账本（复用 `services/lemo-agent-worker/request-ledger.ts` 的设计）→ G-5 TTS 加固 → G-7/G-8 unknown 策略和 524 兜底 → U-2/U-4 界面可见。
验收：对 11-10 那轮故障做回放，不产生二次计费；主模型 404 时 Lemo 照样出片，切换有记录。

**M2 P1 出片一致 + 发布（约 1.5–2 周）**
E-1 共用 Encoder（T-1/H-2）→ E-4 色彩核实 → O-1 去掉整文档快照 → L-1/U-3 素材通道真实素材验收（代码已完成）→ P-1 发布 1.0.3 → P-2 签名 → P-3 干净机器安装验收。
验收：三条路线成片都在 −14±1 LUFS、TP ≤ −1 dB；磁盘增长明显下降。

**M3 P2 新管线（只用于新项目，3–5 周）**
O-2 VideoSpec → E-2 SceneRuntime + CaptureHost（加 Q-5 黄金帧）→ E-3 AudioTimeline/一次编码 → O-3 统一执行器 → E-5 统一闸门。同时推进：L-2 生图通道真实服务商验收（代码已完成，默认关闭）、L-3 锁定镜头、S-1 网络素材、S-2/M-1 剪映和 MV 实测验收、E-7 GSAP 许可。

**M4 P3 产品化**
U-5 成本面板 → Q-6 真实回归集（每次发版跑）→ U-6 路线推荐/模型分层 → L-8 官方 SDK（看法务和质量数据）→ O-5/Q-2 拆大文件、测试改成行为断言 → L-6/L-7 上游一致性和同步 → U-7 无障碍。

---

*附：本次运行的命令*
- `node node_modules/typescript/bin/tsc -p {tsconfig.json|tsconfig.electron.json|tsconfig.scripts.json} --noEmit` → 三个都是 0
- `node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=dot` → 19 个文件 / 44 个用例失败，6 个 unhandled（输出 `.tmp/vitest-out.txt`）
