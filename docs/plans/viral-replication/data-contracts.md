# 数据、参考片分析与恢复落地方案

日期：2026-09-16。状态：**待实现的设计方案**。本文中的新增类型、接口、文件和验收项均为拟议内容，不表示代码已经存在或测试已经通过。

首期继续使用 StoryDream 的下载、转写、模型配置、历史记录和 `EditorialCollagePipelineData` 工程。这里建立自己的参考证据和复刻蓝图，不导入 Hypit 的源码、数据库、Worker 或 SVML 作为内部格式，以可对外收费分发的产品为设计前提。**核心任务是整条视频的整体拆解：从开头到结尾，覆盖叙事、镜头、字幕、转场、图层动效、声音、视听同步与节奏。** 不把来源限定为口播或 10–120 秒片段。20–30 秒中文纸拼贴 / B-roll 解说及 A/B/C 三个开头版本（A 为首片），只是后续复刻生成的首个验证用例，不限制来源分析时长、题材或拆解维度。

## 1. 已核对的现有接点

| 现状 | 实现位置 | 对本期的直接影响 |
| --- | --- | --- |
| 输入仅有 `url/platform/title/settings` | [types.ts](/I:/opc/src/shared/types.ts:1802)、[ipc-contract.ts](/I:/opc/src/shared/ipc-contract.ts:792) | 本地导入不能伪造一个 HTTPS 链接进入下载器；增加独立导入入口 |
| 下载、抽取、ASR、逐帧理解、拆解、再创作均以 provider 注入 | [viral-analysis.ts](/I:/opc/src/shared/viral-analysis.ts:56)、[viral-runtime.ts](/I:/opc/src/shared/viral-runtime.ts:30) | 可按模式插入证据规划与分段观察，不需要新建调度系统 |
| 等距抽帧默认 8、实际最大 40，图宽 768；IPC 目前接受到 500 | [viral-runtime.ts](/I:/opc/src/shared/viral-runtime.ts:80)、[ipc-contract.ts](/I:/opc/src/shared/ipc-contract.ts:805) | UI、schema、runtime 的快速模式限额本期统一到 1–40 |
| 帧分析只在全部完成后保存 | [viral-analysis.ts](/I:/opc/src/shared/viral-analysis.ts:222) | 必须改成每个分析单元独立落盘；整片分批处理，失败不重复已完成的调用 |
| checkpoint JSON 限 2 MiB；结果文件读取限 8 MiB | [storage.ts](/I:/opc/src/shared/storage.ts:4470)、[main.ts](/I:/opc/electron/main.ts:1212) | 图像不内嵌 JSON，大段观察保存单元文件，checkpoint 只放索引与摘要 |
| `runGeneration` 已用于 checkpoint、事件和最终结果校验 | [storage.ts](/I:/opc/src/shared/storage.ts:3224)、[main.ts](/I:/opc/electron/main.ts:1869) | 延续运行代号；另加文档 revision 处理人工编辑，二者不能混用 |
| `beginViralAnalysisRun` 会保留旧 checkpoint、移除 completed 并提升 generation | [storage.ts](/I:/opc/src/shared/storage.ts:3224) | 恢复前必须校验输入依赖，不能只换 generation 就信任所有旧产物 |
| 已有归档、恢复、受管目录隔离删除与 tombstone | [managed-history-paths.ts](/I:/opc/electron/managed-history-paths.ts:29)、[main.ts](/I:/opc/electron/main.ts:718) | 新文件放进现有记录的受管目录；不创建第二套回收站 |
| 公开 detail 已移除 checkpoint | [main.ts](/I:/opc/electron/main.ts:784) | 新运行索引及模型原始响应仍留在主进程，报告通过专用读取接口获取 |

## 2. 版本与两个时钟

拟新增 `src/shared/viral-replication-contract.ts`，集中导出 Zod schema 与其推导类型，避免 TS interface 与 JSON 校验各自维护。现有 `ViralAnalysisResult` 保留基础字段；新写出的报告加 `schemaVersion: 2`、`referenceAnalysisRef/hash`、`coverageState` 和 `recreationState:'not-requested'|'draft'|'ready'`，旧报告无版本时按 legacy v1 读取。未请求复刻时兼容 recreation 对象保留空结构，UI 不把空稿当作可生产正文。复刻蓝图独立为 `ViralReplicationBlueprintV1`，不要把现有 `ViralRecreationDraft.blueprint: string` 改为对象。

| 字段 | 单一职责 |
| --- | --- |
| `schemaVersion` | 数据格式版本；不表示每次保存 |
| `runGeneration` | 分析后台运行代号，重试 / 恢复都会提升；防止旧任务写入新结果 |
| `revision` | 可编辑蓝图版本，首次为 1，每次成功保存 +1；用于乐观并发检查 |
| `scriptRevision` | 新稿正文版本，仅正文及段落结构变化时提升；用于撤销过期配音与时序 |
| `referenceMediaSha256` | 导入 / 下载文件身份，不用文件名判断是否同一素材 |
| `inputHash` | 某单元的实际依赖摘要，不包含密钥，决定断点产物能否复用 |

时间单位在新增模型中统一为整数毫秒，区间为 `[startMs, endMs)`。保留旧 `transcript/frames/source.duration` 的秒单位，只在桥接函数中换算一次。源文件若有非零时间起点，由探测记录统一归零后的媒体时间。

**参考片时钟**仅记录原视频证据位置，锚定 `referenceMediaSha256`。**新稿时钟**在取得新音频及可信的时间对齐之后产生，锚定变体合成稿及逐段 `segmentId + textHash + narrationAssetVersionId + narrationContentHash + alignmentRevision` 绑定清单。新稿变长、换音色或换语速后，对应段的旧输出时间标记为 stale；参考证据的毫秒值永不直接拷贝成新片的 start/end。

拟定核心类型轮廓如下。类型使用的 `Id`、`Sha256`、`MsRange` 都由 schema 校验；示例省略说明性文案字段，不是可以跳过校验的完整实现。

