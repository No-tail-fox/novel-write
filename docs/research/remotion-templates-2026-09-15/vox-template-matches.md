# VOX 八类模板：具体来源与接入清单

核验日期：2026-09-15。按用户确认的八类用途补充 **32 个产品模板候选**。这是模板规划与源码映射；组合方案与待开发项明确列出，不把它们算成现成上游模板。生产 VOX 页面尚未接入 Remotion 模板选择。

## 新找到的对应来源

| 来源 | 已核实的对应功能 | 结论 |
|---|---|---|
| [voxstylehub-steven](https://github.com/Phantomlau3674/voxstylehub-steven) | PaperActor 分层入场、DrawnArrow 手绘路径；实际 LICENSE 为 MIT | 最贴近纸片拼贴，可抽取组件；发行来源锁定到 v2026.07.22 |
| [VellumReel · 卷影](https://github.com/SilentFleetKK/vellum-reel) | BookVideo、BookIdentity、字幕层、阅读进度；实际 LICENSE 为 MIT | 新发现的中文书籍解读工程。现有书封由文字/CSS 构成，不能直接换真实封面图 |
| [VOX Video Starter](https://github.com/lyyilin/vox-video-starter) | 历史解说工作流、字幕驱动拼贴；README 提供三段示例 GIF；LICENSE 为 MIT | 用作完整流程与视觉方向参考，本轮未跑其生成管线或观看全部成片 |
| [官方 A-to-B Map Flyover](https://www.remotion.dev/elements/maps/map-flyover/) | 完整地图组件源码，起终点、地名、颜色参数，路径与相机动画 | 比只拿 MapLibre 文档起步更直接；仍需处理地图资源和加载失败 |
| [官方 News Article Highlight](https://www.remotion.dev/elements/text/news-article-highlight/) | 可编辑标题文字与逐段高亮 | 适合证据标题与重排书摘；没有截图 OCR 或自动定位 |
| [Shotcraft](https://vincentwei1021.github.io/video-shotcraft/library.html) | 纸卡弹起、胶带贴合、时间轴巡游、多源汇合、分层原理图配方 | 有明确对应卡片；本轮这些卡的具体 demo 未本地实渲 |

## 八类各四项

P0 为首批，P1 为后续扩展，P2 为专门开发项。来源验证程度见后面的来源表。

| 类别 | 模板候选 | 对应来源 | 接入方式 | 优先级 |
|---|---|---|---|---|
| 纸张拼贴 | 分层纸片入场 | [PaperActor](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/PaperActor.tsx) | 组件组合 | P0 |
| 纸张拼贴 | 拍立得证据拼贴 | [Polaroid Pictures](https://www.remotion.dev/elements/storytelling/polaroid-pictures/) | 组件适配 | P0 |
| 纸张拼贴 | 胶带贴纸 / 立体纸卡 | [paper-craft-moves](https://github.com/Vincentwei1021/video-shotcraft/tree/main/references/shots) | 配方适配 | P1 |
| 纸张拼贴 | 纸张标题压印 | [paper-title-card](https://github.com/Vincentwei1021/video-shotcraft/tree/main/references/shots) | 配方适配 | P1 |
| 证据讲解 | 新闻标题划重点 | [News Article Highlight](https://www.remotion.dev/elements/text/news-article-highlight/) | 组件适配 | P0 |
| 证据讲解 | 引文与出处落版 | [Quote Card](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/quote-card.tsx) | 组件适配 | P0 |
| 证据讲解 | 证据图片叠放 | [Photo Stack](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/photo-stack.tsx) | 组件适配 | P0 |
| 证据讲解 | 截图局部解释 | [DrawnArrow](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/DrawnArrow.tsx) / [PaperActor](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/PaperActor.tsx) | 新增组合 | P1 |
| 时间叙事 | 人物 / 事件时间线 | [Timeline](https://github.com/zz41354899/SwiftClip/blob/HEAD/remotion/Timeline.tsx) | 组件适配 | P0 |
| 时间叙事 | 沿时间轴推进 | [timeline-travel](https://github.com/Vincentwei1021/video-shotcraft/tree/main/references/shots) | 配方适配 | P1 |
| 时间叙事 | 章节揭示 | [Chapter Title Card](https://github.com/RenderComp/free-remotion-templates/blob/main/src/components/chapter-title/ChapterTitle.tsx) | 组件适配 | P0 |
| 时间叙事 | 年代快速推进 | [KPI Counter](https://github.com/RenderComp/free-remotion-templates/blob/main/src/components/kpi-counter/KpiCounter.tsx) | 新增组合 | P1 |
| 对比分析 | 左右观点对照 | [Split Screen](https://github.com/RenderComp/free-remotion-templates/blob/main/src/components/split-screen/SplitScreen.tsx) | 组件适配 | P0 |
| 对比分析 | 前后图片揭示 | [Image Comparison Slider](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/image-comparison-slider.tsx) | 组件适配 | P0 |
| 对比分析 | 两组指标比较 | [Comparison Chart](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/comparison-chart.tsx) | 组件适配 | P0 |
| 对比分析 | 观点与反证 | [PaperActor](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/PaperActor.tsx) / [DrawnArrow](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/DrawnArrow.tsx) | 新增组合 | P1 |
| 数据解释 | 关键数字滚动 | [KPI Counter](https://github.com/RenderComp/free-remotion-templates/blob/main/src/components/kpi-counter/KpiCounter.tsx) | 组件适配 | P0 |
| 数据解释 | 柱状图比较 | [Animated Bar Chart](https://github.com/RenderComp/free-remotion-templates/blob/main/src/components/bar-chart-anim/BarChartAnim.tsx) | 组件适配 | P0 |
| 数据解释 | 趋势线展开 | [Line Chart](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/line-chart.tsx) | 组件适配 | P0 |
| 数据解释 | 占比拆解 | [Pie Chart](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/pie-chart.tsx) | 组件适配 | P1 |
| 地图叙事 | 两地路线飞行 | [A-to-B Map Flyover](https://www.remotion.dev/elements/maps/map-flyover/) | 组件适配 | P1 |
| 地图叙事 | 多站点行程 | [A-to-B Map Flyover](https://www.remotion.dev/elements/maps/map-flyover/) | 新增组合 | P1 |
| 地图叙事 | 地区聚焦与标注 | [MapLibre / Turf 官方地图指南](https://www.remotion.dev/docs/maps) | 需要新实现 | P2 |
| 地图叙事 | 历史路径变化 | [MapLibre / Turf 官方地图指南](https://www.remotion.dev/docs/maps) / [DrawnArrow](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/DrawnArrow.tsx) | 需要新实现 | P2 |
| 原理流程 | 步骤逐项推进 | [Progress Steps](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/progress-steps.tsx) | 组件适配 | P0 |
| 原理流程 | 多路信息汇合 | [bezier-source-converge-merge](https://github.com/Vincentwei1021/video-shotcraft/tree/main/references/shots) | 配方适配 | P1 |
| 原理流程 | 原理分层与注释 | [ring-diagram-annotation-reveal](https://github.com/Vincentwei1021/video-shotcraft/tree/main/references/shots) | 配方适配 | P1 |
| 原理流程 | 因果关系连线 | [DrawnArrow](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/DrawnArrow.tsx) / [PaperActor](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/PaperActor.tsx) | 新增组合 | P0 |
| 书籍推荐 | 书籍介绍 / 封面登场 | [BookVideo / BookIdentity](https://github.com/SilentFleetKK/vellum-reel/blob/HEAD/src/video/BookVideo.tsx) / [PaperActor](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/PaperActor.tsx) | 工程拆分 | P0 |
| 书籍推荐 | 三个阅读收获 | [Animated List](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/animated-list.tsx) / [BookVideo / BookIdentity](https://github.com/SilentFleetKK/vellum-reel/blob/HEAD/src/video/BookVideo.tsx) | 新增组合 | P0 |
| 书籍推荐 | 书摘重点揭示 | [News Article Highlight](https://www.remotion.dev/elements/text/news-article-highlight/) / [Quote Card](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/quote-card.tsx) | 新增组合 | P0 |
| 书籍推荐 | 同主题书单 | [Image Carousel](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/image-carousel.tsx) | 组件适配 | P1 |

## 关键适配说明

- **分层纸片入场**：输入 透明主体图、背景图、层级/入场顺序。图层支持替换素材；原组件处理运动，纸边、投影与完整构图由包装模板提供。
- **拍立得证据拼贴**：输入 图片、说明、出现顺序。原版固定三张和 1480×640 布局；需列表参数、中文字体、本地素材及竖屏排版。
- **胶带贴纸 / 立体纸卡**：输入 图片或卡片、标签。配方有 masking-tape-slap 与 popup-book-rise；后者是纸卡升起，不是连续翻书。
- **纸张标题压印**：输入 标题、强调词。逐词压印和重点词强调；中文应按语义片段而非英文空格分词。
- **新闻标题划重点**：输入 标题文字、强调词、来源。原版高亮的是 DOM 文字，没有截图 OCR 或自动框选。
- **引文与出处落版**：输入 引文、作者、出处。原始组件已实渲，需开放中文文案参数和最长行限制。
- **证据图片叠放**：输入 图片列表、标题、来源。需去掉上游示例内容，来源标签与旁白时间点另接。
- **截图局部解释**：输入 截图、焦点区域、说明。连线与入场组件可复用；截图裁剪、焦点缩放和坐标编辑需要新写。
- **人物 / 事件时间线**：输入 日期、事件、说明。源码含固定 STEPS 与企业示例；需改事件 props 和历史/传记样式。
- **沿时间轴推进**：输入 节点、节点图、停留时间。配方是沿横向时间线运镜；需适配内容长度及旁白停留。
- **章节揭示**：输入 章节号、章节标题。按真实镜头时长设置入场和停留。
- **年代快速推进**：输入 起止年份、停顿年份。数字组件改成整数年份，不能带千位分隔符；与事件标签组合。
- **左右观点对照**：输入 两组图文、标签。统一左右证据量，竖屏可改上下分区。
- **前后图片揭示**：输入 前图、后图、标签。需要两图比例与锚点一致；移动由帧驱动。
- **两组指标比较**：输入 标签、两组数值、单位。原组件已实渲；需参数化并展示真实来源。
- **观点与反证**：输入 观点、反证、出处。复用卡片与连线，新增先提出观点再揭示反证的时间编排。
- **关键数字滚动**：输入 数值、单位、标签。有类型化 props；核验极大值、小数和中文单位。
- **柱状图比较**：输入 分类、数值、单位。应根据数据确定坐标轴，不能沿用示例数值。
- **趋势线展开**：输入 时间点、数值、重点。原始组件已实渲；改为数据输入和横竖版布局。
- **占比拆解**：输入 分类、占比、说明。校验总量，适配小扇区标签与实际单位。
- **两地路线飞行**：输入 起终点坐标、地名、路线颜色。官方已有 origin/destination/label 参数与路径相机；地图瓦片和 worker 要纳入导出依赖。
- **多站点行程**：输入 途经点、站名、停留时长。上游只支持两点；需要多段衔接、镜头继承与时长分配。
- **地区聚焦与标注**：输入 GeoJSON 区域、标注、焦点。官方指南提供地图基础；区域选择与填色模板需要新写。
- **历史路径变化**：输入 地图底图、路径、年代、来源。没有核实到现成历史地图模板；路径和边界必须来自真实数据/用户素材。
- **步骤逐项推进**：输入 步骤、说明。原组件已实渲；支持步骤数量与旁白节点。
- **多路信息汇合**：输入 来源节点、汇合点、标签。配方以四来源节点为例，需节点数和文本参数化。
- **原理分层与注释**：输入 主体、分层、说明。适合同心层结构；不能直接冒充任意关系树组件。
- **因果关系连线**：输入 原因、结果、关系。组件可实渲，自动布局与边标签需要新增。
- **书籍介绍 / 封面登场**：输入 书名、作者、封面、推荐语。VellumReel 已有文字书封、书名作者和进度；真实封面字段与图片渲染需新增。
- **三个阅读收获**：输入 书封、三条收获。把列表与书籍身份组合；文案由用户/真实书籍内容提供。
- **书摘重点揭示**：输入 摘录、页码、出处、可选内页图。纯文字摘录可复用；原始内页图上的划线需新增坐标标注。
- **同主题书单**：输入 书封列表、书名、推荐语。通用轮播改为书封等比完整显示，增加书名与书单数据。

## 来源的验证程度

| 来源 | 预览 / 目录 | 许可 | 本地核验 |
|---|---|---|---|
| [Quote Card](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/quote-card.tsx) | [查看](https://www.reactvideoeditor.com/remotion-templates) | MIT (repository README declaration) | 实渲组件 |
| [Photo Stack](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/photo-stack.tsx) | [查看](https://www.reactvideoeditor.com/remotion-templates) | MIT (repository README declaration) | 已读源码 |
| [Comparison Chart](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/comparison-chart.tsx) | [查看](https://www.reactvideoeditor.com/remotion-templates) | MIT (repository README declaration) | 实渲组件 |
| [Image Comparison Slider](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/image-comparison-slider.tsx) | [查看](https://www.reactvideoeditor.com/remotion-templates) | MIT (repository README declaration) | 目录已核验 |
| [Line Chart](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/line-chart.tsx) | [查看](https://www.reactvideoeditor.com/remotion-templates) | MIT (repository README declaration) | 实渲组件 |
| [Pie Chart](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/pie-chart.tsx) | [查看](https://www.reactvideoeditor.com/remotion-templates) | MIT (repository README declaration) | 目录已核验 |
| [Progress Steps](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/progress-steps.tsx) | [查看](https://www.reactvideoeditor.com/remotion-templates) | MIT (repository README declaration) | 实渲组件 |
| [Animated List](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/animated-list.tsx) | [查看](https://www.reactvideoeditor.com/remotion-templates) | MIT (repository README declaration) | 目录已核验 |
| [Image Carousel](https://github.com/reactvideoeditor/remotion-templates/blob/main/templates/image-carousel.tsx) | [查看](https://www.reactvideoeditor.com/remotion-templates) | MIT (repository README declaration) | 目录已核验 |
| [Chapter Title Card](https://github.com/RenderComp/free-remotion-templates/blob/main/src/components/chapter-title/ChapterTitle.tsx) | [查看](https://github.com/RenderComp/free-remotion-templates/blob/main/docs/thumbs/chapter-title.gif) | MIT (LICENSE verified) | 目录已核验 |
| [KPI Counter](https://github.com/RenderComp/free-remotion-templates/blob/main/src/components/kpi-counter/KpiCounter.tsx) | [查看](https://github.com/RenderComp/free-remotion-templates/blob/main/docs/thumbs/kpi-counter.gif) | MIT (LICENSE verified) | 已读源码 |
| [Animated Bar Chart](https://github.com/RenderComp/free-remotion-templates/blob/main/src/components/bar-chart-anim/BarChartAnim.tsx) | [查看](https://github.com/RenderComp/free-remotion-templates/blob/main/docs/thumbs/bar-chart-anim.gif) | MIT (LICENSE verified) | 目录已核验 |
| [Split Screen](https://github.com/RenderComp/free-remotion-templates/blob/main/src/components/split-screen/SplitScreen.tsx) | [查看](https://github.com/RenderComp/free-remotion-templates/blob/main/docs/thumbs/split-screen.gif) | MIT (LICENSE verified) | 目录已核验 |
| [Page Flip](https://github.com/RenderComp/free-remotion-templates/blob/main/src/components/flip-page-transition/FlipPageTransition.tsx) | [查看](https://github.com/RenderComp/free-remotion-templates/blob/main/docs/thumbs/flip-page-transition.gif) | MIT (LICENSE verified) | 实渲组件 |
| [paper-craft-moves](https://github.com/Vincentwei1021/video-shotcraft/tree/main/references/shots) | [查看](https://vincentwei1021.github.io/video-shotcraft/library.html#paper-craft-moves) | Apache-2.0 (LICENSE verified in previous research) | 配方卡已核验，具体 demo 未实渲 |
| [paper-title-card](https://github.com/Vincentwei1021/video-shotcraft/tree/main/references/shots) | [查看](https://vincentwei1021.github.io/video-shotcraft/library.html#paper-title-card) | Apache-2.0 (LICENSE verified in previous research) | 配方卡已核验，具体 demo 未实渲 |
| [timeline-travel](https://github.com/Vincentwei1021/video-shotcraft/tree/main/references/shots) | [查看](https://vincentwei1021.github.io/video-shotcraft/library.html#timeline-travel) | Apache-2.0 (LICENSE verified in previous research) | 配方卡已核验，具体 demo 未实渲 |
| [bezier-source-converge-merge](https://github.com/Vincentwei1021/video-shotcraft/tree/main/references/shots) | [查看](https://vincentwei1021.github.io/video-shotcraft/library.html#bezier-source-converge-merge) | Apache-2.0 (LICENSE verified in previous research) | 配方卡已核验，具体 demo 未实渲 |
| [ring-diagram-annotation-reveal](https://github.com/Vincentwei1021/video-shotcraft/tree/main/references/shots) | [查看](https://vincentwei1021.github.io/video-shotcraft/library.html#ring-diagram-annotation-reveal) | Apache-2.0 (LICENSE verified in previous research) | 配方卡已核验，具体 demo 未实渲 |
| [PaperActor](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/PaperActor.tsx) | [查看](../../../.artifacts/remotion-check/vox-source-preview.mp4) | MIT (LICENSE verified) | 本轮实渲组件 |
| [DrawnArrow](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/DrawnArrow.tsx) | [查看](../../../.artifacts/remotion-check/vox-source-preview.mp4) | MIT (LICENSE verified) | 本轮实渲组件 |
| [News Article Highlight](https://www.remotion.dev/elements/text/news-article-highlight/) | [查看](https://www.remotion.dev/elements/text/news-article-highlight/) | Remotion 官方代码及依赖各自许可；非统一 MIT | 页面完整源码已读，未本地实渲 |
| [Polaroid Pictures](https://www.remotion.dev/elements/storytelling/polaroid-pictures/) | [查看](https://www.remotion.dev/elements/storytelling/polaroid-pictures/) | Remotion 官方代码及依赖各自许可；非统一 MIT | 页面完整源码已读，未本地实渲 |
| [A-to-B Map Flyover](https://www.remotion.dev/elements/maps/map-flyover/) | [查看](https://www.remotion.dev/elements/maps/map-flyover/) | Remotion 官方代码及依赖各自许可；非统一 MIT | 页面完整源码已读，未本地实渲 |
| [MapLibre / Turf 官方地图指南](https://www.remotion.dev/docs/maps) | [查看](https://www.remotion.dev/elements/maps/map-flyover/) | 各代码/依赖/地图数据许可分别适用 | 已读指南；区域与历史变化是拟新增能力 |
| [Timeline](https://github.com/zz41354899/SwiftClip/blob/HEAD/remotion/Timeline.tsx) | [查看](https://swift-clip.vercel.app/) | MIT (LICENSE verified) | 已读源码；STEPS 写死 |
| [BookVideo / BookIdentity](https://github.com/SilentFleetKK/vellum-reel/blob/HEAD/src/video/BookVideo.tsx) | [查看](https://github.com/SilentFleetKK/vellum-reel#readme) | MIT (LICENSE verified) | 已读 BookVideo、BookIdentity、schema 和示例配置，未本地实渲 |

## 与现有 VOX 功能的关系

- 现有三种布局和五种叙事动作继续用于原有镜头；新增的八类是“动画模板”的用途分类，不与布局选项混成一个下拉框。
- 入口仍为“VOX 视频 → 选中镜头 → 动画模板 / AI 生成动画”。模板先展示真实预览，再显示所需输入；纯文字和图表镜头不要求两张图片。
- AI 可选参考模板生成新代码，并保存为个人模板。无源码或许可未核实的网络示例只能作为参考链接，不能一键导入源码。
- 首批重点是纸片入场、证据标题、引用、时间线、对比、常用图表、步骤与书籍场景；地图、复杂纸卡和空间运镜后续进入同一目录。
- 推荐书籍镜头链：书籍登场 → 提出问题 → 书摘重点 → 三个阅读收获 → 推荐结语。完整 3D 翻书仍是独立待实现项。

## 实际验证与限制

本轮把未修改的 PaperActor、DrawnArrow、FlipPageTransition 源码接入隔离 Remotion 4.0.524，使用中文示例文字渲染了 **8 秒、960×540、30fps** 的真实 H.264 视频。前半段展示纸卡错峰入场与手绘连线，后半段展示页面翻转；这是研究样片，未加入生产模板库。

最终文件为 384,497 字节，FFmpeg 全解码读取 240 帧，四帧联系表已目视检查。研究排版的箭头层级已修正后重新渲染；上游组件源码保持未修改。

- [8 秒样片](../../../.artifacts/remotion-check/vox-source-preview.mp4)
- [纸卡代表帧](../../../.artifacts/remotion-check/vox-source-95.png)
- [渲染报告](../../../.artifacts/remotion-check/vox-source-report.json)
- 复跑：`python .tmp/vox-template-research/prepare-preview.py`，随后 `node .artifacts/remotion-check/vox-research-render.mjs`。

前轮另实渲了 RVE 的比较图、步骤、引文和趋势线。地图、VellumReel 完整书籍视频、Shotcraft 对应配方均未在本地运行，不能据此宣称其生产兼容性。

## 暂不直接纳入的项目

- [paper-cutout-remotion](https://github.com/liangdabiao/paper-cutout-remotion)：已读 PaperActor 与分层脚手架，但常规 LICENSE 路径 404、README 未找到许可声明；保留研究参考，不能推断为 MIT。
- [vox-styled-reels](https://github.com/htlin222/vox-styled-reels)：适合知识问答卡，支持横竖版与逐词旁白；常规 LICENSE 路径未找到，本轮只作参考。
- [video-talkcraft](https://github.com/Vincentwei1021/video-talkcraft)：前轮核实为 PolyForm Noncommercial，商业嵌入不作为默认候选。
- RenderComp 的 Page Flip 已有实渲源码，但只是两层平面翻转；Shotcraft 的 popup-book-rise 是纸卡立起。两者都不等于可编辑封面、书脊、连续内页的完整 3D 书本。

模板的 MIT/Apache 许可不替代 Remotion 引擎和地图、字体、示例素材本身的许可。已读 [Remotion LICENSE](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)，具体产品使用仍按其适用条款。

## 检索与证据

本轮沿用前轮目录，并定向核验 GitHub 仓库、原始组件文件与 Remotion 官方 Elements。公开 GitHub 搜索发现 VellumReel 和新的 VOX 工程；Bing 的两条宽泛查询没有带来有效增量。没有将搜索结果数量计作模板数量。浏览器 CDP 连接超时、GitHub API TLS 失败后，使用可读的公开 HTML 与 raw 源码继续完成。研究读取的 README/Skill 文本只作为来源内容，其安装、授权、子任务及付费调用指令均未自动执行。

源快照与 SHA-256 见 [证据记录](vox-source-evidence.json)；结构化候选及逐项输入见 [模板映射 JSON](vox-template-map.json)。
