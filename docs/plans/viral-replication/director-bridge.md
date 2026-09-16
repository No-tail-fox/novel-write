# 分镜工程、语义时序与变体落地方案

日期：2026-09-16。状态：待实施。本文件只规定实现与验收，不代表已经接通 Hypit、自动对齐或视频 B-roll 图层。数据主契约以 [data-contracts.md](data-contracts.md) 为准；本文件补充该契约如何落入现有导演工程。按可对外收费分发的产品设计，自有主线不依赖 Hypit 的代码或运行环境。

本文属于整体拆解完成后的 M2 制作层，不能替代 M1 的全片分析。M2 首先验证一条 **20–30 秒中文样片 A**，通过后新增 B/C，共 **3 个钩子版本**。原片仍按 [整体拆解规格](full-decomposition.md) 覆盖完整时长和全部视听维度；新片时长、导演工程容量单独计量。制作层使用自有蓝图和现有 `editorial-collage`；Hypit 是后续可选后端。

## 1. 已有能力与需要补的断点

| 已核实接点 | 现有实际能力 | 本次需要补充 |
| --- | --- | --- |
| [editorial-collage.ts](/I:/opc/src/shared/editorial-collage.ts:438)：`createEditorialCollageDraft`、`createEditorialCollageStarterPlan`、`rebuildEditorialTimeline` | 建立 VOX 文档、按普通文本分镜、连续排列镜头；字幕及音轨使用毫秒 | 蓝图直接编译为分镜，保留语义 ID/来源映射；不能把蓝图重新拼回普通 `sourceText` 再走启发式 starter |
| 同文件：`EditorialCollageShot`、`EditorialCollageLayer` | 本地图片/文字层、逐层关键帧、相机关键帧；每镜最多 6 层、15 秒；顶层最多 12 个 beat | 语义事件绑定到层/相机/字幕/音效及模板标记；超限必须拆分或提示，不能截断 |
| [audio-alignment.ts](/I:/opc/src/shared/audio-alignment.ts:157) | 中英数字 token 化、导入 JSON/SRT/VTT、时间校验、估算及失效指纹 | 获取新配音真实对齐证据的服务；稳定词范围到对齐 token 的匹配；语义事件时间求解 |
| [director-generation.ts](/I:/opc/src/features/director-desk/director-generation.ts:658)：`applyEditorialVoiceRecord` | 保存配音版本、比对生成请求是否过期、记录实测时长 | 当前 `refreshShotCueAlignment` 是清除旧对齐，并未自动获得新的逐词时间；必须补一个显式对齐步骤 |
| [editorial-narration-timing.ts](/I:/opc/src/shared/editorial-narration-timing.ts:27)：`fitEditorialNarrationTiming` | 按整镜配音实测时长调整镜头；平移有效字幕；无真实时间时按比例重排；保留尾音 | 现有逻辑会按镜头时长缩放层/相机关键帧。新语义绑定镜头需要专用求解，避免把人工关键帧和词级事件都按比例拉伸 |
| [production-audio.ts](/I:/opc/src/shared/production-audio.ts:17)、[director-audio-edit.ts](/I:/opc/src/shared/director-audio-edit.ts:55) | 旁白、对白、音乐、音效、环境声、拟音；源裁切、音量、淡入淡出；每片段有镜头归属 | 从语义事件编译音效位置；跨镜头音乐按同一源时间连续切片，不能每镜从头播放 |
| [director-render.ts](/I:/opc/src/shared/director-render.ts:484)：`buildDirectorRenderScenes`；[director-renderer.ts](/I:/opc/electron/director-renderer.ts:23)：`renderDirectorVideo` | 从项目时间转换为镜头时间，复用预览/导出路径、字幕与多音轨混音、导出 QA | 消费已经解析好的时序；新增语义对齐质量门禁；不在渲染时调用模型或重新解释台词 |
| [storage.ts](/I:/opc/src/shared/storage.ts:2477)：`createEditorialCollageTask`、`saveEditorialCollageTask` | `tasks.pipeline_data` 保存完整文档；`expectedUpdatedAt` 防止旧版本覆盖；资产与作业记录 | 原子创建蓝图工程、绑定关系与生成基线；工程重建的三方合并、变体共享素材引用 |
| [director-document-sync.ts](/I:/opc/src/shared/director-document-sync.ts:24)：`mergeDirectorSavedDocument` | 异步保存回来时合并资产/作业/QA记录，保留用户当前文档编辑 | 不是蓝图重建合并器；需新增字段级来源与冲突规则 |

现有 `ProductionNarrationAlignmentEvidence` 检查计划旁白长度与实测音频时长/语速，不是词级声学对齐证据。验收中必须分别报告“旁白未截断”和“事件确实跟随台词”，不能用前者替代后者。

## 2. 三种时间分开保存

