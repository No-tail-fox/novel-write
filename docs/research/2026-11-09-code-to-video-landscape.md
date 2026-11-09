# 代码生成视频：Lemo-Opuscar 深度分析与 GitHub 生态调研

日期：2026-11-09（Asia/Shanghai）。性质：只读调研，未修改应用代码，未发起任何付费模型请求。

数据说明：
- 星标、许可、最近提交时间：2026-11-09 抓取自 GitHub 页面内嵌 JSON、GitHub Search API、npm/PyPI registry 和 arXiv API。api.github.com 部分限流，web_search 在本环境不可用。
- 标【未核实】的内容只有项目方自述，或者没有逐行读过源码。
- StoryDream 现状部分来自本仓库源码和本机数据库 `%APPDATA%\storydream\storydream\data.db`。

---

## 0. 结论摘要

1. **Lemo-Opuscar 不是“一次请求出视频”的服务，而是一套给 Claude Code 用的工具箱**：风格库、导演方法和工具链。它的质量来自一个长循环：Opus 写代码 → 渲染 → 看静帧 → 修改。一支 30–60 秒的片子要 30–60 分钟、上百次工具调用。StoryDream 的用法是让任意模型一次或分小批写出整个文件，没有渲染看图的循环，片长还拉到 7 分钟，这就是“落地全是错误”的根本原因。
2. **业界跑得通的方案都遵循同一套模式**：
   - 分镜用 JSON 表达；
   - **一次只写一个场景**，不写整片；
   - 运行时协议固定，由脚手架提供，模型只填函数体；
   - 先生成配音，再按实际时长定时间轴；
   - 修错由局部到整体逐级扩大，并设上限；
   - 渲染后先做确定性检查，再交给 VLM 看图；
   - 场景并行，有检查点可续跑；
   - 失败的场景降级成模板镜头，不拖垮整片。
3. **可靠性数据很明确**：
   - 整片成功率 ≈ 各场景成功率连乘，单场景必须做到 95% 以上；
   - 一次就成功的概率普遍只有 50–60%，需要 3–5 轮修复；
   - “模型只输出 JSON、模板确定性编译”能接近 100%（ALGOGEN 99.8%），代价是表达力受限；
   - 换模型差距巨大：同一流水线 o3-mini 成功率 93.8%，Claude 3.5 Sonnet 只有 2.1%。
4. **渲染框架选型**：
   - 首选 **HyperFrames**（heygen-com/hyperframes，Apache-2.0，约 8.1 万星，专为 agent 设计）。StoryDream 已经在用 0.8.40，应升级到 0.9.x 并作为主运行时。
   - **⚠ Remotion 有授权风险**：公司总人数超过 3 人时，连 `<Player>` 都要付费（Automators：每次渲染 $0.01，每月最低 $100）。StoryDream 现在打包了 `@remotion/player`，需要尽快评估。
   - Manim 适合做“数学/科普讲解”的按需插件。
5. **建议的产品形态是三档**：
   - **模板模式**（默认，任何模型都能用，接近 100% 成功）；
   - **场景代码模式**（逐场景写 HyperFrames 或 Lemo 风格的代码，可并行、可降级）；
   - **大师模式**（Claude Agent SDK 加 Lemo 原版插件，走真正的 agent 循环，成本高、质量上限最高）。

---

## 1. Lemo-Opuscar 深度分析

### 1.1 基本信息

