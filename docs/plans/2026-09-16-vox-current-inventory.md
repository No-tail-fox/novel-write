# VOX 当前实现、入口与缺口清单

盘点日期：2026-09-16。按当前工作区源码（HEAD `bdf1f71`）及已有验收产物核对；包含早期双链路修复、后续 Remotion、技能制作方式与 ShotCraft 接入。本轮只盘点并新增本清单，没有修复代码、调用模型或重做用户成片。

当前最主要的问题：功能已经分散接入多个入口，但默认自动生成没有把素材分层、丰富模板选择、旁白触发动作和成片验收串成稳定的完整流程。不能用安装了多少技能、目录有多少模板，代替真实生成效果。

## 1. 三个渲染入口，分别负责什么

界面入口：VOX → 分镜 → 选中镜头 → 画面。

| 界面选项 | 已实现 | 实际边界 | 代码 |
| --- | --- | --- | --- |
| 本地拼贴动画（新项目默认） | 独立背景、透明主体、原生文字；逐层关键帧、相机运动；5 种叙事动作 | 默认通常是背景＋一个主体＋文字，对比/多证据可增加第二主体；没有自动为每镜设计完整前景、中景、后景和遮挡关系 | [动作与图层](/I:/opc/src/shared/editorial-motion.ts:64)、[新镜头默认值](/I:/opc/src/shared/editorial-collage.ts:518) |
| 图生视频 | 完整关键帧 → 视频模型 → 视频资产 → 合成；元素与相机动作提示分开，任务状态和过期结果保护 | 模型返回整段 MP4。能否呈现独立元素与前后景运动依赖实际生成，不能由提示词存在就判定达标；不是可编辑的独立图层 | [生成页面](/I:/opc/src/features/editorial-collage/EditorialCollagePage.tsx)、[渲染装配](/I:/opc/src/shared/director-render.ts:578) |
| 动画（Remotion） | 55 个模板、参数编辑、AI 生成 TSX、个人模板、镜头预览/导出、整片混合导出 | 单独入口；普通本地拼贴不会自动选用这 55 个模板。需要选择模板并提供合适的图片、文字、数据 | [引擎切换](/I:/opc/src/features/director-desk/DirectorDeskWorkspace.tsx:1839)、[编辑器](/I:/opc/src/features/vox-animation/VoxAnimationEditor.tsx:22) |

本地拼贴与 Remotion 都属于“不用视频模型”的程序动画。AI 生成 TSX 会使用文本模型，自动制作图片仍会使用图片模型。图生视频才调用视频模型。

## 2. 已做的工作与完成程度