```ts
type Id = string; // 主进程生成，1–128 个安全字符
type Sha256 = string; // 64 位十六进制
type MsRange = { startMs: number; endMs: number };

interface ViralReplicationBlueprintV1 {
  schemaVersion: 1;
  id: Id;
  analysisId: Id;
  revision: number;
  basedOnRunGeneration: number;
  createdAt: string;
  updatedAt: string;
  reference: {
    mediaSha256: Sha256;
    durationMs: number;
    manifestRef: Id;
    manifestHash: Sha256;
    manifestRevision: number;
    scope: 'whole-video';
    coverageState: 'complete' | 'partial';
  };
  scriptRevision: number;
  scriptSegments: ReplicationScriptSegment[];
  semanticEvents: ReplicationSemanticEvent[];
  assetSlots: ReplicationAssetSlot[];
  variants: ReplicationVariant[];
  review: { status: 'draft' | 'reviewed'; reviewedRevision?: number };
}

type ReferenceTrack = 'narrative' | 'shot' | 'onscreen-text'
  | 'transition' | 'layer-motion' | 'speech' | 'music' | 'sfx'
  | 'av-sync' | 'rhythm';
type EvidenceState = 'observed' | 'inferred' | 'not-analyzed';

interface ReferenceAnalysisManifestV1 {
  schemaVersion: 1;
  revision: number; // 整体拆解修订，与复刻蓝图 revision 独立
  basedOnRunGeneration: number;
  sourceMediaSha256: Sha256;
  durationMs: number;
  scope: 'whole-video';
  scanPlanHash: Sha256;
  parts: Array<{ partId: Id; range: MsRange; artifactRef: Id;
    artifactHash: Sha256; shotCount: number; evidenceCount: number }>;
  coverageRef: Id; // 分页覆盖清单，逐轨合并必须覆盖 [0,durationMs)
  coverageHash: Sha256;
  narrativeRef: Id; // 整片叙事结构，可引用任意 part 中的证据
  narrativeHash: Sha256;
  totals: { shots: number; evidence: number; observations: number };
}

interface ReferenceCoverageCell {
  range: MsRange;
  track: ReferenceTrack;
  state: EvidenceState;
  finding: 'present' | 'absent' | 'unknown';
  evidenceIds: Id[];
  reason?: 'pending' | 'budget' | 'missing-capability' | 'failed'
    | 'insufficient-evidence' | 'not-applicable';
}

interface ReferenceEvidence {
  id: Id;
  kind: 'frame' | 'video-range' | 'audio-range' | 'transcript-range'
    | 'signal-measurement';
  range: MsRange;
  mediaRef: Id; // 托管清单中的媒体 ID；禁止自由文件路径
  frameTimeMs?: number;
  transcriptSegmentIds?: Id[];
  reason: 'uniform' | 'visual-change' | 'audio-change' | 'opening'
    | 'boundary-check' | 'motion-check' | 'manual';
  presentation: 'still' | 'ordered-frames' | 'continuous-video'
    | 'continuous-audio' | 'transcript' | 'signal';
  consumedBy: Array<{ analyzerId: string; capabilityVersion: string;
    inputHash: Sha256; consumedRange: MsRange }>;
}

interface ReferenceTranscriptSegment {
  id: Id;
  text: string;
  range: MsRange | null;
  timingQuality: 'provider-word' | 'provider-segment' | 'estimated' | 'missing';
  words: Array<{ id: Id; text: string; range: MsRange | null }>;
}

interface ReferenceObservation {
  id: Id;
  track: ReferenceTrack;
  range: MsRange;
  state: EvidenceState;
  text: string;
  evidenceIds: Id[];
  confidence: 'high' | 'medium' | 'low';
  origin: 'detector' | 'model' | 'user';
}

interface ReferenceSegment { // 叙事功能段落；不是处理单元或镜头
  id: Id;
  range: MsRange;
  evidenceIds: Id[];
  transcriptSegmentIds: Id[];
  shotIds: Id[];
  observations: ReferenceObservation[];
  narrativeRole: 'hook' | 'claim' | 'evidence' | 'turn' | 'close' | 'other';
  interpretation: string; // 功能/节奏推断，与 observations 分开
  review: 'unreviewed' | 'accepted' | 'edited' | 'rejected';
}

interface ReferenceShot {
  id: Id;
  range: MsRange;
  boundary: { startState: EvidenceState; endState: EvidenceState;
    evidenceIds: Id[]; uncertaintyMs: number };
  observations: ReferenceObservation[];
  objectLayoutRefs: Id[];
  textEventRefs: Id[];
  transitionRefs: Id[];
  motionRefs: Id[];
  audioEventRefs: Id[];
}

interface ReplicationScriptSegment {
  id: Id;
  role: ReferenceSegment['narrativeRole'];
  text: string;
  referenceSegmentIds: Id[];
}

type SemanticAnchor = (
  | { kind: 'segment'; segmentId: Id; edge: 'start' | 'end' }
  | { kind: 'text-range'; segmentId: Id; startChar: number;
      endChar: number; exactText: string; scriptRevision: number;
      effectiveSegmentTextHash: Sha256; edge: 'start' | 'end' }
) & { offsetMs: number }; // 有界整数；正值延后、负值提前，解析后不得越界

interface ReplicationSemanticEvent {
  id: Id;
  kind: 'visual' | 'caption-emphasis' | 'sfx' | 'motion';
  start: SemanticAnchor;
  end?: SemanticAnchor;
  fallbackDurationMs?: number;
  referenceEvidenceIds: Id[];
  assetSlotIds: Id[];
  motionRecipeId?: string; // 仅允许本地登记、适配器支持的模板
  motionRecipeRevision?: 1 | 2;
  timingPolicy: { enterMs: number; minHoldMs: number; exitMs: number; priority: number };
  review: 'unreviewed' | 'accepted' | 'edited' | 'rejected';
}

interface ReplicationAssetSlot {
  id: Id;
  kind: 'image' | 'video' | 'voice' | 'music' | 'sfx';
  description: string;
  assetId?: Id;
  assetVersionId?: Id;
  assetContentHash?: Sha256;
  dependsOnSegmentIds: Id[];
  dependsOnSlotIds: Id[]; // 无环；用于角色/产品变更的素材失效传播
  usage: 'reference-only' | 'production';
}

interface ReplicationVariant {
  id: Id;
  name: string;
  parentVariantId?: Id;
  scriptOverrides: Array<{ segmentId: Id; text: string }>;
  assetOverrides: Array<{ slotId: Id; assetId: Id; assetContentHash: Sha256 }>;
  eventOverrides: Array<{
    eventId: Id; disabled?: boolean; start?: SemanticAnchor; end?: SemanticAnchor;
  }>; // 开头变文后须重新绑定开头事件，不能沿用 A 版旧字符范围
}
```

`ReferenceAnalysisPartV1` 是按有界大小保存的证据分片，包含 `partId/range/shots/observations/trackEvents/transcript/evidence`。上面 `ReferenceShot` 中的各类 refs 指向分片中的有类型事件；事件公共字段为 `id/track/range/state/evidenceIds/shotIds/payload`，`payload` 按下表做 discriminated-union schema。不是把完整拆解再次压成一个自由文本 `visualDescription`。

| 轨道 | 首期必须保存的结构化字段 | 证据边界 |
| --- | --- | --- |
| 整片叙事 | 总主题、目标受众与表达目的的推断；开头承诺、信息推进、冲突 / 论证、证据、转折、结尾；段落原文及对应镜头 / 时间；可复用结构 | 目的、爆点及传播机制是解释；播放量 / 互动量不能证明因果或真实留存 |
| 镜头与内容对象 | 镜头起止、主体 / 物体 ID、主体关系、场景；景别、视角、构图、前中后景；对象的归一化框 `x/y/w/h`、可见性、遮挡 / 层级假设；入画出画时段；机位运动与主体运动分别记录 | 静帧可证明采样瞬间的布局；稀疏图差异不能证明中间完整动作路径，也不能确定真实拍摄机位 |
| 字幕与画面文字 | 原文 / OCR 不确定字符、语言、文字用途、行数、归一化框、对齐、字号占画面比例、字体类别候选、字重、字色、描边 / 阴影 / 底板、强调词、入场 / 保持 / 退场时间与方式 | 字体精确名称无证据时只给类别或候选；时间要带采样精度，不能从单帧编造入退场 |
| 转场 | 相邻镜头 ID、边界区间、硬切 / 叠化 / 遮罩 / 缩放 / 擦除 / 其他候选、持续时长、边界置信与证据 | scene score 只产生候选；连续视频或密集边界帧验证后才能细分，未知保留 unknown |
| 图层与动效 | 可见对象 / 文字 / 装饰层、相对前后关系；position/scale/rotation/opacity 等可观测关键状态与时间、入场保持退场、路径 / 缓动候选 | 像素合成视频通常不能确定原编辑工程层数、真实 keyframe / easing；重建建议与观测关键状态分栏 |
| 配音 / 对话 | 逐字稿、说话区间 / 停顿、说话者标签及不确定性、情绪 / 重音候选、语速；provider / forced / estimated 时间质量 | ASR 时间质量独立于文本可信度；声音身份不作真实人物身份认定 |
| 音乐 | 有无与覆盖区间、音量包络 / 起落、节奏 / 拍点候选、情绪 / 音色类别、淡入淡出；与配音的混合 / 遮挡 | 包络能说明混合音频能量变化；未经分离不能当作音乐独立轨音量；无充分证据不报精确曲名或 BPM |
| 音效 | 声音事件区间、类别候选、起止 / 强弱、关联画面事件与时间差 | 必须有实际 audio-range；单凭爆炸画面、字幕“砰”不能确认音效存在 |
| 视听同步 | 台词词 / 句锚点、剪切 / 字幕强调 / 对象动作 / 音效 / 拍点事件间的相对毫秒差、精度与人工修订 | 同步关系引用两个可定位的事件；对齐不可靠时报告区间或 unknown，不制造帧级精度 |
| 节奏 | 镜头时长分布、段落时长、单位时间切换 / 文字更新密度、语速与停顿、声音起伏、快慢区段、高潮 / 松弛解释 | 时长等为可测量值，高潮与情绪功能为推断；所有汇总保留原事件 refs |