| 项 | 内容 |
|---|---|
| 仓库 | https://github.com/lemomo-ai/lemo-opuscar |
| 热度 | 约 13.9k 星、1.65k fork、134 次提交；最新提交 143f387a（2026-11-08），最近每天都有修复提交，并合并了社区 PR |
| 许可 | 代码和文档（含 STYLE.md 提示词、core 工具）为 MIT；demo 视频和静帧为 CC BY 4.0（须署名 LemoLab、附仓库链接、注明是否修改）；6 段配音不在 CC BY 范围内（5 段 Edge TTS、1 段豆包），不能复用 |
| 模型 | README 写明“风格都是按 Claude Opus 5.5 调出来的，其他模型适配度不高” |
| 本地副本 | `vendor/lemo-upstream` 是 f171360（10-29）的完整树，**已经是 66 种风格**；`vendor/lemo-opuscar` 是 3961ddb（10-22）的纯文本副本，59 种，v2 路线用的是这份；`vendor/lemo-native-core` 只有一个 2.7KB 的缓动/噪声工具库 |
| 线上相对本地的新增 | DIRECTOR §13 地图规范（画中国必须完整，默认边界数据不能直接用）、Windows Git Bash 支持、WebGL 丢失上下文检测（`LEMO_ANGLE=swiftshader`）、mux 真峰值限幅、asr_check 支持日韩语、旧 demo 自动拉字体 |

### 1.2 它怎么工作

```
SKILL.md（24 行入口）
 ├─ setup.sh：稀疏克隆仓库到 ~/lemo-opuscar
 ├─ setup.sh deps：playwright-core + three + chromium-headless-shell + Python venv（约 350MB）
 │    可选 deps voice：kokoro-onnx / edge-tts / faster-whisper（约 0.55GB + Whisper 模型）
 │    可选 deps music：numba
 └─ 交给 AGENTS.md 分流：
      看用户自建风格 → 选风格 → 只问一轮问题 → 写 TREATMENT.md
      → 读 STYLE.md + DEMO.md + demo 源码（只学技法，不抄故事）
      → 用真实代码出风格帧 → 时间线先行：配音/音乐网格
      → 逐场景写代码 → still.mjs 出静帧 / sheet.py 拼联系表 / readcheck 查阅读时长
      → 修一轮 → video.mjs 逐帧渲染 → mux.sh 混音（两遍 loudnorm 到 −14 LUFS）→ 交付
```

**运行时协议**：
- 页面必须暴露 `window.DUR`（时长）、`window.render(t)`（确定性绘制第 t 秒）、`window.READY`（资源加载完成）；
- 可选暴露 `window.EV`（声音事件）、`window.TEXTS(t)`（当前可见文字，供 readcheck 检查）；
- 禁止使用 `Date.now`、未设种子的随机数、跨帧累积状态。

**渲染**：Playwright 无头 Chrome 逐帧截图，最多 6 个 worker，再用 FFmpeg 7 合成。每种风格按需选 Canvas 2D、WebGL2、DOM/SVG 或 three.js（`core/three/post.js` 提供景深、GTAO、bloom）。

**声音**：
- 配音：Kokoro（离线）或 edge-tts（在线），再用 Whisper 回听校验并拿到词级时间；
- 音乐：采样器加免费采样库；
- 音效：程序化合成；
- 字幕：srt.py；
- 混音：mux.sh。

**导演纪律**（DIRECTOR.md）：
- 默认片长 30–60 秒，超过 2–3 分钟“时间和 token 成倍增加”，要先告诉用户；
- 1920×1080、24fps；
- 先写 treatment：三个候选结构、镜头表、逐秒 beat、cue map、声音设计表；
- 至少四种运镜；
- 只修一轮。

**demo 规模（本地统计）**：平均片长 57 秒（30–164 秒），平均源码 141KB、16 个文件（51–433KB）。

### 1.3 风格系统

**每种风格的组成**：
- `style.json`：元数据；
- `STYLE.md`：固定 11 节，依次是本质与反例、材质渲染、色彩逻辑、字体字幕、运动、镜头语法、声音调色板、媒介原生动作、陷阱、引擎、可变空间；
- `DEMO.md`、`poster.jpg`；
- 完整 demo 工程：`timeline.js`、`scenes/*.js`、`engine/*.js`、`mix.py`、`score.py`、`build.sh`、`CREDITS`、风格帧。

