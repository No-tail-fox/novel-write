# 短片生成双输出整合与 Lemo Agent 实施方案

<!-- SHORT_VIDEO_MIGRATION_CURRENT -->
## 当前实施状态｜2026-10-31
- [x] 短片入口统一 MP4、剪映草稿、双输出；本地素材池与普通短片混剪链路已实测。
- [x] Pixelle 固定上游 31 模板与 54 处参数完整接入；31/31 真实双输出、124 个草稿媒体引用、3 个运动模板检查通过。
- [x] 真实桌面素材池 40 项、Pixelle 32 项检查通过（常规与紧凑窗口）。
- [x] Lemo 官方 SDK 独立 worker 与原版插件真实加载；新增请求账本/网关的 47 项测试和既有 SDK 27 项测试同轮通过。
- [x] 官方 SDK 本机两轮工具反馈和断流保护实跑通过：成功场景2次上游请求；断流场景仅1次上游请求，unknown之后拦截内部重试。
- [x] 最新最终验收：同一轮17文件404项全过；应用/Electron/scripts/独立worker四套类型检查、Electron与独立worker构建通过，官方SDK运行时与两项离线协议场景再次实跑通过。
- [ ] MoneyPrinter 网络素材检索、Lemo真实渠道/Windows受限工具执行/素材音频桥接/生产入口接线与原创有声成片。
- [ ] 剪映应用实际打开草稿、真实AI美术与声音验收、安装包验收。

**边界：0次付费模型请求。SDK协议试验使用本机模拟响应，不是AI视频创作验收；原创意视频生产入口没有切换到新宿主。C盘已满，本轮构建与测试临时目录固定在I盘，不删除用户文件。**
<!-- /SHORT_VIDEO_MIGRATION_CURRENT -->
<!-- REMAINING_WORK_PLAN_REFERENCE_20261031 -->
## 尚未完成部分的细化方案｜2026-10-31
详见同目录 `remaining-work-implementation-plan-2026-10-31.md`。本轮核查确认：生产worker仍仅做probe，官方SDK新链路尚未切换生产；下一步以真实渠道、受控工具、响应/工件恢复和宿主音频桥接为关键路径，网络素材可独立推进。方案完成不等于功能完成。
本轮未改生成代码、未改样片、未调用付费模型、未重跑上一阶段测试。磁盘复核时C盘约8.5GiB、I盘约7.2GiB可用，上一阶段“C盘已满”的环境状态已经变化。
<!-- /REMAINING_WORK_PLAN_REFERENCE_20261031 -->


- 核查日期：2026-10-31（Asia/Shanghai）。
- 性质：基于本地实现和上游固定提交的源码审计、整体实施方案；不是迁移已完成报告。
- 当前实施状态（2026-10-31 续接）：短片MP4/剪映草稿/双输出、本地素材池，以及Pixelle原核心31模板与54处参数已接入程序。全部31模板真实双输出通过；4例素材混剪通过；15文件330项回归及生产构建通过。中文展示与安全错误处理的最后一轮桌面复验通过（素材池40项、Pixelle32项），三套TypeScript检查通过。Lemo官方SDK独立worker已安装并真实初始化，原版插件与命名空间技能已核验；尚未切换生产入口。MoneyPrinter网络检索、官方Agent完整创作/付费回执/权限桥接及真实成片仍待验收，不能称为整体迁移完成。
- 最新范围（2026-10-31 更新）：数字人直播与动作迁移均排除；数字人口播不放入本期实施与验收。保留普通短片成片增强、Pixelle 全部 31 模板与标准/素材驱动流程、Lemo 官方插件宿主接入。

## 最新执行证据与未完成边界

- 本地素材混剪：多选MP4/MOV/WebM、顺序去重、原子拒绝超限、项目托管、重开恢复；普通短片与Pixelle共用素材池，模板模式禁用无效的普通裁切选项。
- Pixelle：原始313文件保持哈希不变，31模板与54处参数保留。仅新增中文展示名，不修改原文件路径、参数键或默认值。
- 真实媒体：31/31模板生成有声MP4及剪映草稿；视频模板不重复混入原声，双交付重试复用缓存；另4/4本地素材混剪工程例通过。
- 草稿独立性：31个草稿的124个媒体引用均存在且位于各自草稿目录，轨道素材ID均可解析，MP4与草稿指纹一致。三个视频/asset模板的运动检测通过；三张31模板联系表已逐张查看。
- 工程证据：`.artifacts/pixelle-all-templates-dual-output/report.json`、`delivery-verification.json`及三张contact-sheet；`.artifacts/short-video-materials-smoke/report.json`；`.artifacts/short-video-integration-final.log`（330项通过）。
- 本轮付费模型调用为0；色条/正弦音用于工程检测，不是艺术成片。尚未在剪映应用实际打开这些草稿，不能用路径检查替代应用兼容性验收。
- Lemo独立宿主预检：固定官方SDK 0.3.314、实际CLI 2.1.314，真实加载原版plugin及lemo-opuscar:lemo-opuscar技能；预检未提交prompt、无模型请求。27项权限边界/运输/取消测试通过；productionReady明确为false。
- 下一阶段仍需网络素材服务及来源许可记录、Lemo生产权限与请求回执链路、真实渠道兼容与AI生成效果验收。原生产入口仍使用既有工作流，不能把独立宿主预检冒称为完整创作已接入。

## 0. 本轮确认的产品范围

1. MoneyPrinterTurbo 与 Pixelle-Video 的能力统一整合进现有“短片生成”，不新增两个一级入口，不嵌入两套独立网页应用。
2. “短片生成”保留“直接成片（MP4）”与“剪映草稿”两个独立输出选项，允许同时选择；两者复用同一项目内容、素材、配音与时间轴。
3. MoneyPrinterTurbo 负责补强素材检索、混剪与常规成片；Pixelle 保留固定版本全部 31 个原模板及原生标准/素材驱动、渲染合成能力。二者不是每次任务必须依次完整运行的两条流水线。
4. Lemo 沿已讨论路线，在原“创意视频”入口使用官方插件/工具库与 Claude Agent SDK 宿主；不再将受限自写工具循环称为官方等价实现。
5. 数字人直播、动作迁移与数字人口播不纳入本期。保留现有 VOX、HTML、音乐 MV 等无关入口和工作流，不做横向重构。
6. 用户本轮确认的是整体方向；实际迁移、渠道兼容和成片验收仍未完成。不得以方案已写入代替程序已实现。