覆盖记录逐轨、逐范围区分 `observed/inferred/not-analyzed`；“已观测且不存在该元素”是 `observed + absent`，“没有做分析”是 `not-analyzed + unknown`，不可都写成空数组。底层检测、模型感知、人工校对的来源分别标明；存在 `mediaRef` 只能说明视频可回放，只有 `consumedBy` 证明相应分析器实际接收了该区间。帧模型只见四张图片时，不能因为该区间也有视频文件就把观察能力升级为连续视频理解。

镜头、处理单元与批次互不等同：镜头是内容对象，处理单元是一次有界分析输入，批次是预算 / 并发执行容器。一个单元可以含多个镜头，一个长镜头也可跨多个单元；跨单元的同一镜头必须通过边界去重与稳定 ID 合并。首期不存在“整片最多 16 个镜头”的限制。

新片已解析时间另存 `ResolvedReplicationTimelineV1`，包含上述新稿时钟身份、`variantId`、`blueprintRevision`、变体合成后的 `effectiveScriptHash`、`fps: 24 | 30`，以及 `events[{eventId,startMs,endMs}]`、`unresolved[{eventId,reason}]`。生产导出首期固定 24 fps，30 fps 只用于求解器夹具。它是蓝图和音频的派生产物，不可反向覆盖语义锚点。Editorial 导出器只消费这个已校验的结果，详见 [导演桥接](director-bridge.md)。

变体解析先应用 scriptOverrides，再校验 eventOverrides 和 effectiveSegmentTextHash；旧开头文本不一致时必须重新绑定或显式禁用相应事件。正文缓存键使用具体段落文本、音频 hash 与对齐器配置，不单独使用整份 scriptRevision，否则只改开头也会错误失效所有正文。素材槽的 usage 为 reference-only 时不能自动编译进成片，转为 production 必须是用户明确选择可用素材。

ID 与文本定位约定：

- 同一媒体与采样规划恢复时，证据 ID 由媒体 hash、规划版本、毫秒时间、类型确定；叙事段落与确认镜头首次建立后使用主进程生成的稳定 ID。人工纠正镜头边界保留镜头 ID；拆镜 / 合镜保存旧新 ID 映射，不用处理单元序号当镜头 ID。
- LLM 只能引用请求给出的候选单元 ID，不能创建托管文件路径或决定数据库 ID；主进程为新观察、段落、事件分配 ID。
- 调整一段的文字保留段落 ID；拆段、合段使用新 ID，并在本次编辑中显式迁移事件。删除段落会把引用事件标为待修复，不默默绑到下一段。
- 首期文本范围采用 JavaScript UTF-16 下标，与文本框 selection 一致；禁止切开代理对。`exactText` 必须与对应切片精确相等，重复词由位置区分；不做按关键词全文模糊搜索后自动选第一个。
- `confidence` 是模型自评，不是统计准确率；没有相应音频证据时不能把静帧推断出的音效写成“观察”。
- `0,0` 或非单调 / 越界词时间映射为 `missing`，不能包装成已对齐；仅有句级时间时允许段落锚点，词级触发留待对齐或人工定位。

## 3. 本地视频导入与媒体托管

首期新增主进程调用 `viral:import-local`，参数仅为 `{title?, settings}`，由它弹出原生文件选择框。取消返回 `{cancelled:true}`，不创建历史记录。选择成功后再创建历史记录与随机 `managedStorageKey`，预留该记录的 active reservation，复制、探测，完成后返回可预览的记录并置为 `paused/queued`。用户确认模式与整片预算计划后，通过 `viral:analyze-prepared` 开始分析；不要求为适应模型窗口裁掉原片。当前链接入口 `viral:create-and-run` 保持可用。

文件步骤必须明确：

1. 只收普通本地文件；按探测到的视频流判定类型，不能只信扩展名。首期支持 FFmpeg 能解码的 MP4/MOV/WebM/MKV。按实际文件大小、空闲磁盘、解码能力与预计工作量预检，不再设置 10–120 秒内容范围或 1 GiB 的产品硬限制；长片分块处理，不能整段读入内存。磁盘不足或超出当前设备处理能力时在付费调用前返回实际缺口，不静默截短。不设 720p 硬门槛，低清文件提示观察质量限制。
2. 复制至该记录受管目录 `source/source.<detected-ext>.partial`，流式计算 SHA-256；复制完成再探测帧尺寸、旋转、时长、音轨，并发布 `source/source.<ext>` 与媒体清单。先进行目标目录身份校验，复用受管路径与文件写入辅助逻辑。
3. 运行只读托管副本。原始文件只记录可显示的 basename，不把用户绝对路径交给模型、写入公开报告或当删除目标。原文件随后移动或删除不影响恢复。
4. 无音轨记录 `transcriptState: 'no-audio'`，跳过 ASR；有音轨但 ASR 配置缺失 / 失败则单元失败，不伪造一段无声文本。
5. 新增 `ViralSourceDescriptor` 作为记录的 `source` 字段，区分 `{kind:'url',url,platform}` 和 `{kind:'local',displayName,mediaRef,mediaSha256}`。DB `source_json` 保存它。旧 `url/platform` 兼容列继续保留，本地来源用 `url:''`、`platform:'unknown'`，展示“本地视频”依赖 `source.kind`。
6. `ViralVideoSource` 增加来源种类，来源获取 provider 增加 `local-import`（不得使其进入下载平台路由）。新 provider 函数建议命名 `acquireSource`；保留 URL download 实现为其一个分支。
7. 导入期间失败，记录保留为 failed，可查看原因；只清理本次尚未发布的 `.partial` 文件。恢复存在有效托管副本时不再次弹出选择框。

所有区间均使用完整托管原片中的绝对媒体时间。处理单元可以是 `[45000,75000)`，但 `reference.scope` 始终为 whole-video，整片覆盖目标为 `[0,durationMs)`。抽取该区间音频用于 ASR 时，adapter 给模型返回的局部时间加上 45000；该换算仅发生一次，并保存 `audioOriginMs`。连续视音频临时切片也保存原片 originMs；原片回放、跨块字幕 / 音乐与镜头合并都使用绝对时间。这个局部输入时钟不是新稿输出时钟。用户后续主动“重看某段”只提高那段精度，不替代整片初次分析。

目录建议：

```text
<appData>/viral-analyses/<managedStorageKey>/
  source/source.mp4
  source/manifest-v1.json
  audio/chunk-<id>.m4a
  scans/plan-v1.json
  scans/coverage-<revision>.json
  scans/parts/<partHash>.json
  evidence/<samplePlanHash>/frame-0001.jpg
  evidence/<samplePlanHash>/clip-<id>.mp4
  receipts/<receiptId>-<revision>.json
  units/<inputHash>.json
  results/analysis-g<generation>.json
  blueprints/blueprint-r<revision>-<contentHash>.json
  derived/alignment-<inputHash>.json
  derived/timeline-<inputHash>.json
```

`manifest-v1.json` 仅在主进程保存 `mediaId → 相对路径/hash/MIME/大小`。报告回放通过拟新增 `viral:media-url({analysisId,mediaId})` 获取 URL；主进程先查归属、文件实际路径及受管目录，再复用 [html-video-runtime.ts](/I:/opc/electron/html-video-runtime.ts) 的受控媒体响应和 Range 能力。新增 family 命名空间，不能把同名 viral ID 当成 task ID。渲染器不能传任意 path，返回 URL 不能突破清单或目录。

