# Lemo 贴近上游模式设计（Lemo Faithful Mode）

日期：2026-11-09。状态：设计稿，未改代码。
上游：https://github.com/lemomo-ai/lemo-opuscar 。本地副本 `vendor/lemo-upstream`（revision f171360，已有哈希清单 `storydream-upstream.json`；提交日期未核实）；线上 main 最新是 143f387a（2026-11-08 19:46 +11:00，已核实）。
关联：[底座设计](2026-11-09-code-video-foundation.md)、[生态调研](../research/2026-11-09-code-to-video-landscape.md)。

---

## 0. 结论

1. **“贴近”指以下五个层面和上游一致**：内容、目录结构、工作流、工具、产物和质检。StoryDream 不再自己发明“Lemo 流程”，而是**把上游原样跑起来**，宿主只做三件事：提供运行环境、控制权限、记账。
2. **这样做为什么可行**：
   - 上游的工具本来就是独立命令行，有固定的退出码：still / video / readcheck / sheet / mux / tts / asr_check；
   - 它通过 `PLAYWRIGHT_CHROME` 环境变量支持外部浏览器；
   - 它能在 Windows 的 Git Bash 下运行，本机已经装了 Git Bash；
   - 它的页面协议和 StoryDream 现有的 Lemo 运行时一致。
3. **最贴近、又能让不同模型都用上的做法**：
   - 用**官方 Claude Agent SDK 加载上游原版插件**，也就是和上游完全同一套 agent 循环、同一套工具；
   - 非 Claude 模型经过**本机协议转换网关**接进来（Anthropic Messages ⇄ OpenAI Chat / Responses，可参考 MIT 许可的 claude-code-router）；
   - 这样所有模型走的都是同一个 agent、同一份文档、同一组工具和检查。模型之间只有“导演能力”的差别，流程本身没有差别。
4. **必须偏离上游的地方只有 8 处**（见 §5），全部放在上游文件之外，**不修改任何上游文件**。
5. **前提条件是磁盘**：讲中文旁白的片子，最小运行环境约 1.4–1.7GB。现在 I 盘只剩 0.7GB，C 盘只剩 4.0GB。

---

## 1. StoryDream 现有四代 Lemo 接入和上游差在哪

| 维度 | 上游 | v1 整片 HTML | v2 分文件 JSON 补丁 | v3 自制 6 工具 | SDK worker |
|---|---|---|---|---|---|
| 内容 | 66 种风格，原样 | 只抽取片段 | 旧的 59 种纯文本副本 | 66 种 | **原版插件，三个文件锁定哈希** |
| 目录结构 | `<name>/`：index.html、TREATMENT.md、timeline.js、scenes、build.sh、CREDITS、out/ | 单个 HTML | 宿主自定 shared / scene / director 文件 | 部分一致 | 一致 |
| 工作流 | 模型按 AGENTS → DIRECTOR §1–11 自己导演 | 宿主一次要整片 | 宿主拆好批次 | 模型自己导演，但每轮只能做 1 个动作、上限 64 轮 | 一致 |
| 工具 | Read / Write / Edit / Glob / Grep / Bash（运行 core 下的命令）/ AskUserQuestion / 看图 | 没有 | 没有 | 自制 list / read / write / replace / review_frames / finish，**没有 Bash**，只在 3 个时刻截帧 | 一致（现在全部被禁用） |
| 渲染和质检 | still.mjs、video.mjs、readcheck、sheet.py、asr_check、mux.sh | 宿主渲染 | 宿主渲染 | 宿主渲染，3 帧 | 未启用 |
| 声音 | tts / tts_zh、sampler / sfx、mix.py、mux 两遍响度 −14 | 宿主 TTS | 宿主 TTS | 宿主 | 未启用 |
| 实测 | 上游样片 | 被截断 | 推理吃掉了输出额度 | 生成 0 个文件 | 只做过离线验证 |

**结论**：v1–v3 都在“宿主替 Lemo 做主”，这正是偏离上游、反复出错的原因。SDK worker 方向是对的，但还没接入生产。