## 1. 结论与推荐路线

**保留一个产品外壳、一个任务系统和一个模型配置中心；复用两类不同的生产方式，而不是把三个项目分别塞进三个独立网页。**

1. MoneyPrinterTurbo：借鉴并移植素材检索、素材混剪和成片交付的增量能力，补强现有短片生成；不再复制一套完整后台与 Streamlit。
2. Pixelle-Video：采用“固定版本原 Python 核心 + 全部 31 个原 HTML 模板 + 小型本地适配服务 + 现有 React 界面”。不是只复刻页面，也不是把 HTML 重画成简化版模板。
3. Lemo：保留官方插件、指南、风格和工具，优先使用 Claude Agent SDK 作为执行宿主。替换当前手写六工具循环的生产职责，而不是继续把它包装成官方等价实现。
4. MoneyPrinter/Pixelle 的能力都进入“短片生成”。Lemo 保留“创意视频”的原入口，与短片共用素材、音频、输出登记和质量校验，不强行统一生成内核。

选择理由：常规短片适合确定性流水线；创意动画适合编程 Agent 的创作、渲染、检查、纠错循环。两者可以共用软件基础设施，但不能用同一套严格大 JSON 任务协议替代所有工作。

## 2. 实施前的源码基线（历史审计，不代表顶部最新状态）

| 核查点 | 源码证据 | 判断 |
|---|---|---|
| “短片生成”入口 | `src/features/tasks/TaskCreationTypePicker.tsx:8`，标识 smart-video | 已有，无需新增一级入口 |
| 普通任务结束位置 | `src/shared/runner.ts:444-531`：第 6 步调用 writeJianyingDraft，outputDir 指向 draftDir 后 completed | 普通短片当前完成的是剪映草稿，不是本程序直接导出 MP4 |
| 用户交付界面 | `src/features/tasks/TaskDetailPage.tsx:108-185`：剪映草稿已生成、重新打包、草稿目录 | 界面与草稿终点一致，没有证明普通短片已自动成片 |
| 现有 MP4 能力 | `electron/main.ts:3954` 后 renderDirectorProject 只允许 editorial-collage / motion-comic | 可复用底层能力，但不能直接把普通任务塞入该 IPC 冒充 VOX |
| 素材与音频 | runner 的 ensureImages、ensureNarration；draft 接收 images/videos/narration/BGM | 基础设施已存在；视频资产可被草稿消费，不等于普通任务具备完整自动检索视频链路 |
| 模板 | NewTaskPage、TaskDetailPage 绑定 draftTemplates/templateId | 这是剪映草稿模板，不是 Pixelle 的 HTML 视觉模板 |
| 模型配置 | `src/shared/types.ts:56`：openai / responses / anthropic | 已有三种协议声明；并不能证明每个外接 Python/Agent 运行时都复用它 |

因此第一优先级不是再加一个“生成”按钮，而是补上普通短片真实的 MP4 交付终点，并保留原草稿能力。

旧工程兼容：历史 completed 任务仍按原来的“草稿已完成”解释，不倒改历史记录；新任务记录 deliverables 与 outputTargets，MP4 验收通过才显示“成片完成”。缺少 outputTargets 的历史普通任务兼容为仅草稿，不补跑 MP4。

## 3. MoneyPrinterTurbo：增量移植什么，不移植什么

固定提交：`27843a994bfa29c43c02150861d51490a6ca4bd2`。

上游 task.py 的关键流程是文案、检索词、音频、字幕、素材、最终视频，支持中途 stop_at 和生成前检查。这些是成熟实现的参考，不意味着我们要把整套 task.py 连同所有供应商、发布服务都接入。

### 建议补强的能力

| 能力 | 现状判断 | 接入策略 |
|---|---|---|
| 一键 MP4 | 普通任务缺交付闭环 | 新增普通短片 render/verify/register 阶段；复用现有 FFmpeg/媒体探测组件 |
| 视频素材检索与混剪 | 当前普通生成偏 AI 图片/本地人物图片 | 增加统一素材源接口；本地素材优先，外部检索按已配置渠道启用，记录来源/授权信息 |
| 素材不足、尺寸不符、时长不够 | 需要完整策略 | 去重、裁切/适配、选择片段、明确补齐策略；不静默插入黑屏，不以无关素材替代 |
| 配音、字幕、配乐 | 已有，不重写第二套配置 | 使用真实音频时长做时间轴；字幕时间戳校准，BGM 混音及旁白可懂度检查 |
| 局部重做 | 已有步骤/场景状态基础 | 更换画面只重做相关画面与合成；改文案才使对应音频、字幕、时轴失效 |
| 生成前检查 | 需要贯穿成片终点 | 模型/素材源可用、模板可解析、字体/浏览器/FFmpeg可用、磁盘空间、目标路径权限 |

不迁入：另一套账户/设置中心、Streamlit 页面、独立任务队列、社媒自动发布、与用户需求无关的大量供应商插件。

已确认输出方向：保留“直接成片（MP4）”和“剪映草稿”两个独立选项，允许同时选择；建议新任务默认选择 MP4。所有选中交付物分别渲染/打包、校验并登记；不能把“草稿成功”当成“MP4 成功”。

## 4. Pixelle 全模板：全量保留的精确定义

固定提交：`848b054e4fae40dabc62ec58e960b573e83793ac`。

源码清点结果：**31 个 HTML 模板 = 25 个竖屏 + 5 个横屏 + 1 个方形**。

按模板类型：**26 image + 2 static + 2 video + 1 asset**。完整逐文件清单见附录，完整 SHA-256 见同目录 JSON manifest。