证据区间通常直接 seek 托管原视频并到 endMs 停止；首期不为每段转码一份视频。浏览器不支持的编码可按需生成一份 H.264/AAC 预览代理，清单同时记录原文件 hash 与代理 hash，原始媒体时间保持一致；代理生成失败仍可读取文本报告，证据回放显示明确失败状态。

## 4. 快速与深度分析如何并存

`ViralAnalysisSettings.analysisMode?: 'quick' | 'deep'`，缺省为 `quick`。快速模式维持现有 8 帧默认值、1–40 帧范围与报告字段；加入单元 checkpoint 和结果校验，但不额外请求分段动效理解。

深度模式采用 `deepAnalysisProfile: 'whole-video-v1'`，先做整片本地扫描、建立完整覆盖清单和总预算计划，再按有界批次执行。64 帧 / 16 单元 / 16 次初次视觉请求是**单批次起始预算**，不是整片配额；不以调低采样密度来假装任意长的视频已经充分分析。数字是后续可调的工程起点，不宣称已经实测最优。

| 项目 | 首期建议批次限额 / 整片行为 |
| --- | --- |
| 内容范围 | 从第 0 秒到完整 durationMs；不按题材或 10–120 秒筛掉来源；生成样片仍单独验收 20–30 秒 |
| 整片低层扫描 | 流式扫描每个解码视频帧的低分辨率 scene 差异、帧时间与黑场 / 冻结候选；按固定有界时间块落盘。可选加速抽样必须记录检测精度及未检测间隙，不能宣称逐帧已扫 |
| 音频扫描 | 分块提取 16 kHz 单声道供 ASR，另保存必要声道 / 混合音轨供证据；计算音量包络、静音、起音与频谱变化候选。ASR 分块大小按实际上传字节 / 时长限制控制，重叠边界去重 |
| 镜头候选 | scene score 暂定 0.25 只是一个检测阈值；不设置 250 ms 镜头最小长度，短闪切必须保留。硬切 / 渐变 / 连续长镜头分别验证；全片边界连同首尾进入清单 |
| 分析单元 | 单批核心窗口初始最长 30 秒，前后各最多 1 秒上下文；窗口内按 5–15 秒与候选边界装箱，快切或文字更新密集则继续拆单元/批次。上下文可重叠，核心覆盖不能缺失；单元数随片长 / 密度增长 |
| 单批静帧证据 | 普通观察 ≤64 张新增 / 引用帧、最长边 ≤768，低清不放大；优先满足镜头/事件覆盖。细小文字 OCR 另用原分辨率局部裁剪，记录裁剪到原图的坐标与单独用量；不能把 768 缩略图无法识别当成已完成 OCR。不够则新建批次 |
| 单批视觉调用 | ≤16 个单元、≤16 次初次视觉请求；纯帧单元每次最多 4 图，合计引用 ≤64。连续视频请求的 duration / bytes / tokens 按 provider 能力另计，不能用“4 帧”等价核算 |
| 连续证据 | 运镜、动作路径、转场与动效入退场采用局部密集帧 / 光流轨迹 / 连续视频；声音类别与视听同步消费 audio-range / video-range。需要追加时进入显式补证据计划，不在静帧结果里猜完整过程 |
| 执行并发 | 初期视觉 / 音频模型各默认 1，沿用现有取消和有界进程能力；本地扫描可以先完成而模型批次暂停 |
| 整片费用预检 | 汇总预计批次数、视觉初次请求、视频 / 音频分钟数、ASR、每批 / 全片结构汇总、可选补证据与重试；显示价格未知项，不将未知价格写为 0 |
| 预算用尽 | 尚未派发的单元保持 pending，覆盖清单对应轨道为 not-analyzed；任务暂停并显示已完成 / 总范围。允许扩预算继续，不默默省略后半片，也不自动降级快速模式 |
| 修复 / 重试 | 默认不自动付费修复坏 JSON；用户选单元重试后创建新 attempt 和增量预算。可证实未提交的传输失败最多重试 2 次，否则 outcome-unknown；计数跨 generation 累积 |
| 数据体积 | 每个证据分片 / checkpoint / 蓝图索引仍有字节上限；整片逐字稿、镜头、轨道事件分页存储，不以 16 镜头 / 20,000 字符截断全文。新稿 60 段 / 120 事件 / 80 素材位 / 3 变体仍只是首个复刻输出能力 |

具体流水线为：

1. 探测完整媒体、建立 `scope:whole-video` 与预计磁盘成本；无音轨作为 observed absence 保存。
2. 全片分块本地扫描，得到视觉 / 音频候选；候选本身也可查看，尚不等同于已完成语义拆解。
3. 构建 `CoveragePlan`：每个处理单元记录 coreRange / contextRange、涉及轨道、能力需求、证据和 requestPlan。逐轨所有 coreRange 的并集必须覆盖 `[0,durationMs)`，重叠归属规则确定，未排入预算的单元仍在清单中。
4. 完成预算预检后，逐批执行 ASR、视觉、连续视频 / 音频观察。批次结果逐单元保存，在边界处核对同一镜头、字幕、音乐段与说话段，避免接缝重复 / 漏掉。
5. 整片汇总分两层：先汇总批次观察，再合并为整片叙事与节奏报告；每项重要结论保留原始跨批证据 ID。LLM 上下文不足时按层级汇总，完整逐字稿及事件仍在本地，不能只保留摘要替代全文。
6. 输出整片可回看报告与覆盖矩阵，之后才从全片结构选择用于新主题的复刻蓝图。再创作与是否生成短片是独立操作，整片分析完成不需要自动开始生成素材。

阶段仍沿用 `extracting/analyzing_frames/breaking_down/recreating`，事件 `data.substage/batchId/unitId/track/completedDurationMs/totalDurationMs` 提供真实进度。“镜头数”“处理单元数”“本批第几次请求”分别显示，不能把 16 单元进度冒充全片进度。`recreating` 仅在用户请求复刻时启动；深度分析独立完成时结果中 recreation 可保留兼容空结构，并标明未请求。

完成判定分两层：执行状态与 `reference.coverageState`。只有全片扫描完成、所有计划单元可验证落盘、每个要求的轨道没有 pending / failed / budget / missing-capability 空洞，才允许显示“整体拆解完成”。推断可作为明确标记的推断，但不能改标为观测。缺少音频 / 连续视频能力时保留 partial 报告，列出具体轨道和区间，并以 paused / capability-needed 等诊断等待补齐；用户主动结束后保留部分结果，不能换一个 completed 标签掩盖未分析部分。

兼容 `frames/contentBreakdown` 可由整片证据派生简要摘要；已有 recreation 的旧报告仍可使用模板 / 普通任务出口。新深度报告加 `recreationState:'not-requested'|'completed'`，尚未建立新稿时不传空文案创建普通任务，而是引导用户选择建立新稿；仅导出拆解不依赖 recreation。完整镜头轨道和逐字稿从分片 API 读取。模型输入继续保留“迁移结构、换主题、不逐句照搬”的要求。旧快速报告升级深度分析首期创建新记录并复用托管输入，避免覆盖人工编辑；快速模式始终标为快速概览，不称为完整全轨拆解。

## 5. LLM 输出、校验与可信边界

所有模型输出先为 `unknown`，执行 JSON 大小检查、schema 校验、跨引用 / 时间校验后才能进入单元产物。现行 `result.json as ...` 和报告的 `JSON.parse(...) as ViralAnalysisResult` 本期在触及链路处替换为解析函数。