---

## 2. 上游原样保留

- **内容**：
  - 同步到 143f387a。这次同步会带来（已对照 main 核实）：
    - TECHNIQUE 写明 Windows 可以用 Git Bash；
    - video.mjs 遇到 WebGL 丢失上下文时让所有 worker 正常退出，Windows 上不留残余；
    - Windows 字体相关修复；
    - core/README 新增 swiftshader 说明、TEXTS 的 `pass: true`；
    - DIRECTOR 新增 §13 Maps。
  - 沿用 `storydream-upstream.json` 的逐文件 sha256 清单，启动时校验，**任何改动都拒绝运行**。
- **不改任何上游文件**。宿主需要补充的说明放进 `vendor/lemo-host-overlay/HOST.md`，作为一条附加的系统说明注入，内容只写环境事实：Windows 路径、Python 位置、AskUserQuestion 由应用弹窗回答、可用的磁盘空间。
- **淘汰** `vendor/lemo-opuscar`（3961ddb，59 种，v2 专用）和 `vendor/lemo-native-core`；v1、v2、v3 改为只读兼容。
- **许可**：
  - 代码和文档 MIT，保留 LICENSE；
  - demo 媒体是 CC BY 4.0，只有在复用时才需要署名；
  - 6 段配音不得复用；
  - 用户自己的片子不加 LemoLab 署名（上游 AGENTS.md 的原话），但必须写 CREDITS（DIRECTOR §11）。

---

## 3. 运行环境：复刻 `setup.sh deps`，但离线并锁定版本

上游的 `setup.sh` 会联网 clone 和更新仓库，而 worker README 明确禁止自动更新。所以宿主要**按 `setup.sh` 的步骤，用锁定版本复刻安装**，装出来的包和版本必须和上游一致。

| 上游要求 | 本机现状（2026-11-09 实测） | 处理 |
|---|---|---|
| Node 20+ | 系统里有 Node v20.19.5；Electron 41 也可以用 `ELECTRON_RUN_AS_NODE` 充当 Node | 发行版用 Electron 自带的 Node，开发环境用系统 Node |
| `$LIB/node_modules`：playwright-core ^1.63、three ^0.170（有 package-lock） | 没有 | `npm ci` 严格按上游 lockfile 安装，约 45MB |
| 无头浏览器 | 本机有 `ms-playwright/chromium_headless_shell-1169`（197MB）；playwright-core 1.63 默认要求 rev 1243（Chromium 153） | 先用 `PLAYWRIGHT_CHROME` 指向本机已有的 1169 做兼容测试（上游文档本身就支持外部浏览器）；不兼容再下载 1243，约 200MB |
| ffmpeg 7+ | 内置 imageio_ffmpeg 自带 7.1 essentials | 加到 PATH |
| Python 3.11+，`$LIB/.venv`，requirements.txt：numpy、scipy、soundfile、soxr、pillow、fonttools | 内置 Python 3.12.4；已有 numpy、PIL、onnxruntime、faster_whisper；**缺 scipy、soundfile、soxr、fonttools** | 用内置 Python 建 `.venv`，按 requirements 安装 |
| voice 档：kokoro-onnx、edge-tts、faster-whisper、av<19，加 Kokoro 模型 | 缺 kokoro_onnx、edge_tts | 安装，约 0.55GB；中文 Whisper small 约 480MB，首次使用时下载，可以设置 `HF_ENDPOINT` 镜像 |
| music 档：numba（只有 pluck.py 需要） | 缺 | 按需安装，约 140MB |
| `sh` | Git Bash：`C:\Program Files\Git\bin\bash.exe` | 设置 `CLAUDE_CODE_GIT_BASH_PATH`（worker 已经这样做） |
| Kokoro 要求库路径少于 160 字节（espeak-ng 的限制） | `I:\opc\vendor\lemo-upstream` 满足 | 安装器检查路径长度 |

**磁盘预算（讲中文旁白的片子）**：

