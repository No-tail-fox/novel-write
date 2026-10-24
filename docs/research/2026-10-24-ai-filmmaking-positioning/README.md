# 三种通用视频制作模式：短片制作、HTML 动画、创意动画

日期：2026-10-24。性质：定位分析、实施建议与当前结果索引。分析完成后已实施入口调整、Lemo 资料库与逐镜代码执行器；完整状态以 [本轮实施验收](../../plans/2026-10-24-creative-animation/acceptance.md) 为准。

依据：工作区代码、已有本机验收记录与 GitHub 上游一手文档。Lemo 核查和资料包固定提交为 `3961ddb3d24d8876e0e2754f7790d66908acee51`。初始调研未调用模型；后续实施新增 8 次代码生成/修复调用，复用原计划和四段旁白。HyperFrames 按本地 0.8.40 适配宿主规范，未升级到未经兼容核对的 main 生态组合。

## 2026-10-24 实施后的状态

| 项目 | 已完成 | 尚未通过 |
| --- | --- | --- |
| 三种入口 | 短片生成、HTML 动画、创意动画；保留原路由/taskType 和第三张工作台结构 | 全模式安装包与规模验收 |
| Lemo | 59 风格 / 126 文本文件固定版本与许可；6 风格适配，53 仅收录 | 六风格全片与其余风格适配；59 不是可用模板数 |
| 自动创作 | 主进程逐镜 AI 代码 → 编译/浏览器检查 → 至多一次修复 → 模板回退 → 渲染；真实组件跨进程恢复 | 本轮正式 IPC 在供应商派发前因 LICENSE_REQUIRED 受阻 |
| 真实成片 | 当前 v3 四模板片 23.88 秒 1080p，统一浅纸色/直切，−16 LUFS / −1.4 dBTP，完整解码与抽帧；历史混合片/独立 AI 镜头保留 | 保存 AI 镜头因小字/背景未通过 v3；模板片不能代替 AI 代码或整片审美验收 |
| 检查 | review v3 字号/背景约束、168 项质量 + 52 项兼容、typecheck/build、97 项 UI/32 截图 | VLM、词级对齐；额外 shell 合同仍有 8 项失败 |

下文第 2 节保留**实施前基线**，第 3–7 节保留方案及扩充目标。它们不能覆盖本段和验收中的最新结果，也不表示全部建议已经交付。同文案 30–60 秒三模式对比尚未完成。

## 1. 定位结论

按用户提出的方向，通用视频制作收敛成三个入口：**短片制作、HTML 动画、创意动画**。现有 Vox 与 Lemo 应合进第三种制作模式：Vox 提供解释叙事、素材分层和现有生产链；Lemo 提供风格规范、导演方法、示例和代码创作方法。

第三种建议正式命名为 **创意动画**，说明文案为「选定风格，由 AI 编排镜头并完成动画」。模板、AI 代码与二者混合是内部创作方式；Vox 是其中的「解释叙事」片型，Lemo 是风格和方法的来源。无需让用户在两个项目品牌之间选择。

| 制作模式 | 用户主要想完成的事 | 主要画面来源与制作方法 | 默认体验 |
|---|---|---|---|
| 短片制作 | 将文案、图像、实拍或 AI 视频镜头组织成有旁白的影片 | 素材剪辑、图文运动、图生视频/文生视频、配音字幕 | 给文案或素材，选择少量制作预设，自动成片 |
| HTML 动画 | 制作信息表达、版式、图表、品牌和产品界面的动态画面 | 以 HyperFrames 的 HTML/CSS/GSAP 编排为主，使用可编辑组件与时间线 | 选版式/组件自动制作，专家可修改 HTML 与时间线 |
| 创意动画 | 根据故事和美术方向，创作有解释性动作或独特视觉表达的影片 | 全片风格规范 + 语义分镜 + 模板/镜头配方 + AI 定制代码，必要时混用媒体 | 自动选择组件和创作方式，专家逐镜修改、锁定或改代码 |

这是按**用户工作方式**划分的三个入口。HTML 本身也是代码；创意动画也可能用 HTML/Canvas 承载画面。因此三个入口不是互不相容的三套底层技术，底层可以共享素材、配音、风格、组件和渲染能力。

