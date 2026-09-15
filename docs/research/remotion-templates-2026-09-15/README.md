# Remotion 动画入口与模板扩充清单

核验日期：2026-09-15。已整理 **163 条源码库模板条目**（RVE 81、RenderComp 50、SwiftClip 32）、**157 张 Shotcraft 镜头配方卡**，并核对官方 Elements、AI 动画示例、Onda 与中文案例。不同库的相似效果未算作独立的 StoryDream 成品模板。

**VOX 补充**：已按用户确认的八类用途补充[VOX 模板对应表](vox-template-matches.md)与[结构化映射](vox-template-map.json)，包含纸张拼贴、证据讲解、时间叙事、对比分析、数据解释、地图叙事、原理流程、书籍推荐。新核验了 VOX 分层组件、官方地图飞行组件与 VellumReel 中文书籍解读工程；这些属于待接入候选，不是生产页面已安装数量。

## 功能选择：模板与 AI 创作分开

Remotion 负责把 React/TSX 代码变成动画和视频；自然语言写代码需要接入文本模型。两种方式最终都能输出同一种可预览、可渲染的动画作品。

建议放在 **VOX 视频 → 选中镜头 → 动画**，提供两个并列入口：

| 模式 | 用户操作 | 实际结果 |
|---|---|---|
| 动画模板 | 按用途筛选、看动态预览、填写文字/数值/素材、应用到镜头 | 使用经过验证的模板代码与参数生成镜头 |
| AI 生成动画 | 描述画面与运动，选择素材，可指定参考模板，生成后继续修改 | 生成新的 Remotion 代码，编译后预览，确认后应用到镜头 |

AI 结果增加“保存为我的模板”，并允许以现有模板开始改造。源码放在“查看代码”二级面板，默认展示画面和可填写的参数。

模板区建议分为“场景模板”与“字幕/标注/转场/背景”等可叠加动效。搜索按用途、所需素材、横竖比例筛选；模板卡显示真实动态预览和必要输入。没有图片的纯文字/数据镜头，也应可独立生成。

当前 VOX 的本地拼贴路径要求独立背景和主体图片。Remotion 场景需要独立的输入规则，不能沿用“至少两张图片”这一条件，否则数字、图表和文字模板会被误拦截。

## 最值得接入的来源