本轮只核对源码与 Git blob：31/31 在归一化 Windows CRLF 后一致。没有执行 31 模板渲染，不将哈希一致冒充视觉验收通过。

### 必须一起迁移

- 31 个原始 HTML、原画幅、CSS、模板参数、默认值和各自布局。
- template_util 的扫描、尺寸解析、内置目录与用户目录合并机制；用户自定义模板独立于只读上游目录。
- HTMLFrameGenerator 的参数语法：`{{param:type=default}}`，保留 text/number/color/bool 类型；不能只做一个主题色输入框代替全部参数。
- 模板预览、按画幅/类型筛选、参数编辑及真实预览图，而不只保留名称。
- image、static、video、asset 四种处理分支。video 模板要保留视频底层运动和透明图层合成，不得退化成一张截图。
- 与模板有关的字体、默认图片、必要资源及版权信息。完整上游快照保留，生产包按许可与实际用途分层携带资源。

### 迁移时已发现的坑

1. **远程字体。** 15/31 个模板包含 Google Fonts CSS。另有远程默认图片地址。必须在允许分发的前提下做本地资源镜像、锁定字体版本，或明确提示未满足依赖；不能断网后静默换系统字体还宣称保真。
2. **模板与草稿模板不能共用一个 ID 字段。** 新增 visualTemplateRef；旧 templateId 保持草稿语义。ID 至少含提供方、上游提交、画幅、文件路径，避免不同画幅同名模板冲突。
3. **静态模板不应触发生图费用。** 选择 static 就跳过媒体生成；没有图像服务也应能完成纯文本模板渲染。
4. **重复生成风险。** FrameProcessor 以 image_prompt 非空决定是否调用生图；即使已有 image_path/video_path，仍可能进入生成分支。适配器必须显式区分“使用现有素材”与“请求新生成”，不能以为传入图片路径就保证不扣费。
5. **模板文字与普通字幕会重复。** 模板里的 text 不是天然等于独立 SRT 轨。使用 template / timed-overlay / off 的明确字幕策略，同一内容不能在画面和底部无意重复两遍。
6. **原生 LLM 客户端没有自动解决三协议。** 上游 LLMService 使用 AsyncOpenAI/chat.completions，默认 max_tokens=2000。照搬它不能治好之前的协议/截断问题；也不能把 native Anthropic URL 当作 OpenAI URL 配进去。
7. **原生页面不是业务 API 全覆盖。** 本期只抽取标准/素材驱动流程需要的业务逻辑，并接入宿主任务事件；不能认为内嵌页面或接一个 HTTP 地址就完成产品整合。
8. **音画时长不能只看估算。** 上游 VideoService 有音频驱动的裁剪/末帧补齐。应保留实现并显式记录策略，不在末尾静默冻结很久；过长补齐触发质量提示。

### 最便捷且后续能维护的实现

推荐“原核心 + 薄适配层”，而不是全面 TypeScript 重写，也不是内嵌 Streamlit 网页。

- 第一层：StoryDream 现有任务、模型和素材系统负责项目状态及调用授权。
- 第二层：桥接层把场景、已生成音频、已有图片/视频、模板参数交给 Pixelle FrameProcessor / HTMLFrameGenerator / VideoService。已有素材路径可复用，生成开关须显式控制。
- 第三层：需要 Pixelle 原生标准/素材驱动流程时，通过相同桥接层调用 StandardPipeline/AssetBasedPipeline；不再启动另一套主队列、不再维护另一份用户配置。
- 模型差异：由宿主现有三协议适配器处理，或向 Python 注入统一的服务接口；不为每个模板另写模型调用。所有生图/视频/TTS 调用必须经过同一费用与回执登记。
- 运行方式：首版使用隔离 Python worker/sidecar。短片流水线的步骤事件、失败与输出清单返回宿主；Electron 主进程监督其生命周期，UI 不直接访问无鉴权本地端口。
- 若采用本地 HTTP：只监听 loopback，使用会话 token，不开放任意路径读取/写入；若采用 stdio：仍需控制消息大小、日志与 JSON 事件流隔离。两者不并行维护。

Pixelle 原项目含 Python、Playwright、FFmpeg、ComfyKit 等依赖，且依赖表包含 Streamlit/MoviePy。首轮先锁依赖保真跑通，不为了“小包”先删关键依赖；后续只在回归通过后裁掉不使用的 UI 依赖。上游有 Windows 嵌入式 Python/FFmpeg 打包脚本，可参考打包方法，不照搬其独立 Streamlit 启动入口。

## 5. 明确排除的范围

按用户 2026-10-31 最新要求，动作迁移与数字人直播均从本期方案移除：不新增相关入口、业务服务、远程工作流接入、费用预检或验收项，也不让其凭据、额度与模型部署成为其余迁移的依赖。

数字人口播同样不纳入本期。此前研究快照仅作为源码审计资料留存，不代表计划迁入这些功能。本次是调整迁移方案，不删除应用中已有的无关功能。

Pixelle 的全部 31 个内置 HTML 模板继续保留；移除动作迁移不减少模板数量，也不移除正常视频模板、素材混剪或图生视频能力。

## 6. Lemo：问题不在“有没有复制仓库”，在“谁在执行它”

固定提交：`f17136060781a0068a7951245a3aa7835a7230de`；现有 vendor 已有该上游库。

### 官方方式

官方插件是交给宿主编程 Agent 的 skill，不是一个脱离宿主即可自行循环的微型 Agent 库。

术语澄清（2026-10-31）：