**11 个分类，共 66 种**：

| 分类 | 数量 | 示例 |
|---|---|---|
| 剪辑与纪实 | 8 | 字幕新闻、视觉调查 |
| 实证影像 | 8 | 卫星简报、点云测绘、产品拆解、显微叙事 |
| 手绘与绘画 | 8 | 油画厚涂、水彩、水墨、黑板粉笔 |
| 信息与发布 | 8 | 暗色发布会、数据叙事、地铁线路图、电路板 |
| 材质与 3D | 7 | 积木、孟菲斯微缩、移轴 |
| 图形与排版 | 7 | 瑞士动态排版、装饰艺术、间谍片头 |
| 印刷与版画 | 6 | 木刻、铜版画、Riso |
| 东方传统 | 4 | 浮世绘、皮影、剪纸、纸雕灯影 |
| 卡通与动画 | 4 | 橡皮管、80 年代赛璐璐 |
| 游戏 | 4 | 像素 RPG、HD-2D |
| 电影与时代 | 2 | 默片、后室 |

**自建风格**（MY-STYLES.md）：从现有风格改或从空白开始 → 写 STYLE.md → 用真实代码出静帧证明画面 → 做 15–30 秒 demo → 存入 `~/lemo-my-styles/`。

### 1.4 成本与失败模式

- **成本**【估算，未核实】：
  - 输入：开场要读约 11k token 的文档，加上 STYLE 和 DEMO，再读 demo 源码 50–150k token；
  - 输出：成片源码 100–300KB，分多轮写和修，约 30–90k token；
  - 每轮都会重发上下文，累计（多为缓存命中）在百万到数百万 token 量级，工具调用在 100 次以上。
- **文档承认的失败**：主体太小或贴边、太暗或同色叠加、字幕挡住主体、节奏太快、转场黑帧、运镜后特效没跟上；长片成本成倍增加；ffmpeg 6 会被拒绝；虚拟机上 WebGL 丢失上下文；Kokoro 读中文平淡；Whisper 中文偶尔错字。

### 1.5 StoryDream 现在怎么用它：四代并存，没有一条跑通原创新片

| 代 | 位置 | 做法 | 实际结果 |
|---|---|---|---|
| v1 | `src/shared/creative-animation/native-film.ts` | 一次回复写出整片 HTML | 448 秒的片子只写出约 2500 字符就截断，被误报成“缺少 window.render 协议” |
| v2 | `electron/lemo-project-runtime.ts`、`lemo-incremental-authoring.ts` | 宿主定义 shared / scene / director 三类文件，模型分批返回 JSON 补丁 | 推理吃掉 96% 输出额度（completion 12000，可见正文 479 token），截断 |
| v3 | `electron/lemo-upstream-agent.ts` | 自制 6 个工具的文本协议循环，最多 64 轮，只在 3 个时刻截帧 | 用中转的 Gemini 实跑：第 6 轮正文为空，第 9 轮连接被重置，**生成源码 0 个** |
| SDK worker | `services/lemo-agent-worker` | 官方 Claude Agent SDK 加载原版插件，带请求账本 | 只做过离线验证（productionReady:false），没接生产 |

**和上游用法的差距**：
1. 没有审片闭环：上游可以出任意时刻静帧、拼联系表、跑 readcheck，StoryDream 没有。
2. 模型不对：上游按 Opus 调校，StoryDream 实际用的是中转的 Gemini 或 Sonnet。
3. 片长失控：上游 30–60 秒，StoryDream 跑 7.5 分钟、43 个镜头。
4. 风格不锁定：每次调用没有附上风格帧图片和 STYLE 不变量清单，导致风格漂移。
5. 推理 token 和可见输出共用一个上限，代码被挤掉。
6. 画面和声音不同步：宿主接管了配音和字幕，但 EV / cue map 和画面对拍没有被校验。

---

## 2. 代码化视频渲染框架

