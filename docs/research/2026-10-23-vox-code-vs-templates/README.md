# Vox 视频路线选型：Lemo-Opuscar、代码生成与模板化渲染

- 调研日期：2026-10-23
- 目的：判断 Vox 应继续扩充手选动画模板，改为 AI 直接生成视频代码，还是采用混合生产路线。
- 方法：直接核对 Lemo-Opuscar 的 GitHub README、风格索引、TECHNIQUE.md、代表性风格目录、Skill 与许可页，以及 HyperFrames、Remotion、Motion Canvas、Manim、video-shotcraft、VVV、code-video 的 GitHub 项目说明；对照当前工作区 Vox 模板和自动生产实现。Lemo 源码核查基于提交 `3961ddb3d24d8876e0e2754f7790d66908acee51`；其他项目按调研当日公开内容记录，目录数量可能继续变化。
- 限制：GitHub API 未认证访问当日限流；以 GitHub 页面中一手仓库内容为主。外部项目的样片和质量数字属于作者自述，未在本机逐一完整构建；本地 Vox 结论是当前工作区的静态代码检查，不代表干净主分支。

> 2026-10-24 补充更正：上一轮遗漏了本项目已经接入 HyperFrames 0.8.40 的 Core/Player/Lint、本地 runtime 与 HTML 源码工作台。后续工作是补齐兼容的组件生态、规范与自动创作闭环，不是从零引入。按用户最新方向，通用制作模式建议为「短片制作 / HTML 动画 / 创意动画」，Vox 与 Lemo 能力整合到创意动画。详见[定位、完整风格收录范围与实施分析](../2026-10-24-ai-filmmaking-positioning/README.md)。

## 结论先行

**Lemo-Opuscar 确实有一大批可复用的风格，但更准确说是“代码拍片风格库”，不是一堆固定模板。** 当前风格索引列出 59 种风格。每种主要由 `STYLE.md` 视觉制作规范、`DEMO.md`/示例影片及其代码组成；Agent 读入风格规范后，为新的主题重新编写 Canvas/WebGL 等代码，再按时间逐帧渲染。用户换一个题材，通常不是只替换模板里的几段文字和图片，而是让 Agent 重新导演和实现一部新片。

“代码生成视频”和“Vox 动画”本来就不在同一层：Vox 是影片的叙事和视觉表达，代码是制作与渲染方式。Vox 可以用代码制作，也可以混合真实影像、图片、地图、数据与代码动画。当前工作区已经支持模板和自定义代码两种动画模式。

推荐采用：

> **模板/经过验证的动效组件优先，语义路由负责自动选镜头；风格包定义全片美术方向；只在现有组件覆盖不了的镜头上，才允许 AI 生成受约束、可验证的代码组件。**

用户界面仍然可以简单到“一键自动”或少量风格预设。Remotion、Canvas、WebGL、Manim 等应是系统内部实现选项，不是新手要面对的侧栏。

## Lemo-Opuscar：不是固定模板市场

### 结构与制作方式

- 仓库 README 宣称有 59 种影片风格；`styles/README.md` 的当前索引确实按题材分组列出 59 个风格目录，包含剪辑纪实、实证影像、水彩/版画、动态图形、数据叙事、卡通、游戏和 3D 等方向。
- 项目按 `STYLE.md` 风格规范与 `DEMO.md`/demo 组织内容；实际查看的 Watercolor 等样本包含规范、demo 说明、源码和预览素材。规范描述视觉语言、绘制/材质、运动、镜头、声音等，demo 展示技法如何服务具体故事。本轮核对了完整索引和代表性目录，没有逐一构建 59 个风格。
- Agent 按 `DIRECTOR.md`（导演/叙事）、`TECHNIQUE.md`（制作和渲染方法）与风格规范工作。用户可以直接指定风格，也可从零建立个人风格。
- 主要制作方式是代码驱动画面。核心契约是时间函数 `window.render(t)`，配合 `DUR`、`READY` 等状态：给定任意时间点确定性地产生一帧，Chrome 无头逐帧捕获，再用 ffmpeg 编码。旁白、字幕、音乐、音效共享时间线；技术指南还描述了 TTS 后的 ASR 核对与词时间戳、读字时间检查、两轮抽帧审片、关键动作加密采样、黑帧和响度检查。这些是项目工作流程规范，不代表已在 StoryDream 中落地。
- 新增纪实/证据方向也使用真实影像、档案与数据；不能把“用代码制作”理解为所有素材都由程序凭空绘制，或一定完全不使用外部素材。
- 这类复用更像 **风格 Skill + 可运行范例 + 逐片代码创作**。它可以生成非常不同的画面，但把同一种风格用于新题材时，模型仍要理解规范并实现新的场景，不等于传统模板的固定槽位替换。