- **Agent**：接收任务后调用模型规划步骤、调用工具、读取结果并继续行动的运行中系统，不等于一次文本 API 请求。
- **Claude Agent SDK**：Anthropic 提供的开发工具包和运行时接入层，将 Claude Code 的 agent loop、工具、上下文/会话与权限能力嵌入 Python/TypeScript 应用；其库负责运行 Claude Code 二进制。它不是新模型，也不是专用视频生成器，更不是仅有接口定义的空框架。
- **Lemo**：视频制作 Skill/插件、风格指南、代码库与渲染工具，由宿主 Agent 执行。不是 Lemo 自己开发了 Claude Agent SDK，也不能据此声称 Lemo 原仓库已经内置 SDK 服务。
- **本方案关系**：StoryDream 负责界面、项目、费用与交付；建议以 Claude Agent SDK 承载 Agent 循环，加载 Lemo 本地插件并执行其制作流程。SDK 支持本地插件是接入依据，实际模型渠道与端到端流程仍待验证。

接入 SDK 可以避免重写基础工具循环，但不会自动保证审美质量、纠错成功或任意中转接口兼容。需要明确权限、依赖、预算、验证工具和失败退出条件；不能以无限重试代替可靠性。此处只是已核实接口基础上的接入建议，尚未安装或实施。

官方流程为：Brief → TREATMENT.md → 用真实代码渲染并检查风格帧 → 可选分镜审批 → Voice/check → score → animation → mix/render → 自检交付。

它需要读取风格与技法、写多个文件、执行 Node/Python/渲染/混音命令、检查真实画面、看到错误后修程序。样片只是技法参考，不能换几行字幕当新作品。

### 我们当前为什么不等价

`electron/lemo-upstream-agent.ts:84-98` 的系统提示和执行器只提供六个工具：list_files、read_file、write_file、replace_text、review_frames、finish。

其中确实已有视觉反馈和技术检查，不能说完全没有 Agent；但它禁止 shell/Node/npm/网络，把声音与合成完全交给宿主，也没有强制执行官方 TREATMENT/风格帧完整流程。因此“全文件引入”不等于“官方创作方式移植”。

已有真实运行证据仍标注 incomplete_no_generated_film。本轮没有重跑，也没有把离线测试或源码导入当作实片成功。

### 推荐：官方 Agent SDK + 官方插件 + 小型宿主适配

Claude Agent SDK 的官方插件接口支持从本地目录加载 plugin。可直接加载现有 `vendor/lemo-upstream/plugin`，不需要另造一个名字类似、能力缩减的插件。

| 保留官方 | StoryDream 需要提供的适配 |
|---|---|
| Skill、AGENTS/DIRECTOR/TECHNIQUE、STYLE 与 MY-STYLES 流程 | 用产品已填的需求生成 brief，已知信息不反复问 |
| 读写文件、命令执行、渲染、真实画面检查的工作循环 | 运行目录、权限、进度事件、取消、会话恢复、日志与费用登记 |
| 原创 treatment、真实风格帧、动画、声画自检 | 接入现有工程、预览、产物版本和交付记录 |
| 官方工具与风格能力 | Windows 路径、Git Bash/等价脚本执行、Node/Python/FFmpeg/浏览器路径发现 |
| 自定义风格与从空白创作 | 用户风格放 app data 中，库更新不覆盖 |

进程建议：Electron 主进程启动独立 Node Agent worker，worker 使用 SDK 加载本地插件。不要在渲染进程直接运行 Agent，不让它修改应用源码或上游库。实施前未安装SDK；截至本次已在services/lemo-agent-worker独立安装固定SDK和原生CLI，并通过真实初始化及插件/技能加载预检。此时productionReady仍为false，尚未替换旧生产工作流。

产品发行时固定上游提交及依赖；上游 setup 的自动 clone/update 改由安装器/资源管理器负责，Agent 只收到已准备好的库路径。保留原指南与工具，适配差异单独记录，不能悄悄修改官方核心再声称完全原版。

### 声音与字幕怎样结合

“程序生成配音和字幕、AI 生成画面”的方向本身没错；问题是不能把时序和声音节奏从 Agent 的观察中拿走。

推荐保留两种明确模式：

- **官方基线模式**：允许官方工具完成整套声音、配乐和混音，先验证与官方流程同条件的真实成片。
- **宿主音频模式**：Agent 通过有权限控制的工具调用我们的 TTS/字幕/音乐服务；拿到真实音频、测长结果和时间戳后继续编排。两种模式都只允许一个最终混音责任方，禁止重复配音或叠两层字幕。

先做官方基线，再用同一 brief 比较宿主音频接法；不能一开始切掉声音、配乐、真实工具执行，最后把质量差异归咎于模型。

### 模型、上限与自动纠错的实际边界

- 官方 README 声明风格按 Claude Opus 5.5 调整。此处只引用上游声明，不证明任意中转的同名模型就是相同能力。
- 软件有三协议选项，不代表 Agent SDK 原生接受 OpenAI Chat/Responses。自定义网关要通过 Anthropic Messages 等官方支持协议；需验证工具调用回合、图片输入、完整流式事件、版本/beta字段、模型 ID 与能力映射。
- HTTP 200 的普通文本请求不是 Agent 兼容测试；“强制 tools 返回 400、去掉 tools 返回 200”也不能通过关掉工具来假装 SDK 已兼容。
- 不再把整部视频代码塞进单轮 JSON。分阶段、分文件、带检查点执行；长度截断是失败信号，不保存为正常源码。
- 单次输出 token 上限应按模型/网关实际能力设置，不固定为 4096；但不能无限制。上下文、单次输出、单轮工具超时、总费用与总运行时间是不同限制，要分别管理。
- SDK 本身可能有自动重试。接入前必须验证断流/未知回执的处理，不能再叠加一层 UI 重试造成重复付费；未知结果先保留账本、阻止盲目重发，再按可查询证据或用户决定恢复。
- 自动纠错要能修当前工程并重新渲染；测试固定内容与时长，不能通过改测试样片、改主题、删难场景来通过验收。
- 允许工具不等于提供安全沙箱。cwd 或 allowedTools 不是 OS 隔离；Windows 下要明确低权限运行/文件访问策略，不把全盘、全部环境变量密钥或任意安装权限交给生成代码。

轻量化的正确对象是：重复 UI、第二套任务系统、重复配置、可按需下载的非必要资源。不是删掉官方 Agent 的执行和纠错能力。运行时体积、依赖准备与生成成本无法凭“一个 SDK”消失。