| 框架 | 星标 | 许可 | 活跃度 | 渲染方式 | 音频 | 嵌入 Electron | LLM 友好度 |
|---|---|---|---|---|---|---|---|
| **HyperFrames** heygen-com/hyperframes | 81.4k | **Apache-2.0** | 2026-11，0.9.26 | HTML + data-* 属性 + 可跳帧的 GSAP/WAAPI/Lottie/three.js；headless-shell 用 beginFrame 原子截帧，FFmpeg 编码 | ✅ | 高 | **最高**：无构建步骤；9 个官方 agent skills、约 450 个组件、frame.md、lint、llms.txt |
| **Remotion** remotion-dev/remotion | 71.9k | ⚠ 源码可见的自有许可 | 2026-11，4.0.542 | React；Chrome 逐帧截图 + Rust 合成器，或浏览器内 WebCodecs | ✅ | 高（官方 Electron 模板，实验性） | 高：语料多，有官方 skills 和 system prompt；样板代码较多 |
| Motion Canvas | 19.7k | MIT | 发版停在 2024-12 | TS 生成器 + Canvas2D | ✅ | 中 | 中 |
| Revideo midrender/revideo | 4.2k | MIT（默认开 PostHog 遥测） | 2026-07 | Motion Canvas 分支，headless 并行渲染 | ✅ | 中高 | 中高 |
| **Manim CE** | 42.4k | MIT | v0.22.1（2026-10） | Python，Cairo / OpenGL | 需 manim-voiceover | 低（要带 Python + LaTeX） | 高（学术研究最多） |
| 3b1b/manim | 96.3k | MIT | 发版停在 2024-12 | OpenGL | 弱 | 低 | 中（API 不稳定） |
| Theatre.js | 13k | Apache | 2024-04 停更 | 动画编辑器，本身不出视频 | – | – | 低 |
| editly / FFCreator | 5.6k / 3.2k | MIT | 基本停更 | Node + FFmpeg + GL | ✅ | 低（原生依赖） | 中（JSON 描述） |
| Diffusion Studio | 1.25k | MPL-2.0 | 2025-11 | 浏览器 Canvas2D + WebCodecs | ✅ | 中 | 中 |
| Twick | 546 | ⚠ SUL（非开源） | 2026-05 | React 编辑器 SDK | ✅ | 中 | 低 |
| Etro | 1.2k | ⚠ GPL-3.0 | 2026-10 | 浏览器录制，非确定性 | ✅ | 中 | 低 |
| MoviePy | 15.1k | MIT | 2.2.1 | Python 剪辑 | ✅ | 低 | 中（动效弱） |
| timecut / WebVideoCreator | 655 / 245 | BSD / Apache | 已停更 | Puppeteer 虚拟时间 | 部分 | 中 | 中（只作原理参考） |
| lottie-web / dotlottie-web | 32.4k / 939 | MIT | 活跃 | 可跳帧的矢量动画 | ❌ | 高 | 低（LLM 写 Lottie JSON 容易错，只适合当素材层） |
| Rive | 1k | 运行时 MIT，编辑器闭源 | 活跃 | 状态机动画 | ❌ | 高 | 很低 |
| Mediabunny | 7.5k | MPL-2.0 | 活跃 | 纯 TS WebCodecs 封装 | ✅ | 高 | 工具库 |
| Shotstack / Creatomate / JSON2Video | – | 云服务，按量付费 | – | JSON → 云端渲染 | ✅ | 需联网 | 高，但和本地渲染定位冲突 |

**和 StoryDream 直接相关的两条技术细节**：
- HyperFrames 的“原子截帧”依赖 Chrome 的 `HeadlessExperimental.beginFrame`，**只有 chrome-headless-shell 有，Electron 没有**。StoryDream 用 Electron `capturePage` 截帧时，必须自己做“seek(t) → 等两次 rAF 或绘制完成 → capturePage”的握手。另一个办法是额外打包 chrome-headless-shell，直接调 `@hyperframes/producer`。
- Remotion 的托管 MCP 已在 2026-10-26 关停，改为提供 remotion-dev/skills（约 6.7k 星）。