| 工作 | 做了什么 | 哪里查看 / 使用 | 还不能据此承诺什么 |
| --- | --- | --- | --- |
| 双链路资产保留 | 本地背景/主体与完整视频关键帧分别保存，逐镜切换保留素材；关键帧完成不再显示视频已完成 | 画面中的渲染方式；[实施记录](/I:/opc/docs/plans/2026-09-14-vox-dual-route-implementation.md) | 不代表每个实际视频模型已成功出片 |
| 独立素材生产 | 背景和主体分别请求图片；主体生成在纯绿色底上，再本地去绿、羽化和检查透明面积；成功背景可保留，缺主体时只补主体 | “生成分层素材 / 补齐分层素材”；[生成逻辑](/I:/opc/src/features/editorial-collage/EditorialCollagePage.tsx:748)、[抠像](/I:/opc/src/shared/editorial-cutout.ts:18) | 这是指定绿底抠像，不是任意成品海报的语义拆层；实际图片质量未靠本地夹具证明 |
| 5 种默认叙事动作 | 切片入场、聚焦揭示、证据落版、路径推进、并列对比；关键词选取，未命中时轮换 | 画面 → 叙事动作；[定义](/I:/opc/src/shared/editorial-motion.ts:3) | 只是有限模板。相似文案可命中同一模板，不是按每句话自动导演编舞 |
| 内容标题 | 分离“钩子/背景/证据/结论”等内部角色与上屏标题；默认抽取正文分句，可改可隐藏；短文按整句分镜 | 画面 → 上屏标题；[标题代码](/I:/opc/src/shared/editorial-storytelling.ts:11)、[记录](/I:/opc/docs/plans/2026-09-15-vox-story-titles-and-motion.md) | 默认仍是规则抽句，不是经过编辑判断的标题创作 |
| 49 个 Remotion 原模板 | 纸张、证据、图表、地图、流程、书籍、字幕等 11 类；参数、素材导入、模板搜索和个人模板 | 画面 → 动画 → 动画模板 → 选择模板；[目录](/I:/opc/src/shared/vox-animation.ts:10) | 49 个模板 ID 共享若干组件与布局，不等于 49 套完全不同的视觉编排 |
| AI 代码动画 | 文本模型生成/修改 TSX，支持代码查看、编译、取消和过期结果保护；现有时间戳可供代码使用 | 动画 → AI 生成动画；[编辑器](/I:/opc/src/features/vox-animation/VoxAnimationEditor.tsx)、[接入记录](/I:/opc/docs/research/remotion-templates-2026-09-15/implementation.md) | 测试用了固定模型响应，不能保证真实模型生成代码的质量和可运行率 |
| 6 个 ShotCraft 模板 | 改编 5 张上游配方的 6 个变体，保留独立模板 ID、参数约束和许可声明 | 同一个动画模板库；[来源与参数](/I:/opc/src/shared/shotcraft-recipes.ts:3)、[实施记录](/I:/opc/docs/plans/shotcraft-integration/README.md) | 没有导入上游全部 157 张配方，也没有把 214 个样式都变成模板 |
| 4 种技能制作方式 | Paper Cut、旁白 VOX、gbro、Nantian 的产品适配；详见下表 | 画面 → 制作方式；[适配定义](/I:/opc/src/shared/editorial-recipe-catalog.ts:1) | 不是直接执行五个技能的全套工作流 |
| 音频截尾与时长 | 按实测录音重排镜头、后续时间线和自动字幕；导出前再测长；可听旁白溢出阻止合格交付 | [时间校准](/I:/opc/src/shared/editorial-narration-timing.ts:9)、[审计和修复记录](/I:/opc/docs/plans/2026-09-15-vox-audio-sync.md) | 不是逐字 ASR；旧 MP4 不会自动修复，仍需用更新后的程序重新导出 |
| 局部重试与资产保护 | 局部图片失败后保留成功图层；变更提示/关键帧后不让旧请求结果覆盖当前编辑 | [生成逻辑](/I:/opc/src/features/editorial-collage/EditorialCollagePage.tsx:753) | 视频队列重试存在已确认的错路由，不能宣称“重试已全部完成” |

## 3. 五个已安装技能，实际对应四种制作方式

五个 `SKILL.md` 均存在于 `C:/Users/foxnotail/.codex/skills/`。应用调用的是项目自己的适配代码，不直接运行技能目录中的 Python/Swift 脚本。安装与接入是两件事。

| 制作方式 | 参考技能 / 来源 | 当前实际实现 | 缺口 |
| --- | --- | --- | --- |
| 原画参考分层 · Paper Cut | `paper-cut`，aijiduonadegou/Paper-Cut | 先生成/导入构图原画，将真实原画作为参考传入背景/主体再生成；主体本地抠绿；用本地分层时间线 | 是参考图再生成，不是逐像素原画拆层；没有嵌入完整 HyperFrames 流程。普通本地模式不自动启用此方式 |
| 旁白拼贴动画 · VOX | `vox-skill`、`vox-editorial`，jaredcassoutt/vox-editorial | 切到 Remotion；首次使用纸片主体模板并带入已有素材；AI 代码提示要求读取旁白 cues/tokens 时间戳 | 普通模板不会自动逐词编舞；没有原样接入 macOS Vision 抠图脚本 |
| 口播配画面 · gbro | `gbro-collage-broll`，pyang5166/gbro-collage-broll | 切到图生视频；将口播、单一视觉隐喻、半调纸片、最多四组物件组装写入图/视频提示 | 主要是提示和工作流适配；不会因此得到四个本地可编辑物件，效果尚需真实模型验证 |
| 拼贴艺术动画 · Nantian | `vox-collage-art-animation-nantian`，nantian721/vox-collage-art-animation-nantian | 图生视频要求首尾帧；可用下一镜头关键帧作尾帧；检查供应商首尾帧能力，缺尾帧禁止提交 | 没有复刻上游完整调研、故事板、配音与剪辑流程；输出仍是模型 MP4 |

