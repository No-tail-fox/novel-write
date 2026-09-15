# Video Shotcraft 与 StoryDream 的接入判断

核验日期：2026-09-15。只读检查当前本地工作区及缓存资料，没有联网，没有改动产品源码。本文件中的上游能力以缓存 README / demos README 为证据；尚未读到 Workbench manifest 契约或具体 TSX demo，因此不将宣传中的像素一致性、216 个 demo 可用性视为已经在 StoryDream 验证的结论。

**建议将 Shotcraft 作为现有 VOX 动画系统的镜头配方与运动组件来源，先做精选组件适配。暂不整体合并它的独立 Workbench、完整影片模板或剪映导出工程。** StoryDream 已经具备需要承接这些组件的项目数据、预览、AI 代码生成、个人模板和渲染链路。

## 先纠正当前基线

较早的研究文档称“生产 VOX 页面尚未接入 Remotion 模板选择”，但当前工作区已有实现，后续方案应以源码为准：

| 已有能力 | 当前证据 |
|---|---|
| 49 个参数化内置模板，11 类用途 | [vox-animation.ts](/I:/opc/src/shared/vox-animation.ts:9) 的 `VOX_TEMPLATES`；49 按实际模板 ID 计数，非上游模板数量 |
| 模板 / AI 生成双入口、分类搜索、参数编辑、个人模板、单镜头导出 | [VoxAnimationEditor.tsx](/I:/opc/src/features/vox-animation/VoxAnimationEditor.tsx:22)、[导出按钮](/I:/opc/src/features/vox-animation/VoxAnimationEditor.tsx:43) |
| 已接入 VOX 导演台预览与右侧编辑器 | [DirectorDeskWorkspace.tsx](/I:/opc/src/features/director-desk/DirectorDeskWorkspace.tsx:1448)、[编辑器挂载](/I:/opc/src/features/director-desk/DirectorDeskWorkspace.tsx:1644) |
| 项目保存的模板/代码双草稿、个人模板原子保存 | [vox-animation.ts](/I:/opc/src/shared/vox-animation.ts:68)、[VoxTemplateStore](/I:/opc/electron/vox-animation-runtime.ts:44) |
| 使用现有文本服务生成 TSX，支持取消 | [main.ts](/I:/opc/electron/main.ts:2294)、[生成提示约束](/I:/opc/src/shared/vox-animation-prompt.ts:4) |
| Remotion 镜头可与原有拼贴镜头组成同一成片 | [director-renderer.ts](/I:/opc/electron/director-renderer.ts:69)、[场景渲染汇总](/I:/opc/electron/director-renderer.ts:148) |

这些模板的声明是 **StoryDream 原创参数化 composition、受研究启发**，并非已移植 49 个第三方原始组件：[THIRD_PARTY_NOTICES.md](/I:/opc/src/features/vox-animation/THIRD_PARTY_NOTICES.md:3)。不能把同名效果当成已经拥有 Shotcraft 原版运动质量。

`git status` 显示 `src/features/vox-animation/`、`src/shared/vox-animation.ts`、`electron/vox-animation-runtime.ts` 目前为未跟踪文件。上述结论描述当前本地工作区，不能据此声称已提交或已经发布。

## 最有价值的复用点

| Shotcraft 内容 | StoryDream 可落点 | 适配判断 |
|---|---|---|
| `paper-craft-moves`、`paper-title-card` | 现有 `paper-popup`、`paper-title`；[Paper](/I:/opc/src/features/vox-animation/VoxComposition.tsx:21) | 适合用原始运动参数提升纸卡折叠、压印、胶带动效；保留现有中文文案与素材输入 |
| `timeline-travel` | `time-travel`；[Timeline](/I:/opc/src/features/vox-animation/VoxComposition.tsx:35) | 适合增强沿轴推进、焦点停留与章节节奏；镜头总长继续来自项目时间线 |
| `bezier-source-converge-merge`、`ring-diagram-annotation-reveal` | `flow-converge`、`flow-rings`；[Flow](/I:/opc/src/features/vox-animation/VoxComposition.tsx:72) | 适合替换简化运动，并沿用节点、说明、颜色 props |
| `_fixtures/Motion.tsx` 的缓动、分段、确定性随机与 `useT` | 新建受控的内部运动辅助模块 | 复用价值高；先取独立数学函数，再逐个接入组件；无需每张卡复制一份工具代码 |
| `_fixtures/PageCam2D.tsx` | 截图讲解、证据聚焦、空间卡片巡游；[Evidence](/I:/opc/src/features/vox-animation/VoxComposition.tsx:26)、[Gallery](/I:/opc/src/features/vox-animation/VoxComposition.tsx:84) | 适合在第二批增加真实页面 2.5D 运镜，需建立截图尺寸、焦点和版面坐标的输入约定 |
| 镜头卡用途、能量、建议时长、参数和坑点 | 模板元数据与 AI 生成参考上下文 | 可以让“选什么镜头”与“怎样运动”更具体；当前 AI 只收到模板名字，[vox-animation-prompt.ts](/I:/opc/src/shared/vox-animation-prompt.ts:5) 尚未注入配方/原版参考代码 |
| SFX 分场景索引与节奏设计方法 | StoryDream 现有声音时间线 | 适合做音效选择和时间点建议；声音仍由项目音频轨道混音，避免模板内再输出一份旁白或背景音乐 |