| 项 | 大小 |
|---|---|
| node_modules | 45MB |
| 浏览器 | 0 / 200MB |
| core venv | 约 150MB |
| voice | 550MB |
| Whisper small | 480MB |
| Claude Agent SDK 原生 CLI | 约 301MB |
| **合计** | **约 1.5–1.7GB** |

再加上每支片子的工作目录：源码约 141KB（上游均值），渲染中间文件约 0.2–0.5GB。

---

## 4. Agent 执行：所有模型走同一套上游循环

### 4.1 首选 H1：官方 Claude Agent SDK + 原版插件 + 协议转换网关

```
StoryDream UI ──▶ lemo-agent-worker（独立 Node 进程，现有）
                    └─ Claude Agent SDK（加载 vendor/lemo-upstream/plugin，skill = lemo-opuscar）
                         └─ ANTHROPIC_BASE_URL = 127.0.0.1:<port>（现有 messages-gateway：fsync 账本、单次凭据）
                              ├─ 模型档案是 Anthropic Messages → 直接转发（Claude Opus / Sonnet）
                              └─ 模型档案是 Chat / Responses → 协议转换（tools ⇄ function calling、image、stream）
                                   → GPT / Gemini / DeepSeek / Qwen …（经各个中转）
```

- **为什么最贴近**：上游就是给 Claude Code / Agent SDK 写的，AGENTS.md 甚至直接点名 `AskUserQuestion` 工具。用 SDK，就是同一个系统提示、同一套工具语义、同一套上下文压缩，以及会话续接。
- **为什么不同模型都能用**：模型差异全部被挡在网关这一层，agent 循环、文档、工具、检查都不变。
- **网关要新增的能力**：现有网关的原则是“只接 Anthropic Messages、不静默降级”。新增转换器时必须是**显式的、可验证的转换**：
  - 工具：tool_use / tool_result 和 function_call / tool 消息逐字段互转；
  - 图片：Anthropic 的 image 块转成 `image_url`（data URL）；
  - 流式：SSE 事件互转；
  - 结束原因：stop_reason 和 finish_reason 互相映射；
  - 用量：usage 规范化，包括推理 token；
  - 不支持工具或图片的模型**拒绝接入**，并明确告诉用户，不偷偷降级。
- **账本**：沿用 `request-ledger.ts`，发出请求前先 fsync 记“已提交”；出现 unknown 就阻断后续请求，SDK 内部的重试也在网关层计数。
- **许可**：Claude Agent SDK / CLI 适用 Anthropic 自己的条款，不是 MIT。**通过网关接非 Anthropic 模型是否被条款允许，需要法务确认。** claude-code-router 是 MIT（已核实许可，星标数未核实），可以参考它的转换实现。

### 4.2 备选 H2：自研“Claude Code 兼容 harness”
如果 SDK 的条款或体积不能接受，就在宿主里实现**同名、同语义**的工具（Read / Write / Edit / Glob / Grep / Bash / AskUserQuestion / TodoWrite / Skill），使用各协议原生的 tool calling（需要先在底座 S1 补上 tools 支持，现在 tools 字段会被删掉）。

**代价**：系统提示、上下文压缩、工具细节都和 Claude Code 不完全一样，所以贴近程度比 H1 低一档。v3 失败的根本原因就是自制协议：每轮只能做 1 个动作、没有 Bash、只截 3 帧。H2 必须避免这些问题：一轮允许多个工具调用、Bash 运行上游命令、任意时刻都能出静帧。

### 4.3 工具权限（`canUseTool` 白名单，H1 和 H2 共用）