---

## 3. AI / Agent 写代码生成视频：项目与论文

### 3.1 Manim 学术路线（数据最扎实）

| 项目 | 规模 / 出处 | 关键做法 | 数据 |
|---|---|---|---|
| **Code2Video** showlab/Code2Video | 2.35k 星，MIT，ICML 2026 | Planner（分镜 + 共享素材）→ Coder（按 section **并行**）→ Critic（VLM 看渲染结果）；**ScopeRefine** 修错：先改报错行 ±1 行 → 扩到所在代码块 → 最后才重写 section；**6×6 视觉锚点**：位置调整变成“选格子” | 并行使耗时从 86.6 分钟降到 15.4 分钟；锚点比直接写代码提升约 40% |
| **TheoremExplainAgent** TIGER-AI-Lab | 1.5k 星，MIT，ACL 2025 Oral | 场景大纲 → 每个场景的实现计划 → 逐场景写代码；`max_retries 5`、场景并发、`only_plan` / `only_render` 断点续跑、视觉修复开关；旁白用 manim-voiceover + Kokoro | o3-mini 93.8%，GPT-4o 55%，Claude 3.5 Sonnet 2.1%；RAG 效果不稳定 |
| ManimCode | arXiv 2611.08294 | 用 2.4 万条“生成→报错→修订”轨迹微调 4B 模型 | 接入两个长视频系统后，完整成片 19/117 → 107/117、53/239 → 239/239，**说明单场景可靠率决定整片** |
| **ALGOGEN** MAC-AutoML/ALGOGEN-lab | arXiv 2605.12159 | LLM 只写追踪器、输出 JSON 轨迹，由确定性渲染器配合样式模板编译出画面 | **99.8%**，端到端写代码是 82.5% |
| SGA | arXiv 2607.18116 | 不渲染，从代码里抽出场景图检测遮挡 | 人评对 VLM 审查的胜率 65% |
| ManimAgent | arXiv 2606.30296 | 情景记忆：M+ 存成功范例，M− 存已知陷阱 | 无需训练，Pass@1 随记忆增加而提升 |
| MoVer | SIGGRAPH 2025，Apache-2.0 | LLM 同时生成 SVG 动画和逻辑验证 DSL，失败的条件回灌模型 | 首轮 58.8%，最多 50 轮后 93.6% |
| PRISM / Code2Video-Compass | 基准 | – | 从“能执行”到“空间正确”平均掉约 41%；15 个模型都做不稳完整视频 |

### 3.2 HTML / React 路线和 Agent Skills（2026 年主流）