## 7. 产品、双输出与统一任务契约

### 7.1 一个入口，三种制作方式，两种输出

现有“短片生成”内部提供 **AI 图文、素材混剪、模板短片** 三种引导方式，不新增三套任务中心。模式是推荐配置，不是割裂的功能：素材混剪也可选择 Pixelle 模板，模板短片也可复用本地图片/视频。

页面顺序：

1. 内容/素材：主题、固定文案或用户素材；选定制作方式。
2. 画面设置：画幅、画面来源、视觉模板；模板画廊按竖/横/方形与 image/static/video/asset 筛选，显示全部 31 个真实预览。
3. 声音设置：配音、字幕策略、BGM；先预检实际所需渠道与运行依赖。
4. 输出设置：两个独立选项“直接成片（MP4）”“剪映草稿”，至少选一项，可同时选择。建议新任务默认 MP4；只选 MP4 时隐藏草稿专属设置，只选草稿时不强制执行最终 MP4 合成。
5. 生成与交付：统一进度及场景产物预览，最终分别展示 MP4 播放/打开文件和草稿打开目录/重新打包；某个输出失败只能重试该输出。

剪映草稿模板继续保留，但与 Pixelle 视觉模板分属不同设置。界面避免两个控件都叫“模板”却互相覆盖。

复用 StoryDream 的 src/ui、语义色和现有状态管理；不内嵌第二个 Streamlit 应用。沿用既有路由、稳定任务 ID、焦点与草稿状态；覆盖普通桌面和紧凑窗口。高级模板参数来自元数据，不手工遗漏参数。

### 7.2 一个生产过程，两个交付分支

公共阶段：输入与依赖预检 → 文案/分镜 → 素材检索或生成 → 配音与字幕时间戳 → 标准化场景与时间轴 → 按需输出。

- MP4 分支：调用适合当前内容的原生/复用合成能力 → 媒体探测与质量检查 → 登记文件 → 应用内预览。普通短片使用自己的合法接口，不伪装成 VOX/motion-comic 以绕过检查。
- 草稿分支：把同一时间轴、素材、配音和字幕映射到现有剪映 writer → 路径/素材/时间轴检查 → 实际打开验证 → 登记草稿目录。
- 同时选择时，音频、图片、视频及可复用视觉片段只生产一次。草稿失败不重做成功的 MP4；MP4 失败不丢掉已经成功的草稿。
- 允许稍后从同一项目追加另一种交付物；只有缺失或失效的工件才重新生产。保留所需素材与资源引用，不能导出后清理掉草稿正在引用的文件。

MoneyPrinter/Pixelle 是可组合的能力来源，不是连续跑两套全文案/生图/TTS。宿主拥有任务编排和状态，适配器调用经过明确边界的业务服务；每个最终输出只指定一个合成/混音责任方。

### 7.3 草稿保真与可编辑性的边界

这是双输出迁移必须明确的约束：本方案不假设任意 HTML/CSS 都可无损映射为剪映原生可编辑图层。

- 常规混剪：优先保留原图片/视频轨道、切点、配音、可独立表达的字幕和 BGM，延续现有草稿编辑能力。
- Pixelle 模板：为保留原视觉效果，优先将模板画面或复杂动画导出为逐场景的渲染素材，再放入草稿；配音、BGM及未烘焙进模板的字幕保留独立轨道。不能仅把整条最终 MP4 塞进草稿就宣称迁移完成。
- 优先使用无声视觉片段；若复用带声片段，显式移除或禁用其音轨，确保独立配音不会叠加播放。
- 已渲染到画面中的文字/特效不能承诺可在剪映逐字逐层修改；界面明确标示“原生可编辑”或“画面已渲染”。改这类参数时回到本软件重新渲染对应场景，无需重新生成其他素材。
- 字幕策略为 template / timed-overlay / off，区分模板内标题与配音字幕；相同内容不重复叠加。
- 将全部模板重建为原生剪映图层属于额外适配项目，不作为首轮全模板迁移的隐含承诺。

### 7.4 能力边界与部署

- MoneyPrinterTurbo：优先移植素材检索、下载/去重、混剪/适配、成片等增量业务；不迁移第二套队列、设置页和发布系统，不重复改写已经可复用的宿主模块。
- Pixelle：固定原 Python 核心、31 模板和必要资源，由隔离本地工作进程提供模板枚举、预览、分段渲染、合成和取消；保留上游行为并通过薄适配接入宿主素材/音频与三协议模型能力。
- 媒体工具和运行时由安装/启动预检定位，优先复用现有 FFmpeg/浏览器；Python 依赖锁版本，冲突时隔离环境，不假设两个项目能直接共享所有包版本。
- 所有调用共用凭据管理、任务事件、费用与回执；不把密钥写入生成工程或上游配置，不把私有接口直接暴露给渲染页。

### 7.5 拟新增的数据契约

以下是设计，不表示程序字段已经落地：

- schemaVersion、shortVideo.mode、rendererBackend；记录实现版本，后续更新不改变旧工程解释。
- outputTargets：mp4 / draft 的非空去重列表，draft 明确指剪映草稿；支持单选任意一个或同时选择。
- visualTemplateRef：provider / revision / relativePath / canvasSize / typedParams；draftTemplateId 单独记录，旧 templateId 兼容映射为草稿模板。
- scene：stableId、narration、audioAssetId、audioDurationMs、subtitleCues、mediaAssetId、素材来源与许可、视觉工件及可编辑性说明。
- timeline：统一时基、总时长、场景起止、裁切/缩放、字幕和音频轨。两个输出不得各自再按字数估算一次时长。
- renderFingerprint：模板/资源版本、媒体及音频哈希、参数、时间轴和必要渲染环境。按依赖失效，不仅用文件是否存在判断可复用。
- deliverables：mp4 与 draft 各自的 selected、status、path、validation、error、attempt、completedAt 及必要哈希；保留独立重试入口。
- providerJob：requestId/jobId、submitted/running/succeeded/failed/unknown、成本与回执、模型/协议快照；服务端状态未知时禁止盲目重放。