| 工具 | 允许范围 | 拒绝 |
|---|---|---|
| Read / Glob / Grep | 项目目录，加上 `$LIB` 只读（文档、core、styles） | `$LIB` 以外的路径；**`styles/<slug>/DEMO.md` 和 `demo/` 在 `TREATMENT.md` 写好之前一律拒绝**，Edit & Documentary 类风格按上游规则例外。这是上游自己定的规则，由宿主代为执行 |
| Write / Edit | 只限项目目录 | `$LIB`（上游明确要求不在 `styles/` 里构建） |
| Bash | 只允许上游命令：`node core/render/{still,video,events,readcheck}.mjs`；`.venv/.../python core/{render/sheet.py,render/srt.py,tts/tts.py,tts/tts_zh.py,tts/asr_check.py}`；`sh core/render/mux.sh`；项目内的 `sh build.sh`、`python mix.py`、`python score.py`；`ffprobe`；`grep`、`ls`、`cp`、`mkdir`、`mv`（限项目内）；`setup.sh demo <slug>` 改为本地拷贝 | 网络命令（例外：`tts_zh.py` 调 edge-tts 需要用户开关允许）；`setup.sh` 的更新和 clone；`$LIB` 写入；管道到 shell；任何不在白名单里的可执行文件 |
| AskUserQuestion | 转成 StoryDream 的对话框，包括上游要求的第一问“Language 语言” | — |
| Read 图片 | 静帧和联系表直接回传给模型看图，这是上游审片闭环的核心 | 模型不支持看图时，在开工前就拒绝 |
| WebFetch / WebSearch | 默认拒绝（DIRECTOR §2 的“先找参照”可以由用户手动提供素材） | — |

**注意**：白名单和 cwd 都不是操作系统级的沙箱（worker README 自己也写了）。生产环境要加上：Windows 作业对象限制进程树、独立的低权限运行目录、可执行文件路径锁定。

---

## 5. 必须偏离上游的 8 处（全部在上游文件之外）

| # | 偏离 | 原因 | 怎么做到偏离最小 |
|---|---|---|---|
| 1 | 不运行 `setup.sh` 的联网更新，由宿主复刻安装 | 离线、锁定版本、可复现 | 同样的 lockfile 和 requirements；同步上游改为显式的“升级版本”操作，并通过哈希校验 |
| 2 | Windows 上用 Git Bash，而不是 WSL | 上游 TECHNIQUE §1 写的是“Windows 用 WSL”，143f387a 已经加了 Git Bash 支持 | 同步到 143f387a 后，用上游自己的 Windows 路径分支 |
| 3 | AskUserQuestion 由应用弹窗回答 | 应用里没有终端 | 问题文本和选项原样显示 |
| 4 | Bash 白名单 | 安全 | 白名单正好覆盖 core/README 里列出的全部命令 |
| 5 | DEMO 读取门禁由宿主执行 | 上游规则只靠模型自觉 | 规则内容和上游完全一致，宿主只负责强制执行 |
| 6 | 渲染时加 `LEMO_COLOR=bt709` | 上游默认输出全范围；StoryDream 实测成片发灰的问题要统一解决 | 这是**上游自己提供的开关**，不是补丁 |
| 7 | 模型调用经过本机网关记账，非 Claude 模型做协议转换 | 防止重复扣费，并支持多种模型 | 只转换协议，不改请求内容；不支持的能力直接拒绝 |
| 8 | 竖屏（9:16）等画幅 | StoryDream 常做竖屏 | 作为用户需求写进 brief，交给上游自己的 `--size 1080x1920` 处理，宿主不强行改画面 |

**不偏离的部分**：
- 风格内容；
- 片长默认 30–60 秒（超过 2–3 分钟先提示用户，这是 DIRECTOR 的原则）；
- 24fps；
- 响度 −14 LUFS；
- “只修一轮”；
- “至少 4 处和 demo 不同”；
- 交付清单（§11）。

---

## 6. 工作流：上游文档驱动，宿主只“观察”和“接管交付”

上游的流程由模型自己读 AGENTS.md 和 DIRECTOR.md 来执行。宿主**不拆阶段、不替模型写文件**，只根据项目目录里出现的文件推断进度并显示出来：