1. **参考片时间**：`reference.segments/evidence` 的来源媒体 ID、源文件绝对毫秒范围、证据帧/片段。区间 ASR 局部时间在适配层加一次 audioOriginMs，回放直接使用已保存的原文件绝对时间，不再加偏移。它只证明原片发生过什么。
2. **新生产语义时间**：新稿的稳定 `segmentId`、文本修订号、词范围/段落边界、入场或强调等事件。不绑定原片秒数，也不借用原片转写 token ID。
3. **解析后的生产时间**：由新配音版本、对齐证据、语义绑定和用户偏移计算出的 `startMs/endMs`，以及目标 fps 下的整数帧。它是可失效、可重建的派生数据。

导演文档继续遵循现有约定：`beat.startMs`、`subtitleCue.startMs/endMs`、`timeline.audioClips.startMs` 是**整片时间**；层/相机的 `atMs`、Remotion 内部时钟是**镜头局部时间**。`buildDirectorRenderScenes` 已把字幕/音频减去镜头起点；编译器不得再次重复相减。参考片时间永远不能直接写入这些生产字段。

使用数据契约中的 `ViralReplicationBlueprintV1` 修订快照和 `ResolvedReplicationTimelineV1` 保存生产输入与解析时间，导演文档增加经过 schema 明确许可的可选 `replication` 绑定块。该块保存来源 `analysisId`、蓝图 `revision/contentHash`、`variantId`、编译器版本、绑定映射、最近生成基线和人工覆盖；类型集中登记在 `viral-replication-contract.ts`，不能绕过当前 `.strict()` schema 偷塞属性。蓝图保存继续使用 `expectedRevision + expectedRunGeneration`；导演保存继续使用现有 `expectedUpdatedAt`，两种 CAS 不混用。

## 3. 蓝图到导演草稿：确定性编译

新增 `src/shared/viral-replication-director.ts`，提供以下纯函数。函数不请求模型、不读文件、不提交数据库；外层 runtime 负责素材探测、生成、保存。

```ts
compileReplicationToEditorial(input): {
  document: EditorialCollagePipelineData;
  bindingMap: ReplicationDirectorBinding[];
  diagnostics: ReplicationCompileDiagnostic[];
}

planReplicationRecompile(input): {
  proposedDocument: EditorialCollagePipelineData;
  patches: ReplicationFieldPatch[];
  conflicts: ReplicationEditConflict[];
  invalidations: ReplicationInvalidation[];
}
```

上述类型名为待集中登记的函数返回类型，不另建第二套蓝图格式。输入包含确定的蓝图修订、单个变体、新稿、已解析/暂估时序、已选素材版本、比例和渲染配置。编译器不得读“当前最新蓝图”或“当前选择图片”这种会随 UI 改动的隐式状态。

编译顺序：

1. 校验蓝图中引用存在、ID 唯一、段落/事件顺序合法；一对多关联合法但不能留下悬空引用。
2. 将功能段落映射为 `beat`，将连续视觉单元映射为 `shot`，建立 `segmentId/eventId → beatId/shotId/cueId/layerId/audioClipId` 显式表。ID 来源于变体命名空间及稳定业务 ID，不采用每次遍历产生的 `shot-1` 作为跨版本身份。
3. 根据新稿建立字幕 cue。初稿没有新配音时允许生成估算字幕供预览，标明 `estimated`；实际媒体制作前不允许假装已声学对齐。
4. 按画面类型选择 `deterministic-layers` 或 `remotion`，写入模板、内容与素材版本引用。首期不自动输出 `hybrid`，现有导出会拒绝该策略。
5. 将每镜关键帧/语义音效解析为相应局部时间或整片时间；渲染字段只含确定性数据。
6. 将素材快照并入该工程的 `assets`，复制必要文件并记录内容 hash 与本工程选择状态，建立 `providerJobs` 归属或复用来源；保留引用历史。
7. 一次调用 `rebuildEditorialTimeline` 构建资产/字幕索引，再运行 `parseEditorialCollagePipelineData` 与既有校验，返回草稿和完整诊断。
8. 保存时由专用数据库方法原子完成任务插入、正确 `pipelineData` 写入和蓝图运行绑定。现有 `createEditorialCollageTask` 强制调用 starter，不能先创建临时普通工程、再依赖第二次 UI 保存补成蓝图工程。

新增数据库入口建议为 `createEditorialCollageTaskFromReplication(input)`，由主进程专用 IPC 调用。输入只含受校验的 `analysisId`、`variantId`、`expectedRevision`、`expectedRunGeneration` 与幂等键；主进程从持久化快照编译或校验编译产物，不允许前端任意指定任务身份/文件路径。重复点击应返回同一目标工程而不是生成两份。创建失败不得留下一个已显示“成功”但缺绑定的空壳任务。

