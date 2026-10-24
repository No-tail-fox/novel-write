# VOX 重试修复与动画预览验收

日期：2026-09-16。保留本地拼贴与图生视频两条链路，默认仍为本地拼贴。本轮仅实现和本地验收，没有调用付费模型，也没有修改真实项目数据库或原始素材。

## 已完成的行为与入口

| 项目 | 现在的行为 | 使用位置 |
| --- | --- | --- |
| 本地动作预览 | 5 种动作使用生产图层渲染器演示；可播放、暂停、重播、拖动进度，并比较 4 种画幅；点击应用才更新当前镜头 | 分镜 → 画面 → 本地拼贴 → 叙事动作下方「预览动作」 |
| 模板预览 | 55 个现有模板接入独立动态预览；支持搜索、分类、播放、拖动进度、取消和应用 | 分镜 → 画面 → 动画 → 动画模板 →「选择模板」 |
| 个人模板 | 支持预览保存的设置；跨项目缺素材时仍可先应用，再重新选择素材；内容和预览有效后才能保存或导出 | 选择模板 → 我的模板 |
| 错误重试 | 图片、视频、旁白、试片、整片合成分别调用对应能力；展示具体失败原因，同类任务运行或排队时防止重复提交 | 镜头检查器 → 生成队列 |
| 批次重试 | 重试前恢复待执行状态，只检查这次实际执行节点需要的服务；包括自动补入的首帧依赖 | 生成队列 → 重试失败项 |
| 缺素材引导 | 合成因缺背景、主体或旁白失败时显示「查看补齐计划」；打开计划不会提交生成请求 | 顶部失败提示及生成队列中的合成失败记录 |
| 图片生成状态 | 只依据当前镜头尚在运行或排队的图片任务禁用生图按钮；不受旁白或视频记录覆盖影响 | 生成分层素材／生成关键帧 |

预览使用明确标注的本地示例素材，应用内置模板时保留当前镜头图文，不把示例写入项目。两个预览入口都遵循系统减少动态效果设置。这里增加的是现有动作和模板的可见性与可操作性，并非新增 55 种默认自动编排动作；旧镜头需明确选择并应用动作，才会替换已有布局和运动。

## 「最新的」项目核对

最新项目为 **《关于自我主义》**，创建于 2026-09-16 16:17，共 11 个镜头。数据库只读核对发现图片、旁白、视频均为 0；唯一失败任务是合成前置检查 `DIRECTOR_RENDER_PREFLIGHT_FAILED`。因此反复点合成重试不会生成缺失素材。新入口会将该状态引导到补齐计划，由用户检查计划后再开始生成。

最近一个已有素材的项目 **《今天要介绍的是——自我主义》** 有 16 张背景、14 张有效透明主体、16 段旁白，另外 2 个主体分别因抠像要求不符和请求失败而缺失。所有镜头沿用旧的同一种入场动作；首镜约 63% 时间只有微小位移，这解释了「感觉没有动画」的一部分原因。

已用后一个项目首镜的真实既有背景、透明主体和旁白，在隔离目录调用生产渲染器输出 1920×1080、14.67 秒样片。主体入场位移约 1827 像素，同期背景约 18 像素，确认独立分层运动有效。源旁白 14.496 秒完整保留，测得起始偏移 0 毫秒，最后 250 毫秒有声内容相关性 0.99996。这是单镜头验证，不能据此宣称最新空素材项目已出片，或旧项目整片均已验收。

- [真实素材本地样片](../../.artifacts/vox-latest-media-20260916/real-shot-render/selfism-real-shot-local-motion.mp4)
- [项目媒体核对详情](../../.artifacts/vox-latest-media-20260916/README.md)
- [音频验证数据](../../.artifacts/vox-latest-media-20260916/real-shot-render/audio-verification.json)

## 验证结果

- 相关回归合计 125 项通过：双链路、动作差异、旁白时间、制作方式、队列重试、批次调度、请求互斥、持久化和模板示例。
- 本地动作预览：深浅主题 × 1536×1024／1040×720 共 4 组交互；5 种动作 × 4 种画幅共 20 组真实图层变换检查通过，无付费请求、运行错误或横向溢出。
- 模板目录：55 个模板加载通过；4 组主题／窗口交互、个人字幕模板、跨项目缺素材和减少动态效果检查通过；代表模板帧差异已核对。`map-region` 现有实现运动很少，预览保持其实际效果。
- 重试浏览器验收 5 条流程、双链路完整页面验收 5 条流程通过。
- 最终生产构建通过；隔离 Electron 启动、preload、IPC、窗口策略、界面渲染等 6 项冒烟断言全部通过。
- Renderer 与 Electron 类型检查通过。全量类型检查仍被既有 QA 脚本中的 4 处错误阻塞：`qa-hover-seed.ts`、`qa-project-cover-seed.ts`、`qa-workspace-back-seed.ts` 的 ThemeName 类型，以及 `qa-vox-animation-render.ts` 的环境变量对象推断。本轮生产代码无新增类型错误。

验证报告位于 `.artifacts/vox-local-preview/report.json`、`.artifacts/vox-template-catalog-qa/report.json`、`.artifacts/vox-template-catalog-qa/ui-final-report.json`、`.artifacts/director-retry-qa/report.json`；构建和冒烟日志为 `.artifacts/vox-preview-retry-build-final.log` 与 `.artifacts/vox-preview-retry-smoke.log`。

## 主要实现文件

- 本地预览：`src/features/director-desk/DirectorMotionPreview.tsx`、`director-motion-preview.css`。
- 模板预览：`src/features/vox-animation/VoxTemplateCatalog.tsx`、`vox-template-examples.ts`、`VoxAnimationEditor.tsx`、`vox-animation.css`。
- 重试和补齐计划：`src/features/director-desk/director-queue.ts`、`director-batch.ts`、`DirectorDeskWorkspace.tsx`、`src/features/editorial-collage/EditorialCollagePage.tsx`。
- 回归与媒体核对：`tests/director-queue-retry.test.ts`、`tests/vox-template-catalog.test.ts`，以及 `scripts/qa-director-retry.*`、`scripts/qa-vox-local-preview.py`、`scripts/qa-vox-template-catalog.*`、`scripts/qa-vox-latest-*`。

此前已接入功能与来源映射见 [当前功能盘点](2026-09-16-vox-current-inventory.md)。已更新本地构建；正在运行的 StoryDream 请保存后重启，以加载新代码。