| 项目 | 规模 / 许可 | 值得借鉴的点 |
|---|---|---|
| **HyperFrames skills** | 官方 9 个 skills | `/hyperframes`、`/hyperframes-cli`、`/hyperframes-registry`、`/media-use`，自带 lint、inspect 和抽帧审查 |
| **Remotion Prompt-to-Motion-Graphics 模板** | 官方 | 流式生成代码 → 清理代码围栏 → 浏览器内 Babel 即时编译（显式注入 API、去掉 import）→ **编译错误自动重试** → 模型自己判断局部修改还是整体替换 |
| **deepseek-motion** | MIT（3 星，思路典型） | 模型只写很小的 JSON 规格（节拍 + 从菜单选场景、配色、字体、能量），由工具编译成 HyperFrames；“模型永远不碰像素、毫秒或色值” |
| **explainroo** | 1.1k 星，MIT | Agent 只写 `script.md` 和 `scenes.js`，画面挂在旁白的某个词上；Kokoro 本地配音，由工具对齐 |
| video-talkcraft / anything2explainer | 2.2k / 3.2k 星 | 基于 Remotion：词级时间戳、SHOTBOOK 分镜、**先做一个样板镜头请用户确认**、preflight 检查 |
| **MathLens**（中文） | 348 星，CC BY-NC | **先出 TTS → 校验时长并回写分镜** → 逐幕实现；`wait_for_narration(keyword)` 在念到关键词时触发动画；`assert_geometry()` 几何自检 |
| code-video（中文） | dxawdc/code-video | 支持 9 种技术栈；`film lint`（字幕阅读速度、重叠）、`film stills`（联系表）、`film verify`（响度、黑场） |
| OpenMontage | 78.9k 星，⚠ AGPL | YAML 流水线 + JSON Schema 契约、检查点续跑、渲染前后两道检查（偏生成式视频混剪） |
| SenseNova-6.8-Code2Video | 588 星 | 开源 27B 代码视频模型，配 code-video skill；自述一次要数小时，没有基准测试 |
| ManimCat / Math-To-Manim / generative-manim | 499 / 2.8k / 941 星 | 两段式“概念设计 → 代码”；Math-To-Manim 自己承认长片还没渲染成功 |

### 3.3 其它
- **Lottie 生成**（OmniLottie、LottieGPT）：研究阶段，只适合图标级的小动画。
- **文档转视频**：Paper2Video（2.4k 星，MIT，按幻灯片并行）、PresentAgent。
- **非代码路线对照**：MoneyPrinterTurbo、NarratoAI、Pixelle-Video 都是“素材或生成画面 + TTS + 剪辑”，不让 LLM 写渲染代码。
- **商业产品**：Hera（多 agent 动态图形画布）、LottieFiles Motion Copilot、HeyGen Video Agent，只核实了官网标语；Jitter、Rive、Canva、Gamma【未核实】。

---

## 4. 共同成功模式 vs StoryDream 现状

| 成功模式 | 代表项目 | StoryDream 现状 |
|---|---|---|
| 分镜 JSON → **一次写一个场景** | Code2Video、TEA、PaperTalker | v1 一次写整片；v2 的 scene 文件一次覆盖 8 个镜头、最多 60000 字符 |
| 规格 / DSL 优先，模板确定性编译 | ALGOGEN、deepseek-motion、LASEV | 有 HyperFrames 模板和 Pixelle 模板，但没有作为 AI 代码失败时的降级层 |
| 脚手架 + 注入 API + 渲染前静态检查 | Remotion 模板、HyperFrames lint | 协议靠模型自觉，截断被误报成“缺协议” |
| **先出配音**，按实际时长回写分镜 | MathLens、explainroo、Lemo | 先按 4 字/秒估算再切镜头，配音超时才报错 |
| 局部修复 + 次数上限 | ScopeRefine、TEA（5 次） | 修复时把整个文件重发，每个文件只修 1 次 |
| 确定性检查 + VLM 联系表 | SGA、readcheck、film lint | 只在 3 个时刻截帧，没有 VLM |
| 场景并行 + 检查点 + 失败只重做一个场景 | Code2Video、OpenMontage | 一次只跑一个节点，任何一步失败整片停止 |
| 片长纪律 30–90 秒 | Lemo、各 explainer 项目 | 2443 字跑成 7.5 分钟 |
| 推理 token 单独预算，代码阶段低推理 | Code2Video 的模型分工 | 推理和可见输出共用一个上限 |

---

## 5. 给 StoryDream 的建议架构

### 5.1 三档模式