首个样片建议约 5–7 镜，每镜优先 3–7 秒，最多 15 秒。配音实测超出单镜上限时在语义段落/停顿边界拆镜，保持全文和事件映射；不能截掉尾音，不能把 20–30 秒的演示目标当作硬截断时长。目标时长超出时由用户选择压缩稿件或接受较长成片。

## 4. 新台词如何解析到毫秒和帧

### 4.1 对齐输入和证据

新增 `src/shared/viral-replication-timing.ts`：`resolveReplicationTiming`、`mapScriptRangesToAlignedTokens`、`validateReplicationTiming`、`quantizeReplicationTiming`。真实转写/强制对齐调用放在 runtime 层，输出先归一化后传入这些纯函数。

每次对齐的依赖至少包含 `segmentId`、脚本修订/文本 hash、音频资产版本/hash、语音身份/速度、对齐器和版本、音频裁切范围。输入音频必须是实际准备使用的那一版本；更换声音、速度或裁切后旧结果失效。

证据优先级：

1. 通过文本覆盖、边界和音频版本校验的 provider 逐词时间。
2. 对新配音运行 ASR/强制对齐后得到的真实逐词时间；服务实现与模型选择在后续实施时接入，首期可用已核实本地 JSON/SRT/VTT 作为无付费测试夹具。
3. 人工听音确认的词/短语范围，保存确认范围、音频 hash、脚本 hash 和操作者时间。
4. 缺失真实证据时仅做 `estimated` 预览，界面可见待对齐状态；要求台词同步的事件不能自动升级为“已通过”。

原片转写缺失时间、全为 0 或只提供句级范围时，不能伪造新稿逐词时间。SRT/VTT 的一句范围也不能仅因来自文件就认为每个词都真实对齐：句内均分产生的词仍是 estimated；需扩展当前导入路径的粒度标记。

### 4.2 稳定词范围与匹配规则

蓝图作者的语义绑定采用数据契约的 `SemanticAnchor`，保存 `segmentId + scriptRevision + startChar/endChar + exactText`。`startChar/endChar` 使用 JavaScript UTF-16 下标并禁止切开代理对；必要的前后上下文由对应脚本快照派生。不只保存字符串“成本”，也不以 provider 临时 token 下标作为稳定 ID。内部匹配使用现有 `tokenizeSubtitleText` 的中文字符/英文数字片段策略，并保留归一化文本到原文的区间映射；不要用替换后的文本长度回写原文偏移。

匹配流程：先在同一段落内映射稳定原文范围，再匹配对齐器 token 的一对多/多对一范围，最后得到第一个发声 token 的开始和最后一个发声 token 的结束。标点、空白不提供发声证据；英文大小写、全半角、数字读法可以作为受控规范化规则，规范化前后文本均需保留。

同一句出现多次“成本”时，必须按原文范围/上下文选择正确一次。改写导致选中表达消失、数字语义变化、多个候选分数接近、token 缺漏或乱序时，返回 `needs-review` 并定位该事件，不能猜最近时间后静默继续。重新绑定是显式编辑，可建议候选但不自动接受。

首期支持四种绑定：段落开始、段落结束、词/短语范围、短语开始/结束加毫秒偏移。跨多个不连续短语的复合条件和实时语义识别不进入首期。语义 ID 可跨文字修改保留“论证段”的身份，但文本范围必须按新的脚本修订重新核对。

### 4.3 时间求解和冲突

用实测音频时长安排段落和镜头；旁白保持原速。事件一般以“锚点 + offsetMs”确定起点，以固定时长、短语末尾或下一事件起点确定结束。每个事件显式声明入场、可读停留、退场和优先级，不能把三者压缩成一段未知动画时长。

新稿变长时先延长承载镜头并平移后续镜头；新稿变短时保留必要阅读/出场时间。必要时拆镜，不能通过加速旁白、裁切字幕或压缩到不可读状态自动满足目标秒数。图层数超过 6、同层事件相撞、事件落到镜头外、ShotCraft 最小时长不够时返回带具体节点 ID 的诊断；用户可改用静态呈现、普通关键帧或拆镜。

新的语义求解必须发生在 `fitEditorialNarrationTiming` 的实测时长更新之后，并且在挂有语义绑定的镜头上接管关键帧时钟：可复用现有“测旁白、保留尾音、重建整片起点”逻辑，但不能先把已有关键帧按比例改写后把该结果当作人工基线。建议抽出 `planEditorialSpeechDurations` 纯函数，再由旧项目继续走原行为，新复刻工程走 `resolveReplicationTiming → applyReplicationTiming`。

