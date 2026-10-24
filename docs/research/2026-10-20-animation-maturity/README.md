# AI 漫剧、Vox、HTML 动画成熟度分析

调研日期：2026-10-20。对象：StoryDream 当前源码、只读本地项目记录、公开 GitHub 源码、本地安装的 Storybound 当前 HTML 模块。

## 结论

可以借助成熟开源模块补齐这三项功能，也可以从本地 Storybound 还原 HTML 的构图协议与动画机制，在 StoryDream 中重新实现。当前更需要把已有引擎、素材、语音和镜头设计接完整，而不是再增加几个同名模板。

- **AI 漫剧：制作链路不完整。** 当前镜头视频请求是首帧、可选尾帧和文字连续性说明；没有把角色多参考图、场景参考和声音样本接到这条视频请求里，且明确关闭视频原生音频。角色资产管理完善，不等于视频里的脸、服装和口型已经稳定。
- **Vox：素材分层可靠性和语义编排不足。** 当前默认五种确定性动作语法，以关键词和轮换方式选择，时序主要按镜头时长比例缩放。最新 21 镜项目的 29 次历史失败任务里，23 次是绿幕抠图失败。必须先提高可用素材比例，再让对象、证据、箭头和镜头运动跟随讲述的具体词句。
- **HTML：渲染链路已具备，构图与字幕协议偏薄。** StoryDream 已有 29 个版式，Storybound 只有 17 个。后者值得复现的是每个对象的独立位置和尺寸、横竖屏两套构图、语音对时字幕、焦点切换及装饰层。模板数量并不是主要差距。

建议实施顺序：**共用抠图基础 → HTML 构图和字幕 → Vox 语义时间轴 → 漫剧参考素材、对白及制作单元。** 漫剧的参考输入修复可以独立推进，但整体质量验收需要真实视频模型，成本和变量最多。

实施进度与逐项验收记录见[落地验收报告](./acceptance.md)。本轮已按建议顺序完成 A-D 的基础实现，并为每阶段导出本地可播放样片；逐项限制、未覆盖素材及真实远程模型边界均记录在报告中。没有调用付费生成服务，也没有将本地功能样片作为远程视频质量或整片商业成熟度证明。

## 1. 证据边界

| 检查项 | 实际看到的证据 | 能说明什么 |
| --- | --- | --- |
| 当前源码 | 视频请求构建、默认镜头策略、模板编译器、字幕分配、抠图与渲染入口 | 可以定位结构缺口与具体接入点 |
| StoryDream 本地库 | 12 个漫剧项目均为 draft，没有图像、音频、视频资产或提供商任务；没有 HTML 项目记录 | 不能声称已经检查过这些漫剧或 HTML 项目的完整成片 |
| 最新 Vox 项目 | 21 镜、46 张图、21 条音频；19 镜 deterministic-layers、2 镜 Remotion；67 次成功、29 次失败历史任务，无质量报告 | 有真实生产过程记录，仍缺当前整片质量验收 |
| Vox 历史单镜 | 真实素材离线渲染报告：14.67 秒、1920×1080、有音频 | 证明单镜能渲染，不证明最新 21 镜片子的观感 |
| HTML 历史 QA | 17 场景、816 帧、960×540/24fps，画面主要为色块和运动方块 | 证明调度、时间轴、截图链路；不能据此判断内容和设计成熟 |
| Storybound 本地 | 当前安装程序实际引用的 HTML 模块、模板数据和渲染逻辑；本地没有 HTML 项目/成片 | 可以对照实现，不能直接比较两款软件的完整生成效果 |
| GitHub | 6 个仓库的固定提交、许可证与具体源码 | 可判断模块适配性；没有运行其付费生成流程或照单采信 README 的效果宣传 |

本地失败统计记录的是历史任务，包含重试。23 次抠图失败不是 23 个不同镜头，也不是模型或整条流程的失败率。

## 2. GitHub 方案筛选

本次以代码和当前许可证为准。搜索热度仅用于发现候选，不用于认定成片质量。