### 规模数字要谨慎解读

README 同时展示一个 “OPUSCAR 98” 合集（98 部最佳影片对应的风格演示），而当前可复核的 `styles/README.md` 是 59 个风格条目。98 是 showcase 的项目/影片规模，不应与当前风格库的 59 种风格混为一个“模板数量”。

### 借鉴价值与风险

**值得借鉴：**风格规范与演示分开管理；完整制作指南；可保存个人风格；确定性逐帧渲染；旁白、画面、字幕、配乐共享时间线；先抽帧、检查可读性再交付。

**接入代价：**README 明确写明针对 Claude Opus 5.5 调校，其他模型可能无法复现；项目说明单片约需 30–60 分钟、Node 20+、Python 3.11+ 和 ffmpeg。TECHNIQUE 的 Windows 路径建议 WSL，重 3D 场景依赖 GPU，不能直接当作 Windows Electron 内置功能即插即用。它提供了代码导演整部片的公开工作流和演示，不足以证明这条路线在 StoryDream 的多模型、多任务、断点续跑、批量生产场景里已达到同等可靠性。

### 代码与媒体许可分别处理

- 代码和文档：MIT。
- demo 影片和静帧：CC BY 4.0，允许商用、修改和分享，复用时须链接署名 LemoLab 并说明修改。
- 用库自行制作的影片：README 明确归制作方，不要求署名。
- 第三方素材：遵循各 demo 的 `CREDITS` 与原始许可。
- 三种 demo 录音不在上述 CC BY 范围：Game Show Flat 的 macOS 系统声音、Paper-cut Lightbox 的 Edge TTS 旁白、Broadcast News Package 的豆包 TTS 旁白。不能把这些录音随样片直接搬入产品，应使用自己的合法语音渠道重新生成。

## HyperFrames：已有部分接入，需补齐 HTML 制作生态

[heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) 将 HTML、CSS、媒体与可跳转时间的动画逐帧渲染为 MP4，支持 GSAP、CSS、Lottie、Three.js、Anime.js、WAAPI 和自定义 adapter。采用 Chrome + ffmpeg，提供 CLI、lint、预览、帧检查、Studio、本地/Docker 和 AWS Lambda 渲染路径。源码 LICENSE 为 Apache-2.0，要求 Node 22+ 和 ffmpeg；README 自述已在 HeyGen 生产使用，Studio 仍在演进。

这个项目值得关注的部分不只是渲染器，而是配套生态：

- **约 450 个 blocks/components**：README 的口径是转场、覆盖层、标题、动态文字、字幕、图表、地图、3D 和镜头运动等区块，安装后为可编辑源码。它们不是 450 套完整影片模板，本轮也未逐项统计或独立渲染。
- **7 个公开 Skills**：默认核心为 `hyperframes`（制作契约与工作流程）、`hyperframes-cli`（检查/预览/渲染/恢复）、`hyperframes-registry`（优先查询和复用组件）、`media-use`（素材获取、生成与音频混合）。`figma`、`slideshow`、`remotion-to-hyperframes` 按需使用；其中 slideshow 输出可导航演示文稿，不是 MP4。
- **frame.md**：将面向网页的 DESIGN.md 转成面向视频画幅的设计规范，延续品牌 token，同时明确视频中的尺度、排版与构图规则。这比仅要求模型“做得高级”更接近可复用的设计输入。
- **完整制作循环**：计划 → HTML/时间线 → 素材 → lint → 预览与检查 → 渲染。可以参考它组织功能，而无需把所有特效选项暴露在侧栏。

对于 StoryDream，HyperFrames 已是 HTML 视频路线的一部分：当前固定 Core/Player/Lint 0.8.40，使用本地 runtime 和官方播放器；成片由自有 Electron 捕获与 Storybound sidecar 合成。下一步重点是补齐兼容版本的 Catalog、制作规范和自动创作闭环，并与 Lemo 风格包、Shotcraft 镜头配方配合。当前 Remotion 组件也已有实现与后台生产链，尚无同题材样片、性能和恢复数据证明整体迁移会更好，不建议直接替换全部已有实现。上游 main 的最新版 Skill 和组件不能直接视为兼容当前本地版本。