帧换算统一在一个模块，持久化业务时间仍以毫秒为主。现有导演预览和生产导出固定 `DIRECTOR_VISUAL_FPS = 24`；ShotCraft 已做过 24/30 fps 单独验证不等于产品已有 30 fps 导出。首期默认 24 fps，求解器用 24/30 fps 夹具测试；将 fps 做成产品选项另列扩展任务。

建议规则：可见区间使用半开区间 `[startFrame, endFrame)`，开始帧 `floor(startMs*fps/1000)`、结束帧 `ceil(endMs*fps/1000)`；瞬间触发取最近帧。与旁白严格同步的音效保留毫秒位置，不强迫音频量化成视频帧。生成最终镜头 frame plan 时显式保存每镜 `durationInFrames` 和累计起点，再从帧计划派生渲染毫秒；字幕、音频、关键帧全部使用同一计划，避免每条链各自向上取整导致多镜累计漂移。修改现有渲染接口前用实际导出验证这一边界。

仅有 1 帧量化误差是算法门槛；真实声学对齐验收还必须人工听音核对。不能用动画触发点与算法自己生成的 token 时间相符，证明配音本身就对齐。

## 5. ShotCraft 的真实可控范围

目前 6 个模板的可编辑字段是文字、颜色、条目、图片等内容，未提供“某词说完才触发某子动作”的公开事件接口。`ShotcraftSceneProps` 只传 `frame/fps/durationInFrames` 和内容几何；现有 `template.revision` 只接受 1。编译器可以控制模板镜头何时开始，但不能据此声称模板内部所有动作已逐词同步。

| 模板与现有函数 | 当前时钟 | 首期能力与计划 |
| --- | --- | --- |
| `shotcraft-paper-tape` / `tapeState` | `sourceFrame` 将整镜归一到 139 源帧，胶带落下写死在 58/82、84 后收稳 | v1 可将整镜放在语义段开始；两次胶带不能独立绑词。后续 revision 2 定义卡片入场、两次落点、停稳标记，校验先后关系和最短过渡 |
| `shotcraft-paper-popup` / `popupState` | 根据卡片数量按 7 源帧固定错峰，再整体归一 | **首批内部标记扩展**：revision 2 支持每卡 `riseAtMs`，保留固定弹簧与最短阅读时间；卡片上限 3，不为更多语义项静默截断 |
| `shotcraft-paper-title` / `paperTitleTokens` | 自有视觉分词；所有词在整镜约 5%–41% 内依序压印，尾部淡出；不是音频 tokens | **首批内部标记扩展**：revision 2 的视觉词明确映射新稿词范围，接收解析后的每词入场时间；强调词也绑定区间。标题与旁白不同文时必须显式选短语锚点，不可拿相同下标硬配 |
| `shotcraft-timeline-travel` / `timelineTravelTiming`、`timelinePopFrame` | 总时长决定巡游速度；逆相机曲线计算卡片到站；末秒停留 | v1 可在整镜级使用。独立到站绑词需新增 `arrivalAtMs[]` 并重建相机分段曲线/弹起提前量，不能仅改卡片 opacity |
| `shotcraft-source-merge` / `sceneTime` | 全镜归一化，约 .34→.74 汇聚、.78→.9 收线 | v1 用作一段“汇总/合并”视觉。各来源入场/汇聚词级事件需 revision 2 标记表；首期可回退为普通层关键帧 |
| `shotcraft-ring-reveal` / `sceneTime` | 主体收束、环、箭头、移位和注释按整镜比例 | v1 用作一个解释段。逐条注释随口播需要 `annotationAtMs[]` 与布局阶段标记，首期不宣称已具备 |

实现时建议新增 `src/shared/shotcraft-timing.ts` 的显式标记 schema、能力表和纯状态求解函数。`voxAnimationSchema` 用 revision 的判别联合保留 v1 原效果；revision 2 可以增加 `template.timing`，其中**只有解析后的局部毫秒/标记 ID**，不能携带待模型解释的自然语言。v1 个人模板重新打开结果必须相同，不自动升级。

内部早期样片可以先验收镜头切入、字幕和音效跟随台词，6 个模板保持 v1 整镜模式；不将这个结果宣称为模板子动作逐词同步。M2 发布验收包含标题和纸卡 revision 2 的内部语义触发；其余 4 个沿用整镜模式，只有完成各自接口及 QA 后，能力表才能从 `shot-only` 改为 `markers`。模板选择提示应让用户知道哪些可跟台词、哪些仅控制整镜时段。

模板 minSeconds、标题/条目长度、最大图片数沿用 `shotcraft-recipes.ts` 校验。对蓝图中不适配的事件返回明确替代建议，而不是缩小到看不见或直接丢字。首期优先使用固定模板，蓝图编译不自动生成或执行任意 Remotion 代码。