实际任务有交集时，依据主要编辑方式推荐入口：大量实拍/生成视频镜头优先短片制作；主要编辑文字版式、图表和 DOM 元素优先 HTML 动画；主要让 AI 依据风格与故事设计动作、镜头和画面优先创意动画。不要为消除交集而复制任务或强制用户迁移工程。

这里讨论的是通用视频制作。AI 漫剧的小说、剧本、角色资产、分集和制作单元，以及音乐 MV 的歌曲/歌词时间轴，仍是独立的专项流程，不在本轮改名中强行并入这三类。

## 2. 当前实现是什么

### 2.1 实施前基线：Vox 并非全部 AI 代码或 HyperFrames

当前有三条可进入导演台成片的镜头策略：

1. `deterministic-layers`：图层、关键帧与语义动作编译成可定位时间的浏览器画面。
2. `remotion`：使用 React/Remotion 帧驱动组件。其中 `animation.mode` 又分 `template` 和 `code`，分别使用现有模板或编译后的自定义 TSX。
3. `living-poster`：使用已生成的视频素材镜头。

`hybrid` 虽然在保存 schema 中有枚举，目前渲染构建会明确拒绝未完成的混合模式，不能算已交付的第四条策略。影片能包含不同镜头策略，与这个尚未完成的单镜头模式是两件事。

实施前 Vox 自动生产的动画阶段主要选择 `paper-popup`、`paper-actors`、`data-bars`、`map-multi-stop`、`paper-polaroids` 等少量模板，再进行校验、编译与渲染。当时能保留锁定镜头的自定义代码，但自动执行器尚无逐镜 AI 代码创作循环。本次已补齐该循环，仍以模板打底并允许失败回退，不要求全部画面由代码生成。

Remotion 组件最后同样装在 HTML 页面中，`runtime.tsx` 暴露 `window.__tl.seek()`，由 Electron 捕获画面。**HTML 运行壳不能据此归类成 HyperFrames 工程。** 当前导演台也不是直接使用 Remotion 官方 renderer 完成全部成片。

### 2.2 HyperFrames 已部分接入，应在现有 HTML 工作台上补齐

这是对上一轮报告的重要更正：当前 `package.json` 已固定 `@hyperframes/core`、`@hyperframes/player`、`@hyperframes/lint` 为 **0.8.40**，GSAP 为 **3.12.5**。

| 能力 | 当前状态 | 整合时要做的事 |
|---|---|---|
| 官方 Player、源码编辑、lint、时间线检查 | 已有接入代码 | 延续现有工作台，验证新增组件的兼容性 |
| 本地 GSAP 与 HyperFrames runtime | 构建脚本已有打包逻辑 | 固定版本，检查离线字体、素材和安装包资源 |
| HTML 自动制作 | AI 输出结构化场景计划，程序生成 HTML | 加入风格约束、组件查询和必要的定制代码生成 |
| HTML 成片后端 | 自有 Electron 逐帧捕获 + Storybound 媒体 sidecar 合成 | 先验证现有后端；是否接官方 engine/producer 单独比较 |
| 上游组件生态与制作 Skills | 尚无全量适配和质量证据 | 固定兼容版本，登记依赖、适用条件、预览和验收状态 |
| 与本地版本对应的制作契约 | 本轮已加入 0.8.40 宿主约束与语义模板选择 | 新版上游规范/组件仍须单独核对，不能宣称 main 全量兼容 |

用户要求「HyperFrames 作为 HTML 制片的选择」可以明确落实为 HTML 模式中的 HyperFrames 制作方案。当前 HTML 链本身已使用它的一部分，不能再把“原 HTML”和“HyperFrames”包装成两套完全无关的引擎。先补完整方案、标明能力，再根据实测决定是否增加官方渲染后端。

上游 README 所称约 450 个 blocks/components 是组件口径，不是 450 套完整影片。上游 main 的 Skill、CLI、Catalog 和 runtime 也不能直接假定兼容本地 0.8.40。

### 2.3 产品入口确实混用了不同层级

实施前导航中 `editorial-collage` 显示为「VOX 视频」，说明是「解释型视觉叙事」；`html-video` 显示为「HTML 动画」，说明是「代码驱动视频」。前者按片型命名，后者按技术命名，造成用户难以判断同一文案应该去哪里制作。本轮已显示为创意动画，并在 HTML 入口标明 HyperFrames 和场景编辑。