| 方案 | 当前核验许可 | 建议用途 | 接入判断 |
| --- | --- | --- | --- |
| [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app) | 当前快照 MIT | 漫剧制作单元、参考输入映射、对白/OS/VO、模型时长与能力校验 | 制作流程参考优先；当前已重写为 Vue/Bun/Electrobun，不能当作原 Electron 项目的组件直接装入 |
| [wind-comic](https://github.com/ChrisChen667788/wind-comic) | MIT | 角色正面/多角度参考、逐镜素材挂载、提供商差异映射 | 更适合抽取纯函数和适配逻辑；避免搬入庞大 orchestrator |
| [Jellyfish](https://github.com/Forget-C/Jellyfish) | Apache-2.0 | 镜头视频就绪检查、候选确认、提示词包、连续性 | 当前项目已有部分署名适配；补差距即可，不重复建设 |
| [vox-video-starter](https://github.com/lyyilin/vox-video-starter) | MIT | 讲述词句 cue → ASR 时间 → 帧，镜头/标注/路线编排，素材和成片 QA | 最匹配当前 Vox 的语义对时缺口；是小型 starter，不是成熟一体化工作室 |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | Apache-2.0 | HTML 场景蓝图、时间化视觉设计、lint/关键帧检查 | 最适合沿现有引擎增量扩展；先挑兼容蓝图，再评估版本升级 |
| [voxstylehub-steven](https://github.com/Phantomlau3674/voxstylehub-steven) | MIT | PaperActor、手绘箭头、纸张运动组件 | 备选组件库；它是既有 xingchen 技能的发行层，不是另一套新引擎 |

### 2.1 AI 漫剧优先参考什么

**Toonflow** 的 `packages/skills/v118workflow/references/videoProduction.md`、`knowledge/videoPromptCraft.md` 和 `storyboardTable.md` 已明确：

- 制作单元同时受产品规则与当前模型真实时长能力约束；其流程中的 15 秒不能直接写死为所有模型限制。
- 台词必须保留原文，区分角色对白、内心 OS、旁白 VO，只有实际说话角色需要口型。
- 记录参考图顺序、实际输入映射、提示词、声音依据和镜头前后状态。
- 没有真实声音样本或模型音频能力时，不承诺参考声音或原生对白。

本次核验的 Toonflow **已是 MIT**，README 明确移除商业附加条款；这与九月旧调研中的许可结论不同。只针对本次固定提交做复用，旧版本仍按其原许可处理。

**wind-comic** 里更直接有用的代码：

- `lib/elements-registry.ts`：逐镜角色/场景/道具挂载，正面图与多角度图分类。
- `subjectReferencesFromMount()`：形成角色引用及 `refImageUrls`。
- `services/hybrid-orchestrator.ts` 和视频服务：存在实际透传，部分“尚未接通”的文档/注释已经落后于源码。
- `lib/shot-quality-gate.ts`：可参考检查结构，但其 VLM 不可用会放行，评分标准主要面向仿真人广告。接到漫剧时应调整审美标准，并把未检查明确标记为未检查。

**Jellyfish** 当前克隆提交与九月调研相同，不能仅凭仓库 pushed_at 宣称核心实现又更新。可复用的 `shot_video_readiness.py`、`shot_video_prompt_pack.py` 用于补齐已有链路。

### 2.2 Vox 应吸收什么

`vox-video-starter` 有明确的 `episode-schema.ts`：图层 cue、beat cue、cameraBeats、routes、annotations；`timeline-build.ts` / `alignment.ts` 把 cue 文本匹配到 ASR，再转换为渲染帧。它解决的是“讲到哪里，哪个对象发生什么”，比继续轮换入场动画更有价值。

可参考 `matte-assets.py` 的抠图和透明度检查，以及 `qa.ts` 的素材、cue、时长、音轨、响度和接触表检查。需要改造的地方：原始 schema 固定 1920×1080/30fps；本地 Whisper 模型需要下载与运行环境；插值产生的时点必须带置信度，不能当作实测词级对齐。项目的 Remotion 代码、模型权重、字体及示例音乐仍分别遵循各自许可，不能将演示素材默认打包进产品。

### 2.3 HTML 应吸收什么

StoryDream 已装 HyperFrames `0.8.40`；本次源码快照 core 为 `0.8.181`，已提供 22 种带时间结构的场景蓝图，例如：

- `kinetic-type-beats`：用文字变化推动镜头。
- `spatial-pan-stations`：在一个大画布上依次移动至内容站点。
- `camera-journey`：用镜头移动呈现动作与结果。
- `constellation-hub`：外围节点围绕中心聚合。
- `grid-card-assemble`：卡片逐步构建信息网格。

先选文字节奏、空间站点、节点聚合三类，与当前离线资源协议、GSAP 时间轴及逐帧 seek 兼容后再接入。部分 registry block 使用 Three、外部字体或不同资源结构，不宜直接批量导入。版本升级应单独验证，不能把“升级依赖”视为效果改进已经完成。

### 2.4 GPT/Claude 动画 Agent 的工作方式

抽查 HyperFrames 固定提交里的 Claude/Codex Agent Skills 后，看到的不是“给模型一个很长的动画提示词”，而是**分层指令 + 结构化制作数据 + 确定性渲染 + 可执行门禁**。这是一个仓库的可核验做法，不代表所有 GPT/Claude 创作者都使用同一流程，也不证明其示例成片都达到专业水准。

| 层 | 源码中的做法 | 对 StoryDream 的启发 |
| --- | --- | --- |
| 导演规范 | `motion-doctrine` 规定镜头接缝方向、速度、运动因果、镜头持续动作；要求先写 `ledger.json`，再生成转场并验证 | 把“高级、流畅、不要呆板”改成可检查的镜头约束；明确每个 beat 的视觉目的和前后镜头关系 |
| 任务 Skill | `changelog-video` 将输入解析、主题取舍、视觉方案映射、口播、字幕、构图、构建、验收分步；要求先使用品牌 scaffold，不让模型每次重造风格 | 各制作类型保留短而明确的 Skill 路由；具体阶段按需加载，不把整套大规范塞进单一系统提示 |
| 视觉蓝图 | `hyperframes-animation` 区分原子动作规则与多阶段蓝图；22 个蓝图各自描述适用叙事、时长、阶段动作和规则组合 | HTML 先落地少数稳定叙事结构，如文字节拍、空间站点/镜头旅程、证据组装；模板应规定“信息如何出现”，而不只是元素皮肤 |
| 时间轴 | `changelog-video` 把实际语音词时间作为镜头动作和字幕时钟；读音与显示文本分层，TTS 缺词级时间戳时强制对齐，不允许静默漏字幕 | StoryDream 的 Vox/HTML cue 统一关联原文片段、时间来源和置信度；估算时间必须显式标记 |
| 工具执行 | Agent 产出 HTML/GSAP 时间线和资产文件，再交给 CLI/浏览器渲染；HyperFrames 要求单一暂停时间线和可重复 seek | 模型负责做计划与编排，生产代码负责确定性渲染；不要把每次都重新生成整段不透明动画代码作为默认工作流 |
| 自动门禁 | `seam-stamp` 从 ledger 生成接缝；`seam-gate` 在浏览器采样运动方向、速度、重叠、载体连续性；`animation-map.mjs` 检查时间线动作分布 | 自动化可拦截时间轴和渲染正确性错误，但不能替代观看最终 MP4 的审美审查 |

这组源码里最值得借鉴的设计原则：

- **叙事先于动效。** 每个镜头要有被解释的对象、讲述触发点和状态变化。镜头若只是在“呼吸、漂浮”，Skill 认为那是等待画面，应增加信息推进或改成有目的的镜头运动。
- **统一镜头语法。** 普通转场共享同一方向和动量；反向运动需要明确的叙事原因。每部片只保留少量反复出现的转场语法，避免模板拼盘感。
- **把品牌/风格作为可复用输入。** 项目 scaffold、字体、颜色、字幕轨和背景是可复现资产；Skill 负责选择和填充，不应每次从空白页“自由发挥”。StoryDream 可以复用用户自己的品牌配置，但不能照搬上游私有品牌资产。
- **对具体成片做失效管理。** 时间轴、配音或镜头变动后，原有接缝/审查结果应重跑。更完整的产品契约可把审查绑定到最终 MP4 SHA-256；文件变化即撤销旧审查状态。

本次固定提交为 HyperFrames `6d357ff0d8dbb88b8d19fe689c15f0808724e52a`，仓库许可证 Apache-2.0。可直接定位的源码：[`motion-doctrine`](https://github.com/heygen-com/hyperframes/blob/6d357ff0d8dbb88b8d19fe689c15f0808724e52a/.agents/skills/motion-doctrine/SKILL.md)、[`seam-gate` 规则](https://github.com/heygen-com/hyperframes/blob/6d357ff0d8dbb88b8d19fe689c15f0808724e52a/.agents/skills/motion-doctrine/references/seam-gate.md)、[`changelog-video` 工作流](https://github.com/heygen-com/hyperframes/blob/6d357ff0d8dbb88b8d19fe689c15f0808724e52a/.agents/skills/changelog-video/SKILL.md)、[`build-spec`](https://github.com/heygen-com/hyperframes/blob/6d357ff0d8dbb88b8d19fe689c15f0808724e52a/.agents/skills/changelog-video/references/build-spec.md)、[`动画 Skill 路由`](https://github.com/heygen-com/hyperframes/blob/6d357ff0d8dbb88b8d19fe689c15f0808724e52a/skills/hyperframes-animation/SKILL.md)、[`蓝图索引`](https://github.com/heygen-com/hyperframes/blob/6d357ff0d8dbb88b8d19fe689c15f0808724e52a/skills/hyperframes-animation/blueprints-index.md)、[`animation-map.mjs`](https://github.com/heygen-com/hyperframes/blob/6d357ff0d8dbb88b8d19fe689c15f0808724e52a/skills/hyperframes-animation/scripts/animation-map.mjs)。

HyperFrames 的品牌视频 Skill 包含专有品牌字体、音乐、背景和具体成片 scaffold。Apache-2.0 只覆盖仓库中按许可发布的代码，不等于其中所有媒体资产和第三方字体都可直接打包进 StoryDream；复用前需逐项核许可证。建议借鉴流程和重新实现机制，不复制整套私有风格包。

## 2.5 对 StoryDream 的修改建议与顺序

基于当前代码与 [落地验收报告](./acceptance.md)，A-D 的本地实现和离线样片已经完成；下一阶段的瓶颈是远程能力、整片审查和恢复语义，继续加模板数量不会补上这些证据缺口。

1. **先建立成片审查闭环。** 每次正式导出生成绑定 MP4 哈希的 QA 记录：机器检查解码、帧率/分辨率、音轨、黑帧/静帧、音量、缺字幕和渲染采样；独立 reviewer 再按镜头检查叙事、构图、运动、素材瑕疵和音画关系。P0/P1 未解决不得标为通过；MP4 内容变更就让旧报告失效。VLM 结果只能作为审查意见，不能单独证明质量。
2. **先补 Vox/HTML 的真实语音 cue，再扩动作蓝图。** 目前已实现句级 TTS 边界，但 Vox 不是词级对齐，也没有 VLM 审查；HTML 长片高清内存/吞吐也未测。用小型固定样片建立词/句时间来源、置信度和实际抽检偏差，然后做 30-60 秒真实素材片；性能基准单独记录内存峰值、耗时和失败阈值。
3. **补足任务状态与断点恢复契约。** 漫剧远程参考图上传、视频生成、轮询、下载应是各自持久化且可重试的阶段；请求快照、幂等键、输入指纹和远端任务 ID 要保证恢复不重复计费。现有本地恢复字段不足以证明完整上传/下载断点恢复已经工作。
4. **最后用少量真实远程样片验证漫剧模型能力。** 先选支持参考图和音频的模型做同一角色 3-5 镜、15-30 秒测试，逐项检查实际提交的参考媒体、脸/服装/道具连续性、对白音频与口型。把“模型宣称支持”与“本次账号/渠道实际返回”分开记录；口型只对真实通过的模型/模式开放承诺。
5. **质量稳定后再接 HTML 蓝图。** 从 `kinetic-type-beats`、`spatial-pan-stations`、`camera-journey` 中先挑 2-3 个做 StoryDream 自有 schema 与真实素材片，不直接复制品牌 scaffold。旧项目保留原 compiler 路径，新增版本走显式 schema/migration 与指纹，避免升级造成历史项目重放变化。

因此建议把下一轮目标从“再增加一批动画模板”改为“一个可审、可重放、可恢复的真实短片制作单元”。先建立最终片的可追责审查，再验证远程模型和完整链路；观感蓝图应服务于真实语义 cue，而不是替代它。

## 3. Storybound 能逆向拆出什么

### 已确认的本地实现

安装位置 `G:/Storybound`。它是 Tauri/WebView2 应用，没有 Electron 的 app.asar。通过本地运行时读取了当前入口实际引用的 `HtmlVideoPage-HBXz31xy.js`，不是仅凭可执行文件字符串或旧文件名猜测。

模块 SHA-256：`2f7f7fb83d9608cc95c0a4deea7de87cf05ad616f4da60b86376717a5fa62299`。原始模块与格式化副本仅在本地临时目录，未进入生产代码或本报告提交。

| 机制 | Storybound 当前模块 | StoryDream 当前实现 | 值得接入的差距 |
| --- | --- | --- | --- |
| 模板 | 17 个 | 29 个，包含前述 17 个名称 | 对齐机制与画面，不以同名或数量验收 |
| 横竖屏 | 17 个都含独立 landscape 布局 | 模板以 titleTop/captionY、槽位和 CSS 为主 | 每个对象在两种画幅中独立配置 x/y/宽高/z 与安全区 |
| 素材动作 | 对象有 preset/params、startSec、可选 exit | 已有 GSAP 预设和入场编排 | 加入明确退场、持续动作、主次关系，避免所有对象进场后停住 |
| 字幕计时 | ASR captionWords 对齐，失败后均分回退 | `buildHtmlVideoCaptionCues()` 按句子数量均分总时长 | 首选 TTS/ASR 时间戳，保存对齐来源与可信度 |
| 字幕表现 | 5 种外观、11 种动画；karaoke/highlight 可用 charTimings | 3 种外观、3 种字幕动画 | 先补真实词级时间，再增加显示方式 |
| 主视觉文字 | full-quote 可将字幕设为 hero | 主要是标题和底部字幕 | 将讲述中的关键语句提升为主视觉，避免重复标题与口播 |
| 焦点/视差 | 主体放大、同组对象退开淡出，按深度持续微动 | 各版式已有局部运动，缺统一焦点/深度协议 | 把焦点转换定义为一段镜头动作，按语义触发 |
| 装饰与标注 | 7 种装饰；underline/circle/arrow/callout 等强调元素 | 样式和模板局部实现 | 分离信息标注与环境装饰，参与时间轴 |
| 抠图 | 调用原生 remove_background 与 ONNX | HTML 已有 ONNX worker；Vox 仍强依赖绿幕 | 建立两者共用的分割和素材质量检查 |
| 渲染 | GSAP、`window.__tl`、hidden WebView 逐帧截图、FFmpeg | 相同的确定性时间轴思路，Electron 截图与 FFmpeg | 保留当前渲染器，迁移构图/时间轴表达 |

Storybound 的焦点切换与视差函数可以明确看出：镜头中段对焦点主体推近，同时让同组对象沿远离焦点的方向退开、缩小、淡出；持续微动则依赖对象深度。这里有可复现的视觉机制，适合归纳成项目自己的焦点和层级协议。

Storybound 的截图也存在按屏幕大小约束画布、再放大的提示，并非一定比当前渲染器更清晰。其原生渲染二进制不构成本轮推荐迁移目标。

**可行方式：**用本次清点形成行为规格和版式清单，在项目现有 HTML 编译器中重新实现；优先采用已核验许可的开源动作和蓝图。保留原始提取代码在本地对照，不将整个压缩模块当作产品依赖。这样能保留我们已有项目保存、任务恢复、模型配置、编辑和导出链路。

## 4. 当前代码中的具体问题

### AI 漫剧

`src/shared/motion-comic-video.ts:82` 的 `buildMotionComicShotVideoRequest()` 实际只传 prompt、duration、ratio、首尾帧，`generateAudio: false`。底层 `src/shared/video-provider.ts` 已支持 `referenceImagePaths`、带类型的 `referenceImages`、参考视频/音频和 generateAudio，缺的是漫剧这条路线的映射与能力选择。

人物身份、装束、场景、道具、前镜终态等确实进入文字提示；已有 fingerprint、过期资产标记、remoteTaskId 和恢复机制也有价值，应继续使用。新接入的参考素材版本、声音模式、制作单元必须进入指纹，避免修改参考图后复用旧视频。

生成静音视频后叠配音可以保证声音存在，不能保证口型。需要区分无对白动作、角色对白、OS、VO，再根据模型能力选择原生音画、音频驱动或配音合成，不能对全部镜头统一承诺口型。

### Vox

`src/shared/editorial-collage.ts` 默认新镜头为 deterministic-layers；`editorial-motion.ts` 的五种语法为 cutout-slide、focus-reveal、evidence-stack、path-progress、comparison。现有 55 个 Remotion 模板属于另一条可选路线，没有自动解决默认路径的选型、素材填充和对时。

`editorial-narration-timing.ts` 已保护音频长度、尾部与有效字幕 token；动作主要根据最终镜头时长缩放，仍需语义 cue。当前 `director-render.ts` 已拒绝缺少必需图层或独立图片不足，不能沿用旧报告里“少主体仍静默导出”的描述。

`editorial-image-prompts.ts` 要求前景使用统一绿色；`editorial-cutout.ts` 执行色键算法，要求足够透明面积和边缘透明比例。`electron/main.ts` 当前会把抠图错误作为整个图像任务失败。建议保留已生成原图，把图像生成和去底分成两步，针对去底单独重试，减少重复生图和付费。

HTML 已有 `html-video-background-removal.ts` 与 `remove-background-worker.py`，支持多种 ONNX 模型。检查到的默认模型目录尚无 `.onnx` 文件，因此共用 worker 前仍需补齐模型下载/安装、哈希校验与实际运行验证，不能声称现成零配置可用。

### HTML

`src/shared/html-video.ts` 的模板编译与 `window.__tl` 已存在；`html-video-scene-templates.ts` 的主要信息是槽位、标题/字幕位置和动作预设。规划提示词主要选择受支持版式、背景和素材提示，缺少可检查的语义 beat、焦点和强调对象。

`html-video-captions.ts:91` 明确均分字幕时长；“karaoke”外观名称不等于逐词同步。`repairHtmlVideoPlanningSlots()` 有按素材数量改选版式的回退，应该保留叙事意图与回退说明。规划异常也可能进入确定性回退，但本地没有 HTML 项目，无法判断实际触发频率。

普通新任务运行时没有覆盖 fps/maxLongEdge，当前默认 24fps、长边 1280。编辑重建会保留已有画布长边。建议以后明确区分预览和最终导出的清晰度设置；提高分辨率应在构图、素材和对时问题解决后验收，不能单靠输出尺寸改善内容。

## 5. 落地与验收

2026-10-21 实施记录见 [acceptance.md](./acceptance.md)。A-D 已有本地功能样片与分阶段验收；最新补充完成最终 MP4 的 SHA-256 审片绑定、失效撤销和 P0/P1 质量门。该机制只验证审查对象与报告对应，不改变报告中列出的视觉质量和远程验证边界。下文保留原始调研时点的工程问题与验收目标。

详细工程拆分见 [implementation-plan.md](./implementation-plan.md)。关键交付不是“模板已接入”，而是同一批固定素材可以重放的真实样片：

1. **共用抠图：**真实原图覆盖人像头发、物件、纸张、绿衣和非绿背景；保留原图与 alpha、模型信息，单独重试去底。检查透明边缘、孔洞、主体完整度以及不必要的重新生图。
2. **HTML：**同一素材/讲稿制作居中主体、左右构图、引语、对比、焦点转换、空间站点等至少 6 类场景，横竖屏都验收。给出可播放视频和关键帧接触表；确认字幕按真实声音变化、画面中段仍有信息推进、没有遮挡和无意义漂浮。
3. **Vox：**用现有真实项目素材先做 3 镜，再形成 30–60 秒小片，至少包括证据、比较和路径三种叙事关系。cue 可追溯到语音时间，图层和镜头服务于讲述；不以彩色方块夹具作为视觉验收。
4. **漫剧：**先做同一角色 3–5 镜、含不同景别/场景和一次对白的 15–30 秒样片。提供实际提交的参考输入清单、模型能力记录和连续性检查，核对脸/服装/道具/动作接续及声音。优先完成这条短闭环，再批量处理整集。

建议初始目标（仍需用样片校准）：可信字幕/cue 在抽检关键点与声音偏差不超过 200ms；无法可靠对齐的段落显式标记估算，不能伪装为词级实测。渲染应可重复 seek，缺素材/无音轨/超时长等必须报可定位错误。视觉质量仍须观看成片，不能仅由文件存在或流程状态 passed 代替。

## 附：固定源码快照

所有链接固定在本次读取的提交，避免后续变动影响结论。

| 仓库 | 提交与源码入口 |
| --- | --- |
| Toonflow | [d2e94aca](https://github.com/HBAI-Ltd/Toonflow-app/tree/d2e94aca7b59659ff6b4ca15f03cf134ec7f0e1d) · [制作规则](https://github.com/HBAI-Ltd/Toonflow-app/blob/d2e94aca7b59659ff6b4ca15f03cf134ec7f0e1d/packages/skills/v118workflow/references/videoProduction.md) · [许可](https://github.com/HBAI-Ltd/Toonflow-app/blob/d2e94aca7b59659ff6b4ca15f03cf134ec7f0e1d/LICENSE) |
| wind-comic | [7d0d3cf6](https://github.com/ChrisChen667788/wind-comic/tree/7d0d3cf68b52c5ed7d00417e9bc1b59c3ec61806) · [素材挂载](https://github.com/ChrisChen667788/wind-comic/blob/7d0d3cf68b52c5ed7d00417e9bc1b59c3ec61806/lib/elements-registry.ts) · [许可](https://github.com/ChrisChen667788/wind-comic/blob/7d0d3cf68b52c5ed7d00417e9bc1b59c3ec61806/LICENSE) |
| Jellyfish | [a9678194](https://github.com/Forget-C/Jellyfish/tree/a9678194ddf2d9be3ccbe78d4287d87d5089e123) · [就绪检查](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/services/studio/shot_video_readiness.py) · [许可](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/LICENSE) |
| Vox Video Starter | [3ca21b58](https://github.com/lyyilin/vox-video-starter/tree/3ca21b5845643992df607da390aff30b74cf7865) · [对时构建](https://github.com/lyyilin/vox-video-starter/blob/3ca21b5845643992df607da390aff30b74cf7865/studio/scripts/timeline-build.ts) · [许可](https://github.com/lyyilin/vox-video-starter/blob/3ca21b5845643992df607da390aff30b74cf7865/LICENSE) |
| HyperFrames | [6d357ff0](https://github.com/heygen-com/hyperframes/tree/6d357ff0d8dbb88b8d19fe689c15f0808724e52a) · [蓝图索引](https://github.com/heygen-com/hyperframes/blob/6d357ff0d8dbb88b8d19fe689c15f0808724e52a/skills/hyperframes-animation/blueprints-index.md) · [许可](https://github.com/heygen-com/hyperframes/blob/6d357ff0d8dbb88b8d19fe689c15f0808724e52a/LICENSE) |
| Voxstylehub | [673d2050](https://github.com/Phantomlau3674/voxstylehub-steven/tree/673d20505fa1aba0619f1a04ed2d1702b85d4914) · [上游声明](https://github.com/Phantomlau3674/voxstylehub-steven/blob/673d20505fa1aba0619f1a04ed2d1702b85d4914/UPSTREAM.md) · [许可](https://github.com/Phantomlau3674/voxstylehub-steven/blob/673d20505fa1aba0619f1a04ed2d1702b85d4914/LICENSE) |

辅助证据：[源码快照](./repo-source-snapshots.json)、[Storybound 模板清点](./storybound-template-inventory.json)、[本地项目匿名统计](./local-project-statistics.json)、[本地失败分类](./local-failure-counts.json)。