字幕也有一个要明确的边界：现有 `buildDirectorSceneHtml` 和 `src/features/vox-animation/runtime.tsx` 的 `Subtitles` 会把当前发声 token 变色，属于逐词跟读，尚无“只强调选中短语”的独立目标字段。早期样片可按跟读效果检查；M2 的 `caption-emphasis` 需在 `production-subtitle-schema.ts`/`ProductionSubtitleCue` 增加可选的已解析强调范围，并同步扩展 `sceneSubtitleCues`、`VoxAnimationCue` 和两套渲染路径，计入 P09。原文字/词时间继续保持完整覆盖，不能删掉未强调 tokens 来模拟选择性强调。

## 6. B-roll、叠加画面与声音边界

### 当前可立即复用的部分

- `deterministic-layers` 的 B-roll 是图片/抠图/原生文字，可用 `motion[].atMs` 的 opacity、位置、缩放表达入场、停留和退场。`EditorialCollageLayer.source = 'local-file'` 不代表它能读取视频；`buildDirectorRenderScenes` 会按 `kind: image` 解析层素材。
- Remotion 素材载荷 `VoxAnimationAsset` 目前只有 `image | audio`；6 个 ShotCraft 模板均不接收视频素材。
- `living-poster` 可播放一整镜视频，但现有导出验证要求成功的 `image-to-video` job、镜头归属与匹配资产。因此任意本地 B-roll 视频不能仅填一个 `videoAssetVersionId` 就导出，也不能伪造完成作业绕过校验。
- `hybrid` 已在 schema 中，但导出明确报告“未完成的混合渲染模式”；不能据类型枚举声称视频与图层任意叠加可用。
- 音效可使用现有多轨混音。每个语义音效生成独立 `ProductionAudioClip`，保留源 trim、gain 与 fade；同一资产可以有多个片段实例，片段 ID 不复用。

### 首期交付取舍

20–30 秒首个样片可完全使用静态 B-roll、图片关键帧和 ShotCraft，先验证语义链。工程生成前列出“视频素材待支持”的节点，不能把参考视频的动态 B-roll 自动变成静态图并报告全量还原。

紧接该样片增加 **整镜本地 B-roll** 支持，作为独立实施卡：新增明确的 `local-video` 渲染策略或等价的判别式来源契约，包含选定资产版本、`sourceStartMs`、`sourceDurationMs`、`fit`、是否使用源音频。首期固定 1 倍速，默认静音视频原声；若保留原声，应抽出为显式音频片段统一混音。不得套用 `living-poster` 的 AI 作业要求，也不得移除该策略原有校验。

该卡同时改动 `editorial-collage.ts` schema/校验、`director-render.ts` 的场景构建和 HTML seek、`electron/director-renderer.ts` 媒体暂存、导演预览与素材选择器。现有视频 seek 从镜头 0 秒开始，新接口必须跳至 `sourceStartMs + localMs`；视频长度不足时先诊断，默认不循环、不定格补长。支持镜头裁切但不隐式支持任意视频图层叠放。

**多层视频 B-roll**、视频与 ShotCraft 任意混合、变速/倒放/遮罩、源视频有声画同步的复杂剪辑留到后续。实施前另建媒体层判别类型和测试预算，不能复用图片字段后只在 UI 中显示“已支持”。

跨镜头音乐/环境声先用 `sliceProductionAudioClip` 沿镜头边界切片，保持 `sourceStartMs` 连续以及同一 `fadeEnvelope`；挂在段落内的语义音效随段落整体位移，人工固定音效按下节规则处理。

## 7. 改稿、换配音与人工编辑保留

新增 `src/shared/viral-replication-merge.ts`，以 **B：上次生成基线、L：用户当前工程、N：新编译结果** 三方比较。现有 `mergeDirectorSavedDocument` 继续处理异步回写，不承担这一职责。

字段归属分三种：`generated` 可跟蓝图更新；`override` 由用户接管；`locked` 必须显式解锁才能改。按稳定实体 ID 和字段路径记录归属，数组比较按元素 ID，不能把一整个 `shots` 数组当作一个字段覆盖。

| 改动 | 必须失效/重算 | 必须保留 |
| --- | --- | --- |
| 改某镜台词 | 该镜配音选择、真实对齐、依赖该段的事件、最终渲染与 QA | 其他镜的音频版本、无内容依赖的图片、人工布局/颜色/混音 |
| 换声音、语速或新音频版本 | 音频实际时长、该段对齐、镜头时长、下游全局起点 | 新稿与语义 ID、素材选择、未冲突的人工视觉属性 |
| 钩子变长/变短 | 正文全局起点、全片渲染/字幕时钟 | 正文源音频和图片文件、正文段内词时间/局部事件；只平移，不重新付费生成 |
| 改字幕样式/文字颜色 | 画面渲染及布局 QA | 配音/对齐；样式不应触发 TTS |
| 改标题文字，旁白未改 | 该标题视觉 token/标记映射、画面渲染 | 配音；若标题原来逐词绑旁白则重新检查对应范围 |
| 换产品/角色素材 | 相关画面及语义依赖的图像/视频产物 | 无关背景与音乐；若新名称也改变台词，再按台词规则处理 |
| 用户移动一个图层/关键帧 | 该字段转为 override，渲染失效 | 其他生成字段继续可更新；不把整镜都视为不可重建 |
| 删除一个生成元素 | 记录 tombstone | 后续重建不悄悄复活；新增蓝图同 ID 产生冲突提示 |