建议将 `editorial-collage` 的产品名逐步改成「创意动画」，将 Vox 的解释叙事作为默认或推荐片型。HTML 的说明改为具体用途，例如「版式、图表与品牌动效」。三个入口都可以自动化，不把“简单/专业”拆成两个不同项目。

工作台继续采用用户选定的第三张 process-outline：左侧制作/镜头大纲，中央预览与就地编辑，固定项目主操作，高级设置按需展开。无需为 Lemo 再增加一套常驻右栏或第二个生成按钮。

## 3. Vox 与 Lemo 具体怎样合

合并的是**产品能力与工作流程**，不要求把所有代码重写成同一个运行时。

| 层次 | 统一后的职责 | 来源与复用方式 |
|---|---|---|
| 片型 | 决定叙事目标，如解释叙事、数据故事、档案调查、风格短片 | 延续 Vox 预设，引入 Lemo 的适用题材 |
| 全片风格 | 定义色彩、字体、材质、运动、镜头和声音方向 | Lemo 风格规范、现有项目风格与品牌规则 |
| 镜头计划 | 明确每镜头在讲什么、依据什么素材、发生什么动作 | 现有分镜/cue 计划 + Lemo 导演方法 |
| 创作方式 | 已验证模板、AI 定制代码、混合使用 | 由系统按镜头需求选择，专家可覆盖 |
| 画面实现 | React/Remotion、HTML/GSAP、Canvas/WebGL 等 | 按能力适配，保留原始源码格式，不承诺跨格式无损转换 |
| 执行与审片 | 后台任务、版本、断点恢复、预览、抽帧检查、修复与最终编码 | 复用现有生产执行器，增加有界创作/检查节点 |

推荐的默认流程：

`输入文案/素材 → 推荐片型与风格 → 导演计划 → 分镜/语音时间 → 查询合适组件 → 组装或定制镜头 → 真实预览 → 检查/有限修复 → 成片`

组件能表达清楚的镜头直接复用；需要特殊因果动作、物体变形或风格技法的镜头生成代码。仅更换模型或把 STYLE.md 拼进提示词，不能替代组件查询、受限执行、画面检查和修复。

Lemo 允许导演整部影片的代码创作。这种方式可以保留为后续专家模式，但应先在短样片上验证所用模型、依赖、任意时间定位、修改范围与失败恢复，再扩大到长片。现有自动链的默认升级先以逐镜可保存、可重试、可锁定为单位。

## 4. Lemo 全量引入的范围

### 4.1 全量收录规范，逐项建立实际可用能力

固定提交的 `styles/README.md` 可核对为 **59 种风格、11 个分类**。建议完整保存下列参考资料，并保留上游提交、路径、文件哈希、许可证和本地适配版本：

- 59 份 `STYLE.md` 和各自 `style.json` 元数据。
- `DIRECTOR.md`、`TECHNIQUE.md`，以及 `MY-STYLES.md` 的个人风格保存/升级方法。
- `DEMO.md`、示例源码和工具的清单；按适配需要取用具体实现。
- 原始 `AGENTS.md` 和制作 Skill 作为有来源的参考资料，提取适用规则后纳入本项目执行器。
- demo 的出处、第三方 `CREDITS` 和许可记录；本产品实测样片另行保存。

不将外部 AGENTS 直接安装为本仓库的全局指令。上游面向交互式 Agent 的询问、审批、shell 安装和指定语音服务，需要转成本产品的默认值、阶段状态和已有服务配置。安装 Skill 本身不会让应用内配置的 LLM 自动获得工具循环。

上游 `style.json` 的样本包含名称、分类、用途、影片时长等展示信息；不能直接把它当成含完整依赖、输入 schema 与运行时兼容性的生产 manifest。本地需要补这些字段。

目录条目建议使用四个可核验状态：

| 状态 | 可以对用户承诺什么 |
|---|---|
| 已收录 | 可读规范、看出处；不承诺应用内生成 |
| 已适配 | 有明确运行时、输入输出与依赖，可进行开发试制 |
| 已验收 | 指定模型/版本/画幅下的真实样片及质量记录通过 |
| 实验中/受限 | 清楚显示尚未通过的依赖、画幅或模型限制 |