## 几种路线的差异

| 路线/代表 | 实际复用单位 | 换主题时模型做什么 | 优势 | 代价/适用边界 |
|---|---|---|---|---|
| 固定模板：VVV | 完整可编辑影片工程及输入 Schema | 替换图片、文案、音乐等槽位，特殊要求才改源码 | 可预期、可重复、易批量；适合一键流程和清晰验收 | 结构变化空间受模板限制；VVV 当前公开模板集中于婚礼影片，不等于通用 Vox 库 |
| 镜头配方库：video-shotcraft | 一个镜头的构图/动效 recipe 卡片 | 选语义匹配镜头，再用素材和文案生成 Remotion 实现 | 目录可以很大；短镜头组合灵活，适合“讲证据、展示数据、做开场”等语义路由 | 项目面向产品宣传片，不能把 150 个展示计数直接当成 150 个适用于解释片的合格镜头 |
| 风格驱动的代码创作：Lemo-Opuscar | 一组风格规则 + 一部代码样片 | 按风格规范重新设计和实现新片 | 风格跨度大，不必等待固定槽位；适合视觉实验和独特重点片 | 结果强依赖模型、代码生成与逐帧审片；成本、时长及回归稳定性较难控制 |
| HTML 视频生态：HyperFrames | 可编辑 HTML 区块/组件、动画 adapter、风格规范和 Skills | 查询组件、组合 HTML 时间线，必要时写新动画 | README 提供约 450 个组件与 7 个公开 Skills；Apache-2.0；本项目已有部分接入 | 组件数不是完整影片数；新增生态的版本兼容、长片内存、离线依赖与任务恢复需单独验证 |
| 代码/时间线编辑器：Remotion | React 组件、时间线和数据驱动场景 | AI 生成/修改视频项目代码，可复用组件和模板 | 生态与自动渲染成熟，适配 StoryDream 现有体系；可自动化批量 | Remotion 不自带大量 Vox 语义配方；其项目提示有特殊商业许可，集成前必须确认适用条款 |
| 程序化 2D 动画：Motion Canvas | TypeScript 动画和可实时预览的场景 | 编写图形动画，可编辑部分参数，和旁白同步 | 适合解释图形、时间线、因果和动态图表；MIT | 它是制作/编辑框架，不是全片语义生成工作流或大规模现成模板库 |
| 数学/科学动画：Manim | Python 场景及数学对象变换 | 编写严谨的公式、几何和算法演示 | 特定科学/数学解释有强表达力 | 不适合拿来做所有 Vox 镜头的通用渲染底座；风格范围较窄，依赖安装较复杂 |
| 多技术栈自由生成：code-video | Skill/CLI + Canvas、DOM、Three.js、Remotion、Manim 等项目 | Agent 为成片/段落选栈、写代码、配音配乐、抽帧检查 | 概念上最接近泛化 vibe-coding 拍片 | README 的九栈支持是能力范围声明，不代表九套在 StoryDream 中都已通过长片与恢复测试；不应将多运行时选项暴露给新手 |

以上几类不是互斥关系：完整片型、风格规范、镜头配方、渲染组件是不同抽象层。用户说的“模板越多越好”若把它们都装进一个下拉列表，反而会使选择更混乱。

数量核对补充：Shotcraft 当前 README 正文为 **124 cards / 150 shots**，仓库描述仍存在旧计数，应以正文与实际内容为准。VVV 当前是约 5 种完整模板、偏婚礼场景的早期项目，适合参考输入 Schema 与样片工作流程，不能据此视为通用视频平台。code-video 的九栈支持覆盖面很广，但仓库较新，本轮看到的提交历史很少，不宜据此判断生产成熟度。

## 当前 Vox 的重要差距

当前工作区已有约 50 个内置动画 ID、6 个 Shotcraft 配方、模板预览/搜索/个人模板，以及自定义代码动画结构。但**目录中的丰富度还没有进入一键自动生产链**：