```
                ┌─────────────── 统一前端：文案 → AI 结构规划（免费预览、可编辑）──────────────┐
                │  片长 30–90 秒；长文先压缩或拆集；先出配音 → 测时长/词级时间 → 回写分镜    │
                └────────────────────────────────────────────────────────────────────────────┘
                         │                           │                              │
            ① 模板模式（默认）         ② 场景代码模式（进阶）           ③ 大师模式（高级/付费）
            LLM 只输出场景 JSON        LLM 每次只写 1 个场景模块        Claude Agent SDK + Lemo 原版插件
            选模板 + 填参数            HyperFrames HTML+GSAP，或          受控 MCP 工具：render_still、
            HyperFrames catalog /      Lemo 风格“引擎包”的 API            contact_sheet、readcheck、
            Pixelle 模板编译           ≤150–250 行，带结束标记           render_video、tts、mux
            成功率约 99%               静态检查 → 预跑 3 帧 → 局部修复    30–60 分钟一支、成本高
            任意模型                   ≤3 次 → 失败则降级为①的模板       质量上限最高，只能用 Claude
                         │                           │                              │
                └──────────── 统一渲染：seek(t) → 等绘制完成 → capturePage → FFmpeg 混音 ───────┘
                              确定性检查（文字越界/阅读时长/黑场/响度）→ VLM 联系表评审 1 轮
```

### 5.2 关键设计要点

1. **一次只写一个场景**：
   - 一个场景模块对应一个镜头（或一个完整语义段），导出 `renderScene(t, ctx)` 这类固定接口；
   - 末尾要求写 `// END_SCENE` 结束标记，同时检查结束原因和括号闭合，任一不满足就判为截断；
   - 截断时只重做这一个场景，必要时先把场景再拆小。
2. **推理和输出分开**：
   - 规划用推理模型，但只输出小 JSON；
   - 写代码用低推理强度，并单独给足输出上限；
   - 修错只发出错的局部片段加一行报错（ScopeRefine）。
3. **协议由宿主保证**：
   - 页面协议（`DUR`、`render`、`READY`、`TEXTS`）由宿主外壳注入；
   - 模型只写函数体，API 通过参数注入，禁止 `import`、`Date.now`、`Math.random`、网络请求；
   - 渲染前先过 `@hyperframes/lint` 加 AST 检查。
4. **风格只认一个来源**：
   - 每种风格提供：主题 token（配色、字体、缓动、字号、安全区）、STYLE 不变量清单、风格帧图片；
   - 这三样随每次调用附上，模型只能按名字引用；
   - 维护一份“已知陷阱”清单（M− 记忆），持续放进提示词。
5. **Lemo 风格的产品化方式**：
   - 把 demo 的 `engine/*.js` 抽成宿主提供的“风格引擎包”（MIT 允许，须保留署名）；
   - 先移植 8–12 种最适合知识讲解的风格，例如瑞士动态排版、数据叙事、字幕新闻、黑板粉笔、水墨、剪纸、地铁线路图、暗色发布会；
   - 其余风格放在大师模式里。
6. **失败不拖垮整片**：
   - 场景并行；
   - 每个场景有自己的检查点；
   - 失败的场景自动换成模板镜头并在界面上标注；
   - 先做一个样板镜头请用户确认，再批量生成。
7. **建回归集**：
   - 准备 30–50 个固定题目（科普、数据、对比、时间线、新闻、产品）；
   - 记录单场景渲染成功率、整片完成率、平均修复次数、token、耗时、费用；
   - 每次换模型或改提示词都跑一遍。

### 5.3 路线图建议

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0（1–2 周） | 片长限制 + 先出配音 + AI 结构规划预览；截断检测和推理预算；HyperFrames 升级到 0.9.x 并统一截帧握手；评估 Remotion 授权 | 60 秒固定文案用模板模式稳定出片 |
| P1（2–4 周） | 场景代码模式：单场景脚手架、lint、预跑 3 帧、ScopeRefine、降级到模板、场景并行与检查点；先移植 3–4 个 Lemo 风格引擎包 | 回归集单场景成功率 ≥95%，整片完成率 ≥90% |
| P2（4–8 周） | 大师模式：SDK worker 接生产，提供受控 MCP 工具（静帧、联系表、readcheck、渲染、TTS、混音），预算上限、断点续跑；同步 Lemo 上游到 143f387a | 30–60 秒 Opus 原创片完整跑通并完成人工审片 |
| P3 | 按需加 Manim 插件（数学/科普）；VLM 6×6 锚点评审；M− 陷阱记忆 | – |