1. 拆解基础结构允许既有扩展分类字符串，但拒绝非字符串 / 超长值；缺失字段按旧版明确迁移规则补空值，不能把任意对象类型断言成完整报告。
2. 新蓝图 schema 使用 `.strict()`、整数范围、唯一 ID、有限枚举、数量上限。校验所有 `evidenceIds/segmentIds/assetSlotIds` 的存在性，区间满足 `0 ≤ start < end ≤ durationMs`；静帧仍用 1 ms 证据范围及 frameTimeMs 表示，不允许伪造零长度镜头。
3. 单元模型只能引用发给该单元的证据 ID、时间范围；结构汇总只能引用已完成单元。检查台词原文切片、事件起止顺序、文本范围边界。含缺失证据的说法成为未验证推断，不能进入 observations 的 accepted 状态。逐轨覆盖校验检查首尾、接缝、重叠去重和遗漏；模型返回空数组不能使该轨 coverage 自动变 observed。
4. 模型回答中的文件路径、URL、shell 命令、代码不是执行指令；素材位只保存描述或引用已知资产 ID。首期动效只选本地登记的 6 个 ShotCraft 与明确适配的既有模板。
5. 新稿文字允许自动产生 draft，但导出时所有未能解析的必要语义事件必须列出；不能把它们默认挤到 0 秒来凑成可渲染工程。
6. 保存调用来源 `{providerId,modelId,promptVersion,requestId?,attempt,inputHash,startedAt,finishedAt,usage?}`。不保存 key、Authorization、完整配置对象；错误沿用 4,096 字符上限。原始返回仅在需要诊断时留本机，限大小，不写进 AppDelta。
7. 音乐 / 音效语义观察必须有实际音频分析或人工听审。ASR 文字不足以证明存在击打音、鼓点、BGM 起落；音量包络只能证明混合音轨能量。provider 需明确提供 `analyzeAudioRange` 能力及实际消费区间；若当前渠道缺该能力，该轨保持 not-analyzed，报告列出缺口，不能把建议新片音效填成原片已观测音效。
8. 连续视频能力同样显式声明 `analyzeVideoRange` 的最大字节 / 时长 / 采样规则。纯 image-only provider 可以完成静帧可证部分；动作、路径、连续运镜的完整结论需要连续视频、足够密的序列或经验证的局部跟踪。即使底层光流测得像素运动，也不能自动推断真实相机轨迹。技术上尚未接通某能力时保留缺口，不能为了让首期状态变绿而降格“整体拆解”的含义。

拟新增解析函数：`parseViralResultDocument(unknown)`、`parseReferenceAnalysisPart(unknown)`、`validateWholeVideoCoverage(manifest,coveragePages)`、`parseReplicationBlueprint(unknown)`、`validateBlueprintReferences(blueprint)`、`normalizeReferenceTranscript(legacySegments,durationMs)`。纯函数负责规则，主进程负责媒体归属与数据库状态。

## 6. 单元 checkpoint、恢复、防串代与编辑冲突

checkpoint 拟增加 `schemaVersion: 2`、`analysisProfile`、`sourceFingerprint`、`scanPlanRef/hash`、`coverageIndexRef/hash`、`unitIndexRef/hash`、`receiptIndexRef/hash` 和整片预算累计摘要。每批最多 16 单元的索引作为有界页保存；checkpoint 只引用不可变索引根，不能因片长增长无限膨胀。不要将 base64 图、完整模型响应或每版蓝图放进 2 MiB checkpoint。

```ts
interface ViralAnalysisUnitCheckpoint {
  unitId: Id;
  batchId: Id;
  coreRange?: MsRange;
  kind: 'source' | 'scan' | 'extract' | 'transcribe' | 'observe-visual'
      | 'observe-video' | 'observe-audio' | 'reconcile-boundary'
      | 'batch-summary' | 'breakdown' | 'recreate' | 'blueprint';
  inputHash: Sha256;
  status: 'completed' | 'failed';
  artifactRef?: Id;
  artifactSha256?: Sha256;
  attempt: number;
  diagnostic?: string;
}
```

提交一个成功单元的固定顺序：

1. 请求前检查 signal、当前 generation、记录未归档 / 删除。先持久化 `reserved/submitting` 请求收据、预算保留和 checkpoint 指针，再真正派发；request-start 事件仅用于展示，不能代替收据。
2. provider 返回后优先把有界原始响应及 output hash 保存到本次 attempt 的收据文件，避免已经计费的有效返回因后续 JSON 校验失败而丢失；再检查 signal / generation，校验为单元产物。旧代不能发布当前单元，完成的返回仍可作为该 attempt 的隔离收据用于恢复核对。
3. 写 `units/<inputHash>.json` 的唯一临时文件，flush / 发布为不可变文件，记录 hash；完成后的收据指向原始返回和已校验产物，失败响应也有明确 invalid-output 状态。
4. 以 `updateViralAnalysisForGeneration` 原子提交新单元 / 收据索引、coverage 页指针与成本累计；失败立即停止后续单元。文件可能成为孤立产物，但不能被新运行误认为已完成。
5. checkpoint 提交成功后发 unit-completed 事件。前端刷新后看到的进度与覆盖状态必须有可读产物支持。

恢复必须逐项检查：schema 支持、源文件 hash 一致、抽帧清单未变、单元文件存在 / 内容 hash 匹配、provider/model/promptVersion 与相关设置的 inputHash 一致。满足这些条件后才把旧 generation 的已完成单元登记给新 generation；有效单元不重复请求。坏文件只使自身及依赖单元失效，不能丢弃无关 ASR 或已完成镜头。

首期依赖图不用通用 DAG 框架，使用固定阶段与有序批次：`source → whole-scan → plan → chunk-extract / transcribe / observe → boundary-reconcile → batch-summary → whole-breakdown`；用户请求复刻后才继续 `recreate → blueprint`。每个观察依赖各自实际媒体 / 字幕，原片无音轨可依赖明确的 no-audio 标记；接缝合并仅依赖相邻单元。scanPlan / samplePlan / 批次预算在建立时持久化，恢复不按当前时间或新随机数另选一批输入。补充扫描形成新的 plan revision，不使已验证的无关部分全部失效。

对于“上游已返回 / 本地还未落盘就断电”，现有同步模型接口无法保证恢复后不重复计费。记录有 request-start 而无完成收据的单元为 interrupted / outcome-unknown，重试前显示该状态；不把单元 checkpoint 说成付费调用的恰好一次保证。有效响应一到达就优先完成本地持久化，缩短这个窗口。

人工编辑使用独立 CAS：`saveBlueprint({analysisId,expectedRevision,expectedRunGeneration,document})`。主进程不接受调用者自定的新 revision，而是验证当前 revision 后分配 +1。两个窗口以 r3 同时保存时只能一个得到 r4，另一个返回 `VIRAL_BLUEPRINT_CONFLICT` 与最新 revision。UI 保留未保存草稿以便比较，不能以最后写入覆盖前者。

首期只允许对已完成、未归档记录编辑蓝图；暂停 / 运行中的部分结果只读。这样后台分析不会和人工编辑竞争同一蓝图。确需重新深度分析时创建新分析记录，并复制必要输入；首期不做跨版本语义自动合并。蓝图保存不改变 `runGeneration`；改新稿提升 `scriptRevision`，使相关 alignment / resolved timeline stale。

## 7. SQLite、JSON 与迁移

M1 只扩展 `viral_analyses`，不为每一帧 / 事件建表。M2 的工程操作收据表见第 12 节。拟通过现有 `addColumnIfMissing` 增加：

| 列 | 用途 |
| --- | --- |
| `source_json TEXT NULL` | 来源判别与托管媒体身份；旧记录按 url/platform 在读取时补出 URL 来源 |
| `reference_path TEXT NULL` | 当前整体拆解 manifest 的受管相对路径 |
| `reference_revision INTEGER NOT NULL DEFAULT 0` | 整体拆解人工修订的 CAS；0 表示未发布索引 |
| `reference_content_hash TEXT NULL` | 当前 manifest 完整性校验，分页 cursor 绑定它 |
| `reference_run_generation INTEGER NULL` | manifest 所属有效分析代号 |
| `blueprint_path TEXT NULL` | 当前可编辑蓝图的受管相对路径，由主进程生成 |
| `blueprint_revision INTEGER NOT NULL DEFAULT 0` | CAS；0 表示尚未产生蓝图 |
| `blueprint_content_hash TEXT NULL` | 读取完整性校验 |
| `blueprint_run_generation INTEGER NULL` | 蓝图来自哪个有效分析代号 |