新任务只有所有已选交付物校验通过才显示全部完成；一项成功、一项失败显示部分完成及失败原因，保留成功产物。具体任务枚举迁移要与现有数据库/调度契约一致，不用一个 outputDir 或一个成功事件覆盖两种结果。

历史兼容：没有 outputTargets 的旧普通任务按仅草稿处理，不自动付费重跑；旧 outputDir 与 templateId 继续可读。修改输出选项应更新后续交付，不倒改历史运行回执。

失效规则：换模板只重做依赖它的视觉片段与输出；换 BGM 只重做混音或草稿音轨；改配音影响音频、字幕、时长及相关画面；改文案只失效受影响场景及汇总时间轴。全部变更可追溯，不自动重做所有付费素材。

## 8. 实施顺序、文件落点与阶段交付

以下保留原分阶段设计和拟议文件落点；实际实施状态以本文开头的当前状态为准。按可独立验证的增量交付，不同时重写三个项目。

### 第一段：双输出基础与普通短片闭环

- `src/shared/types.ts`、持久化与任务状态：新增输出选择、场景/时间轴和逐交付物状态；为旧工程加默认兼容与迁移测试。
- `src/shared/runner.ts`：保留公共生产阶段，将最终交付拆为 MP4 与草稿两个按需分支。
- `electron/short-video-renderer.ts`（拟新增）及 IPC/preload：普通短片的合成、取消、验证接口；复用现有媒体工具，不放宽其他工作流类型保护。
- `src/features/tasks/NewTaskPage.tsx`、`TaskDetailPage.tsx` 与现有产物预览：两个输出选项、独立状态、预览与重导出。
- 交付门槛：同一组固定本地素材分别完成 MP4-only、draft-only、both；验证一分支失败不破坏另一分支。先不依赖付费生成测试基础链路。

### 第二段：MoneyPrinter 增量增强

- 接入素材源、检索、下载/去重、选段与画幅/时长适配；对接既有配音和字幕，不重新跑一套模型调用。
- 迁移有用的成片/预检/恢复逻辑，固定来源版本、许可证与适配边界；复用第一段交付分支，不形成第二套导出系统。
- 交付门槛：素材混剪在同一短片入口得到 MP4 和草稿；缺素材、下载失败、短素材补齐、取消和重试有明确行为。

### 第三段：Pixelle 全模板、标准和素材驱动流程

- `vendor/pixelle-video/`（拟新增）：固定上游版本、LICENSE/NOTICE、31 模板与资源清单；只在镜像/薄适配层做必要改动并记录。
- `electron/pixelle-sidecar.ts`、Python bridge（拟新增）：预检、模板枚举、预览、分段渲染、合成、事件、取消与恢复。
- `src/shared/pixelle-templates.ts`（拟新增）：模板身份、参数、资源与版本映射；新增模板画廊，不迁入整个 Streamlit。
- 保留标准/固定文案、用户素材、图生视频与视频模板分支，按实际 capability 筛选渠道；static 模板不得产生无意义生图费。
- 为草稿提供逐场景视觉素材和独立音轨，显式标注烘焙画面边界；模板预览、MP4 和草稿使用一致模板参数与时间轴。
- 交付门槛：全部 31 模板逐项渲染/双输出检查，使用同一批缓存素材；video 模板检查多时刻运动，不能用静态预览冒充。

### 第四段：Lemo 官方插件与 Agent 宿主

- 保持“创意视频”原入口。`electron/lemo-agent-runtime.ts` 与独立 Node worker（拟新增）承载 SDK、本地插件、会话、权限和进度。 启动时核验初始化消息中的 plugins 与 namespaced skills 确实包含 Lemo；缺失即阻断该任务并明确报错，不能把 SDK 成功启动等同于插件加载成功。
- 先做依赖与模型渠道契约预检：工具调用往返、图片输入、流式结束/错误、实际输出上限、取消/恢复。文本请求返回 200 不等于 Agent 可用。
- 按官方流程完成 brief → treatment → 真实风格帧 → 编码/渲染 → 检查/修正 → 混音/成片；分阶段落盘，不要求整片一次大 JSON。
- 先验证官方声音/混音基线，再接宿主 TTS/字幕；两者均只有一个最终混音责任方。用户仍在本软件操作，不需要切换到另一个聊天应用。
- 既有 `lemo-upstream-agent.ts` 保留历史工程/回执读取，不再作为新的官方等价生产核心。复用现有可用的渲染与技术检查，但不以固定生成器限制原创项目结构。
- 模型调用使用实际验证可用的 Claude 渠道/模型，不靠名称判断能力；不自动重放历史 unknown 请求。设置可见预算、执行/工具超时、迭代限额与失败退出，不以无限重试掩盖错误。
- 交付门槛：固定原创需求的一支有声 MP4、源码、制作记录及真实纠错证据；再测试另一风格与较长时长，不拿官方示例替换任务。

### 第五段：整体验收与打包

- 先复现再处理历史提及的 6 项全局界面契约失败，运行相关测试、typecheck、生产构建和桌面视图检查；不把历史通过当当前通过。
- 验证双输出、旧工程兼容、启动预检、工作进程退出/取消、资源保留、重复导出不重复付费、字体资源和安装后的工具路径。
- 先固定素材与模拟服务测试，再在预算明确的条件下做真实生成验收；保存模型回执、成片、草稿与首中尾截图证据。
- 每段独立可回退；不清理用户现有文件，不更改无关 VOX/HTML/音乐 MV 工作流。

## 9. 验收与“跑通”的定义