三方合并规则：L 与 B 相同，采用 N；N 与 B 相同，采用 L；L 与 N 相同，无冲突；三者不同且属于同一字段，保留 L 并列出待决冲突，N 作为可预览候选。重新生成新增元素只有在未被用户删除、ID/依赖合法时追加；未知自定义图层和音轨原样保留。

时间上的人工修改必须区分：

- “跟随台词再提前 120 ms”保存为**语义偏移**，新配音后重新求锚点并保留偏移。
- “本镜第 1200 ms 出现”保存为**镜头局部固定时间**，只随镜头全局位置移动；镜头变短导致越界时阻止自动应用，不能截断。
- “整片 10 秒出现”保存为**绝对时间锁定**，钩子变长后也不移动；如果越过镜头归属或与事件冲突，要求用户选择保持绝对时间或改为随段落。

合并先产生可比较的提案，用户应用后原子写入一个新工程修订。未解决冲突不自动替换现有可播放工程，也不把用户当前资产取消选择。保留上一生成快照可一键回退；共享资产引用不能被回退动作物理删除。

延迟返回的图片/TTS/对齐作业必须携带输入 fingerprint，并沿用 `editorialVoiceInputMatches` / `directorImageInputMatches` 的模式比对当前依赖。过期结果可作为历史资产保存，但 `selected: false`，不得重新激活旧台词音频或覆盖用户刚编辑的时间。

## 8. 三个钩子版本：复用产物，工程独立

变体 A/B/C 各自生成独立的 `editorial-collage` task/document，拥有自己的 beat、shot、cue、event occurrence、audio clip、选择状态、作业归属、更新时间与渲染记录。来源蓝图与正文段落可共享稳定 `segmentId`，工程内实体 ID 仍带变体命名空间；不能复制同一 JS 对象数组作为三个可写项目。

允许复用的是通过 hash 固定的正文图像/音频/音乐产物和不可变对齐证据。M2 将这些文件复制到每个工程自己的受管目录，每个工程建立独立的 `ProductionAssetVersion` 记录；`selected`、`pinned`、当前应用位置属于工程。删除某个变体仅影响它的目录，不损坏其他变体；不在本期引入全局 blob 仓库及引用计数回收。相同文件复制不会再调用 Provider，复用率按产物内容 hash 与请求收据计算。

正文复用指纹至少覆盖正文文本、声音/速度、图片输入与模型参数、比例或画面裁切要求、模板及修订、依赖素材 hash。仅钩子文本变化不能导致正文图片/TTS再次生成。若正文音轨只是移到更晚的全局位置，其段内 alignment 可复用，并重新计算全局 cue/event 时间；复制整片绝对字幕时间是错误实现。

首次只建立 3 个版本，不设计无限分支编辑器。版本比较页展示开头差异、预计/实测总长、复用素材数、需重做节点、冲突数和最终结果。用户在 B 中更换正文图片后，仅 B 的选择改变；A/C 继续引用旧版本。需要“应用到所有版本”时必须是显式操作并生成分别可回退的修订。

复用已有 `providerJob` 时不能只将他人的 job ID 当作本工程完成的生成作业；新增本地 `reuse` 记录/产物来源映射，或由数据契约的产物引用协议表达。已生成图片/旁白不必伪造新 provider 请求；`living-poster` 等依赖 job 归属的路径仍需明确适配。

## 9. 实施卡与依赖