运行 checkpoint 继续存 `checkpoint_json`，不再加另一张分析状态表。整片证据与覆盖清单分页保存在不可变 JSON；基础报告引用 `referenceAnalysisRef/hash`，复刻请求产生的蓝图再增加 `replicationBlueprintRef`，记录它当时生成的 revision / hash / schemaVersion。最新人工编辑通过 `viral:get-blueprint` 读取。**不可把旧报告引用与当前可编辑蓝图当成同一个实时对象**，从而避免人工保存每次都重写整个结果文件。

蓝图 JSON 以 `blueprints/blueprint-r<nextRevision>-<hash>.json` 不可变保存，写盘成功后在同一 `enqueueCommit` 中检查 generation / revision / 归档状态并更新指针。CAS 不成立时不发布新指针；该文件是可安全回收的孤立文件。DB commit 失败不删除旧版、不覆盖旧文件。应用重启只相信 DB 当前指针，不能按文件名最大 revision 猜当前版本。

整体拆解的人工编辑也有独立 CAS。首次生成 manifest 的 reference_revision 为 1；以后 `save-reference-edit` 只写受影响分片、新覆盖/关系摘要和 manifest-r<n>-<hash>，在同一串行提交中校验 `expectedReferenceRevision + expectedRunGeneration` 并更新 reference 指针。保留原始 detector/model 观察和 user 修订层，不能把修正后的值冒称原模型识别结果。镜头边界变化只重算相邻镜头和跨边界关系；付费再观察为显式独立操作。当前 blueprint 仍引用旧 manifestRevision 时显示“来源有更新”，不自动改新稿或导演工程。

编辑操作采用判别联合，例如 `adjust-shot-boundary / split-shot / merge-shots / correct-text / upsert-track-event / review-interpretation`；单次最多 100 项且请求不超过 256 KiB，主进程拒绝任意字段路径或文件路径。运行中的未完成分片只读；已完成、未归档结果允许修订。失败重试不覆盖已发布的人工修订，需要新分析结果时另建记录。完整拆解索引/分片变化后旧 cursor 明确过期，UI 保留稳定选中 ID 并重新取页。

新版报告 / 蓝图写入和读取前均做实际 UTF-8 byte 长度限制；蓝图先限 2 MiB，报告继续 8 MiB，每个证据 / coverage / index 分页也限 2 MiB。checkpoint 仍为 2 MiB，事件 data 继续现有 256 KiB 限制。到达页面上限就创建下一页；根索引过大也分页，不截断整片逐字稿、镜头或事件。JSON 中不内嵌图片或音频，不向历史列表传完整文档。

迁移规则：

- 旧数据库列使用默认 / null，不启动批量模型任务、不重写所有结果、不改变旧记录状态。
- 旧报告无 `schemaVersion` 时经 legacy reader 校验后返回；没有蓝图时报告仍可保存模板、创建普通任务。“生成复刻工程”显示需先建立蓝图，不编造镜头事件。
- 旧 checkpoint 可导入 v2 的 source/extract/transcribe/frame 完成单元；存在的文件需要校验。旧帧摘要继续作为 quick 结果，不能自动视作 deep 多帧观察。
- 新版未知 schemaVersion 只读报出“版本不受支持”，不尝试按 v1 强行解析或降级覆盖。
- 数据库备份 / 导出会包含新增列；JSON 文件跟随现有受管目录备份。仅导出 DB 不宣称已包含媒体工程。
- 暂不做蓝图版本浏览器、无限自动快照或跨记录全局内容寻址仓库。有效历史版本保留到记录清理；未被 DB / checkpoint 引用的临时文件仅在对应记录非 active 且确认归属后回收。

## 8. 归档、删除与已导出工程

沿用现有历史语义：运行中不能归档 / 删除；先归档才能永久删除；归档后读取仍可用、业务写入拒绝；恢复解除归档但不启动模型；已 tombstone 的 ID 不能通过保存 / 恢复复活。

新增导入、保存蓝图、解析时序、导出工程也必须获得该记录的 activity reservation。删除开始前不能只检查 `runningViralAnalyses`：它还需排斥本次保存 / 导出正在进行的文件操作。归档 / 删除与这些操作统一沿用 `historyActivityRegistry`。

删除目标只能从 `managedStorageKey` 导出，经现有 quarantine 机制一次删除该记录的 source/evidence/units/results/blueprints/derived；任何 JSON 内部引用的 path 都不能成为额外递归删除目标。原始导入文件不删除。

导出的 `EditorialCollagePipelineData` 工程应拥有生成所需素材的独立副本，不能引用即将可删除的 viral 临时帧路径。导出时复制成功且项目保存完成后，才记录 `sourceAnalysisId + blueprintRevision + contentHash` 作为溯源元数据。删除分析记录不级联删除该工程；工程仍能预览 / 导出，回看原片证据则显示“来源分析已删除”。恢复已归档分析不要求重建工程。

## 9. 拟新增 API 与现有 API 的改动面

以下均为方案接口，实施时要一次同步主进程、preload、API 清单、IPC schema 与 browser fallback；不能只加一个 `ipcMain.handle`。

| 接口 | 参数 / 返回 | 行为 |
| --- | --- | --- |
| 现有 `viral:create-and-run` | 在 settings 增加 mode/profile/budgetPolicy，其他不变 | URL 模式保留域名 / HTTPS 检查；deep 先完成下载 / 整片扫描 / 预算预检，在已有预算授权内执行或暂停待扩预算 |
| 拟新增 `viral:import-local` | `{title?,settings}` → `{cancelled:true}` 或 `{cancelled:false,analysisId,durationMs,mediaId,delta}` | 原生选文件、复制到受管目录；返回暂停的待分析记录 |
| 拟新增 `viral:analyze-prepared` | `{analysisId,settings,budgetPolicy}` → `{analysisId,delta}` | 仅允许具备完整托管来源、尚未模型分析的记录；启动整片分析，不以选段规避片长 |
| 拟新增 `viral:get-analysis-plan` | `{analysisId}` → `{planRevision,inputHash,scope,totals,budget,coverageSummary}` | 返回完整覆盖与请求计划摘要，价格未知项单列 |
| 拟新增 `viral:continue-analysis` | `{analysisId,expectedPlanRevision,budgetExtension?}` → `{analysisId,delta}` | 依据持久化已耗费 / 保留费用增量继续；不重置请求计数，也不覆盖旧计划 |
| 拟新增 `viral:get-reference-part` | `{analysisId,manifestHash,cursor?,track?,limit?}` → `{items,nextCursor,coverage}` | 分页读取镜头、逐字稿或各轨事件；cursor 绑定 manifestHash / track，拒绝跨版本拼页 |
| 拟新增 `viral:get-reference-index` | `{analysisId}` → `{manifest,revision,hash,editable,coverageSummary}` | 读取当前人工修订；分析报告的原始 ref 保持生成时快照 |
| 拟新增 `viral:save-reference-edit` | `{analysisId,expectedReferenceRevision,expectedRunGeneration,edits[]}` → `{revision,hash,changedPartIds,diagnostics}` | 只接受已定义的镜头边界/文字/事件/解释编辑操作；写变化分片与新 manifest 后 CAS 发布；不覆盖原始模型证据 |
| 拟新增 `viral:export-reference` | `{analysisId,expectedReferenceRevision,format:'markdown'|'json'|'csv'}` → `{cancelled?,exportId?,outputPath?}` | 主进程选择保存位置，按当前修订导出整体报告/结构化数据/镜头表；不调用模型、不要求新稿 |
| 拟新增 `viral:media-url` | `{analysisId,mediaId}` → `{url,mime,durationMs?}` | 只读本记录清单媒体；支持 Range / seek |
| 拟新增 `viral:get-blueprint` | `{analysisId}` → `BlueprintReadResult` | 返回当前蓝图、revision、hash、只读原因；未请求复刻可无蓝图，不意味着整体分析未完成 |
| 拟新增 `viral:create-blueprint` | `{analysisId,expectedReferenceRevision,brief,acceptedCostPlanId,idempotencyKey}` → `{operationId}` | 用户进入复刻才启动新稿/蓝图生成；独立 operation，不提升已完成整体分析的 runGeneration；晚回结果检查来源修订 |
| 拟新增 `viral:save-blueprint` | `{analysisId,expectedRevision,expectedRunGeneration,document}` → `{revision,hash,document}` | 主进程重新校验并 CAS，document 总量 ≤2 MiB |
| 拟新增 `viral:reanalyze-deep` | `{analysisId}` → `{newAnalysisId,delta}` | 从完成报告新建 deep 记录，复用合格输入副本；不覆盖原蓝图 |
| 现有 `viral:get-result` | 返回兼容基础报告、coverageState 与新版 ref | 完成报告仍校验 `resultGeneration === runGeneration`；运行中的只读部分证据由分片 API 读取，不冒充完成结果 |
| 现有 `viral:retry/update-status` | 签名不变 | 恢复失败单元，校验 inputHash；不会重置人工蓝图 |