| 层级 | 必须取得的证据 | 不能冒充 |
|---|---|---|
| 范围与入口 | MoneyPrinter/Pixelle 能力均在现有短片入口；Lemo 在创意视频；未引入已排除功能 | 三个独立网页或另建重复任务系统 |
| 源码迁移 | 固定提交、完整模板/资源及版权清单、哈希与适配记录 | 只复制几个文件或改模板名 |
| 输出选择 | MP4-only、draft-only、both 三种组合；至少选一个；未选分支不执行 | 默认只出草稿或强制双输出 |
| 双输出一致性 | 同项目的场景顺序、画幅、配音、时间轴、模板参数一致；共享工件不重复付费 | 两个分支分别重写文案或重新生图 |
| 模板保真 | 31/31 逐模板渲染；同素材/字体/浏览器版本与上游对照；中文/长文本/空字段及横竖方画幅 | 文件数一致、名称出现或缩略图正常 |
| 动态模板 | video_default/video_healing 多时刻有真实运动、图层位置正确、无双字幕/双配音 | 静态预览或整段冻结 |
| MP4 | 可播放文件、视频/预期音频轨、尺寸/帧率/时长、中文缺字和黑帧/静音检查、首中尾复核 | HTTP 200、目录存在、草稿成功 |
| 剪映草稿 | 实际打开，无丢失素材，时间轴/音轨正确；31 模板逐项核对，标注可编辑与已渲染部分 | 只写出 JSON、素材仅在临时目录、承诺全部 HTML 图层原生可编辑 |
| 部分失败与取消 | 一个输出失败不毁掉另一个；独立恢复和重导出；取消停止后续动作并记录在途远程请求 | 把部分完成显示全部完成、点击重试就重做所有模型调用 |
| 缓存与收费 | 换模板/BGM不重扣生图费；static 不生图；unknown 不盲重发；可追加另一交付物 | 文件存在就视为缓存有效或使用全任务重试 |
| 历史兼容 | 旧草稿任务、旧 templateId/outputDir 可读，不自动补跑 MP4 | 改写历史状态或让旧任务启动付费生成 |
| Lemo | 官方插件实际加载；treatment、真实风格帧、原创源码、工具执行记录、纠错过程、最终有声 MP4 | 只读指南、仅渲染官方 demo、模型自称检查通过 |
| 全局界面与安装 | 复现并解决历史 6 项失败；相关契约/类型/构建测试；普通及紧凑窗口与运行依赖预检 | 把方案写完或旧截图当当前软件通过 |

测试顺序：确定性单元/契约测试 → 固定本地素材集成测试 → 全模板与双输出验收 → 受控真实模型生成 → 安装包回归。其中确定性测试、固定本地素材、31模板双输出与SDK离线协议已经执行；真实模型生成、剪映实开和安装包验收仍未完成。不得将源码哈希或离线协议通过当成原创影片验收。

Lemo 实片先用一支固定 brief 的 15–30 秒原创片，再增加不同风格与较长时长。原始需求、素材、模型与验收条件锁定；失败修程序或生成工程，不换样片降低标准。美术质量单独对照评审，技术通过不自动等于官方样片效果。

## 10. 依赖、授权与仍待实证的事项

- MoneyPrinterTurbo 代码 MIT；Pixelle 代码 Apache-2.0，携带 LICENSE/NOTICE；迁移时保持来源与改动可追溯。
- Lemo 代码/文档 MIT，官方样片视频与静帧另有 CC BY 4.0 与第三方素材/特定配音例外，不能因为 package.json 写 MIT 就把所有样片音视频当作无条件素材库。生产复用前核对对应 CREDITS/授权。
- 字体、默认图片、采样/音乐与模型权重分别核查分发条件；代码许可不能替代素材许可。
- 未实证：当前已付费 Claude 渠道对 SDK 完整能力的兼容、真实输出上限、Windows 生产执行隔离与完整依赖准备、打包后的离线能力（31模板本地真实双输出已在本轮全部通过）。
- 当前只发现 ffmpeg/ffprobe 不在 PATH，不等于机器或应用资源中没有它们；实施时首先复用项目已有工具路径。
- 迁移工程验证没有付费模型请求，没有重试历史 unknown 任务；已安装并实际运行固定上游依赖及官方 SDK 的本机验收，不等于真实渠道生产接入。

## 11. 一手来源与本地证据

上游固定提交：

- MoneyPrinterTurbo task.py：https://github.com/harry0703/MoneyPrinterTurbo/blob/27843a994bfa29c43c02150861d51490a6ca4bd2/app/services/task.py
- Pixelle 模板与核心：https://github.com/ATH-MaaS/Pixelle-Video/tree/848b054e4fae40dabc62ec58e960b573e83793ac
- Lemo 官方 Skill：https://github.com/lemomo-ai/lemo-opuscar/blob/f17136060781a0068a7951245a3aa7835a7230de/plugin/skills/lemo-opuscar/SKILL.md
- Lemo 官方流程：https://github.com/lemomo-ai/lemo-opuscar/blob/f17136060781a0068a7951245a3aa7835a7230de/AGENTS.md
- SDK 插件加载：https://code.claude.com/docs/en/agent-sdk/plugins
- SDK 概览：https://platform.claude.com/docs/en/agent-sdk/overview
- 网关兼容：https://code.claude.com/docs/en/llm-gateway-protocol
- SDK 权限：https://platform.claude.com/docs/en/agent-sdk/permissions

本地证据：

- `I:\opc\.artifacts\feature-transfer-audit-20261031\pixelle-source`：只读研究快照，未安装执行。
- `I:\opc\.artifacts\feature-transfer-audit-20261031\pixelle-template-manifest.json`：31 模板原始 Git blob 与 Windows 工作树哈希。
- `I:\opc\.artifacts\feature-transfer-audit-20261031\moneyprinter-task-pinned.py`：本轮固定提交源码。
- `I:\opc\electron\lemo-upstream-agent.ts`：当前六工具循环。
- `I:\opc\src\shared\runner.ts`：普通任务草稿终点。
- `I:\opc\electron\main.ts`：现有导演渲染入口限制。
- `I:\opc\.artifacts\lemo-upstream-production\live-rain-garden-20261030\resume-audit-20261030\live-resume-result.json`：此前真实运行未完成的证据，本轮未重放。

