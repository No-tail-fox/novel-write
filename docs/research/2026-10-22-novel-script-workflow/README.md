# 小说到 AI 漫剧剧本：后台批量工作流调研

调研日期：2026-10-22  
范围：StoryDream 当前 AI 漫剧源码、已固定的 GitHub 源码提交、桌面应用的后台任务与审核交互。

## 本轮落地状态（2026-10-22）

已按下文固定提交中的成熟流程，完成“已保存源分集 → 后台批量剧本 → 集中审核 → 显式批准 → 独立分镜 → 审核应用”的产品闭环。阶段划分参考 Toonflow，持久任务与恢复参考 Jellyfish、wind-comic；实现沿用 StoryDream 的 Electron、SQLite 和现有组件，不引入它们的完整服务栈，也不复制受限项目的源码、界面或提示词。

| 范围 | 当前状态 |
| --- | --- |
| 集级任务、候选剧本、批准版本、分镜候选独立持久化 | 已实现；SQLite 原子写入，版本绑定批准 |
| 已保存源分集的剧本批量提交 | 已实现；去重、源顺序串行、暂停/恢复、取消和失败重试 |
| 页面切换、应用重启 | 已实现；主进程持有任务，完成候选保留，中断文本任务重新排队；不承诺供应商不重复计费 |
| 剧本工作台 | 已实现；分集筛选、原文证据、场次/对白编辑、草稿恢复、逐集/批量批准 |
| 批准后独立生成、审核并应用分镜 | 已实现单集闭环；允许第 2 集先应用，保留源集号，不覆盖已有制作 |
| 原文自动分集、系列 Bible 自动生成 | 原文边界规划仍沿用现有入口，尚未统一迁入持久后台编排；不宣称整条链路自动化 |
| 分镜批量调度、全局任务中心 | 尚未完成；任务当前在项目剧本工作台查看 |
| 真实小说改编质量及远程成片恢复 | 尚未实测；本轮是离线流程验收，不是可播放样片或模型质量验收 |

验收：7 个相关测试文件共 **175 项通过**，renderer/Electron 类型检查与构建通过；生产 Electron 的深浅主题 × 1536×1024 / 1040×720 四组界面验收通过。详细证据、运行命令和未验证边界见 [验收记录](acceptance.md)。

## 结论先行

你的判断基本正确：**小说改编不应该以“打开一个弹窗，等待当前一集生成完成，再手动确认并继续下一集”作为主流程。**

但需要把“拆分”拆成不同的业务阶段，否则会把两个问题混在一起：

1. **原文分集**：识别章节、按剧情边界把完整小说划分为第 1 集、第 2 集，并保留原文起止范围。
2. **改编剧本**：把每集原文改写为可拍摄剧本，包含角色、场景、对白、旁白、动作、节拍和前后状态。
3. **制作拆解**：把正式剧本拆成场次、镜头、参考图、对白音频和视频制作单元。

完整的成熟目标流程是（下文各阶段包含尚未实现的后续范围）：

> 导入并持久化小说 → 后台分析与分集 → 后台批量生成分集剧本 → 前台集中审核与编辑 → 批量生成分镜 → 审核后生成图片、视频、配音和合成。

这里的“后台”不是指电脑关机后仍然生成。对桌面应用，后台应至少意味着：关闭弹窗、切换页面后任务继续；退出应用后能够根据已落盘的任务状态和 checkpoint 恢复；关机期间不能继续计算，也不能假装任务已经完成。

自动生成也不等于自动批准。剧本可以批量生成，不能绕过审核直接触发图片、视频和配音等付费媒体任务。

## 改造前实现为什么让人感觉不对

本节记录调研时的基线问题，不是改造后的行为。已保存源分集的项目现已改用后台剧本工作台；没有源分集的历史项目保留旧规划入口。

### 1. 原有“AI 分集”不是“生成剧本”

相关代码：

- [MotionComicPage.tsx](../../../src/features/motion-comic/MotionComicPage.tsx)
- [motion-comic-episode-planning.ts](../../../src/shared/motion-comic-episode-planning.ts)

`planMotionComicEpisodes()` 主要做的是：

