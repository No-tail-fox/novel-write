# VOX 内容标题与多种叙事动作

日期：2026-09-15。修复用户反馈的“所有镜头同一种动画”和“钩子等内部标签被直接放进成片”。保留本地拼贴动画与图生视频，默认本地，本轮只做本地验证。

## 修改结果

- 结构角色和上屏文字分离。每镜保存 `title`，默认取该镜头原文中的分句；用户可在画面生成面板修改“上屏标题”或清空隐藏。内部“钩子／背景／证据／结论”仍用于组织稿件，不再直接作为观众标题。短句按整句分镜，不再强制拆成四段。
- 本地动作扩展为切片入场、聚焦揭示、证据落版、路径推进、并列对比，具有不同的构图、对象轨迹和出现顺序。“叙事动作”和“相机运动”分开选择。
- 自动选择依据原文的揭示、证据、过程、对比关键词；未命中时按镜头轮换。具体对比双主体或多条证据分别产生素材提示词，生成数量随实际层数计算。这是本地规则规划，不声称已实现通用 AI 导演。
- 预览与导出共用标题和图层。原生标题存在时去掉重复常驻标题，移除 VOX/SHOT 技术角标，并修复宽标题 SVG 超出图层高度的问题。对比标签上移，最终样片底板与字幕区域间距约 27 像素。
- 老项目加载时修复已知原生结构标签，保留图片与手动关键帧。动作切换保留可复用资产，隐藏暂不使用的生成图层；复制的对比镜头可切换动作后恢复第二主体，保持六层上限。

## 使用与限制

新项目直接使用按内容选取的标题及动作。已有项目可在画面生成面板逐镜修改“上屏标题／叙事动作”；已有手动动作不会在打开项目时被自动覆盖。旧 MP4 必须重新导出才能体现修改。

动作切换不会重新绘制已有图片。若新构图需要第二主体，会保留其独立缺失素材槽位，之后补齐；已有主体与新语义不符时需重新生成相应图层。两条链路分别保存独立图层素材和图生视频关键帧。

## 验收证据

| 检查 | 结果 |
|---|---|
| 最终核心逻辑测试 | `editorial-storytelling.test.ts` 与 `editorial-motion-variety.test.ts`，12 项通过 |
| 集成聚焦测试 | 13 文件，141 项通过；后续小修由核心测试与页面验收覆盖 |
| 扩展回归 | 21 文件，189 项通过、1 项失败；失败为 `editorial-collage-workbench.test.ts:44` 的旧源码字符串断言，仍要求已移除的四／六／八节拍控件 |
| 预览 UI | 双主题 × 1536×1024 / 1040×720，12 组通过；`.artifacts/vox-story-ui/result.json` |
| 实际 EditorialCollagePage | 5 组通过：独立生成、失败补齐、独立关键帧、模式刷新恢复、标题与动作保存；`.artifacts/editorial-dual-chain/result.json` |
| 最终生产构建 | 通过；`.artifacts/vox-story-build.log` |
| 实际本地导出 | 1920×1080、12.5 秒、5 镜头，视频／音轨／非黑帧有效；5 种运动均经 MP4 解码抽帧确认 |

全局类型检查仍有既有 `browser-fallback.ts` 缺少 API、`storage.test.ts` 缺少 `updateMusicMvTask` 和 `electron/main.ts` 的 `ratio` 类型错误。另有三个既有 QA 种子脚本的 ThemeName 错误。本轮 VOX 相关实现未出现新的类型错误，不声称全仓检查已通过。

样片使用程序生成的独立透明素材与测试音，不是实际旁白成片。没有调用付费模型，没有改写真实用户项目或重新生成《撒日朗》。外部调用数为 0。

- [五种动作样片](/I:/opc/.artifacts/vox-motion-variety-qa/run-LxOgL6/vox-five-motion-styles.mp4)
- [导出报告](/I:/opc/.artifacts/vox-motion-variety-qa/run-LxOgL6/report.json)
- [实际视频轨迹测量](/I:/opc/.artifacts/vox-motion-variety-qa/run-LxOgL6/pixel-measurements.json)
- [五镜头分阶段抽帧](/I:/opc/.artifacts/vox-motion-variety-qa/run-LxOgL6/five-motion-contact-sheet.png)
- [对比镜头标签与字幕间距](/I:/opc/.artifacts/vox-motion-variety-qa/run-LxOgL6/comparison-layout.json)

前期成熟方案来源与两条链路的实现背景见 [GitHub 调研](/I:/opc/docs/plans/2026-09-14-vox-motion-skill-research.md) 和 [双链路实施](/I:/opc/docs/plans/2026-09-14-vox-dual-route-implementation.md)。