`BlueprintReadResult` 拟为 `{document: ViralReplicationBlueprintV1 | null, revision:number, contentHash:string|null, editable:boolean, unavailableReason?: 'legacy-no-blueprint'|'analysis-incomplete'|'archived'|'unsupported-version'}`。损坏文档使用明确错误而非返回 null，防止误导用户为“从未创建”。

`analyze-prepared` 在同一数据库串行提交中更新待分析记录的 settings / 初始预算与 plan revision，再调用已有 begin-run 流程。只允许“source / 本地扫描已完成、付费分析尚未启动”的 prepared 记录。`continue-analysis` 仅延长已冻结计划的预算或启动明确的增量补证据计划；改变模型 / 采样配置必须计算受影响单元，不能任意覆盖运行中 / 已人工编辑结果。

工程预检 / 导出与对齐接口由工程适配方案统一定义；本文件不再另起一套 production-task 入口。原 `viral:create-production-task` 与模板保存保留现行用途。

## 10. 实施文件与可独立评审的提交顺序

| 提交包 | 拟改 / 新增文件 | 可评审结果 |
| --- | --- | --- |
| D1 数据与兼容 | 新 `src/shared/viral-replication-contract.ts`；现有 `types.ts`、`viral-analysis.ts` | 旧报告可读；新蓝图拒绝坏时间、坏引用、未知版本 |
| D2 托管本地输入与回放 | 新 `electron/viral-replication-service.ts`；`electron/main.ts`、`html-video-runtime.ts`、`managed-history-paths.ts`、`viral-runtime.ts` | 选文件产生可恢复受管副本；独立媒体 ID 回放 |
| D3 整片扫描与逐单元分析 | 新 `src/shared/viral-deep-analysis.ts`；`viral-analysis.ts`、`viral-runtime.ts` | 整片逐轨覆盖清单、分批有界输入、连续视音频能力路由、跨块边界合并、完成单元立即 checkpoint |
| D4 蓝图持久化 / CAS | `src/shared/storage.ts`、服务文件、`electron/main.ts` | 不可变 JSON 与 DB 指针；归档 / 删除互斥；人工编辑冲突可见 |
| D5 IPC 完整接入 | `src/shared/storydream-api.ts`、`ipc-contract.ts`、`electron/preload.ts`、`src/app/browser-fallback.ts` | API 清单一致；浏览器模式返回明确能力限制或受控 fixture |

本期不修改 Python 下载器来承担视觉语义分析；`viral-media-worker.py` 继续下载职责。FFmpeg 本地扫描在现有有界进程执行器内实现，取消时终止进程树。

## 11. 必须写入后续实施计划的验收

以下是计划中的测试，不是本轮执行结果。

| 测试接点 | 必须覆盖的场景 |
| --- | --- |
| 新 `tests/viral-replication-contract.test.ts` | 秒转毫秒只做一次；所有引用存在；空 / 重复 ID；越界时间；各轨 present/absent/unknown 不混淆；中文夹英文 / 数字 / emoji；重复词锚点；无时间戳不得生成可信词时序 |
| `tests/viral-analysis.test.ts` | quick 不增加模型调用；deep 每批 ≤16 单元、64 帧 / 64 图像引用，整片超过一批仍完整覆盖；预算暂停不删除后半片单元；超过 16 镜头、长镜头跨块、字幕跨块、整片汇总保留尾部关键证据；兼容旧出口 |
| `tests/viral-runtime.test.ts` + 新 `viral-deep-analysis.test.ts` | 低层全帧扫描与快切候选；250 ms 内两次切镜不被合并丢失；无音轨 / 有音乐无语音 / 多说话者；帧模型不可报完整动作路径；音频模型缺失显式缺口；分块 ASR 时间偏移与去重；损坏视频 / 取消；JSON 校验与预算 |
| `tests/viral-contracts.test.ts` | 第 4 单元失败后前三个不再请求；旧 generation 晚回不覆盖新任务；断电窗口只有可验证完成单元复用；运行中编辑拒绝；人工 r3 冲突；改稿使时序 stale |
| `tests/storage.test.ts`、`storage-reliability.test.ts` | 旧 DB 增列；DB 提交失败保留旧指针；孤立文件不自动成为当前版；整片长文本 / 镜头超过分页体积仍无丢失；损坏 / 未知 schema；2/8 MiB 真实字节上限；分页 cursor 绑定版本 |
| `tests/history-governance.test.ts`、`history-managed-paths.test.ts`、`history-activity-registry.test.ts` | 本地原文件不删；删除与导入 / 保存 / 导出互斥；归档只读；恢复不重跑；tombstone 不复活；链接 / junction / 跨记录 mediaId 不能越权 |
| `tests/ipc-contract.test.ts`、`electron-ipc-contract.test.ts`、`ipc-inventory.test.ts` | 所有新增 invoke channel 有 schema、preload、API 清单与 fallback；禁止任意路径进入 media-url；拒绝额外字段和过大文档 |
| 后续真实 Electron QA | 中文本地文件名、MOV 旋转、无声 / 纯音乐 / 对话 / 快切 / 图文动画；一条明显长于 120 秒且超过 16 镜头的全片；逐轨首尾与接缝回放；中途预算暂停 / 关机后继续；归档恢复；删除分析后已导出工程仍可渲染；另验收 20–30 秒复刻样片 |

本层完成的首要出口是：**有完整覆盖清单、各轨证据状态可核对、逐镜头可回看的整片拆解报告**。用户继续复刻时，再生成可修订、稳定语义 ID 的蓝图及受管素材。整体拆解不等于已经还原原始剪辑工程；后续生成仍需把新配音对齐结果解析为新片时间，交给现有 Editorial 工程。

## 12. M2 运行快照、配音清单与请求收据

类型仍集中在 `viral-replication-contract.ts`。以下给出上一节到工程层之间必须补齐的最小数据，不另建完整工作流引擎。