- `vox-production-runtime.ts` 的自动动画阶段仍用少量分支：纸张解释多落在 `paper-popup` / `paper-actors`，数据根据是否有坐标落在 `map-multi-stop` / `data-bars`，档案落在 `paper-polaroids`。
- 自动制作虽有计划、图片/抠图、语音/时间、动画、编译、渲染和验证等任务节点，但 `animation` 执行主要按三个制作预设直接指定固定模板；并没有让 LLM 根据每个镜头语义在现有整套 Vox 目录中做可靠选择，也没有在模板不足时自动生成并运行新的自定义代码组件。
- `vox-animation-prompt.ts` 的 AI 代码生成主要依靠一段 TSX 系统提示词，已经限制依赖、帧驱动、素材 URL 和字幕区域；它还缺少 Lemo/HyperFrames 那样成套的导演计划、全片风格规范、组件查询、样片审查与修订循环。换一个更强模型可能改善单镜头，无法单独补齐这些流程。
- 所以眼下把 50 个选择扩到 150 个，主要会增加人工选择负担；把整条链立刻改成自由写代码，又会把路由不足转成代码不稳定、质量难验收的问题。

这说明近期核心不是换 Remotion，也不是马上拷进 59 个风格，而是补上 **镜头语义 → 风格约束 → 可验证配方/组件 → 成片 QA** 这一层。

## 推荐的 Vox 混合架构

### 1. 视觉方向（少量全片预设）

给新手呈现“自动推荐”以及少量看得懂的风格，例如：纪录解说、纸张档案、数据新闻、地图旅程、科技发布/极简图形。风格包定义全片色彩、字体、材质、镜头运动、节奏、声音方向和禁用规则。Lemo 的 `STYLE.md + demo` 是风格包写法的参考；不需要在主工作区展示 59 个技术风格。

### 2. 语义分镜与镜头配方

由脚本与旁白分析识别开场钩子、观点、证据、引文、人物、地点、数据、路线、机制、前后对比和结论；每个镜头再依据素材和画幅，从适配的 recipe 中自动选择。每个 recipe 记录用途、输入 Schema、建议时长、文字/素材约束、支持比例、预览、质量状态及回退项。

### 3. 经过验证的代码组件作为默认渲染层

沿用当前 Remotion 渲染链，先把稳定模板拆成可组合的镜头组件和运动原语。模板不是要求“一镜一种孤立整片风格”；可由镜头组件在共享的全片设计系统下组合，保持一致性又避免每个场景从头写代码。

### 4. AI 代码生成作为有限补位，不是第一条主路

当语义路由确认没有合适 recipe 时，专家/自动模式可以为**单个镜头**生成受约束组件，而非任意重写整部影片。生成结果需要：限定 API 和依赖、运行隔离、确定性时间输入、可单帧/任意顺序渲染、错误捕获、抽帧审查，并在失败时回退到通用安全镜头。长片必须先通过真实旁白短样片门禁。

这保留 Lemo 式的表现力，又用固定渲染契约和 Vox 的任务持久化保证批量制作可控。自由代码模式可留给熟练用户；普通用户不用理解代码生成。

## 建议落地顺序

1. **先补自动路由，不换渲染器。** 为现有可用模板/recipe 补齐叙事用途、素材要求、时长、比例、适用/禁用条件；按镜头语义自动匹配并提供稳定的 fallback。用测试覆盖每种语义和无匹配情况。
2. **以真实旁白做样片门禁。** 挑 30–60 秒真实故事，至少含观点、证据、数据或图片镜头；检查字幕阅读时长、画面变化、音画同步、长帧/空帧、裁切和最终编码。样片通过后才全片渲染。
3. **整理风格包，而不是盲目增加模板数。** 每包包含简明风格规范、真实 demo、适用题材、渲染输入/输出协议、QA 状态和许可清单。先做 4–6 个片型，把用户可选项保持少而明确。
4. **只为覆盖不到的重点镜头开放 AI 代码补位。** 生成隔离的镜头组件、校验接口与输出；记录成本和失败率。验证多个模型都能稳定工作后，才考虑扩大占比。
5. **扩展已有 HyperFrames 生态，再评估其他渲染栈。** 对数据/科学等必要场景先 PoC Motion Canvas 或 Manim。用户导入外部模板包应有来源、许可证、依赖和预览，经过隔离验证后才能运行。

### 下一轮怎样实测选型

