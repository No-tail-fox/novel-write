# 后台批量剧本工作流验收

日期：2026-10-22。范围：已保存源分集的 AI 漫剧项目。结论：核心剧本调度、审核、版本绑定和单集分镜闭环通过离线验收；不代表真实模型的剧本质量或成片质量通过。

## 流程依据

沿用调研固定提交所体现的阶段划分与持久任务模式：Toonflow 的 source/script/制作分离、Jellyfish 的持久任务与 worker、wind-comic 的顺序生成与恢复。固定提交和许可证见 [调研报告](README.md)。

StoryDream 的当前落地流程为：

> 保存原文分集 → 一次提交缺失/选中/失败集的剧本任务 → 主进程按源顺序生成并逐集保存 → 工作台编辑、校验、显式批准 → 单独生成分镜 → 审核并应用至正式分集 → 后续再进入资产和媒体制作。

生成期间不要求保持弹窗或页面打开；后一集剧本不等待前一集分镜、图片、视频或配音。剧本批准和分镜应用都不创建媒体任务。

## 代码与数据边界

- `src/shared/motion-comic-script-batch.ts`：任务状态、候选、批准、分镜候选和版本授权契约。
- `src/shared/motion-comic-script-store.ts`：SQLite 独立记录、原子写入、任务去重、源文/Bible/前集版本指纹、编辑和失效传播。
- `electron/motion-comic-script-batch-service.ts`：后台串行剧本 worker、单集分镜 worker、取消与退出等待。
- `electron/main.ts`、`electron/preload.ts`、`src/shared/ipc-contract.ts`、`src/shared/storage.ts`：IPC、原子项目保存、应用启动恢复和关停接线。
- `src/features/motion-comic/MotionComicScriptWorkspace.tsx`：分集列表、筛选、原文证据、剧本与对白编辑、草稿恢复、批准及分镜审核。
- `src/shared/motion-comic-planning.ts`、`src/shared/motion-comic.ts`：源文绑定、保留系列参考资产、乱序应用集号、去重和已有制作保护。

剧本状态为 `queued / running / script-ready / review / approved / failed / cancelled / stale`；分镜状态单独记录为 `running / ready / failed`。`script-ready` 只表示机器候选就绪，不等于已批准。

批准及应用必须绑定 `taskId + outputRevision + expectedUpdatedAt`。分镜应用另外要求确认已审核整理记录；项目保存时再次检查批准和依赖，防止检查后到提交前的竞态。切换集和重载保留本地草稿，冲突不静默覆盖。

重启后运行中的文本任务重新排队，已完成候选保留；中断分镜明确标记失败并保留已批准剧本，允许单独重试。这不是供应商请求级的幂等或无重复计费保证。

## 测试与构建

2026-10-22 最终相关回归：**7 个文件，175 项测试全部通过**。

```powershell
.\scripts\run-npm-node.cmd node_modules/vitest/vitest.mjs run tests/motion-comic-script-batch.test.ts tests/motion-comic-planning.test.ts tests/motion-comic-planner-ui.test.ts tests/motion-comic.test.ts tests/storage.test.ts tests/electron-ipc-contract.test.ts tests/motion-comic-production.test.ts --pool=threads --maxWorkers=1
```

覆盖任务去重、源顺序、前情输入、暂停与取消、重启恢复、过期回写拒绝、批准竞态、分镜只复用已批准剧本、退出等待、原文证据、既有制作保护、后集先应用、集号持久化与 IPC 契约。

通过的检查：

```powershell
.\scripts\run-npm-node.cmd node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
.\scripts\run-npm-node.cmd node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit
.\scripts\run-npm-node.cmd scripts/build-electron.mjs
.\scripts\run-npm-node.cmd node_modules/vite/bin/vite.js build
```

renderer 类型检查已在最终紧凑布局 JSX 调整后重新通过。Vite 仍有既有 Node/undici 浏览器外部化警告，不据此宣称构建完全无警告。

独立的 scripts 类型检查另有工作区既有错误：`scripts/qa-collage-render.ts(34,28)` 的 `removeImageBackground` 少传第三个参数。本轮没有修改该无关脚本，也没有将全仓库类型检查报告为通过。

## 真实 Electron 交互验收

执行入口：

```powershell
vendor/python/python.exe scripts/qa-motion-comic-script-ui.py
```

使用生产 Electron 构建、独立 SQLite/profile 和确定性离线夹具：24 个源分集，每集 32 条原文证据、8 场和每场 4 个动作节拍；预置 23 个候选、第 24 集失败、第 2 集已批准并有 8 镜分镜。队列初始暂停，外部生成请求被拦截并审计。

机器报告：`.artifacts/novel-script-workflow/report.json`。结果：`status=passed`、`errors=[]`、`paidCalls=0`。实际验收包括：

1. 未审阅候选不能批准，也不能启动分镜；批量批准只包括勾选当前修订的集。
2. 深浅主题 × 两种窗口尺寸均检查分集列表、场次列表和节拍编辑区独立滚动；编辑字段与底部批准按钮完整可见，无横向溢出。
3. 第 2 集先于第 1 集应用，正式分集保持编号 2；没有媒体任务，重复应用被禁止。
4. 批准后仍须单独生成分镜，不能把批准动作当成制作启动。
5. 编辑草稿在切换集和重载后保留；保存后修订号增加，后续依赖标记过期。
6. 批量提交只等待入队即关闭；离开项目再返回后，队列及暂停状态仍在。

界面截图均已打开复审：

| 主题 | 窗口 | 截图 |
| --- | --- | --- |
| 深色 | 1536×1024 | `.artifacts/novel-script-workflow/dark-1536.png` |
| 深色 | 1040×720 | `.artifacts/novel-script-workflow/dark-1040.png` |
| 浅色 | 1536×1024 | `.artifacts/novel-script-workflow/light-1536.png` |
| 浅色 | 1040×720 | `.artifacts/novel-script-workflow/light-1040.png` |

修复了 1040×720 下重复标题和纵向筛选挤占正文的问题：筛选并排，压缩冗余标题和留白，保留审核勾选、固定动作和各区滚动。最终实际可滚动区域高度：

| 窗口 | 分集列表 | 节拍编辑区 | 场次列表 |
| --- | --- | --- | --- |
| 1536×1024 | 460px | 345px | 216px |
| 1040×720 | 263px | 183px | 102px |

两种主题的尺寸一致；不再只用“元素存在”作为小窗口可用性通过标准。

## 尚未验证或未完成

- 真实小说 8–10 集、真实模型的批量改编质量、耗时、token 和失败重试费用尚未实测；本轮没有调用付费模型。
- 原文边界规划仍走既有入口，尚未全部迁入持久后台；系列 Bible 自动生成未补齐。
- 分镜是独立单集任务，尚未实现整季分镜批量调度；剧本任务尚未完整接入全局任务中心。
- 没有源分集的历史项目保留旧规划弹窗，不能据此宣称所有历史入口均已迁移。
- 远程人物连续性、口型、提交结果未知时的供应商幂等，以及完整上传/下载断点恢复仍未验证。
- 本轮没有生成或验收可播放样片，不替代此前 HTML/Vox/漫剧真实媒体验收要求。
- 本轮未提交、上传代码或执行关机；其余工作区修改没有纳入本次验收结论。