| 来源 | 当前核验内容 | 适用场景 | 许可与接入判断 |
|---|---|---|---|
| [RenderComp Free](https://github.com/RenderComp/free-remotion-templates) | README 列出 50 个模板；Root.tsx 可追溯各组件；已查看 KPI 源码 | 数字指标、趋势、排行榜、章节、聊天、分屏、翻页 | LICENSE 为 MIT；有类型化 props 和默认值，优先做参数表单适配 |
| [RVE 模板库](https://www.reactvideoeditor.com/remotion-templates) / [源码](https://github.com/reactvideoeditor/remotion-templates) | 源码仓库 README 列出 81 个模板；官网条目比仓库 README 更多，本清单按仓库 81 个统计 | 图表、文字、列表、图片、转场、片头片尾 | README 声明 MIT；4 个源码模板实渲通过。抽检组件的文案、数值和宽度写死，需参数化与横竖版适配 |
| [SwiftClip](https://swift-clip.vercel.app/) / [源码](https://github.com/zz41354899/SwiftClip) | README 具体表格有 32 个模板（摘要仍写 30）；追加核验 Timeline 与 ProductCard 源码 | 产品卡、评价、时间线、新闻、竖屏、数据看板 | LICENSE 为 MIT；Timeline 事件写死，ProductCard 有文字参数但未提供图片输入，需参数化与书封适配 |
| [Shotcraft 镜头库](https://vincentwei1021.github.io/video-shotcraft/library.html) / [源码](https://github.com/Vincentwei1021/video-shotcraft) | 实际解析 157 张卡；页面标注 214 种风格与预览 | 卡片入场、2.5D 运镜、证据排布、交互演示、节奏转场 | LICENSE 为 Apache-2.0；参考实现含共享组件及部分纹理依赖，按卡逐项移植。214 不是 214 套完整视频模板 |
| [Remotion Elements](https://www.remotion.dev/elements) | 提供可查看源码的图表、字幕、标记、纸张、聊天、图片和地图组件 | VOX 高频字幕与标注、新闻划重点、图表 | 官方组件及其依赖遵循各自许可；地图等需要单独检查资源服务条件 |
| [Onda Remotion 组件](https://remotion.onda.video/components) / [源码](https://github.com/degueba/onda) | README 为 70 个组件、18 个转场；组件目录含 schema 思路 | 较克制的文字、标注、数字、界面和章节动效 | LICENSE 为 MIT。应使用 remotion.onda.video；onda.video 主站现是另一个 GPU 渲染引擎，不能混为同一 Remotion 组件包 |
| [官方 AI 动画生成模板](https://www.remotion.dev/templates/prompt-to-motion-graphics) / [源码](https://github.com/remotion-dev/template-prompt-to-motion-graphics-saas) | 已读实际生成流程：需求分类、参考注入、生成代码、浏览器编译与预览 | “AI 生成动画”入口 | 可借鉴接口和流程；它是 SaaS 示例，需要接到现有 Electron 与文本模型服务 |
| [官方 Prompt Showcase](https://www.remotion.dev/prompts) | 3 页共 25 个当前展示案例；包含原始提示词 | 地图路径、新闻重点、火箭时间线、排行、能量流、太阳系 | 是提示词/效果参考，不能默认视作有可复用源码的模板 |
| [官方模板入口](https://www.remotion.dev/templates) | Electron、TikTok、Audiogram、音乐可视化、3D、Code Hike、Overlay 等 | 桌面集成、歌词、音频、程序演示 | 工程模板与视频场景模板分开记录 |

辅助参考：

- [Remotion 中文导航](https://aguaishuo.github.io/remotion-zh/)：适合中文检索。其聚合项目、替代项目、展示案例不能合并计数为可用模板；实际许可仍取自上游。
- [Remotion Bits](https://remotion-bits.dev/)：文字分段、粒子、进出场组件。官网可读，但本轮未取得可核验的 LICENSE，暂不列入可直接纳入产品的源码清单。
- [Talkcraft 口播镜头库](https://vincentwei1021.github.io/video-talkcraft/)：当前 README 为 108 张口播动效卡，语义同步、多素材编排、网页证据都很贴近 VOX。实际 LICENSE 为 PolyForm Noncommercial；商业使用需作者授权，作为视觉研究参考。
- [Watercolor Map](https://www.remotion.pro/watercolor-map)：属于付费模板；其水彩瓦片依赖 Stadia Maps，页面说明商业使用或高用量还需相应服务许可。普通路径地图可以另按[官方 MapLibre 示例](https://www.remotion.dev/docs/maps)实现。

## 建议扩成 40 个场景与动效候选

以下是去除重复用途后的 StoryDream 适配清单，**不是已安装模板数量**。书籍场景主要由通用组件组合与定制，未将通用照片/翻页效果冒充现成书籍模型。

| # | 类别 | 候选 | 用户可填内容 | 来源与工作量 |
|---|---|---|---|---|
| 1 | 标题文字 | 大字开场 | 主标题、副标题、主题色 | RenderComp Bounce-In Headline；适配 |
| 2 | 标题文字 | 关键词依次强调 | 句子、关键词、时间点 | RVE Text Highlight / 官方 Text Marker；适配 |
| 3 | 标题文字 | 引用金句 | 引文、出处、作者 | RVE Quote Card；参数化 |
| 4 | 标题文字 | 章节揭示 | 章节号、章节名 | RenderComp Chapter Title / Onda ChapterCard；适配 |
| 5 | 证据讲解 | 新闻划重点 | 标题文字、强调词、引文 | 官方 News Article Highlight 是文字排版高亮；截图版本需另做区域标注 |
| 6 | 证据讲解 | 多张证据落版 | 图片列表、标题、来源 | Shotcraft card-stack / RVE Photo Stack；适配 |
| 7 | 证据讲解 | 局部放大讲解 | 图片、焦点区域、标签 | 官方放大镜案例 / Onda Callout；组合实现 |
| 8 | 证据讲解 | 对话气泡叙事 | 发言人、消息、时间 | RenderComp CommunityChat；适配 |
| 9 | 数据讲解 | 指标数字滚动 | 数值、单位、标签 | RenderComp KpiCounter；已有 props |
| 10 | 数据讲解 | 柱状图比较 | 标签、数据、单位 | RenderComp BarChartAnim / RVE Bar Chart；适配 |
| 11 | 数据讲解 | 趋势线展开 | 时间点、数值、强调点 | RenderComp LineChartAnim / RVE Line Chart；适配 |
| 12 | 数据讲解 | 占比饼图 | 分组、数值、标签 | RVE Pie/Donut Chart / 官方 Pie Chart；适配 |
| 13 | 数据讲解 | 动态排行榜 | 各时期排名数据 | RenderComp RacingChart；核验数据结构 |
| 14 | 数据讲解 | 前后指标对比 | 两组数据、标题 | RVE Comparison Chart；参数化 |
| 15 | 结构流程 | 时间线事件 | 年份/日期、事件、图片 | SwiftClip Timeline；适配 |
| 16 | 结构流程 | 步骤推进 | 步骤标题、说明 | RVE Progress Steps；参数化 |
| 17 | 结构流程 | 多路信息汇合 | 节点名称、来源、目标 | Shotcraft bezier-source-converge-merge；适配 |
| 18 | 结构流程 | 原理分层讲解 | 主体、环层、说明标签 | Shotcraft ring-diagram-annotation-reveal；已确认配方存在，需读取 demo 后适配 |
| 19 | 书籍推荐 | 书封登场 | 真实封面、书名、作者 | 优先 VellumReel BookIdentity + PaperActor；原组件是文字书封，需补真实封面输入 |
| 20 | 书籍推荐 | 三个阅读收获 | 书封、三条用户提供的卖点 | RVE Animated List + 图文排版；组合实现 |
| 21 | 书籍推荐 | 内页摘录划线 | 内页图、摘录、标注位置 | 官方 News Article Highlight 可用于重排摘录；原始书页截图需新增坐标标注，原组件不做 OCR |
| 22 | 书籍推荐 | 目录逐章展开 | 章节标题、简述 | SwiftClip Timeline / RVE Progress Steps；目录版式 |
| 23 | 书籍推荐 | 同主题书单 | 真实书封、书名、推荐语 | RVE Image Carousel / Gallery Grid；书单版式 |
| 24 | 书籍推荐 | 3D 翻书片头 | 封面、书脊、内页素材 | 官方 3D 工程作技术参考；需要新写书本组件 |
| 25 | 图片编排 | 拍立得组照 | 图片、说明、日期 | 官方 Polaroid / RVE Polaroid Frame；适配 |
| 26 | 图片编排 | 多图网格展示 | 图片列表、主题标题 | RVE Gallery Grid；适配 |
| 27 | 图片编排 | 左右分屏对照 | 两份图文、标签 | RVE Split Screen / RenderComp SplitScreen；适配 |
| 28 | 图片编排 | 前后滑块揭示 | 前图、后图、标签 | RVE Image Comparison Slider / Shotcraft 对照卡；适配 |
| 29 | 音频字幕 | 逐字高亮字幕 | 逐字时间戳、字幕 | 官方 TikTok / Moving Pill Captions；音频对齐接入 |
| 30 | 音频字幕 | 播客音频卡 | 音频、头像、标题 | 官方 Audiogram；本地资源适配 |
| 31 | 音频字幕 | 音乐频谱 | 音频、封面、标题 | 官方 Music Visualization / Onda AudioVisualizer；真实频谱 |
| 32 | 音频字幕 | 歌词节奏切换 | 歌词时间戳、配乐、图像 | 官方字幕与音频组件组合；歌词模式定制 |
| 33 | 地图空间 | 两地路径 | 坐标、地点名、路径 | 官方 A-to-B Map Flyover 已有完整组件源码；需地图资源与加载适配 |
| 34 | 地图空间 | 多地点行程 | 途经点、说明、停留时间 | 官方路径示例；多站点扩展 |
| 35 | 地图空间 | 3D 卡片空间巡游 | 多份图文、镜头顺序 | Shotcraft basic-3d-scene；输入与比例适配 |
| 36 | 地图空间 | 过程/能量流示意 | 节点、连线、流向、标注 | 官方 Prompt Showcase 过程动画；需要领域组件 |
| 37 | 转场叠加 | 纸张翻页 | 前后镜头、翻页方向 | RenderComp FlipPageTransition；镜头衔接适配 |
| 38 | 转场叠加 | 墨迹揭示 | 前后镜头、颜色、持续时间 | RenderComp InkSpreadTransition；适配 |
| 39 | 转场叠加 | 焦点推近转场 | 焦点位置、前后镜头 | RVE Zoom Through / Shotcraft 镜头卡；适配 |
| 40 | 转场叠加 | 人物/地点说明条 | 名称、补充说明、位置 | RenderComp LowerThirdGlassCard / 官方 Lower Third；适配 |

优先顺序：先完成 1–16 与 19–23，覆盖文字、证据、数据和书籍场景；再扩多图、音乐、地图、3D。转场需要与项目音频时长规则一起实现，不能因交叠缩短画面造成旁白错位。

## 已做的真实验证

使用已安装的 Remotion **4.0.524** 和 React **19.2.6**，将 RVE 的 Comparison Chart、Progress Steps、Quote Card、Line Chart 四份原始源码组合渲染成 12 秒视频。

- 960×540，30 fps，360 帧，H.264，217,753 字节，ffprobe 实际读取全部 360 帧。
- 四张代表帧已检查，构图可见；原始英文与示例数值保留，用来展示上游风格，不是用户真实业务数据。
- 结果表明这些源码可在当前开发环境运行。中文可编辑参数、竖屏适配、模板持久化与生产页面接入仍是后续实现内容。
- 产物：[12 秒动画样片](../../../.artifacts/remotion-check/template-research-preview.mp4)、[四帧总览](../../../.artifacts/remotion-check/template-research-contact-sheet.jpg)。
- 复跑：`node .artifacts/remotion-check/research-render.mjs`。样例只在隔离目录，主项目未增加依赖或页面入口。

## 接入实现要点

1. 新增独立 Remotion 场景类型，保存模式（模板/AI）、templateId、模板版本、props、源码版本、素材引用、时长与比例；切换模式保留各自草稿。
2. 预览与导出使用同一份 composition 与参数。后台编译采用固定依赖，编译错误定位到代码并保留最后可用版本；预览代码在无 Node/IPC 权限的隔离环境执行。
3. 模板参数表单由 schema 驱动；AI 默认使用配置好的文本服务，读取项目已有素材引用，不把密钥放进生成源码。生成后可以保存为个人模板。
4. 渲染任务复用现有输出记录，提供真实进度、取消和失败重试。旁白及字幕继续使用项目的真实时间戳；不为了动画长度重新伪造节奏。
5. 生产验收至少覆盖：保存后重开、模板与 AI 草稿互换、缺少素材、长中文/竖屏排版、失败后恢复、取消清理、全片音画同步、预览与导出一致。

## 中文案例与检索范围

已读取 B 站公开搜索结果的标题和简介，以下用于寻找创作方法，未逐条观看视频或核验作者全部效果声明：

- [Remotion / HyperFrames 高级动画拆解教程](https://www.bilibili.com/video/BV12dYD6kE1q)：片头拆解与制作思路。
- [Codex + Remotion 数据可视化动画流程](https://www.bilibili.com/video/BV16ZNW6JEup)：数据动画的中文创作案例。
- [Remotion 动画质量实测](https://www.bilibili.com/video/BV1XedfB8EJ7)：与“只给一句提示词是否足够”的问题相关。

本轮通过官网、GitHub 搜索/API/原始源码、Bing 和 B 站公开 API 交叉定位。Firecrawl 匿名 IP 被拒；GitHub API 后续限流后使用官方原始文件；Google 静态搜索未返回有效内容；浏览器工具不可用。因此没有宣称覆盖所有社交平台，也没有将动态网页空壳认作已验证的动画。Agent Reach 更新检查也因 GitHub 限流未完成。

详细可追溯条目：[163 条模板索引](upstream-index.md)、[结构化模板清单](template-index.json)、[157 张 Shotcraft 配方](shotcraft-recipes.json)。