## 附录 A：31 个模板的完整清单

SHA-256 为上游 Git blob 的原始字节哈希；Windows 检出可能仅换行符不同。完整哈希在同目录 manifest 中。

| # | 原文件路径（templates/ 下） | 类型 | 上游 SHA-256 前 16 位 |
|---|---|---|---|
| 1 | `1080x1080/image_minimal_framed.html` | image | `762d8209b41fc363` |
| 2 | `1080x1920/asset_default.html` | asset | `e974a90f5e756427` |
| 3 | `1080x1920/image_blur_card.html` | image | `6c95bcb71cb435f9` |
| 4 | `1080x1920/image_book.html` | image | `d470c3433b93081e` |
| 5 | `1080x1920/image_cartoon.html` | image | `944f47af3ddad27f` |
| 6 | `1080x1920/image_default.html` | image | `d910c098c17eed7b` |
| 7 | `1080x1920/image_elegant.html` | image | `1e2011c1b880818d` |
| 8 | `1080x1920/image_excerpt.html` | image | `f24b929bd954fd09` |
| 9 | `1080x1920/image_fashion_vintage.html` | image | `cfd835abf5ae79d0` |
| 10 | `1080x1920/image_full.html` | image | `03a32b2f8ac95ab6` |
| 11 | `1080x1920/image_healing.html` | image | `19a91c5e24a86aa0` |
| 12 | `1080x1920/image_health_preservation.html` | image | `cb8194bc7be48adf` |
| 13 | `1080x1920/image_life_insights.html` | image | `1fab1bd2a6dc5b51` |
| 14 | `1080x1920/image_life_insights_light.html` | image | `a96f2e07cd896851` |
| 15 | `1080x1920/image_long_text.html` | image | `2c2cc2090507bfaf` |
| 16 | `1080x1920/image_modern.html` | image | `fe6e261d3fbe9b4e` |
| 17 | `1080x1920/image_neon.html` | image | `ec75eb57b0810a62` |
| 18 | `1080x1920/image_psychology_card.html` | image | `8339cc4a5459f9f2` |
| 19 | `1080x1920/image_purple.html` | image | `f1435d03e6a882a1` |
| 20 | `1080x1920/image_satirical_cartoon.html` | image | `1fe0eae0c0e12feb` |
| 21 | `1080x1920/image_simple_black.html` | image | `8e208dfdba73805b` |
| 22 | `1080x1920/image_simple_line_drawing.html` | image | `aad7bdbe6452490e` |
| 23 | `1080x1920/static_default.html` | static | `a073df254b565356` |
| 24 | `1080x1920/static_excerpt.html` | static | `87b09c49414d7597` |
| 25 | `1080x1920/video_default.html` | video | `f374516dfd39cc43` |
| 26 | `1080x1920/video_healing.html` | video | `ba8e17467deb8c0b` |
| 27 | `1920x1080/image_book.html` | image | `2d2fc3cfa9729ff0` |
| 28 | `1920x1080/image_film.html` | image | `ea15b78c48841bb0` |
| 29 | `1920x1080/image_full.html` | image | `6fda67d0ab1307cf` |
| 30 | `1920x1080/image_ultrawide_minimal.html` | image | `b51d4769dd1eb72b` |
| 31 | `1920x1080/image_wide_darktech.html` | image | `64a6613d006239a1` |

合计：31；画幅：1080×1920 共25、1920×1080 共5、1080×1080 共1。
本清单覆盖固定提交内置全部 HTML 模板，不包含任何未公开的付费模板，也不把未来上游新增模板算作已迁入。


## 2026-10-31 最终检查收取与官方 SDK 请求安全接续
- 最终四套严格 TypeScript 检查全部退出 0：应用、Electron、scripts、独立官方 SDK worker；Electron 最新生产构建通过。
- 最新扩大回归为同一轮 16 文件、357 项全部通过（.artifacts/short-video-sdk-final-regression.log）。
- 固定上游校验通过：Lemo 2519 文件，Pixelle 313 文件。
- 下一步：在未开放生产生成的前提下补充官方 SDK 逐请求持久化账本及 unknown 回执阻断，使用本机协议桩验证，禁止未知结果自动重投。
- 本轮仍为 0 次付费模型请求；SDK 初始化不是完整成片验收。


## 2026-10-31 官方 SDK 请求保护阶段最终验收
- 新增47项账本/网关回归；与既有27项SDK回归同轮74项通过。最新扩大回归为独立一轮17文件404项全过，不是多轮测试数相加。
- 四套严格TypeScript检查全部退出0：应用、Electron、scripts、独立SDK worker；Electron与官方SDK worker构建通过；固定上游2519/313原文件校验通过。
- 构建后重新执行官方CLI运行时检查及真实SDK离线协议检查，两项场景全部通过。成功场景2次上游调用、1次工具权限拒绝后反馈；断流场景只有1次上游调用，unknown之后拦截后续请求。
- 实测SDK在错误结果后还可能抛错；负向验收明确核对LEMO_LEDGER_BLOCKED，不忽略意外错误。已修复mock回调返回值的类型错误，未降低tsc或测试断言。
- 新增磁盘写入/flush失败、取消、请求体限额和模型配置快照测试；删除独立worker误带的根项目file依赖，根package.json/package-lock.json哈希未改变。
- 验收汇总：.artifacts/short-video-gateway-phase-verification.json；回归日志：.artifacts/short-video-gateway-final-regression.log；官方SDK两场景报告：.artifacts/lemo-agent-gateway-smoke/report.json。源码哈希已复核。
- 仍未开放Lemo官方生产入口；真实渠道兼容、Windows受限执行、音频素材桥接、分阶段会话/unknown人工核对恢复、原创有声片与安装包尚未验收。MoneyPrinter网络素材检索、剪映应用实开仍未完成。
- 本迁移工程阶段0次付费模型调用；没有修改样片或任务数据。C盘已满，全部本轮临时目录与缓存位于I盘，没有删除用户文件。
