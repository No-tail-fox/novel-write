# 小说到剧本后台批量改造拆分

本文件保留完整实施规格；2026-10-22 已落地核心剧本闭环，未完成项在下表单列。详细测试、截图和证据边界见 [验收记录](acceptance.md)。

## 实施状态

| 工作项 | 状态与实际边界 |
| --- | --- |
| 数据层 | 已完成。任务、机器/人工候选、批准和分镜候选独立保存，原子队列写入 SQLite |
| 剧本编排器 | 已完成。单项目源顺序串行、去重、暂停/恢复、取消、失败重试和应用启动恢复；没有增加可配置并发 |
| UI 迁移 | 已保存源分集使用剧本工作台。配置弹窗仅等待入队便关闭，不等待模型完成；无源分集的历史项目保留旧入口 |
| 审核与版本 | 已完成。保存后校验；批准绑定任务、修订号与项目版本，修改依赖标记 stale；旧修订不能批准或应用 |
| 分镜分离 | 已完成单集独立生成、审核和应用，复用已批准剧本，不重新生成剧本；尚无整季分镜队列 |
| 集号和已有制作保护 | 已完成。允许后集先应用，保持原始源集号；应用后跳转分幕，重复应用被拒绝 |
| 原文边界和系列分析 | 原有入口保留；原文边界规划尚未迁入持久后台任务，自动系列 Bible 未补齐 |
| 全局任务中心 | 未完成；当前剧本任务在项目工作台查看 |
| 远程媒体与真实样片 | 不在本轮完成范围，未执行真实付费小说批量生成或成片质量验收 |

实现依据为调研固定的 Toonflow、Jellyfish、wind-comic 流程，适配现有 Electron/SQLite，不复制受限许可项目。以下 TypeScript 和方法名是原始规格示意；实际字段与 API 以 `motion-comic-script-batch.ts`、`motion-comic-script-store.ts` 和 `motion-comic-script-batch-service.ts` 为准。

## 目标

把现有“选择一集 → 打开弹窗 → 等待生成 → 在弹窗中确认 → 写入正式集”的流程，改造成：

> 一次提交整季剧本任务 → 每集独立排队和落盘 → 前台查看和审核 → 显式批准后独立生成分镜 → 审核后应用，不启动媒体生成。

## 1. 数据层

新增版本化的本地任务记录，建议先落在项目现有持久化边界内：

```ts
type MotionComicScriptTaskStatus =
  | 'queued' | 'running' | 'script-ready' | 'review'
  | 'approved' | 'failed' | 'cancelled' | 'stale';

interface MotionComicScriptTask {
  id: string;
  projectId: string;
  sourceEpisodeId: string;
  status: MotionComicScriptTaskStatus;
  inputFingerprint: string;
  seriesBibleVersion: string;
  previousStateVersion?: string;
  provider: string;
  model: string;
  promptVersion: string;
  outputRevision: number;
  artifactId?: string;
  checkpoint?: {
    stage: 'source' | 'bible' | 'script' | 'validate';
    payloadRef: string;
  };
  progress: number;
  attempt: number;
  remoteTaskId?: string;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}
```

剧本候选单独保存。机器生成结果不能直接改变 `MotionComicEpisode.status` 或写入正式镜头。批准动作需要带 `taskId + outputRevision + expectedUpdatedAt`，防止旧页面覆盖新版本。

## 2. 编排器

新增项目级 `MotionComicScriptBatchService`，职责只包括调度和状态，不负责 React UI：

- `enqueueAllMissing(projectId)`：只创建没有批准版本、没有运行任务的集；
- `enqueueEpisode(projectId, sourceEpisodeId)`：单集重试；
- `pause(projectId)` / `cancel(taskId)`；
- `resume(projectId)`：应用启动后恢复 queued/running/unknown 状态；
- `getSnapshot(projectId)`：供任务中心和工作台读取；
- `approve(taskId, revision)`：将候选变为正式剧本；
- `markStaleByDependency(projectId, dependencyVersion)`：显式标记受影响集。

第一版建议按集串行执行，同一项目最多一个 script worker。等状态、恢复和人工编辑稳定后，再增加跨项目并发或小范围有界并发。

任务 worker 每次执行前重新读取项目和任务记录，不能使用启动时捕获的旧 React state。每个阶段完成后立即原子写 checkpoint；写入失败不能向前端报告成功。