| 对象 | 必需字段与约束 |
| --- | --- |
| `ReplicationNarrationBinding` | `segmentId, effectiveTextHash, assetVersionId, audioSha256, durationMs, sourceRangeMs, alignmentRef, alignmentHash, alignmentRevision, timingQuality`；quality 区分 provider-word/forced/manual/estimated/missing，不能用句级 SRT 冒充逐词 |
| `ResolvedReplicationTimelineV1` | `schemaVersion:1, variantId, blueprintRevision, effectiveScriptHash, narrationBindings[], resolverVersion, fps, inputHash, segmentPlacements[], events[], unresolved[]`；每段保留局部词证据与新片全局起点 |
| `ReplicationProductionPlanV1` | `id, schemaVersion:1, analysisId, blueprintRevision/hash, runGeneration, variantId, effectiveScriptHash, compilerVersion, renderConfig, narrationBindings[], resolvedTimelineRef/hash?, assetManifest[], bindingMap[], diagnostics[], requestPlan[], inputHash`；冻结快照，不在派发时再读取最新选择 |
| `ReplicationRequestReceipt` | `id, operationId?, analysisId?, batchId?, unitId/nodeId, inputHash, ownerGeneration, receiptRevision, providerId, modelId, idempotencyKey?, attempt, status, remoteRequestId?, estimatedUpperBound?, reservedCost?, actualUsage?, actualCost?, pricingRef?, startedAt, updatedAt, rawResponseRef/hash?, outputRef/hash?`；不含凭据；当前执行权由持久化代号 / revision 和单实例 reservation 一起约束 |
| 请求状态 | `planned → reserved → submitting → running → completed/failed`；旁路状态 `outcome-unknown/cancel-requested/cancelled`；缺可查远端 ID 的中断不能凭超时自动变 completed/failed |
| 成本计划 | `currency, priceSnapshotAt, maxKnownCost?, maxRequestsByKind, consumed, reserved, unknownPriceNodes[]`；计数累积跨恢复 generation；只有可证实未接收/未计费的请求可释放对应保留额度 |

M1 的分析调用收据索引存在 checkpoint，按批次分页，其内容保存为不可变小文件并经 DB checkpoint 提交。必须先持久化 planned → reserved → submitting，再发送上游请求；已生成 requestId 的异步请求立即持久化。恢复时，submitting / running 没有可核验完成结果则进入 outcome-unknown；先查询 provider 的原请求，只有 provider 明确支持且保证对应语义时才可使用原 idempotencyKey 重放，不能假设所有 OpenAI 兼容接口都支持去重。缺查询能力时由用户明确接受可能重复计费后创建新 attempt，绝不自动重发。

响应已写入独立 receipt 文件、但 checkpoint 索引提交前崩溃，是一个需要专门处理的窗口：submitting 收据预先记录该 attempt 唯一的 responseRef 位置。恢复只检查该已知位置，做 hash / inputHash / requestId 校验，成功后补提交；不能遍历目录选择“最近一个响应”。响应自身尚未落盘的窗口仍不可消除。旧 generation 晚回只允许补写它预先拥有的 append-only 收据槽，不得提升当前单元或预算状态；新 generation 在既定恢复步骤中接收该结果。

M2 的生成节点继续显示为 `ProductionProviderJob`，而精细收据放在任务受管目录并由工程 operation 引用。现有 [production-workflow.ts](/I:/opc/src/shared/production-workflow.ts:43) 和 [editorial-collage.ts](/I:/opc/src/shared/editorial-collage.ts:212) 只有 queued/running/completed/failed/cancelled，且 `estimatedCost` 为必填数值：**不能直接写入 reserved/outcome-unknown 或以 0 代表未知价格。** 最小扩展是在 job 添加 `receiptId/receiptHash/requestOutcome?/costEstimateStatus?`，完整状态以收据为权威；如需要 job 新状态，必须同步 TS、Zod、持久化、UI 与所有分支。未知价格应允许明确 missing/unknown 值或独立字段，旧 job 兼容；不能靠类型断言绕过 strict schema。分析收据不塞进有历史数量上限的 providerJobs 数组。

请求预算在 reserved 时占用名额和已知最大成本；received/completed 时结算实际用量，有响应但校验失败仍计费。failed / cancelled 不自动释放额度，只有可证实未提交或上游确认未计费才释放；用户停止等待不代表远端已取消。货币分别累积，未记录汇率时不能把不同币种相加。因 unknown-price 节点不能给出可信金额上界时，仍显示请求数 / 音视频分钟硬上限和未知项，而不声称总费用保证。

M2 新增 `viral_replication_operations` 表保存工程创建/更新/对齐的幂等收据，建议列：

```text
id TEXT PRIMARY KEY
kind TEXT                  # blueprint | plan | create | update | align | restore
analysis_id TEXT NULL      # 仅溯源，不设置删除来源时级联删除
target_task_id TEXT NULL
idempotency_scope TEXT
idempotency_key TEXT
request_hash TEXT
status TEXT                # prepared | running | completed | failed | outcome-unknown | cancelled
revision INTEGER           # operation CAS；不是蓝图 revision
owner_generation INTEGER   # 防止恢复前 worker 的晚回提交
staged_task_id TEXT NULL
staged_storage_key TEXT NULL
snapshot_path TEXT NULL
snapshot_hash TEXT NULL
receipt_index_path TEXT NULL
receipt_index_hash TEXT NULL
result_json TEXT NULL
created_at TEXT
updated_at TEXT
UNIQUE(idempotency_scope, idempotency_key)
```

同幂等键同 request_hash 返回原操作/工程；同键不同请求返回冲突。scope 由主进程依据来源 / 目标与操作类型生成，不让 renderer 任意拼接。request_hash 使用规范化输入、蓝图 hash、变体、编译器及渲染设置，不包含当前时间、凭据或临时路径。claim 操作以 expectedRevision / ownerGeneration 条件更新并递增，配合 activity reservation 防止双击和旧运行晚回取得同一节点执行权。

创建工程最终提交必须将 task 文档、task 事件与 operation 完成状态在同一数据库持久化提交写入。现有 [storage.ts](/I:/opc/src/shared/storage.ts:876) 使用 sql.js 内存快照、串行 `enqueueCommit` 与原子数据库文件写入；因此必须新增**一个专用 FileDatabase 方法**，在同一 callback 中执行 insertTask、工程文档更新、事件插入和 operation 更新。不能先调用公开 `createEditorialCollageTask`，然后再单独 update operation 并声称原子。callback 内不做异步文件复制或外部调用。

文件与数据库无法共享真正原子事务，按发布顺序解决：prepared operation 先持久化随机 staged_task_id / staged_storage_key 与源快照 hash；将输入和媒体写到该明确拥有的目标目录，逐个校验并发布不可变 manifest；最后做上述单次 DB commit，把 target_task_id 关联并置 completed，此时才向 UI 发布工程。DB 前崩溃可依据 operation 指定位置核验并继续，不重建另一份任务；DB 后崩溃时重复请求返回已有 task。任务保存前失败只留下受管 staging，不能显示半成品，也不能通过扫描最大编号目录猜成功。

新建前的计划与源分析共同受 activity reservation 保护；跨来源 / 目标操作按稳定键顺序取得 reservation，失败释放已经取得的项，不能嵌套重复预留同一记录。工程创建成功时把蓝图来源快照、实际使用的证据分片、素材和计划复制到任务自己的托管目录；之后对齐 / 渲染 / 历史回退的收据从任务读取，分析删除不损坏这些操作。

待创建 operation 无 target_task_id 不代表可以直接删 staged_storage_key：必须确认 operation 终止、没有 active reservation、没有任务使用该 key，并用现有受管目录身份 / quarantine 规则清理。先终止远端请求或保留 outcome-unknown 提示与收据，再回收本地文件；不能删来源记录时让一个仍在运行的创建继续发布工程。已关联任务的 operation 由任务生命周期清理，删除来源只去掉可选外部回看能力；其独立快照和计费收据仍在目标任务内。

M2 针对收据至少增加以下故障注入：预留后未发请求、提交后未收到 ID、收到响应后索引提交失败、两次相同 create 请求、相同幂等键不同参数、复制后 DB 持久化失败、DB 成功后返回丢失、旧 owner 晚回、来源删除与目标提交竞争、价格未知 / 多币种 / 远端取消不确定。每例都核对是否重复付费、是否出现两份 task、当前指针是否指向完整文件；仅验证 schema roundtrip 不足以证明恢复可用。

诊断至少区分 `invalid-source / unsupported-capability / invalid-output / stale-input / edit-conflict / budget-exhausted / missing-asset / alignment-needed / transient-not-submitted / outcome-unknown / cancelled`。持久化内部代码，界面转换成具体步骤和恢复动作，不直接展示堆栈。