前五种配方在既有 [VOX 对应表](/I:/opc/docs/research/remotion-templates-2026-09-15/vox-template-matches.md:24) 中有具体条目，但原文同时说明这些 demo 未本地实渲。本轮同样没有将它们标成已完成移植。

## 不能直接复制粘贴的边界

1. **帧率不一致。** 上游 demo 默认 30 fps，`_DURATION` 也是 30 fps 帧数；StoryDream 固定 24 fps：[demos README](/I:/opc/.tmp/shotcraft-demos-readme.md:7)、[时长约定](/I:/opc/.tmp/shotcraft-demos-readme.md:47)、[production-visual-continuity.ts](/I:/opc/src/shared/production-visual-continuity.ts:4)。直接保留 90 帧动画会从 3 秒变成 3.75 秒。应把固定关键帧转成秒/归一化进度，或显式按源 fps 换算；不要为了某个模板全局改项目 fps。

2. **“等比放大”不等于竖屏重排。** Motion 系 demo 在 480×270 设计坐标作画；StoryDream 支持 16:9、9:16、1:1、4:3：[demos README](/I:/opc/.tmp/shotcraft-demos-readme.md:42)、[画布尺寸](/I:/opc/src/shared/director-render.ts:477)。需要逐卡声明支持比例、留白与排布策略，并验证长中文与字幕安全区；不能把横屏动画机械放大后宣称已适配竖屏。

3. **素材路径与假 UI 不兼容当前输入体系。** 大部分 demo 依赖 `Fixtures.tsx`，一部分通过 `staticFile()` 读取 `_textures` 截图和 `live-layout.json`：[demos README](/I:/opc/.tmp/shotcraft-demos-readme.md:10)。StoryDream 预览通过宿主读取项目素材，转为 data URL 后构建 iframe，且有 CSP 限制：[VoxAnimationPreview.tsx](/I:/opc/src/features/vox-animation/VoxAnimationPreview.tsx:18)、[readVoxAsset](/I:/opc/electron/vox-animation-runtime.ts:33)。应将截图与内容映射到项目 asset IDs，不能只复制 TSX 留下上游相对路径或示例产品素材。

4. **当前“AI 代码”入口不能承载多文件 demo 包。** 编译器只允许 `react` / `remotion` 导入，拒绝相对模块、外部重导出和 DOM 访问，并要求 `export default`：[vox-animation-runtime.ts](/I:/opc/electron/vox-animation-runtime.ts:15)。上游共享 fixtures、`@remotion/motion-blur` 以及测量文本宽度的 demo 不能原样粘入。精选上游组件应进入受审查的内置 runtime 构建；不要直接放宽用户代码沙箱。motion-blur 需要另验证是否适合当前捕帧方式。

5. **真实视频卡片需要新增宿主能力。** `ClipCard` 使用 `OffthreadVideo`、视频素材和循环交叉淡化：[demos README](/I:/opc/.tmp/shotcraft-demos-readme.md:64)。StoryDream 动画素材类型仅支持 image/audio，读取函数不收 MP4：[vox-animation.ts](/I:/opc/src/shared/vox-animation.ts:74)、[director-render.ts](/I:/opc/src/shared/director-render.ts:550)。在视频 asset、精确 seek、静音与源时间映射完成前，不把 ClipCard 列为可直接接入。

6. **Workbench 的剪辑模型不能覆盖现有项目结构。** 当前时间线按 beat→shot 顺序累计毫秒，并保存素材、字幕与音频引用：[rebuildEditorialTimeline](/I:/opc/src/shared/editorial-collage.ts:587)。Remotion 镜头明确禁止拆分和合并：[splitEditorialShot](/I:/opc/src/shared/editorial-collage.ts:899)、[mergeEditorialShots](/I:/opc/src/shared/editorial-collage.ts:953)。上游拖放、多轨、裁剪、变速应先设计 source trim / speed curve / 字幕与音频的映射及持久化，再讨论移植编辑器；不能仅接一个界面。

