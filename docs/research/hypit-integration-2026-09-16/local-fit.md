# 现有爆款拆解模块：外部视频分析能力接入位置

日期：2026-09-16。范围：只读检查当前工作区源码，没有调用模型、下载媒体或运行真实用户任务。本笔记只描述本项目，不判断尚未核实的 Hypit 功能。

## 结论

我们已具备“链接 → 下载 → 抽帧 / 转写 → 内容拆解 → 结构复刻 → 模板 / 生产任务”的闭环。值得补充的是按时间连续理解视频的证据层，而非另做一套下载器、账号系统或生产工作台。现有 `RunViralAnalysisOptions` 已通过 provider 注入各阶段，适合把外部能力包成可选分析器，再映射回本项目的结果与任务体系。

## 已有流水线与真实职责

1. **输入与任务管理。** 当前入口只收抖音、快手、B 站链接，支持自动识别平台、1–40 个抽帧目标、赛道、风格、比例和草稿模板；没有本地视频导入入口。入口为 [ViralAnalyzerPage.tsx](I:/opc/src/features/viral/ViralAnalyzerPage.tsx:147)，`CreateViralAnalysisInput` 只有 `url/platform/title/settings`，[types.ts](I:/opc/src/shared/types.ts:1802)。URL 限定 HTTPS、域名白名单且平台匹配，[viral-analysis.ts](I:/opc/src/shared/viral-analysis.ts:123)。
2. **媒体下载。** Python `viral-media-worker.py` 负责国内平台下载、Cookie 兜底、媒体校验与进程约束。它不是视觉分析 / 镜头切分程序。命令入口只构造 `download` 请求，[viral-media-worker.ts](I:/opc/src/shared/viral-media-worker.ts:51)，Python 平台分发见 [viral-media-worker.py](I:/opc/src/shared/viral-media-worker.py:331)。
3. **抽取与转写。** TypeScript runtime 调 FFmpeg 提取 16 kHz 单声道 AAC，并按视频总时长均匀选取帧，宽度 768；默认 8、最多 40 帧。并未使用场景变化检测。见 [viral-runtime.ts](I:/opc/src/shared/viral-runtime.ts:80) 与 [时间点算法](I:/opc/src/shared/viral-runtime.ts:140)。目前实际转写走配置的 OpenAI 兼容 / SiliconFlow 音频 API；文件中虽保留本地 faster-whisper 函数，当前 `transcribeViralAudio` 并不调用它，[viral-runtime.ts](I:/opc/src/shared/viral-runtime.ts:190)。
4. **关键帧理解。** 依次把“上一帧 + 当前帧”发给视觉模型，产出景别、构图、可见字幕、情绪、元素和中文生图提示词。[viral-runtime.ts](I:/opc/src/shared/viral-runtime.ts:470)。现行提示词明确要求“不要分析转场、滤镜、动效等后期效果”，虽然类型仍有 `cameraMovement/transition` 字段。抽帧只用文件 SHA-256 去掉完全重复的 JPEG，不是感知去重或镜头分段，[viral-analysis.ts](I:/opc/src/shared/viral-analysis.ts:534)。
5. **内容拆解。** 将转写文本与 `timestamp + visualDescription` 摘要交给文本模型，生成选题、标题 / 封面规律，以及开头、结构、结尾、爆点四项。这里没有传入音频特征、相邻帧运动或剪辑边界；原本有时间戳的转写在此被拼成纯文本。见 [viral-analysis.ts](I:/opc/src/shared/viral-analysis.ts:248)。
6. **再创作。** 第二次文本调用生成主公式、标题 / 封面 / 开头 / 结构 / 结尾子公式，标准提示词、人物 / 场景 / 冲突 / 转折 / 结果事实骨架、完整故事底稿，以及分镜建议。见 [viral-analysis.ts](I:/opc/src/shared/viral-analysis.ts:323)。既有提示词强调迁移结构、换新主题，不逐句或逐镜高仿。
7. **恢复与持久化。** 下载、抽取、转写、帧分析、内容拆解、再创作均有 checkpoint 和 runGeneration 防串代机制。[viral-analysis.ts](I:/opc/src/shared/viral-analysis.ts:162)，[main.ts](I:/opc/electron/main.ts:1867)。帧分析当前只在全部帧完成后写 checkpoint，中途失败不会保存已完成的单帧分析结果，[viral-analysis.ts](I:/opc/src/shared/viral-analysis.ts:222)。

## 结果契约与下游接点

| 契约 | 当前包含 | 接入时的意义 |
| --- | --- | --- |
| `ViralVideoSource` | 平台、原链接、下载来源、本地视频 / 封面、作者、时长、赞评转数字 | 保留我们已有下载和素材来源管理；互动数字不等于留存证据 |
| `ViralTranscriptSegment` | 文本、start/end、逐词时间戳 | 可承接外部 ASR，但无时间戳响应目前允许落为 `0,0` |
| `ViralFrameAnalysis` | 单帧 timestamp/path、构图 / 字幕 / 情绪 / imagePrompt | 可直接复用外部关键帧结果，但不能承载镜头起止、连续动作、音效与节奏 |
| `ViralContentBreakdown` | topic、title、cover、opening、structure、ending、viralPoint | 已有内容策略报告，不必重做；`evidence` 当前只是字符串数组 |
| `ViralRecreationDraft` | formula、templatePrompt、storyCore、storyContent、blueprint、script、storyboardHints、taskDefaults | 继续作为新创作与模板的统一出口 |