代码：[制作方式编辑器](/I:/opc/src/features/editorial-collage/EditorialRecipeInspector.tsx:27)、[切换适配](/I:/opc/src/shared/editorial-recipes.ts:6)、[原画参考请求](/I:/opc/src/features/director-desk/director-generation.ts:283)。完整接入记录见 [技能接入报告](/I:/opc/docs/plans/2026-09-15-vox-skill-integration.md)。

## 4. 55 个动画模板完整目录

本次直接读取当前导出目录核实为 55 个：49 个本项目参数化模板＋6 个 ShotCraft 模板。默认本地拼贴的 5 种动作不计入此数。

| 分类 | 数量 | 当前名称 |
| --- | ---: | --- |
| 纸张拼贴 | 7 | 分层纸片入场、拍立得拼贴、立体纸卡、纸张标题压印、纸胶带定妆、折页纸卡立起、逐词纸面压印 |
| 证据讲解 | 5 | 新闻划重点、引文与出处、证据叠放、局部放大解释、对话气泡叙事 |
| 时间叙事 | 5 | 事件时间线、时间轴巡游、章节揭示、年代推进、刻度时间轴巡游 |
| 对比分析 | 4 | 左右观点对照、前后图片揭示、指标比较、观点与反证 |
| 数据解释 | 5 | 关键数字、柱状图、趋势线、占比拆解、动态排行榜 |
| 地图叙事 | 4 | 两地路线、多站点行程、地区聚焦、历史路径变化 |
| 原理流程 | 7 | 步骤推进、多路汇合、分层原理、因果连线、过程流动、来源汇聚成一体、环层结构注释 |
| 书籍推荐 | 6 | 书籍登场、阅读收获、书摘重点、同主题书单、目录展开、立体翻书 |
| 文字与图片 | 4 | 大字开场、关键词强调、多图网格、空间卡片巡游 |
| 音频与字幕 | 4 | 逐词字幕、播客音频卡、音乐频谱、歌词切换 |
| 转场与标注 | 4 | 纸张翻页、墨迹揭示、焦点推近、人物与地点说明 |

ShotCraft 的六项是纸胶带定妆、折页纸卡立起、逐词纸面压印、刻度时间轴巡游、来源汇聚成一体、环层结构注释。上游固定为 `Vincentwei1021/video-shotcraft` 的 `5e71af35a2daee492dd3ea93e5e8903f32dcd13c`，来源及改编范围见 [THIRD_PARTY_NOTICES.md](/I:/opc/src/features/vox-animation/THIRD_PARTY_NOTICES.md)。

模板数量与感受到的丰富度有差距：旧模板有共享布局；大量模板是文字、图表或卡片，不是多景深拼贴；默认流程也没有自动挑选、填充这些模板。`paper-actors` 是第一张图铺背景、后续图各自进入，如果后续图仍是完整海报，就会表现为整张卡片运动，而不是抠出的主体。该模板没有自动完成海报分层。[实际组件](/I:/opc/src/features/vox-animation/VoxComposition.tsx:25)。

## 5. 重试与前后景问题的当前结论

### 已确认的重试缺陷

- 视频失败项的普通队列“重试”接到了生图：队列映射只为风格试片保留 kind，[EditorialCollagePage.tsx:241](/I:/opc/src/features/editorial-collage/EditorialCollagePage.tsx:241)；重试 handler 对其他项全部调用 `startGeneration`，[DirectorDeskWorkspace.tsx:1170](/I:/opc/src/features/director-desk/DirectorDeskWorkspace.tsx:1170)。所以它不会执行视频重试。右侧专用“重试视频生成”则是另一条正确调用视频的入口。
- 普通图片/视频队列未包含旁白任务，不能把这处视频错路由扩大成“旁白队列也证实误生图”。
- 批量重试有静默拦截条件：批次控制器/活动状态、空节点或当前配置不可用时直接返回，不显示本次原因；可用性检查针对当前批量勾选项，未按实际重试节点收窄。[入口守卫](/I:/opc/src/features/director-desk/DirectorDeskWorkspace.tsx:1183)。这能解释一种无响应路径，但未结合用户当前运行状态复现。
- 未发现“失败节点因为状态没重置，所以批量重试必然不执行”：普通重试确实重置 pending。[执行器](/I:/opc/src/features/director-desk/director-batch.ts:179)。
- 重试会建立新任务，旧失败历史行仍然存在；看到旧失败行本身不能证明新请求没发出。