| 上游阶段（DIRECTOR） | 宿主看到的信号 | UI 显示 |
|---|---|---|
| §1 接需求（语言、一轮问题） | AskUserQuestion 调用 | 问答对话框 |
| §3–4 故事和 treatment | `TREATMENT.md` 出现 | Treatment 预览（三个候选结构和选定方案），用户可以在对话里提意见 |
| §5 用真实代码出风格帧 | `stills/styleframe*.jpg` | 风格帧预览 |
| §6–7 声音和音乐网格 | `voices/*.wav`、`dur.json`、`words.json`、`events.json` | 配音和节拍进度 |
| 场景开发与审片 | `stills/*.jpg`、联系表、readcheck 和 asr_check 的退出码 | 联系表、文字阅读检查、语音回听检查结果 |
| §11 修一轮、交付 | `<name>.mp4`、`poster.jpg`、`<name>.srt`、`CREDITS` | 成片 |

**交付之后由宿主接管**：
1. 用 ffprobe 复检：时长、24fps、色彩标签、响度是否在 −14±1 LUFS、有没有黑帧（复用底座的 G6 闸门）；
2. 运行上游 §11 规定的 `grep -rniE "lemo ?lab|opus 5\.5"` 署名检查；
3. 把成片、海报、字幕、TREATMENT、CREDITS 导入 StoryDream 项目，可以继续在时间线里剪辑或导出到剪映。

**应用内预览**：复用现有的 `lemo-upstream-renderer`（本机 HTTP 服务、私有 partition、同一套页面协议），只用于拖动时间轴预览。**最终成片一律用上游的 `video.mjs` 和 `mux.sh` 出**。另加一个一致性测试：同一时刻用 `still.mjs` 和应用内预览各截一帧，比较感知哈希。

---

## 7. 最终效果

| 模型 | 贴近程度 | 预期画面 | 依据 |
|---|---|---|---|
| Claude Opus 5.5（Anthropic 协议，H1） | **和上游完全一致** | 应该接近上游样片水平（上游声明风格是按 Opus 5.5 调的） | 上游 README；**需要实跑 1 支片验证** |
| Claude Sonnet 5.5（你现在的中转默认模型） | 流程一致 | 低于 Opus 一档【未核实】 | 同一家族，上游没有给出数据 |
| GPT / Gemini / DeepSeek / Qwen（经网关） | 流程一致，模型不同 | 技术质量由上游的确定性检查兜底（readcheck、asr_check、mux 遇坏音频拒绝输出、黑帧检查）；画面好坏和能否跑完，要看模型的长程 agent 能力 | 上游自己说“其他模型适配度不高”；v3 用 Gemini 生成 0 个文件，但 v3 的工具协议本身有缺陷，不能直接当作结论。**必须实测** |

**每支片的成本和耗时**（估算，以上游说明为准）：
- 30–60 分钟，100 次以上工具调用；
- 输入累计在百万 token 量级，多数应该能命中提示缓存；
- 中转站是否支持缓存会直接决定成本，**需要探测**；
- 默认片长 30–60 秒，更长要先提示用户。

**不会再出现的问题**：
- 宿主一次要整片导致截断；
- 宿主自定文件拆分导致推理吃掉输出额度；
- 自制 6 工具导致生成 0 个文件；
- 成片色彩和响度不统一。

**仍然存在的限制**：
- 慢、贵；
- 非 Claude 模型的成功率未知；
- 中转站不稳定（524、连接重置）只能通过账本和续跑来兜底，无法根除。

---

## 8. 实施步骤

| 步骤 | 内容 | 验收 |
|---|---|---|
| F0 | 清理磁盘；同步上游到 143f387a 并更新哈希清单；淘汰 `vendor/lemo-opuscar` | 哈希校验通过；Git Bash 下能运行 `node core/render/still.mjs styles/<slug>/demo 1.5` |
| F1 | 运行环境安装器：`$LIB` npm ci、`.venv`（core 和 voice）、`PLAYWRIGHT_CHROME`、ffmpeg PATH | 用上游工具把某个样片完整渲染、混音一遍，产物通过 ffprobe 和响度检查 |
| F2 | SDK worker 接入生产：开放 canUseTool 白名单和 DEMO 门禁；AskUserQuestion 接弹窗；账本和续跑；文件信号驱动 UI | **Claude Opus 实跑 1 支 30–60 秒中文旁白片**，走完 §11 交付 |
| F3 | 网关协议转换：Chat / Responses ⇄ Messages，覆盖工具、图片、流式、usage | 故障注入测试；GPT、Gemini、DeepSeek 各跑 1 支，记录完成率、轮数、token、费用 |
| F4 | 接回 StoryDream：导入成片和字幕、时间线、剪映导出；预览一致性测试 | 端到端在应用内完成 |