全量导入与分批验收并行推进。默认推荐已验收风格；全部风格进入可搜索、可分类的风格库。生成一次任务只加载全片所选规范、必要镜头配方和相关技术规则，不把 59 份文件同时塞入模型上下文。

### 4.2 全量风格索引

下表是已核对的上游收录范围，**不是当前应用已经支持的生成清单**。

| 分类 | 数量 | 风格目录 |
|---|---:|---|
| 剪辑与纪实 | 8 | caption-news、newsreel、countdown、city-symphony、visual-investigation、kino-montage、telestrator、news-package |
| 实证影像 | 8 | satellite-briefing、briefing-board、lidar-survey、white-model、data-physical、teardown、microscope、archive-lighttable |
| 手绘与绘画 | 7 | crayon-book、watercolor、ink-wash、impasto、one-line、whiteboard、urban-sketch |
| 东方传统 | 4 | shadow-puppet、ukiyoe、papercut-red、paper-lantern |
| 印刷与版画 | 5 | risograph、halftone-dossier、woodcut、engraving、silkscreen-poster |
| 图形与排版 | 7 | swiss-motion、spy-titles、art-deco、blueprint、stained-glass、pictogram-motion、ascii-crt |
| 信息与发布 | 5 | dataviz、iso-infographic、dark-keynote、living-screencast、hologram-hud |
| 卡通与动画 | 4 | rubber-hose、cel-anime-80s、scifi-toon、midcentury-toon |
| 游戏 | 4 | pixel-rpg、hd-2d、microgame、game-show |
| 电影与时代 | 2 | silent-film、backrooms |
| 材质与 3D | 5 | brick-toy、paper-popup、tilt-shift、lowpoly-island、glass-product |

首批实际验收优先考虑与现有能力接近的 `halftone-dossier`、`archive-lighttable`、`dataviz`、`swiss-motion`、`dark-keynote`、`paper-popup`。这是适配优先级，不是将全量收录缩减成六种风格。重 3D、人物表演和特定外部素材依赖的风格需要各自的验证路线。

### 4.3 规范与代码的可移植边界

配色、字体、构图、叙事节奏、镜头逻辑和声音方向可以跨模式复用。Canvas/WebGL 的绘制程序、Three.js 的模型和着色器、DOM/GSAP 的时间线、React/Remotion 的帧组件则需要对应适配器。不能把 Lemo 所有示例源码直接粘成 TSX，也不能假定任意 `window.render(t)` 工程都符合 HyperFrames 的 clip/media 生命周期。

Lemo 的代码与文档采用 MIT；demo 影片和静帧为 CC BY 4.0，复用需链接署名 LemoLab 并说明修改；第三方素材遵循各自 CREDITS。Game Show、Paper-cut Lightbox、Broadcast News Package 的三类 demo 语音不在该 CC BY 授权内，应重新制作。用户使用库新创作的影片，README 声明不要求署名。全量引入风格规范可行，示例媒体与第三方资产按各自授权处理。

## 5. HyperFrames 要补的具体部分

1. **兼容基线。** 固定 Core/Player/Lint/runtime/CLI/Skill/组件目录的可用组合；先检查本地 0.8.40，再决定整体升级，避免只换最新版 Skill。
2. **制作与设计规范。** 借鉴上游 `SPEC.md`、`frame.md`、逐镜计划、clip 起止、暂停时间线、字体和安全区要求。规范要变成可检查数据，不能只留在提示词中。
3. **组件查询与装配。** 引入可追溯的 Catalog 组件；记录适用语义、输入、支持画幅、字体/依赖、本地资源路径和预览，不在主侧栏列数百个特效开关。
4. **自动创作闭环。** 在现有改写、规划、素材、配音、预览、成片链中，增加组件选择与必要的局部代码定制，校验后保存精确源码版本，再预览和修复。
5. **渲染互操作。** 验证官方 runtime 与当前 `__ready`/`__tl.seek` 捕获协议的桥接；媒体定位、字体就绪和反向 seek 必须检查。是否引入官方 producer/engine，是后续有真实对照数据的后端决策。

HTML 模式也可以使用 Lemo 的通用视觉规则，例如 Swiss Motion 的排版和节奏。创意动画可以调用已验收的 HTML 图表镜头。共享能力通过镜头适配器实现，无需复制整部工程或增加一个「Lemo 工作台」。