- 将完整原文切成稳定的原文单元；
- 让模型选择每集的 `startUnitId` 和 `endUnitId`；
- 输出标题、分集理由和连续性钩子；
- 根据边界重新拼回每集原文；
- 对超长文本按批次请求，但当前仍由前台调用方顺序等待。

这是“原文分集”，不是把小说改编成正式剧本。它可以成为后台第一阶段，但不能把完成它后的状态文案写成“剧本已生成”。

### 2. 真正的剧本生成被放在逐集弹窗里

相关代码：

- [MotionComicPlanDialog.tsx](../../../src/features/motion-comic/MotionComicPlanDialog.tsx)
- [motion-comic-planning-service.ts](../../../electron/motion-comic-planning-service.ts)
- [motion-comic-planning.ts](../../../src/shared/motion-comic-planning.ts)

改造前的主路径是：

1. 用户选择一个源分集；
2. 打开规划弹窗；
3. 前台等待 `api.planMotionComic()`；
4. 生成并在弹窗中审核剧本；
5. 用户确认后再次请求分镜；
6. 用户应用结果后才写入正式 episode。

弹窗在 `busy` 或 `applying` 时禁止关闭。虽然服务已有单项目并发保护、失败草稿、成功 checkpoint、原子写入、输入绑定和七天恢复，但这些能力是**单次前台请求的恢复保护**，还不是一个可观察、可调度、可批量恢复的多集后台工作流。

### 3. 后一集被错误地锁在前一集的全部制作之后

相关代码：

- [motion-comic-planning.ts](../../../src/shared/motion-comic-planning.ts)
- [MotionComicScenesPanel.tsx](../../../src/features/motion-comic/MotionComicScenesPanel.tsx)
- [MotionComicWorkflowPanels.tsx](../../../src/features/motion-comic/MotionComicWorkflowPanels.tsx)

`nextUnplannedMotionComicSourceEpisodeId()`、`openPlanDialog()` 和 `applyMotionComicPlan()` 原先要求必须先完成前一集的结构化。这个约束把连续性问题处理成了用户操作顺序问题：第 2 集不能开始，直到第 1 集的流程被用户推进到前面若干步骤。本轮已解除生成与应用路径中的前集制作硬锁，生成顺序改由后台队列管理。

合理的约束应是：

- 系列级人物表、世界观、画风规则和分集大纲冻结后，可以批量排队；
- 默认按集顺序生成剧本，使前情摘要稳定；
- 第 2 集只需要第 1 集的机器生成或已确认剧本摘要，不应等待第 1 集分镜、图片、视频和配音全部完成；
- 用户可以单独重试失败集，不必重跑整季；
- 如果用户修改前集正式剧本，应标记受影响的后续剧本为过期，而不是静默覆盖。

## GitHub 成熟方案对照

以下链接均指向此前核查的固定提交。它们证明的是源码中的流程和任务设计，不等同于已经验证了远程模型的画质、人物连续性或不重复计费恢复。