定义在 [types.ts](I:/opc/src/shared/types.ts:1871)、[types.ts](I:/opc/src/shared/types.ts:1902)、[types.ts](I:/opc/src/shared/types.ts:1950)。`ViralAnalysisResult` 将上述内容聚合，[types.ts](I:/opc/src/shared/types.ts:1983)。它目前没有 schemaVersion、分析器来源、模型版本、镜头级对象、时间证据引用、置信度、审核状态或人工修订字段。

**保存模板已是完整接点。** `createViralTemplateDrafts` 一次生成故事 `PromptTemplate` 和画面 `CustomStyle`，包含 review / rewrite / cover / storyboard / image-prompt 各步骤提示词；故事模板默认绑定提取出的画面风格。[viral-template-extraction.ts](I:/opc/src/shared/viral-template-extraction.ts:20)。分镜步骤复用本项目统一输出规则，而不是外部 schema，[viral-template-extraction.ts](I:/opc/src/shared/viral-template-extraction.ts:298)。两份模板在 DB 内原子保存，[storage.ts](I:/opc/src/shared/storage.ts:1976)。

**生成生产任务也是现成出口。** `createViralProductionTaskInput` 把 `storyContent/script` 作为普通 paste 任务正文，把 `storyboardHints` 拼进额外要求，并把关键帧提示词拼为 `imagePromptReference`。[viral-analysis.ts](I:/opc/src/shared/viral-analysis.ts:378)。Electron 创建任务后马上调用正常任务流水线，[main.ts](I:/opc/electron/main.ts:4088)。这不是把原视频镜头直接复制进分镜时间轴；源时间信息仅部分保留为字符串，普通 `StoryboardScene` 是新生成的 `id/cap/descPrompt/durationMs`，[types.ts](I:/opc/src/shared/types.ts:1444)。

**报告目前主要呈现文本。** 展示四项拆解、原文案、带时间数字的生图提示词、复刻稿和“保存为模板 / 生成新任务”。没有按证据点击回放源视频片段、连续镜头时间轴或人工镜头审核操作。[ViralReport.tsx](I:/opc/src/features/viral/ViralReport.tsx:53)。

## 对外部视频分析器最有价值的缺口

- **真实时间分段：** 场景 / 镜头起止、关键瞬间、连续动作和转场，而不是固定抽 8 张图。
- **图声文对齐：** 在同一时间段关联口播、画面字幕、动作、BGM / 音效变化；现有语音和帧在策略分析前被压成独立字符串。
- **可检查的拆解证据：** “0–3 秒为何是钩子”“第几秒反转”“什么镜头支撑判断”需要明确时间引用和原片回放；不能把模型给出的爆点分析当实际留存因果证据。
- **结构化迁移：** 给再创作阶段提供镜头功能、节奏预算、视觉关系，而非只有 `storyboardHints: string[]`。由我们继续生成新题材分镜。
- **稳健的数据边界：** 当前模型 breakdown JSON 是类型断言，最终结果文件也只是 `JSON.parse(...) as ViralAnalysisResult`，无完整运行时 schema 校验。[viral-runtime.ts](I:/opc/src/shared/viral-runtime.ts:48)，[main.ts](I:/opc/electron/main.ts:1212)。外部数据接入必须先校验、归一化，不能直接写入现有结果。

## 建议接法

先做独立的可选“深度视频分析” provider：使用本项目已下载的本地媒体，在 `extract / transcribe / analyzeFrame` 周围增加整体分析阶段；其输出归一到独立的、有版本号的时间证据契约，例如 `segments[{startMs,endMs,keyframeRefs,transcriptRefs,visualAction,narrativeRole,evidence}]`。字段是建议设计，不代表外部项目现成功能。

再通过适配器补充现有 `frames/contentBreakdown/recreation`，保留当前分析器作为快速模式与降级路径。`analyzeFrame` 的参数只有当前帧、前一帧和源元数据，若外部能力需要完整视频，不能仅替换这个函数就宣称接入完成。接口定义见 [viral-analysis.ts](I:/opc/src/shared/viral-analysis.ts:56)，provider 工厂见 [viral-runtime.ts](I:/opc/src/shared/viral-runtime.ts:30)。

首轮保持现有“保存模板 / 新建任务”不变，只让输出更有证据、节奏更具体；待同源视频对照验证有效，再让镜头功能结构进入分镜生成提示词，并在报告增加可定位的时间片段。需要一起升级 checkpoint、结果版本校验和 UI 媒体访问接口。无需搬入另一套账号、数据库、任务调度器或前端。

接入验收宜关注：同一素材下是否抓到固定抽帧漏掉的开场 / 转折，时间引用能否回看验证，中文转写与片段是否对齐，耗时 / 调用成本，失败恢复，以及新主题生成是否仍使用我们的 StoryboardScene 与模板规则。以上属于推荐验收，不是本次已运行结果。