## 9. 待确认
1. 磁盘：清理哪些、是否搬盘（需要约 1.5–1.7GB 加工作空间）。
2. H1（官方 SDK，最贴近，约 301MB，条款需确认）还是 H2（自研兼容，轻量，贴近程度低一档）。
3. 中文配音用上游的 edge-tts（联网，需要用户开关），还是在保持输出格式（`<id>.wav` + `dur.json`）一致的前提下，接入 StoryDream 现有的配音服务。后者算第 9 处偏离。

---

## 10. 风格库的真实规模（2026-11-09 核实）

| 来源 | 数量 | 内容 | 能否直接用 |
|---|---|---|---|
| 仓库 `styles/`（本地快照 f171360；main 143f387a 同为 66 种） | **66 种**（目录共 67 个，含 `_template`） | 完整风格包：`STYLE.md`（固定规则）、`DEMO.md`、demo 源码、海报、`style.json` | ✅ 直接用于 faithful 模式 |
| OPUSCAR 98（仓库 `styleboard/opuscar98_styles.json`，Pages 的 opuscar98/#styles 由它生成） | **98 种**（2D 77、2.5D 4、3D 17） | 每种包含：风格说明、可复制的**风格提示词**（中英，含色板、构图、运动、参照、避免事项）、逐镜头导演编排，另有 `styleboard/img/opuscar98/NN.jpg` 一张静帧；**没有 STYLE.md 和 demo 源码** | ⚠️ 只能作为“轻量风格”：按 MY-STYLES.md 的“从空白建立自己的风格”流程转成 `STYLE.md` |
| 合计 | 164 个选项 | 98 种是同一部影片里的片段风格，与 66 种在题材上有相近处，但条目不重复 | |

> 更正：本节初稿写“98 种不在仓库里，只在 Pages 网页上”，这是错的。数据已在仓库里（`styleboard/opuscar98_styles.json`，469,904 字节），并且已经随 f171360 快照收进 `vendor/lemo-upstream`，在 `storydream-upstream.json` 里有逐文件 sha256。

**处理方式（2026-11-09 已在 `feat/route-split-opuscar98` 实现）**：
- 66 种完整风格包作为一等公民：`scripts/sync-lemo-styles.py` 从已校验的快照生成 `src/shared/creative-animation/lemo-upstream-catalog.json`。比旧目录多出 7 种（chalkboard、circuit-board、desktop-flythrough、isometric-picture-book、memphis-diorama、printed-long-take、transit-map），它们只走 Lemo 路线，不走模板路线。
- 98 种轻量风格：同一脚本离线生成 `opuscar98-catalog.json`，只含界面字段，ID 为 `o98-NN`；静帧缩成 WebP，按 CC BY 4.0 署名。完整提示词不复制进前端，生成时由 `electron/lemo-opuscar98.ts` 再按 manifest 哈希校验后读取。
- 用户选中轻量风格时：预检改查 `MY-STYLES.md` 和 `opuscar98_styles.json`，不查 `styles/<id>/STYLE.md`。Agent 系统提示要求先按 MY-STYLES.md 的“从空白开始”流程选一个技术底座，读它的 STYLE.md，再在**本片工程目录里**写出自己的 `STYLE.md`，然后才写 TREATMENT。同时说明风格已定，不做逐题访谈。这里有两点和原文不同：不写入 `~/lemo-my-styles/`（宿主不写用户主目录），也不复用原片段的故事和角色。
