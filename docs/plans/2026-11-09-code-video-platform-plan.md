# StoryDream 代码生成视频：整体方案（草案，待确认）

日期：2026-11-09，2026-11-13 更新。状态：**方案阶段，尚未改动代码、依赖或 git。**
调研依据：[docs/research/2026-11-09-code-to-video-landscape.md](../../research/2026-11-09-code-to-video-landscape.md)

> **2026-11-13 更新（用户已决定）**
> - T3 大师层改用 **Pi**（[earendil-works/pi](https://github.com/earendil-works/pi)，MIT，TypeScript SDK），**支持所有模型**，不再只限 Claude。Claude Agent SDK worker 冻结为备选，不再是主线。
> - **允许 Agent 写代码并执行代码**：Python 跑在 Windows 沙箱里；画面 HTML 仍在宿主的离屏渲染器中运行。
> - **加入声音层**：Agent 负责节拍网格、配乐、拟音、环境声和声部混音设计；宿主负责旁白和最终母带处理。详见 §4.4、§4.5。
> - P4 拆成 P4a–P4e。P4a（Pi 验证）在 P0 之后就可以开始，和 P1 并行。
> - 同日补充决定：
>   - 安装包**预置一个小型基础音色包**（§4.5.5）；
>   - 字幕模式**由用户选择**，可选“影片自己画”或“宿主统一加”（§4.4.11）；
>   - **允许 Agent 申请在旁白句子之间加停顿**（§4.5.7）。

---

## 1. 目标与约束

| 目标 | 说明 |
|---|---|
| 一个软件里走完 | 从文案到成片 MP4 全部在 StoryDream 内完成：结构规划 → 配音 → 画面代码 → 预览 → 渲染 → 质检 → 导出。不依赖外部 CLI 或 Claude Code |
| 不同模型都能生成 | OpenAI 兼容、Responses、Anthropic 协议都可用，包括各类中转（Claude/GPT/Gemini/DeepSeek/Qwen…）。弱模型也能出片，强模型出得更好 |
| 三个引擎都要 | HyperFrames（主力）、Remotion（模板与 React 场景）、Lemo（风格库，外加 Pi 驱动的多模型大师模式） |
| 有声片 | 成片要有旁白、配乐、拟音和环境声，按 Lemo 的 DIRECTOR §6/§7 标准来做，不能只有“旁白 + 一条 BGM” |
| 用最新版 | 依赖升级到当前最新并锁定版本，之后定期更新 |
| 授权 | 个人或 ≤3 人公司，Remotion 免费可用（团队扩大后需重新评估）。Lemo 代码 MIT，样片 CC BY，须署名。HyperFrames Apache-2.0 |

**设计底线**：
- T1/T2 不再让模型一次写整片；任何一个场景失败都不能拖垮整片；协议、时间轴、音频由宿主掌控，模型只负责“画面创意”。
- T3 是例外：Agent 可以多轮迭代整片工程并执行代码。但下面这些边界始终由宿主掌控：
  - 模型请求（全部经过账本网关）；
  - 文件边界和执行沙箱；
  - 旁白音频与 cue 时间；
  - 最终母带；
  - 交付门禁。

---

## 2. 版本现状与升级清单

> 本节版本号保留原调研日期，不代表开工时的最新版本。截帧的最终选型以 §6 为准。

| 包 | 当前 | 最新（2026-11-09） | 判断 |
|---|---|---|---|
| @hyperframes/core / player / lint | 0.8.40（09-14） | **0.9.26**（11-09） | **明显落后**。0.9.0 于 11-02 发布，一周内发了 26 个版本，修了“set 打断 tween 时渲染空白”“Windows 忙时 lint 卡 30 秒”“渲染随机数不可复现”“预览与渲染不一致”等问题 |
| @hyperframes/producer / engine | 未安装 | 0.9.26 | 可选：做 beginFrame 原子截帧时需要（见 §6） |
| remotion / @remotion/player / media-utils | 4.0.524 | **4.0.542** | 同一大版本，只差 18 个补丁版本，**不算旧**，顺手升级 |
| gsap | 3.12.5 | **3.15.1** | 落后 3 个小版本，升级 |
| three | 0.170.0 | **0.187.0** | 落后 17 个小版本（three 每个小版本都可能有破坏性变化），谨慎升级 |
| @anthropic-ai/claude-agent-sdk（worker） | 0.3.314 | 0.3.319 | 小版本升级 |
| Lemo 上游 | f171360（10-29） | 143f387a（11-08） | 同步，并排除 6 段受限配音 |
| `@earendil-works/pi-coding-agent` | 未安装 | P4a 开工时取当时最新版 | **新增**，写死精确版本。包名刚从 `@mariozechner/*` 改成现在这个；要求 Node ≥ 22.19，Electron 41 自带 Node 24，满足要求 |
| 内置 Python：scipy / soundfile / soxr | 未安装（现有 numpy、PIL、faster_whisper、playwright） | 当前稳定版 | **新增**：Lemo 的 `core/audio/sfx.py`、`sampler.py` 和 `core/tts/*` 依赖它们。scipy 体积在 100MB 量级，P4a 实测 |
| 内置 Python：numba | 未安装 | 当前稳定版 | 可选，只给 `pluck.py`（拨弦物理建模）用，约 140MB；默认按需下载，不打包 |
| Lemo 乐器音色包（vsco2ce / vcsl / freepats / karoryfer / salamander） | 未安装 | 上游 `tools/assets.json` 的固定版本 | **预置“StoryDream 基础音色包”**：从 CC0 包里挑出的子集，目标 ≤ 100MB，随安装包发布。五个完整包（70–400MB）在设置里按需下载到用户数据目录，校验 SHA-256（§4.5.5） |
| @lottiefiles/dotlottie-web、mediabunny | 未安装 | 0.82.1 / 1.65.2 | 可选，以后作为素材层或混流工具 |

策略：
- 全部写死精确版本。
- HyperFrames 迭代极快，每月评估一次升级，用回归集验收后再合入。

---

### 2.1 片长与长文策略（已定）

- **快捷档位：30 / 60 / 90 / 120 / 180 秒，默认 60 秒。** 增加 120 秒，避免从 90 秒直接跳到 3 分钟。高级设置支持 15–180 秒的整数自定义时长；首期单集目标上限 180 秒。
- 档位是**目标片长**，不是硬裁切点。规划时预留约 10%–15% 给开场、转场、句间停顿和片尾，最终以实测配音、获准停顿和片尾之和为准。通常控制在目标 ±10%，不得靠截断旁白、强行加速语音或无意义静帧凑时长。
- 保存 `targetDurationSeconds` 与 `actualDurationSeconds` 两个字段。增加停顿后的总时长仍不得超过目标的 110%（180 秒档最多 198 秒）；界面和费用估算明确展示实际预计时长。硬性要求整 30/60 秒的广告位裁切暂不作为这个档位的含义。
- **长文默认按章节和语义拆成多集，保留信息。** 分集规划预览中展示每集标题、内容范围、预计片长和总费用；用户也可以切换为“压缩成一支”，先审阅压缩后的文案再生成配音。不得为了满足档位静默删除事实或原文段落。
- 时长预估结合语言、所选音色与语速的历史数据，首次用保守估算；TTS 后用实测时长校正。若超过允许范围，在画面生成前暂停该阶段，展示调整档位、分集或改稿选项，不自动再次付费生成配音。
- Agent 申请句间停顿的上限继续按 §4.5.7 执行；不允许通过改写目标片长绕开上限。用户主动调整档位则生成新的时间轴版本，并按依赖关系失效下游产物。
- 音乐 MV 和用户提供的完整配音以媒体实际时长为准，不套用这些档位；超过首期单集处理上限时明确提示分段，不截断原音频。
- 验收覆盖全部快捷档位、15/180 秒自定义边界、长文拆集、压缩预览，以及停顿后的 cue/SRT/音画时长一致性。

## 3. 总体架构

```
┌──────────────────────────── ① 创作入口（统一）────────────────────────────┐
│ 文案/主题 → AI 结构规划（免费、可预览、可编辑）                            │
│  · 片长 30/60/90/120/180 秒（默认60）；长文默认拆集，可选压缩                       │
│  · 按原文小节分段，按完整句子分镜，标题行不进旁白，清掉 Markdown             │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    ▼
┌──────────────────────────── ② 音频优先时间轴 ─────────────────────────────┐
│ 逐镜 TTS → 实测时长 → 词级时间戳（TTS 自带或 STT 对齐）→ 回写分镜            │
│ BGM 节拍网格（可选）→ 形成唯一事实源：Timeline                              │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    ▼
┌──────────────────────── ③ VideoSpec（统一中间表示）───────────────────────┐
│ scenes[]: { id, start, duration, narrationCues(词级), intent, layout,       │
│            styleId, engine: hyperframes|remotion|lemo, tier: T1|T2|T3,      │
│            template?{id, params}, code?{source, status} }                   │
└───────┬──────────────────────────┬──────────────────────────┬─────────────┘
        ▼                          ▼                          ▼
  T1 模板层（默认）          T2 场景代码层（进阶）       T3 Agent 大师层（Pi）
  LLM 只出参数 JSON          LLM 每次只写 1 个场景        Pi SDK（utilityProcess）
  → 模板编译                 → 脚手架 + 注入 API          + Lemo 原版资料作上下文
  任意模型，≈99%             → lint → 预跑 3 帧           + 宿主工具（审片/沙箱 Python/音频）
                             → 局部修复 ≤3 → 失败降级 T1  任意模型，经账本网关，按预算
                                                          → 画面 + 声部 stems（+ 可选风格字幕）
        └──────────────────────────┬──────────────────────────┘
                                   ▼
┌──────────────────────── ④ 统一场景运行时 + 渲染 ─────────────────────────┐
│ Scene Runtime 协议：seek(t) / READY / DUR / TEXTS(t) / EV                    │
│ 适配器：HyperFrames(__timelines) · Remotion(frame→Composition) · Lemo(render)│
│ 截帧：HyperFrames/Remotion 场景用 Electron；Lemo 保留上游渲染器（见 §6）    │
│ 审片与导出同路径；HyperFrames producer / beginFrame 延后评估                │
│ 合成：FFmpeg：画面 + 旁白 + 配乐/拟音/环境声 stems（或 BGM）+ 闪避 + 字幕      │
│       + 两遍 loudnorm（−14 LUFS，TP −1.2 dB）——见 §4.5                       │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    ▼
┌──────────────────────────── ⑤ 质检与修复 ─────────────────────────────────┐
│ 确定性检查：文字越界/重叠、阅读时长、字幕安全区、黑场、时长、响度            │
│ VLM 联系表评审（模型支持看图时）：6×6 锚点给出修改建议，最多 1–2 轮          │
└───────────────────────────────────────────────────────────────────────────┘
横切：⑥ 模型能力层  ⑦ 风格包  ⑧ 任务编排（并行/检查点/预算）  ⑨ 回归评测
```

---

## 4. 关键模块设计

### 4.1 模型能力层（解决“不同模型都能生成”）
- **能力档案（Capability Profile）**：每个模型档案记录最大输出 token、推理控制方式（`reasoning_effort`、thinking `budget_tokens`、或不支持）、是否支持流式、是否支持看图、是否支持 JSON 模式和工具调用、上下文长度。
  - 来源：内置常见模型的默认值，加上一次低成本探测（短请求）和用户手动覆盖。
- **角色路由**：规划、写代码、看图评审分别可以配置不同模型。例如用 DeepSeek 写代码、Gemini 看图、Claude 做规划。没配置时全部使用默认模型。
- **统一调用规范**：
  - 所有请求都走流式，加空闲超时（例如 60 秒无数据就断开），不设总超时上限；
  - 写代码阶段使用低推理强度；输出上限按档案取值，不超过模型上限；
  - **截断检测统一**：结束原因为 length / max_tokens、缺少结束标记、括号不闭合，任一出现即判为 TRUNCATED，不进入修复，改为拆小或续写；
  - 错误分类：传输层不确定 → unknown；服务商已返回之后的本地错误 → failed，并先把产物存盘。
- **提示词分级**：同一任务准备“强模型版”和“弱模型版”两套提示词。弱模型版的约束更多，可用 API 更少，模板化程度更高。

### 4.2 三个引擎各自的定位

| 引擎 | 定位 | T1 模板 | T2 场景代码 | 说明 |
|---|---|---|---|---|
| **HyperFrames 0.9** | **主力**，新功能默认 | 官方约 450 个组件（转场、字幕、图表、地图、动态文字）+ 自研块 | 每个场景一个 HTML 片段 + GSAP 时间线（paused，注册到 `__timelines`），`@hyperframes/lint` 校验 | 官方 skills / frame.md 改写成提示词参考资料，任何模型都能读 |
| **Remotion 4.0.542** | 现有模板动画（shotcraft）+ React 组件型场景 | 现有 VOX/shotcraft 模板 | 每个场景一个 TSX 组件，浏览器内 Babel 即时编译（参考官方 Prompt-to-Motion-Graphics 模板），只注入 `useCurrentFrame/interpolate/spring/Img` 等白名单 API | 官方 remotion-dev/skills 作提示词参考（许可待核实） |
| **Lemo 66 风格** | 风格库 + 大师模式 | 风格 token 和不变量注入 T1 模板 | 风格引擎包：从 demo 的 `engine/*.js` 抽成宿主 API，模型只写场景调用 | 先移植 8–12 种适合讲解的风格；完整原版走 T3（Pi，任意模型） |

### 4.3 T2 场景代码层（核心）
1. **输入**：单个场景的 VideoSpec，包括时长、词级 cue、意图、布局锚点、风格包摘要和风格帧图片（模型支持看图时附上）。
2. **输出**：只有一个场景模块，固定接口，结尾必须写 `// END_SCENE` 标记，单个场景 ≤150–250 行。
3. **校验顺序**：
   - 静态检查：语法解析，禁止 import、`Date.now`、`Math.random`、网络请求、DOM 越权；
   - 引擎 lint：HyperFrames 用 `@hyperframes/lint`，Remotion 用 TSX 编译；
   - 离屏预跑 t = 0、中点、结尾 3 帧，抓运行时报错，并检查画面是否为空或全黑。
4. **修复（ScopeRefine）**：只发出错的片段加一行报错 → 修不好扩大到所在函数 → 再不行重写整个场景，总共最多 3 次。
5. **降级**：仍然失败就自动换成 T1 模板镜头，在界面上标出“已降级”，用户可以单独重试。
6. **并行**：场景之间互不依赖，按并发上限并行生成和预跑。

### 4.4 T3 Agent 大师层（Pi，多模型，可写可跑代码）

目标：在 StoryDream 里复现原版 Lemo 的创作流程，同时适配 Windows 桌面软件的安全和计费要求。原版流程是 Agent 自己导演，依次写 TREATMENT、证明画风、写画面、写声音，再反复审片。

#### 4.4.1 和现在实现的差别（这次要改掉的）

| 现在（`electron/lemo-upstream-agent.ts`） | 改成 |
|---|---|
| 自研 JSON 围栏协议，每轮只能做一个动作；最近 10 轮保留原文；单轮最多 16k token；默认 64 轮 | Pi 原生工具调用，一轮可并行调用多个工具，历史自动压缩；轮数、token、金额预算继续沿用 L-4 |
| 宿主负责全部声音，Agent 不能碰音频 | Agent 写节拍网格、配乐、拟音、环境声和混音设计；宿主只负责旁白和母带（§4.5） |
| 宿主分镜锁死，Agent 只能“填空” | 旁白文字和 cue 时间固定（音频优先），**分镜只作为建议**；镜头、运镜、转场和节奏由 Agent 在 TREATMENT 里重新设计 |
| 审片只在 8%/45%/86% 截 3 帧 | 联系表（每 1–2 秒一帧，过两遍）、0.2 秒抽帧条、readcheck、音频报告、带声音的预览合成 |
| 普通字幕由宿主统一渲染 | **用户选择**“影片自己画”（风格字幕，推荐）或“宿主统一加”。影片自己画时，宿主核对文字和时间；SRT 始终由宿主导出（§4.4.11） |
| 旁白时间完全固定 | 文字固定；Agent 可以申请在句子之间加停顿，宿主重新拼接旁白，不重新生成配音（§4.5.7） |
| 不能执行代码 | 在沙箱中用内置 Python 运行 Agent 写的脚本（音频合成、数据和素材预处理） |
| 只认 Claude（SDK 方案） | 任何已配置的模型或中转都能用；能力不足的模型由能力档案标出，并给出提示 |

#### 4.4.2 进程与模块

```
主进程 (electron/main)
 ├─ PiAgentHost            electron/pi-agent-host.ts           启停、续跑、事件转发、预算
 ├─ AgentToolBridge        electron/pi-agent-tools.ts          工具的宿主实现（渲染、审片、音频、沙箱）
 ├─ LedgerGateway          services/lemo-agent-worker/messages-gateway.ts 扩展为多协议
 └─ SandboxRunner          electron/agent-sandbox.ts → resources/bin/sd-sandbox.exe
        ▲ MessagePort（JSON 消息，带 runId/segment/toolCallId）
utilityProcess: services/pi-agent-worker/worker.ts
 └─ @earendil-works/pi-coding-agent  createAgentSession(...)，内联扩展 storydream-ext
```

- **Pi 运行在独立的 `utilityProcess` 中**：只放行白名单里的环境变量，不继承用户的 API 密钥、代理或 `NODE_OPTIONS`。
- worker 只做三件事：调模型（经网关）、跑 Pi 的文件工具、把宿主工具转发给主进程。渲染、FFmpeg 和沙箱都在主进程实现。
- **Pi 的配置完全隔离**：
  - `agentDir`、session 文件和临时目录都放在 `work/pi-agent/<runId>/`；
  - 自定义 `ResourceLoader`，不扫描用户的 `~/.pi`，不扫描项目内的 `.pi/`，也不读用户的 AGENTS.md；
  - `defaultProjectTrust: never`；
  - 关闭 Pi 内置的 `mcp`、`codemode`、`tool-search` 扩展，只加载内联的 `storydream-ext`；
  - `enableInstallTelemetry: false`。
- 现有的 Claude Agent SDK worker 保留在 `services/lemo-agent-worker`，冻结为备选，不进新建入口。它的账本网关被 Pi 复用。

#### 4.4.3 模型与计费（复用并扩展账本网关）

- **所有请求都经过本机账本网关**：Pi 里注册一个 `storydream` provider，`baseUrl` 指向 `127.0.0.1` 上的网关，`apiKey` 是每次运行随机生成的本机凭据。真实渠道的凭据只留在主进程里。
- **网关要支持三种协议**：现在只支持 Anthropic Messages，要扩展到三种，都按原样透传：
  - `anthropic-messages`
  - `openai-completions`（Chat）
  - `openai-responses`

  `api` 字段取自用户的模型配置。不同协议之间不互相冒充，也不偷偷删掉 tools 来“降级”。
- **账本规则**沿用 `request-ledger.ts`：
  - 每次提交前先 fsync 落盘；
  - 断流、超时或回执落盘失败都算 **unknown**，之后的请求全部拦截，必须由用户在界面上核对后才能继续；
  - 被明确拒绝的请求不会被当作可以重试。
- **以下 Pi 设置必须关闭或固定**，否则会产生账本之外的付费请求：

  | Pi 设置 | 取值 | 原因 |
  |---|---|---|
  | `retry.enabled` | `false`（provider 层 `maxRetries` 也设为 0） | 不允许自动重发 |
  | `cacheWarming` | `"off"` | 默认的 `"idle"` 会在空闲时发送暖缓存请求 |
  | 压缩（compaction） | 保留 | 压缩本身也是一次模型调用：同样经过网关，计入预算 |
  | `defaultThinkingLevel` | 取自能力档案 | 写代码时用 low/medium |

- **预算采用双闸门**：
  - **硬闸门**在网关：轮数、token 或金额（沿用 L-4 估算价格表）超限时，请求在发出前就被拒绝，这个结果明确是“未发送”；
  - **软闸门**在 `turn_end` 钩子：接近上限时提醒 Agent 收尾。
- **能力档案映射到 Pi 的模型定义**：`contextWindow`、`maxTokens`、`input: ['text','image']`（只有支持看图的模型才发图）、`reasoning`。不支持工具调用的模型不能选 T3，界面直接说明原因，不自动降级。

#### 4.4.4 工具集

内置工具只开 `read`、`write`、`edit`、`grep`、`find`、`ls`；**`bash`/`powershell` 一律关闭**。路径用 `tool_call` 钩子统一检查，任何一项检查失败就拒绝执行：

| 区域 | 权限 |
|---|---|
| 项目目录 `project/**`（`material/**` 除外） | 读写 |
| `material/**`（旁白、素材，宿主放进去的） | 只读 |
| Lemo 库（`DIRECTOR/TECHNIQUE/AGENTS/core/README` 和 `styles/<当前风格>/**`、`core/**`） | 只读 |
| 其它任何位置，以及符号链接、目录联接、`:` 备用数据流、设备名 | 拒绝 |

额外限制：单文件写入 ≤ 2MB；`out/` 以外的源码总量 ≤ 32MB。

自定义工具（`pi.registerTool`，在宿主实现）：

| 工具 | 参数 | 做什么 | 返回给模型 |
|---|---|---|---|
| `render_stills` | `times[]` 或 `range a:b:step`，≤12 帧 | 宿主调用 Lemo 上游 still 路径，使用与正式导出相同的运行时（§6） | 图片 + 控制台错误 + 资源缺失列表 |
| `contact_sheet` | `from,to,step=1.5` | 抽帧并拼成联系表（等同 `still.mjs --range` + `sheet.py`） | 1–3 张拼图，每格标注时间 |
| `frame_strip` | `t0,t1,step=0.2` | 关键动作抽帧条 | 1 张拼图 |
| `readcheck` | — | 读取 `window.TEXTS(t)`，按上游 readcheck 规则检查（中文 4.5 字/秒、拉丁 15 字/秒、+1.5 秒） | 不合格的文字及原因 |
| `export_events` | — | 读取 `window.DUR/EV`，写入 `events.json` | 事件数量，以及缺少 `sound` 的事件 |
| `run_python` | `script`（项目内）、`args[]`、`timeoutSec ≤ 900` | 在**沙箱**中用内置 Python 运行（§4.4.5） | 退出码、stdout/stderr 末尾各 64KB 以内、新增或修改的文件 |
| `audio_report` | — | 检查 stems 和事件对齐（§4.5.4） | 逐项通过/警告/失败 |
| `preview_mix` | `quality: draft` | 低分辨率画面 + 旁白 + stems，按 mix.json 合成预览 MP4 | 响度、人声与音乐差值、黑场；同时给用户播放 |
| `view_asset` / `request_image` | 沿用现有素材和生图通道 | 生图同样有账本和 unknown 阻断 | 图片 |
| `request_narration_pause` | `pauses: [{afterCueId, ms, reason}]` | 在句间加停顿，宿主重新拼接旁白，不付费（§4.5.7） | 接受或拒绝及原因、新的 `cues.json` 和 `DUR`、哪些产物因此失效 |
| `list_instruments` | — | 列出当前可用的乐器（基础包 + 已下载的包 + pluck 物理建模） | 乐器名、音域、来源、许可 |
| `compare_demo` | — | 只在 TREATMENT 写完后可用：返回风格 demo 海报和最新联系表 | 两张图 + “6 项至少 4 项不同”核对清单 |
| `finish` | `posterTime`、`notes` | 运行交付门禁（§4.4.8） | 通过 / 未通过的项目 |

每个工具调用都会写回执（`toolCallId → 参数哈希、结果哈希、产物`）。续跑时，已有回执的调用不再重复执行。

#### 4.4.5 代码执行沙箱（`sd-sandbox.exe`）

原版效果好的关键之一，是 Agent 能写 `score.py`、`mix.py` 并执行。这里的做法是：**只执行 Python，并且必须在系统级沙箱里执行；沙箱不可用时绝不退回到无隔离执行。**

- **实现**：自研的小型 Rust 辅助程序，随应用签名发布：
  - 用 `CreateAppContainerProfile` 为每次运行建一个 AppContainer（`StoryDream.Agent.<runHash>`），**不授予任何 capability**。这样就没有网络，包括本机回环，所以 Python 碰不到网关；
  - 只给容器 SID 授予三类权限：项目目录读写；内置 Python 目录、Lemo `core/`、音色包目录读和执行。运行结束后撤销这些 ACE，并删除容器配置；
  - 用 Job Object 限制：`KILL_ON_JOB_CLOSE`、最多 4 个进程、内存默认 4GB、单次墙钟超时默认 300 秒（上限 900 秒），并启用 UI 限制（不能访问桌面和剪贴板）；
  - 环境变量只放：`PYTHONPATH=<lemo core>`、`PYTHONDONTWRITEBYTECODE=1`、`TEMP/TMP=project/.tmp`、`LEMO_LIB`、`SD_SR=48000`。
- **画面代码不进这个沙箱**：HTML/JS 在宿主的离屏渲染器里运行，用独立 session 分区，屏蔽网络，只能访问本地静态服务。这是现有机制，继续沿用。
- **暂不开放执行 Node**：Electron 二进制在 AppContainer 下能否正常运行还要验证。有需要的话放到 P5。
- **降级**：容器创建失败时（比如企业策略禁用），本次运行自动改用**数据模式**（§4.5.3），并在界面上标明。
- **必须通过的逃逸测试**：
  - 连外网和连 `127.0.0.1` 网关都失败；
  - 读 `%USERPROFILE%`、写项目目录以外的位置都失败；
  - 通过目录联接越界失败；
  - 进程炸弹、内存耗尽、超时都能杀掉整棵进程树；
  - 卸载后不残留 ACE 或容器配置。

#### 4.4.6 Agent 的上下文与工作流（原版流程的宿主化改写）

- **上下文文件**，直接用原文，不提炼：
  - `AGENTS.md`、`DIRECTOR.md`、`TECHNIQUE.md`、`core/README.md`；
  - `styles/<slug>/STYLE.md`（O98 风格用它的参考文档）；
  - 外加一份 **StoryDream 宿主说明**（新写，相当于 skill 模式那张对照表），内容包括：
    - 不运行 `setup.sh`，依赖已经装好；
    - 不调用 AskUserQuestion，brief 已经在 StoryDream 里确认过；
    - `node core/render/*.mjs` 对应 `render_stills` 等工具，`.venv/bin/python` 对应 `run_python`；
    - 旁白已经生成，放在 `material/narration/`，wav 加上 `words.json`、`cues.json`。**文字不能改**；时间只能通过 `request_narration_pause` 在句间加停顿，最好在 Treatment 阶段一次性申请；
    - 用 `list_instruments` 查询可用乐器，不要假设完整音色包已经安装；
    - 当前字幕模式（影片自己画 / 宿主统一加），以及影片自己画时的开关要求（§4.4.11）；
    - `mux.sh` 和母带由宿主负责，Agent 只交 stems 和 `mix.json`；
    - `build.sh` 改为写 `storydream-build.json`。
- **brief**：标题、原文、用户的创作说明、已确认的旁白和 cue（毫秒）、建议分镜（标注“仅供参考”）、素材清单、画幅和片长、字幕模式、锁定镜头的保留窗口（L-3）。
- **工作流和宿主门禁**：

  | 步骤 | Agent 做什么 | 宿主怎么保证 |
  |---|---|---|
  | 1 Treatment | 写 `TREATMENT.md`：三种结构里选一种、logline 和故事弧、镜头表、逐秒节拍、**cue map（速度、小节网格、每个剪切/动作/字幕落在哪一拍）**、**声音设计表**、字幕设计 | `tool_call` 钩子：TREATMENT 缺少这 7 个小节时，禁止读取 `styles/<slug>/DEMO.md` 和 `demo/**`（只读 STYLE.md 不受限）。“剪辑与纪实”类风格例外，按上游规则可以先用素材工具 |
  | 2 看风格 | 写真实绘制代码，用 `render_stills` 出 3 张风格帧（有角色就出设定稿），并对照 STYLE.md 自查 | 必须至少调用过一次 `render_stills` |
  | 3 时间轴 | 写 `timeline.js`（SECS/HIT 等），作为画面和声音共用的单一时间源，并导出 `timeline.json` | `audio_report` 用它核对对齐 |
  | 4 画面 | 写 `index.html` 和模块，暴露 `READY/DUR/render/EV/TEXTS`；风格字幕模式下还要画字幕 | 每次 `render_stills` 都会报告运行时错误和 Canvas 状态泄漏（沿用 `LEMO_CANVAS_STATE`） |
  | 5 声音 | 写 `audio/score.py`、`audio/foley.py`、`audio/ambience.py`（可以合并），通过 `run_python` 生成 `out/stems/*.wav`，再写 `audio/mix.json` | §4.5 |
  | 6 审片 | 完整联系表过两遍；关键动作出抽帧条；`readcheck`；`audio_report`；`preview_mix`；`compare_demo` | `finish` 门禁会检查这些工具在**当前源码哈希**下都运行过 |
  | 7 交付 | 调用 `finish`，给出海报时间和与 demo 对比的 6 项结论 | §4.4.8 |

- **导演备注**：运行中用户可以在界面上发一句备注，宿主通过 `session.steer()` 插入，Agent 在下一步看到。

#### 4.4.7 编排、续跑与界面

- **生产 DAG 改动**（新的 `authoringVersion = 4`；v3 只读兼容）：
  ```
  voice:* → timing:* → agent-segment:1 → agent-segment:2 … → film-finalize → audio-master → render → verify
  ```
  - 每个 `agent-segment` 就是一次 `session.prompt()` 或续写，跑到 Agent 停下，或者达到本段轮数上限（默认 20 轮）为止。用分段代替现在的“每轮一个节点”，界面进度更清楚，也方便暂停。
  - 总预算沿用 L-4（`agentMaxTurns/Tokens/Cost`）。T3 默认 120 轮；工具可以并行调用，所以实际轮数比现在少。
  - `audio-master` 是新节点：宿主做最终混音和母带，不需要付费。
- **续跑**：
  - Pi 会话持久化为 `work/pi-agent/<runId>/session.jsonl`。重启后用 `SessionManager` 打开会话继续。
  - 网关账本里有 unknown 时，先弹出现有的“核对未知请求”界面；用户确认后才能继续。
  - 工具调用发出了但没有结果时（中途崩溃）：如果宿主有这次调用的回执，就补回结果；没有回执，就补一条“上次执行被中断，请先检查文件再决定”。**是否需要补，要在 P4a 实测 Pi 遇到悬空工具调用时的行为后确定。**
- **界面**（扩展现有的 `lemo-agent-activity`）：
  - 实时显示工具调用流，联系表和抽帧条直接显示成缩略图；
  - 预算条显示轮数、token 和估算金额；
  - 提供导演备注输入框，以及暂停/继续按钮；
  - `preview_mix` 生成后可以直接播放；
  - 收尾时并排展示 TREATMENT、和 demo 的对比结论、门禁结果。

#### 4.4.8 交付门禁（`finish`）

硬性要求，有任何一项不满足就不能导出：
1. `READY/DUR/render` 都存在，并且 `DUR` 和片长相差不超过 1 帧；当前源码哈希下完成过技术审片，没有运行时错误，没有 Canvas 状态泄漏。
2. `readcheck` 通过。影片自己画字幕时：
   - 每条 cue 的文字和旁白完全一致，可见时间覆盖 cue 窗口（误差不超过 1 帧）；
   - 加上 `captions=0` 参数渲染时，画面里不再有任何字幕（§4.4.11）。
3. stems 格式和时长合格；`audio_report` 没有失败项（§4.5.4）。
4. 当前源码哈希下运行过完整联系表 ×2、`preview_mix`、`compare_demo`。
5. `TREATMENT.md` 和 `CREDITS` 都存在，并且 CREDITS 覆盖所有用到的素材、音色包、字体和配音引擎；素材文件和清单哈希一致（沿用 `verifyLemoAssets`）。

只提示、不阻止导出：低频过重、近静默不到 2 处、拟音覆盖率低、和 demo 相同的项目超过 2 项。这些会显示给用户，由用户决定是否返工。

#### 4.4.9 交付物

- `<name>.mp4`：24 fps，除非 STYLE.md 另有规定；约 −14 LUFS。
- `poster.jpg`、`<name>.srt`、`TREATMENT.md`、`CREDITS`。
- 工程源码，加上 `storydream-build.json`（记录可复现的渲染和混音步骤，替代 `build.sh`）。
- **剪映草稿**：旁白、配乐、拟音、环境声分别放在独立的音轨，字幕放在可编辑的字幕轨（复用现有的双输出导出）。

#### 4.4.10 P4a 验证（2–3 天，0 次付费请求起步）

1. 在 utilityProcess 里跑 Pi SDK，经过本机桩网关，验证这几项：工具调用、并行调用、图片结果、压缩、`retry/cacheWarming` 关闭后确实没有多余请求、中断后续跑、悬空工具调用的处理。
2. 只开文件工具加 `render_stills` 和 `contact_sheet`。用 Claude、GPT 和一个国产模型（经中转）各跑一次真实请求；需要预算，请用户确认。
3. 同一个风格、同一份文案，和现有的 `lemo-upstream-agent.ts` 各出一支片，用联系表对比。
4. 测量：worker 打包体积、Pi 依赖数量、冷启动时间。

#### 4.4.11 字幕模式（用户可选）

| | 影片自己画（风格字幕，**推荐，创建页默认选中**） | 宿主统一加 |
|---|---|---|
| 谁画 | Agent 按 TREATMENT 里的字幕设计，在页面里画；字体、动效、位置都属于风格的一部分 | 宿主用现有的字幕渲染叠加，样式在宿主的字幕检查器里调 |
| 输入 | `material/narration/cues.json`（加过停顿之后的版本） | 同左，Agent 不需要画 |
| 页面要求 | 字幕在 `window.TEXTS(t)` 中以 `cap:<cueId>` 作为 id 上报；必须支持 `location.search` 里的 `captions=0`，此时不画字幕 | 画面里不能出现旁白字幕（其它画面文字不受限） |
| 宿主检查 | 文字逐字一致、可见窗口覆盖 cue（±1 帧）、不出安全区、`captions=0` 时没有字幕 | 现有的安全区和阅读时长检查 |
| SRT / 剪映字幕轨 | 始终由宿主导出 | 同左 |

- **在哪里选**：创建页和生产设置都可以选，值写在 `productionSettings.captionMode: 'film' | 'host'`。旧项目没有这个字段，按 `host` 处理，行为和现在一样。
- **中途切换**：
  - 从“影片自己画”切到“宿主统一加”：**免费**。用 `captions=0` 重新渲染，再叠加宿主字幕，只重跑渲染和检查。
  - 从“宿主统一加”切到“影片自己画”：需要追加一段 Agent 运行，是付费的；先显示预估费用，用户确认后才执行。
- **剪映草稿**：影片自己画字幕时，草稿里的视频用 `captions=0` 版本，字幕放在可编辑的字幕轨，避免字幕重复。

### 4.5 声音层（T3 首发，之后 T1/T2 共用母带部分）

#### 4.5.1 分工

| 层 | 谁负责 | 说明 |
|---|---|---|
| 旁白 | 宿主 | 沿用现有 TTS 和 STT 对齐（用户配置的音色）。生成 `material/narration/<cueId>.wav`、`words.json`、`cues.json`，供 Agent 只读 |
| 节拍网格 / cue map | Agent | 写在 `timeline.js` 里，画面和声音共用 |
| 配乐 | Agent | `core/audio/sampler.py`（真实乐器采样）、`pluck.py`（拨弦）、numpy 合成。用风格自己的声音配色，不要千篇一律的“钢琴加弦乐” |
| 拟音 | Agent | `core/audio/sfx.py`，由 `events.json`（`window.EV`）驱动，保证每个声音落在对应的帧上 |
| 环境声 | Agent | `sfx.py` 的噪声底和自写滤波 |
| 声部混音设计 | Agent | `audio/mix.json`：各声部增益、在旁白下的闪避量、近静默段、J/L-cut 说明 |
| 最终混音和母带 | 宿主 | 闪避（以旁白做旁链）→ 人声压缩 → 按 RMS 平衡（人声比音乐高约 10 dB）→ 两遍 loudnorm −14 LUFS / TP −1.2 dB。用 TypeScript 加 FFmpeg 重写 `mux.sh` 的逻辑（Windows 上没有 sh） |
| 用户的 BGM | 宿主 | 用户上传了 BGM 时，它作为 `music` 声部的替代或补充，由 brief 告诉 Agent 该怎么处理 |

#### 4.5.2 文件契约

```
project/
  timeline.js / timeline.json    节拍网格、段落、命中点（单一时间源）
  events.json                    宿主导出的 {dur, ev}；ev 需要声音时带 sound 字段
  audio/score.py foley.py ambience.py   Agent 写，在沙箱里运行
  audio/mix.json                 声部设计（见下）
  out/stems/music.wav ambience.wav sfx.wav   48 kHz、立体声、float32 或 24-bit，时长 = DUR
  material/narration/…           只读
```

```json
{
  "version": 1,
  "stems": { "music": { "gainDb": -16 }, "ambience": { "gainDb": -24 }, "sfx": { "gainDb": -10 } },
  "duck": { "under": "narration", "music": -10, "ambience": -6, "attackMs": 80, "releaseMs": 450 },
  "silences": [ { "t0": 21.2, "t1": 22.6, "reason": "转折前" } ],
  "transitions": [ { "kind": "J", "at": 14.0, "lead": 0.6 } ]
}
```

#### 4.5.3 两种模式

- **代码模式**（默认，需要沙箱可用）：Agent 写 Python，自由使用 `sfx/sampler/pluck` 和 numpy。
- **数据模式**（沙箱不可用，或用户在设置里选择“不执行模型代码”）：Agent 只写 `audio/score.json`（事件包含时间、乐器、音高、时长、力度、声像）和 `audio/foley.json`（时间、`sfx.py` 里的声音名、参数），由宿主自带的可信脚本 `sd_audio_render.py` 渲染成同样的 stems。弱模型也适合用这个模式。

#### 4.5.4 `audio_report` 检查项

| 检查 | 级别 | 标准 |
|---|---|---|
| 格式和时长 | 失败 | 48 kHz、没有 NaN 或 Inf、每条 stem 和 `DUR` 相差不超过 1 帧 |
| 削波 | 失败 | 母带前每条 stem 的峰值 ≤ 0 dBFS |
| 拟音同步（相当于 cuecheck） | 失败 | `ev[].sound` 对应的起音落在 `sfx.wav` 中 ±42ms 以内（24fps 下 1 帧） |
| 音乐和网格对齐 | 警告 | `HIT` 命中点附近有音乐起音（±1 帧） |
| 人声高于音乐 | 失败 | 旁白期间，预览混音里的人声 RMS 比音乐和环境声至少高 8 dB（目标 10 dB） |
| 近静默 | 警告 | 至少 2 处 `silences`，并且实测这些段落里所有声部都低于 −45 dBFS（旁白不能落在静默段里） |
| 低频 | 警告 | 20–120 Hz 能量和其余频段相比不超过约 −3 dB |
| 拟音覆盖 | 警告 | 带 `sound` 字段的事件 ÷ 镜头数，低于阈值时提示 |
| 最终响度 | 失败 | 母带后 −14 ± 1 LUFS，TP ≤ −1.0 dB |

#### 4.5.5 音色包与授权

**预置基础音色包（随安装包发布）**
- **只从 CC0 包里挑**（VSCO 2 CE、VCSL、FreePats 的 CC0 部分、Karoryfer），不包含 Salamander 钢琴（CC BY 3.0）和 MuldjordKit 鼓组（CC BY 4.0）。这样预置部分在法律上不强制署名；CREDITS 里仍会写上一行致谢。
- **初选乐器**（覆盖讲解片最常用的几类，P4c 按实际体积调整）：

  | 类别 | 乐器 |
  |---|---|
  | 键盘 | `upright`（立式钢琴，CC0，代替 Salamander） |
  | 弦乐 | `violins`、`cellos`、`contrabass_pizz`、`harp` |
  | 木管与铜管 | `flute`、`clarinet`、`horn` |
  | 打击和音色 | `marimba`、`glockenspiel`、`vibraphone`、`hand_chimes`、`timpani`、`bass_drum`、`snare2`、`hihat`、`claps`、`shaker`、`woodblock`、`triangle`、`frame_drum` |
  | 拨弦与民族 | `guitar_nylon`、`kalimba`、`dan_tranh`（可代替古筝）、`erhu` |

  另外，`pluck.py` 的物理建模乐器（古琴、琵琶、三味线、筝等）不需要采样。但它依赖 numba，按需下载；没装 numba 时 `list_instruments` 不列出这些乐器。
- **体积目标 ≤ 100MB**：每个乐器保留整套采样文件夹，不删力度层，保证 `sampler.py` 的行为和原版一致。`index.json` 只保留包含的条目。超过目标时先减少乐器种类，不降低单个乐器的质量。
- **构建**：新增脚本 `scripts/build-instrument-starter.mjs`，从上游固定版本的 release tar 里提取所选乐器，生成清单（每个文件的 SHA-256、来源包、许可），构建时校验。

**目录和运行方式（不修改上游文件）**
- `sampler.py` 固定从它自己旁边的 `instruments/` 目录读取音色。所以宿主会在用户数据目录下准备一份运行副本 `lemo-audio/core/audio/`：
  - 原样复制上游的 `*.py`，校验哈希；
  - `instruments/` 里合并“基础包（从安装目录硬链接或复制）+ 已下载的完整包”，并重新生成合并后的 `index.json`。
- 沙箱的 `PYTHONPATH` 指向这份副本。给容器授予读权限的也只有这个目录。

**完整包按需下载**
- 在设置里的“音色包”页管理：显示每个包的大小、许可和包含的乐器，可以下载或删除。
- 下载时校验 SHA-256；解压需要约 2 倍的临时空间；下载失败不影响已有的音色包。
- 离线或只有基础包时，Agent 用 `list_instruments` 只能看到基础包里的乐器；用到没有的乐器时，`sampler.py` 会报错，Agent 改用基础包里的乐器或合成声音。

**授权**
- `sampler.credits()` 生成的条目自动并入 CREDITS。
- 下载的完整包里如果用到了 CC BY 乐器（Salamander、MuldjordKit），CREDITS 里必须写上规定的署名，`finish` 门禁会检查。
- 各包的许可按 `core/audio/INSTRUMENTS.md` 写进安装说明和关于页。

#### 4.5.6 推广到 T1/T2

- 母带部分（闪避、平衡、loudnorm）和 `audio_report` 的通用检查项，从 P4c 开始给所有路线共用。
- T1/T2 的模板和场景以后也可以输出 `EV`，由宿主用数据模式自动配拟音。这部分列入 P5。

#### 4.5.7 旁白停顿申请（`request_narration_pause`）

目的：DIRECTOR §6/§7 要求转折前留近静默、给观众留一口气、画面落在节拍上，而音频优先的时间轴会把旁白排得很紧。允许 Agent 在**句子之间**加停顿，**不改文字，不重新生成配音**。

- **调用方式是声明式的**：每次提交的是**完整的停顿集合** `pauses: [{afterCueId | null, ms, reason}]`，会替换上一次的集合，不是累加。同样的集合重复提交，结果也一样。`afterCueId: null` 表示在第一句之前（开场留白）；也可以加在最后一句之后（片尾余韵）。
- **限制**（不满足就整体拒绝，并说明原因）：
  - 只能放在 cue 边界，不能切开一句话；单个停顿 200–2000ms；
  - 停顿总时长 ≤ min(原旁白时间轴的 15%, 10 秒)，加完后的片长不超过用户选的目标片长 +10%；
  - 每次运行最多被接受 3 次，防止反复修改；建议在 Treatment 阶段一次定好；
  - 有锁定镜头（L-3）时，如果某个停顿会改变锁定窗口的起点或内部时间，就拒绝；
  - 音乐 MV 项目不提供这个工具（歌曲时间固定）。
- **宿主怎么处理**（不付费，确定性）：
  1. 在旁白时间轴的 cue 边界插入静音，把后面的旁白片段、`cues.json`、`words.json` 整体后移；配音文件和 voice 节点的哈希不变，并检查确实没有触发重新配音。
  2. 停顿时长算进前一句所在的镜头（宿主分镜只是建议，这样做只是为了让界面时间轴和剪映草稿连贯），然后重建 `document.timeline`。
  3. 结果写进项目文档的 `narrationPauses`，带回执（集合哈希、修改前后的 cue 时间）；续跑时按回执恢复，不重复执行。
  4. 返回给 Agent：新的 `DUR`、新的 cue 时间，以及**哪些东西失效了**——stems、审片回执、`audio_report`、readcheck 要按新的时间重跑；这些检查都绑定在“源码 + 旁白时间轴”的哈希上，`finish` 会拦住过期的结果。
- **界面**：时间轴上用标记显示每个停顿和理由。片子做完后用户还可以删除或调整停顿，但界面会提示：这会让画面和声音失去对齐，需要追加一段 Agent 运行（付费，先显示预估）。
- **SRT 和字幕**：一律使用加过停顿后的 cue 时间。

### 4.6 风格包（单一来源）
- 一个 `styleId` 对应一个 StylePack：
  - tokens：配色、字体、缓动、字号、安全区；
  - invariants：STYLE.md 提炼出的 10–20 条不变量；
  - 风格帧图片；
  - 各引擎的适配：HyperFrames 主题和 frame.md、Remotion 主题、Lemo 引擎包；
  - 已知陷阱清单。
- 废除 `selectedStyleId`、`presetId` 对画风的影响，以及写死的纸拼贴提示词骨架。旧项目做一次迁移。

### 4.7 任务编排
- 改造现有生产 DAG：场景级并行，每个场景有自己的检查点，互不相关的节点继续执行；不再出现“一处失败全停”。
- 付费前给出预估（镜头数 × 单价），先做一个**样板镜头**请用户确认，再批量生成。
- 检查点改为只存变化部分（现在每步约写 1MB 完整文档）。

### 4.8 旧代码收敛
- 旧的逐镜 ai-code、Lemo v1/v2/v3 改为**只读兼容**：可以打开和导出已有成果，不再新建。
- Pi 大师模式（v4）通过 P4e 验收后：
  - 现在的自研 8 工具循环（`electron/lemo-upstream-agent.ts`，v3）也改为只读兼容，能打开、续导出已有工程，但不再新建；
  - Claude Agent SDK worker 冻结为备选。
- 新建项目统一走新管线；评估稳定后再删除死代码。

---

## 5. 从高星项目“拿什么、怎么拿”

| 项目 | 星标 / 许可 | 怎么用 |
|---|---|---|
| HyperFrames | 81k / Apache-2.0 | **直接依赖**（升级到 0.9.26）；官方 skills / catalog 作为提示词资料和 T1 模板来源 |
| Remotion | 72k / 自有许可（≤3 人免费） | **直接依赖**（升级）；参考官方 Prompt-to-Motion-Graphics 的编译和重试闭环 |
| Lemo-Opuscar | 13.9k / MIT + CC BY | **本地副本**（同步到 143f387a）；风格包 + T3；`core/audio`、`core/render` 的规则和脚本作为声音层和审片的依据 |
| Pi（earendil-works/pi） | MIT | **直接依赖**（`@earendil-works/pi-coding-agent`，精确版本）：T3 的 Agent 框架，用 SDK 内嵌在 utilityProcess 中；只用会话、工具调用、压缩和扩展钩子，不用它的 CLI、登录或遥测 |
| Code2Video / TheoremExplainAgent | 2.4k / 1.5k，MIT | **借鉴架构**：规划/编码/评审分工、ScopeRefine、6×6 锚点、重试上限、断点续跑 |
| deepseek-motion / ALGOGEN | MIT / 论文 | **借鉴**“规格 → 确定性编译”，即 T1 的设计思路 |
| explainroo / MathLens | MIT / CC BY-NC | **借鉴**词级挂载动画（MathLens 不可商用，只学思路） |
| OpenMontage | 79k / AGPL | **只借鉴**检查点和契约校验思路，不引入代码 |
| Manim CE | 42k / MIT | 第 5 阶段作为数学/科普插件，按需下载 |

---

## 6. 渲染截帧的技术决策（已定）

**按引擎分派：HyperFrames 和 Remotion 场景首期采用 A；Lemo 保留已经接入的上游渲染器。B 暂不引入。** 用户不需要选择截帧技术，只选择分辨率和帧率。统一的是任务、时间与产物协议，不强行把三个引擎换成同一个渲染实现。

| 路线 | 首期正式导出 | 审片与预览 | 决策理由 |
|---|---|---|---|
| HyperFrames / 新 Remotion 场景 | A：Electron 离屏、显式 seek、绘制完成握手、capturePage | 联系表和关键帧走同一适配器；正式预览播放同路径生成的 MP4 | 复用已有桌面环境，先解决帧同步和确定性 |
| Lemo / Pi 大师模式 | 保留上游 `core/render/video.mjs`，使用已经随应用提供的 headless 浏览器运行时 | 联系表、抽帧条改接同一运行时的 `still.mjs`；验收预览播放该路径生成的 MP4 | 当前 `exportLemoUpstreamProject` 默认就是 upstream，不退回旧 Electron 导出 |
| 已有模板及历史工程 | 保留原有渲染路径 | 保持与原导出一致 | 不因新方案破坏已有成果 |

### 6.1 帧同步与确定性

- 时间以帧编号为准：第 n 帧只求值 `t=n/fps`，不依赖真实播放速度或计时器推进。帧数为 `ceil(durationSeconds * fps)`，解码后的总时长允许在 1 帧内取整。
- Electron 路径必须等待资源 READY（字体、图片、模型等）、本次 seek 的 frameId 回执和实际绘制完成，再截帧。**仅等两次 rAF 不能作为已绘制的证明**；渲染挂起或回执不匹配直接失败，不截上一帧冒充成功。
- 固定随机种子、视口、deviceScaleFactor、字体、浏览器与依赖版本、帧率和颜色输出参数；随机顺序 seek 与顺序 seek 应得到一致的画面。
- 预览可以降低分辨率或码率，但必须使用同一源码、字幕模式、时间轴、字体、资源和渲染引擎；版式使用固定设计坐标。低清预览不替代最终分辨率下的文字和边界检查。
- 每次审片/导出的回执记录 sourceHash、timelineHash、assetHash、引擎与浏览器版本、画幅、fps、字幕模式。任一改变使相关回执失效；不得静默切换渲染引擎后继续沿用旧验收结果。
- 页面交互预览仅用于编辑；验收以同路径生成的 MP4 为准。目前 Lemo 的审片仍使用 Electron，改接上游 still 路径是本方案的待实施项，不能写成已经一致。

### 6.2 帧率与后续优化

- 新建 Lemo 项目默认 24fps，STYLE.md 有明确要求时遵从风格；其它代码视频默认 30fps。创建后持久化，预览、声音同步和正式导出共用；已有项目保留原帧率。所有“1 帧”阈值按项目 fps 计算。
- 不再把 B 命名为“高质量导出”：beginFrame 的主要价值是控制绘制时序、提高稳定性或吞吐，不保证视觉质量自动提高，也不能未经测量承诺与官方像素一致。
- P5 才评估 HyperFrames producer / beginFrame：用相同影片对比丢帧、重复帧、耗时、内存、安装体积和图像差异，有实测收益再引入；优先评估复用已有浏览器，但需验证版本与启动参数兼容，不能假定可直接共用。

### 6.3 验收

- 2D、Three.js、中文字体、图片解码、密集转场分别覆盖；包含 30 秒短片与 180 秒长片。
- 比较源渲染帧与最终 MP4 解码帧（考虑有损编码的容差），核对首尾、转场边界、关键动作；不允许缺帧、错误重复帧、黑场或资源缺失被当作成功。
- 联系表与导出的同时间帧内容一致；随机 seek、取消、失败后重试都不得复用过期帧或混入旧产物。

---

## 7. 分阶段计划与验收

| 阶段 | 周期（估） | 内容 | 验收标准 |
|---|---|---|---|
| **P0 准备** | 2–3 天 | ① 现状提交到新分支并推送到 Gitee（先检查大文件和敏感信息）；② 修好 6 项失败测试；③ 升级依赖（§2）并通过 typecheck 和测试；④ 建 30 题回归集的骨架 | 测试全绿；升级后现有 HTML 视频和模板动画都能预览和导出 |
| **P1 底座 + 模板层** | 1–2 周 | 模型能力层、AI 结构规划预览、音频优先时间轴、VideoSpec、T1 模板层（HyperFrames 为主，接入现有 Remotion 模板）、统一运行时和截帧握手 | 同一份 60 秒文案，用 ≥3 个不同模型（例如 Claude、GPT、Gemini 或 DeepSeek，经中转）都能完整出片 |
| **P2 场景代码层** | 2–3 周 | T2：HyperFrames 场景和 Remotion 场景；脚手架、lint、3 帧预跑、ScopeRefine、降级、并行与检查点、确定性质检 | 回归集单场景成功率 ≥95%，整片完成率 ≥90%（≥3 个模型） |
| **P3 风格包** | 2–3 周 | 统一风格包；移植 8–12 种 Lemo 风格引擎包；风格锁定；VLM 联系表评审 | 风格一致性人工评分达标；选什么风格出什么风格 |
| **P4 大师模式（Pi）** | 共 4–6 周，**P4a 在 P0 之后即可开始，和 P1–P3 并行** | 见下面 P4a–P4e | Claude、GPT、一个国产模型（经中转）各出一支 45–60 秒有声原创 Lemo 片 |
| P4a Pi 验证 | 2–3 天 | §4.4.10：SDK 内嵌、桩网关、关闭重试和暖缓存、续跑、悬空工具调用、两个审片工具；和现有循环对比出片 | 桩网关下 0 次多余请求；3 个模型都能完成多轮工具调用；记录打包体积和冷启动时间 |
| P4b 账本网关 + 沙箱 | 1–1.5 周 | 网关扩展为三种协议并透传；网关上的预算硬闸门；`sd-sandbox.exe`（AppContainer + Job Object）；`run_python`；逃逸测试 | 逃逸测试全部通过；unknown 之后 100% 拦截；沙箱不可用时自动切换数据模式，不会无隔离执行 |
| P4c 声音层 | 1–1.5 周 | Python 依赖进安装包；**基础音色包构建脚本和运行副本**；`export_events`、`audio_report`、`preview_mix`、`list_instruments`、`request_narration_pause`（宿主拼接旁白）；宿主母带（TS + FFmpeg，等同 `mux.sh`）；数据模式渲染脚本；完整音色包下载页 | §4.5.4 的失败项全部可以检测；母带后 −14 ± 1 LUFS；拟音同步 ≤ 1 帧；剪映草稿里各声部分轨；基础包 ≤ 100MB，离线可用；加停顿后配音文件哈希不变，cue/SRT/时间轴一致 |
| P4d 工作流 + 编排 + 界面 | 1 周 | 宿主说明、TREATMENT 门禁、`compare_demo`、`finish` 门禁；**字幕模式选择**（创建页和设置、`captions=0`、免费地从影片字幕切到宿主字幕）；DAG v4（分段）、续跑、导演备注、活动流界面、时间轴上的停顿标记 | 中途杀进程能续跑；预算耗尽停在可续跑状态；两种字幕模式都能导出 MP4 和剪映草稿，字幕不重复；界面两种窗口尺寸、深浅主题都通过 |
| P4e 验收 | 3–5 天 | 选 2 个风格（一个 2D、一个 3D 或印刷类）× 3 个模型；同时用原版 Lemo skill（Claude Code）出对照片 | 人工评分：画面接近原版，声音明显好于现状（有拟音、静默段、闪避）；交付物齐全；0 次 unknown 被自动重发 |
| **P5 扩展** | 持续 | Manim 插件、更多风格、陷阱记忆、HyperFrames producer / beginFrame 性能评估；T1/T2 输出 `EV` 后自动配拟音；沙箱内执行 Node；风格专用的 Python 包（LiDAR、切片等）放进私有 venv | — |

---

## 8. 风险

| 风险 | 应对 |
|---|---|
| HyperFrames 1.0 之前 API 变化快 | 锁定版本，所有调用经过适配层，按月升级并用回归集验收 |
| 中转站能力不明或不稳定 | 能力探测 + 流式 + 空闲超时 + 结果回执；unknown 只用于传输层不确定 |
| 弱模型写代码成功率低 | T1 兜底；T2 失败自动降级；按模型选择提示词分级 |
| three.js 跨 17 个小版本 | 单独验证 Lemo 3D 风格和现有用到 three 的地方，必要时分步升级 |
| 磁盘空间紧张（C 约 8.5GB、I 约 7.2GB） | 升级前清理缓存；暂不额外引入 HyperFrames 专用浏览器，保留 Lemo 已有运行时 |
| 613 个未提交文件 | P0 先做快照分支；推送前排查大文件（vendor 里 Lemo 副本约 114MB，Gitee 对单文件和仓库体积有上限）、密钥和用户数据 |
| Remotion 授权 | 现在 ≤3 人免费；团队扩大时切换成以 HyperFrames 为主，或购买授权 |
| Pi 迭代快（刚改过包名），API 可能变 | 写死精确版本；所有调用都经过 `pi-agent-host` 适配层；升级前跑 P4a 的验证脚本 |
| Pi 本身没有权限系统 | 关闭 bash/powershell；文件工具统一由 `tool_call` 钩子做路径检查，检查失败就拒绝；执行只走 `sd-sandbox.exe`；Pi 的资源发现和遥测全部关闭 |
| Pi 内部的隐藏请求（重试、暖缓存、压缩） | 所有请求都经过账本网关，从网关一侧计数和拦截；P4a 用桩网关证明设置生效 |
| AppContainer 下 Python 和 numpy/scipy 的 DLL 加载、ACL 授权失败 | P4a 先做最小 PoC；失败时用数据模式兜底；不考虑无隔离执行 |
| 模型写的音频代码跑得慢或占满内存 | Job Object 限制内存和时间；采样率固定 48k；限制 stems 时长；超时把原因返回给 Agent，让它改写 |
| 中转站对工具调用或图片支持不一致 | 能力档案探测；不支持的模型不能选 T3，并说明原因；不自动切换协议 |
| 安装包变大（Pi 依赖 + scipy 等 + 基础音色包） | P4a 实测体积；基础音色包上限 100MB；numba 和完整音色包按需下载；Claude SDK 的原生 CLI（约 301MB）不进安装包 |
| 停顿申请导致反复返工 | 声明式的完整集合、每次运行最多被接受 3 次、建议在 Treatment 阶段定好；失效项由哈希门禁强制重跑 |
| T3 单片成本高 | 预估金额 + 网关硬闸门；分段运行，可以随时暂停；默认每段 20 轮、总共 120 轮，用户可以调整 |

---

## 9. 需要你确认的事项

已决定（2026-11-13）：
- 大师模式要做，用 **Pi**，所有模型都能用；P4a 提前到 P0 之后，和 P1 并行。
- 允许 Agent 写代码并执行：只执行 Python，在 AppContainer 沙箱里运行；沙箱不可用时用数据模式。
- 加入声音层：Agent 负责配乐、拟音、环境声和声部设计；宿主负责旁白和母带。
- 安装包预置一个小型基础音色包（只含 CC0，≤ 100MB），完整包按需下载（§4.5.5）。
- 字幕模式由用户选择：“影片自己画”或“宿主统一加”；创建页默认选中“影片自己画”，旧项目保持“宿主统一加”（§4.4.11）。
- 允许 Agent 申请在旁白句子之间加停顿：不改文字，不重新配音，有数量和时长上限（§4.5.7）。

- 片长：30/60/90/120/180 秒，默认 60 秒；高级自定义 15–180 秒，长文默认拆集，可选压缩（§2.1）。
- 截帧：新 HyperFrames/Remotion 场景采用 Electron；Lemo 保留上游渲染并统一审片路径；beginFrame 延后评估（§6）。

仍待确认：
1. 首批要支持哪些模型或中转？（决定能力档案默认值、P1 和 P4e 的验收模型）
2. 推送 Gitee：vendor 下的 Lemo 完整副本（约 114MB，含视频）是否一起推？建议用 .gitignore 排除，安装时再拉取。
3. T3 默认预算：每支片默认的金额上限是多少？（会显示在创建页上）