---

## 6. 许可风险清单（建议法务确认）

| 对象 | 风险 |
|---|---|
| **Remotion**（StoryDream 已打包 `@remotion/player`） | 源码可见，不是开源；公司总人数超过 3 人，使用 Player 或任何渲染 API 都属于 Automators，每次渲染 $0.01、每月最低 $100；禁止用户上传自带的 Remotion 代码来渲染；浏览器内渲染遥测强制开启，5.0 会扩大遥测范围；不含 H.264 / AAC 专利 |
| Lemo-Opuscar | 代码 MIT：须附版权声明和许可全文。demo 媒体 CC BY 4.0：须署名 LemoLab。6 段配音不可复用。`tts_zh.py` 调用 Edge 在线服务，服务条款需核实。Anthropic SDK / CLI 不是 MIT |
| HyperFrames | Apache-2.0，保留 NOTICE 即可 |
| OpenMontage | AGPL-3.0，不宜直接集成，只借鉴思路 |
| Etro | GPL-3.0，会传染到闭源代码 |
| Twick | SUL，禁止做成托管 SaaS 或单独售卖 |
| Diffusion Studio / Mediabunny | MPL-2.0，按文件级 copyleft 处理 |
| MathLens | CC BY-NC，**不可商用** |
| Revideo | MIT，需设置 `DISABLE_TELEMETRY=true` |
| FFmpeg | 注意构建版本是 GPL 还是 LGPL，以及编解码专利 |

---

## 7. 主要来源

- Lemo-Opuscar：https://github.com/lemomo-ai/lemo-opuscar 、https://lemomo-ai.github.io/lemo-opuscar/ ；本地 `vendor/lemo-upstream/{README.zh-CN.md, AGENTS.md, DIRECTOR.md, TECHNIQUE.md, core/README.md, MY-STYLES.md, plugin/skills/lemo-opuscar/SKILL.md}`
- HyperFrames：https://github.com/heygen-com/hyperframes 、https://hyperframes.heygen.com/guides/hyperframes-vs-remotion.md 、https://hyperframes.heygen.com/concepts/determinism.md
- Remotion：https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md 、https://www.remotion.dev/docs/license/faq.md 、https://www.remotion.dev/docs/ai/ai-saas-template 、https://www.remotion.dev/docs/ai/system-prompt 、https://github.com/remotion-dev/skills
- Code2Video：https://github.com/showlab/Code2Video （arXiv 2510.01174）
- TheoremExplainAgent：https://github.com/TIGER-AI-Lab/TheoremExplainAgent （arXiv 2502.19400）
- ALGOGEN：arXiv 2605.12159 、https://github.com/MAC-AutoML/ALGOGEN-lab
- ManimCode 2611.08294；ManimAgent 2606.30296；SGA 2607.18116；PRISM 2605.19382；MoVer https://github.com/jama1017/MoVer
- Code2Video-Compass：https://github.com/code2video-compass/Code2Video-Compass
- deepseek-motion：https://github.com/alexriderspy/deepseek-motion ；explainroo：https://github.com/vincentsch/explainroo ；MathLens：https://github.com/shuyicc/MathLens ；code-video：https://github.com/dxawdc/code-video
- OpenMontage：https://github.com/OpenMontageInc/OpenMontage ；SenseNova：https://github.com/OpenSenseNova/SenseNova-6.8-Code2Video
- Manim CE：https://github.com/ManimCommunity/manim ；Revideo：https://github.com/midrender/revideo ；Motion Canvas：https://github.com/motion-canvas/motion-canvas
- Paper2Video：https://github.com/showlab/Paper2Video