## 6. 数据和后台执行怎样保持一致

当前 HTML 与 Vox 有不同的权威状态：HTML 主要为 `HtmlVideoPipelineDataV2` 及 `html-video-pipeline.v2.json`；Vox 基于 editorial document 与后台 production run。共享 `ProductionWorkflow` 已存在，但 HTML adapter 的 `source.readOnly` 为 true，它是投影，不是可以直接反写的统一工程。

近期保留现有 `html-video`、`editorial-collage` taskType 和 route ID，先调整显示名和创建入口。不要因为改产品名称而批量改数据库类型、旧项目路径或后台 job ID。

建议补充的共用元数据包括：片型、风格来源/提交/版本、模板或配方版本、创作方式、实际引擎与版本、模型/提示输入指纹、精确源码和素材哈希、QA 记录。本轮已在 editorial 制作设置、镜头 authoring 与节点中保存风格/上游版本、创作方式、请求与输入指纹、源码尝试和预览路径；尚无跨全部模式的统一运行时 manifest，不能把建议清单全部算成已交付。

每个原生工程仍由自己的执行器持有；跨模式共享素材和版本化镜头产物。早期的「用另一方式制作」应创建派生项目并保留来源，不能承诺将任意 TSX、HTML 或 Canvas 代码无损互转。

后台继续复用现有主进程调度、checkpoint、锁定、取消与恢复。代码创作和修复作为有上限的节点执行；用户修改输入后，旧异步结果不能覆盖新草稿。provider 已提交但没有明确回执的 unknown 任务不能因换模式、换风格或恢复而自动重复付费提交。源码校验也不等于完整执行隔离，运行范围和资源权限需要单独验证。

## 7. 落地顺序与验收

| 阶段 | 要交付的东西 | 通过标准 |
|---|---|---|
| 1 定位与兼容 | 三种制作模式说明；Vox 显示名迁移；风格/创作方式/引擎分层契约 | 旧项目、后台任务、锁定镜头与路由能继续打开；保留第三张工作台结构 |
| 2 全量风格资料 | Lemo 59 风格与导演/技术规范的有版本资料包、来源/许可和就绪状态 | 文件完整可核对；按所选风格加载；不把未适配条目标成可一键生成 |
| 3 两条动画基础能力 | HTML 的 HyperFrames 兼容基线与组件接入；创意动画的语义组件路由 | 同脚本真实素材短样片可播放，任意定位/反向定位一致 |
| 4 创意代码执行 | 从 Lemo 规则生成逐镜代码，编译、预览、检查、有限修复及回退 | 至少一种风格在配置模型下完成真实自动链，失败不丢已确认镜头、不重复扣费 |
| 5 扩充与规模验证 | 其余风格、不同画幅、长片、安装包与中断恢复 | 每项有独立版本、样片、资源数据与恢复证据后再进入默认推荐 |

首轮使用同一份 30–60 秒中文解释脚本、真实旁白和素材，对比当前组件方案、Lemo 风格下的定制镜头、HyperFrames HTML 组件方案。脚本包含观点、证据/照片、数据或地图和结论。不是只输出三个空工程或三段色块动画。

记录全片可读性、中文排版、解释动作是否表达旁白含义、素材重复/遮挡、字幕时序、音频、首中末与转场帧、耗时费用、峰值内存、修改一处后的失效范围、切页/重启恢复和确定性重渲染。VLM 若实际使用，保存模型、抽帧输入、结论与修复记录；未运行则明确 pending。

## 8. 当前成熟度的准确边界

- **HTML：**已有两次六镜、48.78 秒、1920×1080、24fps 基准通过，历史耗时约 303/366 秒，进程树同时采样私有字节峰值约 2.70/1.56 GB。4K 同负载在 3.5 GiB 私有内存保护线上中止，没有验收成片；24 镜、并发和新组件链未测。因此继续笼统写“HTML 高清长片内存未测”已不准确，也不能扩大为全部长片性能通过。
- **Vox / 创意动画：**历史数据柱形图完整自动链已通过；纸拼贴未知生图请求、地图/档案整片缺口保留。本轮逐镜自动代码创作与组件恢复已实测，历史 dataviz 单镜通过 v2 后生成混合片；当前 v3 因字号/背景拒绝该源码，尚无 v3 AI 代码通过证据。零新增付费输出的四模板 v3 片为 23.88 秒 1080p，解决本次样例的背景跳变/叠图/低响度并通过媒体检查，未完成整片审美与听审。可靠声学词级对齐和 VLM 审片尚未证明。
- **AI 漫剧：**远程角色连续性、口型、参考实际接收与完整上传/下载断点恢复仍未验证。这些不会因调整入口或引入风格库而自动解决。