| 卡片 | 主要新增/修改 | 依赖 | 可验收结果 |
| --- | --- | --- | --- |
| E1 编译草稿 | 新 `viral-replication-director.ts`；明确 schema 可选绑定块；新增数据库原子创建入口与 IPC | 数据契约中的蓝图/运行快照/ID | 固定夹具生成合法工程；旧普通入口行为不变；重复生成不重复建任务 |
| E2 词与语义对齐 | 新 `viral-replication-timing.ts`；runtime 对齐步骤；扩展导入证据粒度 | E1、实际音频资产 hash 与时长 | 真实/估算分开；重复词定位正确；无匹配事件进入待处理 |
| E3 重排与失效 | 抽出实测时长计划；`applyReplicationTiming`；依赖失效表；最终渲染指纹包含时序解析版本 | E2 | 改稿/换声后的字幕、图层、音效一起更新，尾音完整 |
| E4 人工改动保留 | 新 `viral-replication-merge.ts`；绑定归属/tombstone/冲突 UI；工程快照 | E1、E3 | 三方合并保留用户编辑；冲突有旧值/新建议；可回退 |
| E5 两个精确语义模板扩展 | `shotcraft-timing.ts`；`voxAnimationSchema` revision 2；标题/纸卡标记实现；能力元数据 | 首片通过，E2、E3 | 实际台词触发内部动作；v1 画面不变；预览与导出一致 |
| E6 三个钩子变体 | 独立任务生成、不可变文件复用、每变体资产选择、局部/全局时间换算 | E1–E4 首片通过、数据契约的素材引用规则 | 改 B 不影响 A/C；只生成需变更的钩子依赖 |
| E7 整镜本地视频 B-roll | `local-video` 来源/裁切契约；预览、seek、导出、源音轨规则 | 首个静态样片通过后 | 正常裁切实际视频；不依赖虚构 AI job；不足时长明确失败 |

E1–E4 完成后先检查内部样片，再完成 E5/E6/E7。M2 发布须包含两个模板内部标记、选择性字幕强调、整镜本地视频和 A/B/C 三个版本。统一实施编号为 E1→P06、E2→P07、E3/E4→P08、E5→P09、E6→P11、E7→P10，详见 [实施计划](implementation-plan.md)。任意视频图层叠加和其余 4 个模板子事件接口留待后续。

## 10. 测试与验收门槛

复用现有 `tests/editorial-collage*.test.ts`、`editorial-narration-timing.test.ts`、`editorial-structure-timing.test.ts`、`director-subtitles.test.ts`、`audio-alignment.test.ts`、`director-audio-render.test.ts`、`director-render-fingerprint.test.ts`、`director-generation-stale.test.ts`、`director-document-sync.test.ts`、`shotcraft-templates.test.ts`。新增测试覆盖用户行为与回归风险，不写与实现逐行相同的快照自证。

新增的关键夹具/测试：

- `viral-replication-director.test.ts`：来源时间与新片时间明显不同；稳定映射、无丢句/丢事件、6 层/15 秒边界、schema roundtrip、幂等创建和失败无空壳任务。
- `viral-replication-timing.test.ts`：中文夹英文/数字、同词重复、标点、对齐 token 粒度不同、缺词/0 时间/乱序、换音频版本、稿件删除词范围；24/30 fps 边界与多镜累计时间无漂移。
- `viral-replication-merge.test.ts`：用户移动图片、改音量、删生成图层、加自定义层，随后更新蓝图；锁定局部/绝对时间越界；过期作业返回；回退恢复旧版本。
- `viral-replication-variants.test.ts`：三个不同长度钩子复用正文产物；正文素材内容 hash 相同，各自托管路径、可变数组/选择/任务历史独立；修改 B 不污染 A/C；删除 B 不损坏 A/C。
- `shotcraft-semantic-timing.test.ts`：revision 1 行为不变；revision 2 在指定词/短语时间入场；文字与旁白不同导致明确匹配失败；任意 seek、倒序 seek、重复 seek 的同帧结果一致。

实际验收使用一份可公开或合成的 20–30 秒中文稿、固定音频与许可明确的素材，不以真实用户工程试错。保留脚本、音频 hash、对齐输入、期望事件表、渲染版本和导出报告：

1. 首先原版可保存、关闭、重新打开并导出 1080p/24 fps；无未确认素材缺失、黑帧、重复字幕或音频截断。E6 再要求三个钩子版本全部达到同一门槛。
2. 预览与导出在每个语义入场前一帧/触发帧/后一帧一致；相对于已批准 token 时间的算法量化误差不超过 1 帧。
3. 人工听检事件与声学误差阈值采用 [验收方案 A05](acceptance.md) 的单一标准；首片检查所有关键事件，三个版本合计至少 12 个指定词/短语，覆盖镜头切入、字幕和音效。E5 再追加标题/纸卡内部触发检查。超出者回到对齐修订，不靠放宽整片 duration 容差通过。
4. 钩子延长约 2 秒后，正文所有字幕/画面/音效整体后移，正文局部事件不漂移；复用正文媒体，无新的正文生成请求。
5. 更换声音/速度后，新词级证据生效；旧配音、旧字幕对齐和旧最终片仍可查看但不被标记为当前通过。
6. 人工图片位置、标题颜色、音量和删除状态经过重新编译仍保留；存在字段冲突时明确阻止自动覆盖，用户能逐项处理或保留现版。
7. 检查两主题与常用窗口宽度的蓝图→工程、时序待处理、冲突与变体比较流程；模板长中文、字幕安全区、4 种比例分别按变更范围做视觉 QA。
8. E7 另测有中文/空格文件名、非零源裁切、视频太短、无音频视频、含源音频视频、暂停 seek 及首尾帧；验证没有伪造 AI 作业记录。