7. **渲染架构不同。** 当前用 Remotion Player 驱动画面，暴露 `window.__tl.seek`，再让 Electron 的 HTML 视频渲染器捕帧和混音：[runtime.tsx](/I:/opc/src/features/vox-animation/runtime.tsx:31)、[seek](/I:/opc/src/features/vox-animation/runtime.tsx:39)、[director-renderer.ts](/I:/opc/electron/director-renderer.ts:148)。上游宣称的 Remotion 导出像素一致性不能直接外推到本产品；预览与导出必须在当前链路重新采样比较。

8. **元数据还不足以稳定管理上游版本。** 当前 schema 是固定通用 props，`template` 只存 id 和 props，未记录上游来源、组件版本、独立参数 schema 或支持比例：[vox-animation.ts](/I:/opc/src/shared/vox-animation.ts:55)、[template schema](/I:/opc/src/shared/vox-animation.ts:70)。应在小规模引入时补齐这些字段和旧项目迁移策略，否则以后更新原版运动可能无意改变旧工程。

9. **整片模板和剪映导出应独立评估。** Ink Press 是 36.2 秒产品宣传片结构，与 VOX 旁白驱动的事实解释内容不完全相同；Windows 剪映导出仍标注未测试：[Shotcraft README](/I:/opc/.tmp/shotcraft-readme.md:129)、[目录说明](/I:/opc/.tmp/shotcraft-readme.md:199)。模板可以单独作为“产品演示”预设研究，剪映导出可以作为独立 exporter；不宜顺带合进本次组件适配。

## 推荐实施路径

**第一批：五个镜头，提高现有质量。** 锁定上游 commit，读精确配方与 TSX；选择纸卡、纸张标题、时间轴、多源汇合、环层说明五类。复用现有 `VoxAnimation` 草稿和资源 ID，在 `src/features/vox-animation/` 下建立按模板 ID 注册的组件映射，逐步替代 `VoxComposition.tsx` 的单文件分支。给每个移植组件保留原版版本、许可和参考预览，并用现有表单填真实内容。

**第二批：增强选择与生成。** 给模板登记建议时长、支持比例、素材角色和专有运动参数；表单按每个模板 schema 生成。把已核验配方和受控示例片段加入 AI 提示上下文，继续使用现有 `vox:generate` 和编译链；不另建 LLM 服务或个人模板存储。

**第三批：补宿主能力。** 只有在用户实际需要真实视频卡片、模板内多片段剪辑、运动参数曲线时，再扩展视频资产和源时间映射，评估 Workbench 契约到 StoryDream 文档模型的双向转换。无需为了展示五个镜头先引入另一套项目、时间线或导出服务。

适配验证应覆盖：24 fps 下的关键帧时间、长中文与四种比例、缺素材、保存重开、参数变化触发输出失效、预览与捕帧一致、字幕与音频对齐、取消后的窗口/任务清理。现有 [vox-animation.test.ts](/I:/opc/tests/vox-animation.test.ts:13) 已覆盖若干数据与编译约束；[qa-vox-animation-render-entry.ts](/I:/opc/scripts/qa-vox-animation-render-entry.ts:19) 可作为混合镜头渲染验收入口。

本地已有 QA 产物的 `render-report.json` 为 passed，`decode-report.json` 记录 192 帧、24 fps、1920×1080、8 秒并全量解码通过。这是当前 VOX 通路的既有证据，不是本轮重新运行的结果，也不证明 Shotcraft 组件已通过验证：[渲染记录](/I:/opc/.artifacts/vox-animation-qa/render-report.json)、[解码记录](/I:/opc/.artifacts/vox-animation-qa/decode-report.json)。

## 证据限制

缓存 `.tmp/shotcraft-tree-recursive.json` 实际内容是 GitHub API rate-limit 错误，不能据此确认目录完整性或源码数量。README 的 157 张卡、214 预览与 Workbench 的 216 demo 使用不同计数口径；本文件未重新统计上游树。缓存 Apache-2.0 LICENSE 已存在，但音频授权和 Remotion 授权仍需各自保留；如实际复制上游代码，当前宣称内置 composition 均为原创的 THIRD_PARTY_NOTICES 也应相应更新。