## 3. UI 迁移

### 保留的配置入口

弹窗只保留以下内容：

- 生成范围：全部未完成 / 选中集 / 失败集；
- 改编要求；
- 目标集长；
- 模型；
- 是否先生成系列 Bible；
- 开始、取消提交。

点击开始后立即关闭，显示任务中心入口。不能在弹窗内等待整季，也不能因为 worker 正在运行而阻止切换页面。

### 新的剧本工作台

建议在现有 episodes/scenes 体系旁增加一个独立工作台视图：

- 集列表：状态、进度、更新时间、失败原因、模型；
- 批量工具栏：生成未完成、重试失败、暂停后续、批量批准；
- 剧本编辑区：原文证据、场次、对白、旁白、动作、角色和前情；
- 影响区：当前修改会使哪些下游镜头/媒体过期；
- 审核动作：保存草稿、批准、退回重生成。

已有 `MotionComicPlanDialog` 可先改成 `MotionComicScriptStartDialog`，保留审阅组件作为工作台的内容面板，而不是继续承担任务生命周期。

## 4. 与现有代码的迁移边界

### 可以复用

- `motion-comic-episode-planning.ts` 的原文单元化、边界连续覆盖校验和 source fingerprint；
- `motion-comic-planning-service.ts` 的输入绑定、原子写入、失败草稿和 checkpoint 思路；
- `motion-comic-planning.ts` 的脚本 schema、对白说话人校验和原文 evidence；
- `MotionComicScriptReview` 的人工审核交互；
- 现有 `sourceEpisodeId` 映射。

### 必须拆开

- `planMotionComic()` 的 script 与 storyboard 两个阶段；
- `applyMotionComicPlan()` 中“应用正式 episode”和“保存机器候选”；
- `MotionComicEpisode.status = 'boarded'` 这种从一次写入推导全部完成状态的做法；
- `nextUnplannedMotionComicSourceEpisodeId()` 对所有生成和应用路径的强制顺序限制。

顺序限制可以改成默认调度策略，而不能继续作为数据写入的硬错误。数据层应允许第 2 集拥有 `script-ready`，即使第 1 集尚未生成分镜。

## 5. 恢复与付费边界

剧本阶段通常是文本生成，恢复成本低；媒体阶段不能照搬同样的重试策略。

对于远程媒体：

1. 创建本地任务和输入指纹；
2. 提交前写入 `submitting`；
3. 远端返回 task ID 后立即原子落盘；
4. 有 task ID 时只轮询和下载；
5. 提交结果未知时标记 `unknown-submit`，需要人工确认，不自动再次创建；
6. 下载保存临时文件，完成后校验大小/hash，再原子改名；
7. 支持 HTTP range 时才标记可断点续传，否则从头下载但不重新创建远端任务。

## 6. 测试与验收分层

### 单元测试

- 同一源分集不会创建重复任务；
- 空白、失败和已批准集的筛选正确；
- input fingerprint 变化会创建新 revision；
- 任务状态转移拒绝非法跳跃；
- 旧 revision 不能批准覆盖新 revision；
- 原文证据连续覆盖、对白说话人和角色引用继续通过现有 schema 校验。

### 集成测试

- 任务写入后关闭页面，重新打开能读取状态；
- worker 在每个 checkpoint 后进程退出，重启能继续；
- 一个集失败不会阻塞其他集状态展示；
- 取消任务不会把候选误标为批准；
- 重新生成只替换机器候选，不覆盖人工稿和已有媒体。

### 真实样片验收

以下为下一阶段待执行的真实模型验收，不是本轮离线夹具已经证明的结果。已完成的流程、存储与桌面交互验收见 `acceptance.md`。

使用 8–10 集真实小说：

- 一次点击创建全部剧本任务；
- 关闭弹窗并切换到 HTML/Vox 页面；
- 回到剧本工作台查看每集状态；
- 退出并重启应用；
- 审核第 1、2 集，单独重试第 4 集；
- 修改第 3 集后观察第 4 集及以后变为 stale；
- 在没有批准剧本时确认付费媒体按钮不可用；
- 批量批准后只创建已批准集的分镜任务。

验收时记录真实模型、耗时、输入 token、输出 revision、失败原因和是否重试；不能只以 JSON 文件存在作为完成证明。