HTML 性能数值来自历史基准，本次未重新运行或扩大其覆盖范围；创意动画新增验证见实施验收。此前部分 Vox 文档写“HTML 高清长片内存未测”，应以上述更具体的范围与原始报告为准。

## 9. 可核对证据

本地实现：

- [创意动画当前实施验收](../../plans/2026-10-24-creative-animation/acceptance.md)：新增代码节点、风格库、真实调用/恢复、样片和未通过项的权威索引。
- `src/shared/creative-animation/`；`electron/creative-style-references.ts`；`electron/creative-animation-preview.ts`；`src/shared/html-video-authoring.ts`：风格适配、来源核对、review v3 和 HyperFrames 宿主约束。
- `package.json`；`src/shared/hyperframes.ts`；`scripts/build-electron.mjs`：HyperFrames 固定依赖与 runtime 打包。
- `src/features/html-video/HtmlVideoAuthoringWorkspace.tsx`；`src/shared/html-video.ts`；`electron/html-video-renderer.ts`：官方 Player、源码保存/校验、结构化 HTML 构建与捕获。
- `src/shared/task-runtime-providers.ts`：HTML LLM 规划返回 scene plan，受模板 schema 约束。
- `src/shared/vox-animation.ts`；`src/features/vox-animation/runtime.tsx`；`electron/vox-animation-runtime.ts`：模板/TSX 模式与 Remotion 运行壳。
- `electron/vox-production-runtime.ts`；`src/shared/director-render.ts`；`electron/director-renderer.ts`：自动模板装配、实际可渲染策略、未完成 hybrid 的拒绝与后端。
- `src/app/navigation.ts`；`src/shared/production-workflow-adapters.ts`；`src/shared/html-video-runner.ts`：当前入口、只读投影与 checkpoint 归属。

既有验收：

- [第三张设计基准与 Vox 实施验收](../../design/2026-10-22-vox-generation-simplification/acceptance.md)。
- [共用抠图、HTML、Vox 与漫剧成熟度验收](../2026-10-20-animation-maturity/acceptance.md)。
- [1080p 首次通过报告](../../../.artifacts/html-video-benchmark/20261021-232638-hd/report.json)、[1080p 第二次通过报告](../../../.artifacts/html-video-benchmark/20261021-233547-hd/report.json)、[4K 中止报告](../../../.artifacts/html-video-benchmark/20261022-002412-uhd/report.json)。

上游一手资料：

- Lemo：[固定版本风格索引](https://github.com/lemomo-ai/lemo-opuscar/blob/3961ddb3d24d8876e0e2754f7790d66908acee51/styles/README.md)、[导演规范](https://github.com/lemomo-ai/lemo-opuscar/blob/3961ddb3d24d8876e0e2754f7790d66908acee51/DIRECTOR.md)、[技术规范](https://github.com/lemomo-ai/lemo-opuscar/blob/3961ddb3d24d8876e0e2754f7790d66908acee51/TECHNIQUE.md)、[个人风格](https://github.com/lemomo-ai/lemo-opuscar/blob/3961ddb3d24d8876e0e2754f7790d66908acee51/MY-STYLES.md)、[Skill](https://github.com/lemomo-ai/lemo-opuscar/blob/3961ddb3d24d8876e0e2754f7790d66908acee51/plugin/skills/lemo-opuscar/SKILL.md)、[许可说明](https://github.com/lemomo-ai/lemo-opuscar/tree/3961ddb3d24d8876e0e2754f7790d66908acee51#licence)。
- HyperFrames：[仓库](https://github.com/heygen-com/hyperframes)、[制作 Skill](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/SKILL.md)、[frame.md 设计规范](https://www.hyperframes.dev/design)。main 链接可能继续变化，实施时必须固定兼容提交。