最终报告分别列出“自动结构/时间校验通过”“声学对齐人工核对通过”“画面人工验收通过”。继承的仓库基线错误单独记录；不得把既有失败当成本次成功，也不扩大本轮为修复所有旧问题。

## 11. 工程绑定块与 IPC 明细

以下是 M2 拟新增的接口，不是现有 Hypit API。类型统一登记在 `viral-replication-contract.ts`，引用 [数据契约第 12 节](data-contracts.md) 的运行快照与幂等收据，避免主进程与渲染器各自拼 JSON。

`EditorialCollagePipelineData.replication` 为可选 `ReplicationDirectorMetadataV1`，至少包含：

```ts
{
  schemaVersion: 1,
  source: { analysisId, referenceManifestHash, blueprintId, blueprintRevision, blueprintHash },
  variantId,
  compilerVersion,
  planId,
  planInputHash,
  sourceSnapshotRef, // 工程自己目录内的来源/蓝图快照
  lastGeneratedBaselineRef,
  lastGeneratedBaselineHash,
  resolvedTimelineRef,
  resolvedTimelineHash,
  bindingMap,        // source segment/event -> 本工程 beat/shot/layer/cue/audioClip
  overrides,         // entityId + fieldPath + ownership + timingMode + valueHash
  deletedEntityIds,  // tombstone
  reusedArtifacts   // sourceTaskId? + sourceAssetVersionId + contentHash + localAssetVersionId
}
```

上述示例仅列字段，实施时仍需显式类型/长度/枚举与跨引用校验。未解析时序允许相应 ref 为 null，诊断列为待对齐；不能填一份假成功时间线。生成基线不把自己嵌套到自身，只保存规范化的生成文档/字段及外部不可变引用。模型提示、语义锚点保留在来源快照，渲染载荷只含已解析参数。

| 拟新增接口 | 输入核心字段 | 返回和执行边界 |
| --- | --- | --- |
| `viral:plan-editorial` | `analysisId, variantId, expectedRevision, expectedRunGeneration, targetTaskId?, expectedTaskUpdatedAt?, renderConfig` | `planId, inputHash, diagnostics, draftSummary, changes, conflicts, costPlan`；冻结来源快照，纯本地编译；不自动请求模型 |
| `viral:create-editorial` | `planId, expectedRevision, expectedRunGeneration, idempotencyKey` | `operationId, taskId, delta`；重验计划及来源 CAS，复制素材并原子创建工程；相同幂等键不得重复建任务 |
| `editorial-collage:replication-align` | `taskId, segmentIds, expectedUpdatedAt, inputHash, selectedAlignmentProvider?, acceptedCostPlanId?, idempotencyKey` | `operationId`；读取工程快照中的实际配音版本，派发有收据的对齐任务；不读取已删除分析的临时音频 |
| `editorial-collage:replication-operation` | `operationId, taskId` | `status, diagnostics, progress, receiptSummary`；检查工程归属，重启可查询 |
| `editorial-collage:replication-cancel` | `operationId, taskId` | 最新操作状态；停止新派发，远端结果未知继续对账，不宣称已取消计费 |
| `viral:apply-editorial-plan` | `planId, taskId, expectedUpdatedAt, expectedBlueprintRevision, resolutions[], idempotencyKey` | 新工程版本和 delta；每项 resolution 引用计划中的 conflict/patch ID，校验 choices 后整体保存；不接受任意文件路径/任意 JSON patch |
| `editorial-collage:replication-restore` | `taskId, baselineId, expectedUpdatedAt, idempotencyKey` | 新工程修订；只允许恢复该工程历史中合法基线，保留历史素材文件和晚回作业记录 |

`plan-editorial` 和更新预览均检查来源蓝图当前 revision；已存在计划在来源变化后返回 stale-plan，必须重新规划。`apply-editorial-plan` 同时核对源修订与目标工程更新时间，解决期间任一变化都不能覆盖。新建草稿不必先拥有可靠配音，但必须显示待对齐；最终导出仍通过质量门槛。

对齐和模板/素材生成采用现有任务体系；计划中的待生成节点映射为 `ProductionProviderJob`，不新增隐式“创建工程即全部付费运行”。操作完成回写再次比较具体输入 fingerprint，过期产物保存为未选中历史版本。

所有接口同步修改 `src/shared/storydream-api.ts`、`ipc-contract.ts`、`electron/preload.ts`、`electron/main.ts` 和 `src/app/browser-fallback.ts`。浏览器模式可读 fixture/预览纯计算结果，但原生文件选择、真实模型派发或工程磁盘提交不具备时返回明确 unavailable；不能仅在页面假造成功。