使用同一份 30–60 秒中文脚本、同一旁白和素材，包含开场、真实图片/档案、数据或地图、结论，分别制作：

1. 现有 Remotion + 语义选择组件。
2. 参考 Lemo 风格规范，由 AI 定制重点镜头代码。
3. HyperFrames HTML + Catalog 组件。

比较完整可播放结果的观感、中文排版、旁白/字幕同步、修改一处内容的影响范围、耗时与费用、峰值内存、失败恢复和确定性重渲染。外部生成路径还应固定模型和依赖版本。以上是后续实施建议，本轮没有运行这些外部工程、安装 Skills 或调用付费生成接口。

### 关键验收指标

- 默认流程不需要用户逐镜选择模板，且能自动覆盖常见语义镜头。
- 模板路由不合适时有可理解的回退，不应产生空白、重复静帧或无关动画。
- 同输入可以确定性重渲染；锁定/恢复不会因为 AI 重新规划改变已确认镜头。
- 真实样片通过旁白、字幕、画面、素材出处和编码检查；不是只通过色块、测试方块或静态预览。
- 自定义代码隔离且受限，编译/渲染失败能退回安全配方；全片自由代码不应成为新手默认生成路径。
- 每种风格或配方必须有真实内容预览和 QA 状态。“卡片数”“风格数”“技术栈数”不是质量指标。

## 最终建议

产品方向更新为：**短片制作 / HTML 动画 / 创意动画。Vox 作为创意动画中的解释叙事片型，Lemo 的完整风格规范与导演流程整合进创意动画；现有 Remotion 优先完善自动路由，已有 HyperFrames HTML 链补齐兼容的组件生态与创作闭环。** 这是后续实施方向，不代表三种入口及全量风格已经完成。

近期交付以经验证的组件为主，逐步加入风格包与受约束的代码创作。用户只选片型、风格和少量必要输入，系统完成分镜、选组件、素材生成、配音、渲染与质量检查；专家从具体镜头进入编辑。

## 来源

- Lemo-Opuscar：[仓库 README](https://github.com/lemomo-ai/lemo-opuscar)、[当前风格索引](https://github.com/lemomo-ai/lemo-opuscar/blob/main/styles/README.md)、[TECHNIQUE.md](https://github.com/lemomo-ai/lemo-opuscar/blob/main/TECHNIQUE.md)、[示例 Watercolor 风格](https://github.com/lemomo-ai/lemo-opuscar/tree/main/styles/watercolor)、[MIT 许可](https://github.com/lemomo-ai/lemo-opuscar/blob/main/LICENSE)
- Lemo-Opuscar：[制作 Skill](https://github.com/lemomo-ai/lemo-opuscar/blob/main/plugin/skills/lemo-opuscar/SKILL.md)、[媒体与代码许可说明](https://github.com/lemomo-ai/lemo-opuscar#licence)、[风格影片展示](https://lemomo-ai.github.io/lemo-opuscar/)。
- HyperFrames：[仓库 README](https://github.com/heygen-com/hyperframes)、[Apache-2.0 许可](https://github.com/heygen-com/hyperframes/blob/main/LICENSE)、[核心制作 Skill](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/SKILL.md)、[Catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart)、[frame.md 设计规范](https://www.hyperframes.dev/design)。
- [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)：项目 README 与公开 gallery，镜头 recipe/预览目录参考；Apache-2.0。
- [VVV](https://github.com/actionow-ai/vvv)：完整模板复用、输入验证、短样片审查参考；MIT。其 README 标明早期发布状态，不能把项目自述的端到端验证外推到 StoryDream。
- [Remotion](https://github.com/remotion-dev/remotion)：React 代码作为视频源的渲染底座参考；仓库明确提示存在特殊商业许可条件。
- [Motion Canvas](https://github.com/motion-canvas/motion-canvas)：TypeScript 动画和实时预览编辑器参考；仓库标示 MIT。
- [Manim Community](https://github.com/ManimCommunity/manim)：数学/科学解释动画的专用路线参考；仓库标示 MIT。
- [code-video](https://github.com/dxawdc/code-video)：多技术栈代码拍片 Skill/CLI 与逐帧审片参考；README 标示 MIT。
- 工作区前序调研：[Vox Vibe-coding 视频 Skill 与模板库调研](../2026-10-23-vox-vibecoding-video/README.md)。