### 为什么仍可能看不到前后景动画

- 默认模式有背景/主体/文字的分层代码，但真实素材是否生成合格、透明主体是否绑定成功、实际导出是否用到这些素材，需要核对具体项目，不能由代码存在直接推定。
- 已有扁平项目不会在打开时自动调用模型变成分层项目；需要补齐分层素材并重新导出，原 MP4 不会随代码改变。
- Paper Cut 原画参考流程需要选中对应“制作方式”；普通本地拼贴不会自动经过它。
- Remotion 分层模板依赖用户提供/选择正确素材，不负责把任意海报拆成独立透明对象。
- 图生视频的视觉前后景运动由模型生成，当前提示与请求适配已经接入，但这几轮没有真实收费模型出片验收。
- 本轮没有确认用户当前运行的安装包/进程是否加载了这些最新源码，也没有确定最新反馈对应哪一个项目产物，不能把问题简单归咎于旧版本。

## 6. 已有验证、借鉴来源与还缺的闭环

早期 GitHub 对照的实际借鉴：paper-cutout-remotion 的独立背景/角色与错峰运动，voxstylehub 的准确文字与多时点检查，vox-director 的逐镜 I2V 和元素/相机动作分离，vox-explainer-skill 的旁白测时与装配。它们提供设计依据，不是四套引擎全部导入。来源与当时问题见 [早期 GitHub 调研](/I:/opc/docs/plans/2026-09-14-vox-motion-skill-research.md)。

| 验收 | 可以证明 | 证据 |
| --- | --- | --- |
| 双链路与标题 | 模拟服务下独立图层请求、部分失败补齐、关键帧隔离、标题保存和重载 | [双链路结果](/I:/opc/.artifacts/editorial-dual-chain/result.json) |
| 5 种默认动作 | 合成透明素材经过实际 Electron/FFmpeg 后能出现不同轨迹 | [12.5 秒测试样片](/I:/opc/.artifacts/vox-motion-variety-qa/run-LxOgL6/vox-five-motion-styles.mp4) |
| 49 个 Remotion 模板 | 98 次横竖屏浏览器检查，以及模板/代码/原有拼贴的实际混合导出 | [接入与验收](/I:/opc/docs/research/remotion-templates-2026-09-15/implementation.md) |
| 4 种制作方式 | 隔离组件验收参考图片、首尾帧请求、保存重载和 Remotion 播放 | [验收报告](/I:/opc/.artifacts/editorial-recipes/report.json) |
| 6 个 ShotCraft 模板 | 四画幅、24/30 fps 的 48 组关键帧；26 秒 1080p/24 fps 实际导出 | [测试样片](/I:/opc/.artifacts/shotcraft-qa/shotcraft-integration.mp4)、[记录](/I:/opc/docs/plans/shotcraft-integration/README.md) |
| 音频截尾 | 真实《撒日朗》原成片第 3/4 镜分别裁掉 282/414ms；隔离副本校准后保留全部原旁白，测试导出保留尾音 | [真实媒体审计](/I:/opc/.artifacts/vox-audio-sync-audit/README.md)、[校准验收](/I:/opc/.artifacts/vox-audio-sync-qa/run-P44a3p/report.json) |

上述验收主要使用本地素材、模拟服务或隔离副本，没有为用户真实项目跑通收费生成到最终成片的完整验收。ShotCraft 样片使用本地图片和空音轨；动画样片不代表主题影片质量。没有重做《撒日朗》原片。历史报告还保留全仓类型检查/旧测试失败，不能概括为全项目无 bug。

后续工作的依赖顺序建议（本轮未执行）：先统一图片/视频/旁白/导出的任务重试与状态反馈；再用一个真实项目证明原画、合格透明主体、独立运动、完整旁白和成片一致；之后让默认生成能够按文案选择现有模板并准备其所需素材/数据；最后扩展模板及复杂编舞。这样每一项都有可播放产物验收，避免继续增加入口却未进入实际生成流程。