| 项目 | 固定提交与许可证 | 可借鉴的部分 | 不应误读的部分 |
| --- | --- | --- | --- |
| [Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app/tree/d2e94aca7b59659ff6b4ca15f03cf134ec7f0e1d) | `d2e94aca`，当前核查为 MIT | [source/script 工作流](https://github.com/HBAI-Ltd/Toonflow-app/blob/d2e94aca7b59659ff6b4ca15f03cf134ec7f0e1d/packages/skills/workflow/references/sourceAndScript.md)把源文、故事骨架、改编策略、逐集剧本、导演规划、资产抽取、分镜和媒体分阶段；制作 Agent 读取正式剧本 | skill/reference 主要是工作规范，不自动证明有可靠队列；旧提交许可不能套用到当前提交 |
| [Jellyfish](https://github.com/Forget-C/Jellyfish/tree/a9678194ddf2d9be3ccbe78d4287d87d5089e123) | `a9678194`，Apache-2.0 | [task store](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/core/task_manager/stores.py)和 [worker](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/services/script_processing_worker.py)展示持久任务、Celery worker、前端轮询、任务 ID、进度、结果、错误、取消和 active task 去重；分镜保留原文证据与实体 ID | 已读视频路径不能证明远端供应商 ID 在首次提交后立即落盘，也不能证明重启时绝不重复计费 |
| [wind-comic](https://github.com/ChrisChen667788/wind-comic/tree/7d0d3cf68b52c5ed7d00417e9bc1b59c3ec61806) | `7d0d3cf6`，MIT | 整季生成 API、每集前情输入、队列表、心跳、任务认领、失败重试、孤儿回收、阶段 checkpoint；默认串行并支持有界并发 | 队列需显式开启；关闭队列时是进程内 fire-and-forget；长篇拆分接口不是完整小说改编，前端 season batch 也不等于后台剧本 worker |
| [ArcReel](https://github.com/ArcReel/ArcReel/tree/200674feb06a9954a49a05181912bc0b06dcc16e) | `200674fe`，AGPL-3.0 + NOTICE 要求 | [产品流程](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/PRODUCT.md)和 [上下文状态](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/CONTEXT.md)将 `segments / scenes / shots / video_units` 分层；计划、正式剧本、资产、分镜和视频单元分别持久化 | 只借鉴流程和契约思想，不复制源码、界面或提示词；许可不适合未经评估直接并入产品 |
| [Huobao Drama](https://github.com/chatfire-AI/huobao-drama/tree/575790caad0d0ed5346bdbe5a202ac6a3d02ee0) | `575790ca`，CC BY-NC-SA 4.0 | `script_rewriter → extractor → storyboard_breaker → prompt_generator`；LLM 做决策，工具负责受约束写入；先抽取角色、场景、道具，再绑定稳定 ID | 非商业许可；批量重建分镜前会清理旧内容的做法不能直接用于有人工修改和付费媒体的项目 |
| [waoowaoo](https://github.com/waooAI/waoowaoo/tree/6cbbe22cc6492159e0f649d507e4e21a9aec3074) | `6cbbe22c`，Elastic License 2.0 | Temporal Activity、心跳、checkpoint、输入指纹、步骤唯一键；把基础设施重试和新业务尝试区分；显式记录参考图类型与模型能力 | 不宜直接复制整套 Temporal/服务栈；当前许可并非 MIT/Apache；仍不能证明所有供应商请求都具备远端幂等 |

### 共同收敛出的成熟结构

这些项目虽然实现方式不同，但在产品结构上都接近以下顺序：

> 源文与素材导入 → 系列/资产定义 → 分集或故事骨架 → 逐集剧本 → 单集场次与镜头 → 角色/场景/道具定妆 → 分镜图或首尾帧 → 图生视频 → 配音字幕 → 合成导出。

特别重要的是，**计划、正式剧本、分镜、制作单元和媒体任务不是同一个对象**。把它们合并到一次 `applyGeneratedMotionComicPlan()` 中，会导致后台批量、人工审核、局部重做和版本失效都很难实现。

## 成熟目标流程与后续范围

本节保留完整目标规格，不应整体视为已经交付。当前已实现 B/C 和 D 的单集分镜审核闭环；A 的持久后台编排、D 的批量分镜与远程恢复仍有缺口，以上方状态表和验收记录为准。

### 阶段 A：导入与分析

导入完整小说后立即保存源文和指纹，前台只展示一个简短的配置入口：源类型、改编方式、目标集长、模型和是否生成系列设定。点击开始后，入口可以关闭，任务进入任务中心。

后台顺序：

1. 识别章节标题、段落和稳定原文单元；
2. 抽取人物、关系、场景、道具、世界规则和视觉规则；
3. 生成分集建议：标题、logline、原文范围、结束钩子、前情摘要；
4. 做连续覆盖校验，保证原文没有遗漏、重叠或被模型改写；
5. 保存为“分集计划”，而不是直接写入正式 episode。

原文分集失败时只需要修复分集计划，不应重新跑人物表和所有后续内容。

### 阶段 B：批量生成剧本

用户在“剧本工作台”点击一次“生成未完成剧本”，系统为每个分集建立独立任务。默认策略是**有序、低并发**：上一集剧本完成后生成下一集；系列 Bible 和分集计划冻结后，也可以配置少量并发。

每个分集任务至少生成并保存：

- 完整正式剧本；
- 场次与节拍；
- 角色对白、旁白、内心 OS、动作的类型；
- 角色和造型引用；
- 场景、道具引用；
- 每个节拍的原文证据 ID；
- 本集结尾状态和下一集可用的前情摘要；
- 模型、提示词版本、输入指纹和输出修订号。

剧本任务完成后进入 `script-review`，不能自动进入付费媒体生成。

### 阶段 C：集中审核

前台不再用生成弹窗承载长时间等待，而是展示一个剧本工作台：

- 左侧是所有分集和状态；
- 中间是当前集剧本、场次、对白和原文证据；
- 右侧显示角色/场景/道具、前情摘要和变更影响；
- 顶部提供“只生成未完成”“重试失败集”“暂停后续任务”“批量批准”；
- 每个集可以单独编辑、批准、重试或退回。

配置弹窗可以保留，但只负责“开始批量任务”和少量参数，不负责等待生成结果，也不应在 `busy` 时锁死整个界面。

### 阶段 D：审核后批量制作

只有 `script-approved` 的集才允许创建分镜任务。分镜生成也应该是独立队列，按镜头或制作单元保存 checkpoint。角色参考图、声音和模型能力检查应在付费提交前完成。

图片、视频、配音和下载任务再次分层；任何远程请求都需要区分：

- 已排队但未提交；
- 已提交且有远端任务 ID，可查询恢复；
- 提交结果未知，不能自动重试付费创建；
- 已完成，等待下载；
- 下载中断，可从已知字节范围续传；
- 已下载并通过校验。

## 建议的数据和状态模型

### 集级状态

每集独立保存状态，不要只从 `episodes[].scenes.length` 推导：

```text
source-ready
script-queued
script-running
script-ready
script-review
script-approved
script-stale
storyboard-queued
storyboard-running
storyboard-ready
failed
cancelled
```

`script-ready` 表示机器产物完成，`script-approved` 表示用户确认。两者必须分开。

### 独立的剧本产物

建议新增集级 `scriptArtifact` 或独立存储记录，而不是把机器结果直接写入正式 `MotionComicEpisode`：

```text
id
projectId
sourceEpisodeId
status
sourceFingerprint
seriesBibleVersion
previousEpisodeStateVersion
model / provider
promptVersion
inputSnapshot
outputRevision
scriptPayload
evidencePayload
checkpoint
taskId
error
retryCount
createdAt / updatedAt
approvedAt
```

正式 episode 只在批准后生成或更新。这样可以保留机器候选、人工版本和历史媒体，不会因重新生成覆盖用户内容。

### 任务记录

任务记录应按“项目 + 集 + 阶段”持久化，至少包含：

```text
taskId, projectId, sourceEpisodeId, stage
queuedAt, startedAt, heartbeatAt, finishedAt
status, progress, attempt
inputFingerprint, outputRevision
provider, model, remoteTaskId
checkpoint, errorCode, errorMessage
cancelRequested, retryPolicy
```

任务中心读取这些记录，而不是依赖当前页面的 React state。

## 连续性怎么做才对

不建议用“用户必须先完成上一集全部按钮”来保证连续性。应冻结并版本化：

1. 系列 Bible：人物、关系、世界观、画风和禁用规则；
2. 分集计划：每集原文范围、主线、结尾钩子；
3. 前集状态：角色位置、伤势、服装、道具持有、已知信息；
4. 角色/场景/道具资产版本；
5. 每集正式剧本的输入和输出指纹。

默认生成顺序：第 1 集剧本完成后生成第 2 集；第 1 集只要有稳定的机器或人工前情摘要，第 2 集就不必等待第 1 集分镜和视频。

当第 3 集剧本被修改时，影响分析只标记依赖它的场次、镜头和媒体过期；不重新生成已经独立批准且未受影响的第 1、2 集。

## 实施顺序

1. **先分离“分集计划”和“正式剧本”。** 保留现有原文边界校验，把当前 `applyMotionComicPlan()` 前的机器结果变为可持久化候选。
2. **增加集级任务和剧本产物记录。** 先用 Electron 主进程 + 本地 JSON/SQLite 实现，不引入 Celery 或 Temporal；做到任务重启可发现、状态可查询。
3. **实现按集批量编排。** 默认串行，有界并发可配置；支持暂停、取消、失败单独重试和未完成过滤。
4. **把现有规划弹窗改成启动配置入口。** 生成期间关闭弹窗不影响任务；页面切换到剧本工作台和任务中心。
5. **增加剧本审核和批准边界。** 未批准的剧本不能生成图片、视频和配音；批准后才创建分镜任务。
6. **再改分镜为独立批量任务。** 每场、每镜持久化，保留人工编辑和已有媒体。
7. **最后接远程媒体的提交、轮询、下载和断点恢复。** 远端任务 ID 必须在可确认时立即落盘；提交结果未知时转人工处理，避免重复计费。

不建议第一步就把现在的 `planMotionComic()` 在循环中调用很多次。那只是把前台弹窗换成前台循环，仍然缺少集级任务、恢复、版本、审核和媒体准入。

## 验收标准

用一部真实的 8–10 集小说，不先生成付费视频：

1. 导入完整原文后源文立即持久化；
2. 点击一次“批量生成剧本”；
3. 关闭弹窗、切换到其他页面，任务继续；
4. 返回任务中心能看到每集独立状态、进度、模型和错误；
5. 模拟中途退出应用并重启，已完成集不重跑，运行中集按 checkpoint 恢复；
6. 让第 4 集失败，只重试第 4 集；
7. 只修改第 3 集，不覆盖第 1、2 集已经批准的剧本；
8. 修改前集后，后续受影响集显示 `stale`，并说明原因；
9. 批量批准剧本后，才能批量生成分镜；
10. 未批准剧本不能触发图片、视频、配音等付费服务；
11. 生成记录能回溯到原文范围、系列 Bible、模型、提示词版本和输出 revision；
12. 任务取消、应用退出、网络失败和提交结果未知时不会静默标记为成功。

## 证据与边界

本报告引用的 GitHub 项目是流程和源码结构对照，不是对其成片质量的背书。尤其需要保留以下边界：

- 后台队列存在，不等于供应商远端任务可以无重复计费恢复；
- checkpoint 存在，不等于上传和下载支持完整断点续传；
- Agent skill 写了“连续性”，不等于实际模型能稳定保持脸、服装、口型和道具；
- 前端显示“完成”，不等于剧本已审核或媒体已经通过质量门；
- 批量生成只能解决调度效率，不能替代系列 Bible、资产版本、人工审核和成片抽检。

## 实现入口与后续落点

本轮新增和改造的主要入口：

- `src/shared/motion-comic-script-batch.ts`：任务、候选、批准和分镜的 schema 与版本授权契约。
- `src/shared/motion-comic-script-store.ts`：SQLite 持久化、去重、依赖指纹、人工修订和过期传播。
- `electron/motion-comic-script-batch-service.ts`：独立于页面生命周期的串行剧本 worker 与单集分镜 worker。
- `src/features/motion-comic/MotionComicScriptWorkspace.tsx`：批量提交、分集审核、草稿恢复与独立分镜审核应用。
- `MotionComicPage.tsx`、`motion-comic-planning.ts`、`motion-comic.ts`：页面接入、移除前集硬锁、源文绑定和乱序应用后的集号保持。
- `electron/main.ts`、`electron/preload.ts`、`src/shared/storage.ts`、`src/shared/ipc-contract.ts`：启动恢复、退出等待、原子存储与 IPC 接线。

已有动画成熟度报告仍记录 HTML、Vox 和 AI 漫剧的素材、对时、VLM 审查、远程参考图与恢复缺口：

- [动画成熟度总报告](../2026-10-20-animation-maturity/README.md)
- [工程拆分与验收标准](../2026-10-20-animation-maturity/implementation-plan.md)

本轮已实现最小的“集级剧本任务 + 独立剧本候选 + 剧本工作台 + 批准后单集分镜”闭环。后续应依次补齐原文分析/分集后台化、全局任务中心与分镜批量调度，再以真实小说和真实模型验收质量、远程提交与上传下载恢复，不能用本轮离线证据替代这些结果。工作区其余未提交改动不计入本次交付。
