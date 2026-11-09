# 提示词模板源码盘点与应用规则

统计日期：2026-10-28。范围为当前工作区已有创作流程，默认提示词从原有源码、Lemo 参考文档和风格适配器提取。本次没有另写一套默认提示词。

## 项目类别与统计口径

系统有 **5 个项目创作类别**。内容赛道、文案风格、视觉风格和模型调用步骤是不同层次，不能合并算作项目类别。

| 项目类别 | 类型 ID | 专属工作流规则 | 现有结构 |
| --- | --- | ---: | --- |
| 短片生成 | story | 14 | 9 套任务模板，每套含文案改写、封面、分镜、绘图提示词；另有预审、角色卡、输出协议等 |
| HTML 动画 | html-video | 6 | 资料文案、文案改写、场景规划、前景素材协议、HyperFrames 创作协议；可选现有内容赛道和文案风格 |
| 创意动画 | editorial-collage | 219 | 文案、时长与输出格式、分镜/图层、图片、动作、Remotion/Lemo 生成与增量编辑，以及完整风格参考 |
| AI 漫剧 | motion-comic | 6 | 核心设定、系列规划、单集规划、分集输出与修复；保持原有结构化协议 |
| 音乐 MV | music-mv | 1 | 现有视觉提示词拼装规则；当前没有独立的 LLM 文案创作流程 |
| 公共规则（非项目类别） | shared | 30 | 11 条内容赛道、6 条文案风格、资料策略、新媒体表达、精修和部分导演文案规则 |
| 合计 | | **276** | 该列按默认所属频道计数；公共规则仅提供给实际调用它的频道 |

模板库默认共有 **290 条记录**：9 套短片任务模板 + 276 条工作流规则 + 5 条独立步骤模板（预审、改写、封面、分镜、绘图提示词）。

“记录数”不等于“完全不同的提示词文本数”：9 套任务模板内部有 36 个步骤入口，精确去重后是 28 段；276 条工作流规则精确去重后是 275 段；把 36 个任务步骤、276 条工作流规则和 5 条独立步骤放在一起，共 317 个内容入口、305 段不同文本。此处按存储的完整字符串比较，保留动态占位符；其中包含拼装规则和协议片段，并不表示 305 次独立模型调用。任务模板的说明文字不作为生成提示词另计。

## 原有赛道和风格

短片任务模板 **9 套**：人物故事、文化科普、电商带货、民间故事、美食探店V2、通用故事、健康图书、心灵鸡汤、绘本故事。原始赛道差异、角色策略和四步提示词继续保留。

公共内容赛道 **11 种**：人物故事、民间故事、电商带货、好书带货、知识科普、文化科普、绘本故事、健康图书、情感共鸣、美食探店、通用故事。公共赛道建议与短片任务模板分别来自原有两个数据源，数量和命名本来就不同。

文案创作风格 **6 种**：纪实解释、故事叙事、观点评论、轻松科普、数据解读、文化随笔。HTML 动画和创意动画都使用这套现有风格；可编辑公共默认，也可新增只对其中一个频道生效的版本。

创意视觉风格 **59 种**：每种保留完整 `STYLE.md` 参考，以及图片构图和动作两条适配规则，共 **59 份风格参考 + 118 条图片/动作规则**；另保留导演参考、技术参考和各生成阶段协议。这些包含在上表 219 条中，不能再重复相加。

## 原来不完整的原因

- 原模板库主要管理 9 套短片任务模板和 5 条步骤默认，其他工作流的系统规则分散在源码、参考文档和风格适配器中。
- 内容赛道和文案风格原来作为代码常量参与拼装，没有进入统一模板库。
- 部分创意文案在前端就拼好请求，后端即使保存新模板也不会重新读取拼装规则。
- 短片任务的内置步骤优先级覆盖了单独编辑的步骤模板，导致部分“保存”不影响真实请求。
- 列表使用轻量摘要，直接从列表克隆会缺少完整提示词和任务内的步骤内容。

## 本次保存和生效方式

1. 原有默认以固定 ID、类型、用途和所属频道注册，不提供删除操作。允许编辑正文与名称，修改后跨重启保留；可恢复源码原文。
2. 自定义工作流模板先选“提示词用途”，再选该用途实际支持的“生效频道”。更换用途时载入其源码原文；已有频道兼容时保留选择。
3. “保存为备用”仅保存内容并停用该自定义模板；“保存并应用”保存并启用。新建和克隆的自定义模板默认未启用。
4. 同一用途，频道专用规则优先于公共规则；同一频道优先使用已修改默认或自定义，再按最近保存时间选择。未修改的默认继续返回原有源码表达式，确保默认输出兼容。
5. 短片独立步骤覆盖未修改的内置任务默认；用户明确修改或选用的自定义任务步骤仍保留自己的优先级。
6. 实际生成时由主进程读取持久化模板。创意文案请求在后端重新拼装，图片/动作适配器也在实际调用时解析。前端列表摘要不充当生成内容。
7. 未识别的变量会在保存时拦截；运行时提供原有动态值。各用途的 JSON、HTML、代码、旁白等输出要求仍来自原实现。
8. 变更作用于下一次生成；已有文案、分镜、图片或成片需重新执行对应步骤。重置内置默认保留用户新增模板。

## 验证与实现入口

相关回归覆盖默认输出等价、频道隔离、停用与优先级、真实请求拼装、59 种风格适配器、变量校验、SQLite 保存与重启、重置保留自定义，以及短片独立步骤覆盖。

- 原文语料：`src/shared/workflow-prompt-corpus.json`
- 用途、变量与来源：`src/shared/workflow-prompt-catalog.ts`
- 运行时解析与频道约束：`src/shared/workflow-prompt-runtime.ts`
- 模板库与工作流编辑器：`src/features/templates/PromptTemplatesPage.tsx`、`WorkflowPromptEditor.tsx`
- 关键回归：`tests/workflow-prompts.test.ts`
- 桌面验收：`scripts/qa-workflow-prompts.py`，报告在 `.artifacts/workflow-prompts/report.json`

## 本次验收结果

- 12 个相关测试文件，216 项通过；另有 17 项模板管理、重启保留和命令绑定检查通过。
- 三套 TypeScript 检查通过：`tsconfig.json`、`tsconfig.electron.json`、`tsconfig.scripts.json`，未使用 `skipLibCheck`。
- Renderer 和 Electron 生产构建通过。
- 隔离配置下的 Electron 桌面验收通过 8 项检查，检查 1440×900 与 1040×720 的模板库、编辑器、HTML 创作页共 6 张截图，无横向溢出、无运行时错误。
- 测试使用模拟模型返回和本地隔离数据库，没有付费 API 调用；已验证保存的模板进入实际请求拼装。
- 扩展检查仍发现授权状态/激活页、侧栏版本、草稿模板与部分无关命令清单的失败，本次未将整仓测试报告为通过。相关旧模板行为断言已经更新并单独复验。

机器可读的本次验收汇总：`.artifacts/workflow-prompts/validation.json`。桌面截图与报告仅为本地验收产物，不包含用户真实项目或凭据。

## 工作流用途全量索引

下表逐条对应已提取的原有调用位置。动态变量说明可在模板编辑器查看。公共规则可用频道按实际调用范围限制，不在这里复制提示词正文。

| 用途 ID | 名称 | 默认所属频道 | 原文来源 |
| --- | --- | --- | --- |
| research-copy | 资料文案 · 创作系统规则 | shared | src/shared/research.ts |
| html-planning | HTML 动画 · 场景规划 | html-video | src/shared/task-runtime-providers.ts |
| html-rewrite | HTML 动画 · 文案改写 | html-video | src/shared/task-runtime-providers.ts |
| vox-code | 创意动画 · Remotion 代码生成 | editorial-collage | src/shared/vox-animation-prompt.ts |
| story-narrative | 短片 · 叙事规划 | story | src/shared/runner.ts |
| story-platform | 短片 · 平台适配 | story | src/shared/runner.ts |
| story-rewrite-contract-1 | 短片 · 改写与评选输出协议 1 | story | src/shared/runner.ts |
| story-rewrite-contract-2 | 短片 · 改写与评选输出协议 2 | story | src/shared/runner.ts |
| story-cover-contract | 短片 · 封面输出协议 | story | src/shared/runner.ts |
| story-length-repair | 短片 · 篇幅修复 | story | src/shared/runner.ts |
| story-character | 短片 · 角色档案 | story | src/shared/runner.ts |
| story-image-contract | 短片 · 绘图输出协议 | story | src/shared/runner.ts |
| editorial-scene | 创意动画 · 纸拼贴场景 | editorial-collage | src/shared/editorial-image-prompts.ts |
| editorial-layer | 创意动画 · 纸拼贴图层 | editorial-collage | src/shared/editorial-image-prompts.ts |
| creative-scene | 创意动画 · 场景画面简报 | editorial-collage | src/shared/creative-animation/image-prompts.ts |
| creative-layer | 创意动画 · 分层素材简报 | editorial-collage | src/shared/creative-animation/image-prompts.ts |
| music-mv-image | 音乐 MV · 镜头画面提示词 | music-mv | src/shared/runner.ts |
| creative-plan | 创意动画 · 预设画面规划 | editorial-collage | electron/vox-production-runtime.ts |
| html-foreground | HTML 动画 · 前景素材规则 | html-video | src/shared/task-runtime-providers.ts |
| writing-track:character-story | 内容赛道 · 人物故事 | shared | src/shared/copywriting-tracks.ts |
| writing-track:folk-tale | 内容赛道 · 民间故事 | shared | src/shared/copywriting-tracks.ts |
| writing-track:ecommerce | 内容赛道 · 电商带货 | shared | src/shared/copywriting-tracks.ts |
| writing-track:book-product | 内容赛道 · 好书带货 | shared | src/shared/copywriting-tracks.ts |
| writing-track:knowledge | 内容赛道 · 知识科普 | shared | src/shared/copywriting-tracks.ts |
| writing-track:culture-knowledge | 内容赛道 · 文化科普 | shared | src/shared/copywriting-tracks.ts |
| writing-track:picture-book | 内容赛道 · 绘本故事 | shared | src/shared/copywriting-tracks.ts |
| writing-track:health-book | 内容赛道 · 健康图书 | shared | src/shared/copywriting-tracks.ts |
| writing-track:inspirational | 内容赛道 · 情感共鸣 | shared | src/shared/copywriting-tracks.ts |
| writing-track:food-vlog | 内容赛道 · 美食探店 | shared | src/shared/copywriting-tracks.ts |
| writing-track:general | 内容赛道 · 通用故事 | shared | src/shared/copywriting-tracks.ts |
| writing-style:documentary | 文案风格 · 纪实解释 | shared | src/shared/editorial-writing-styles.ts |
| writing-style:story | 文案风格 · 故事叙事 | shared | src/shared/editorial-writing-styles.ts |
| writing-style:commentary | 文案风格 · 观点评论 | shared | src/shared/editorial-writing-styles.ts |
| writing-style:popular-science | 文案风格 · 轻松科普 | shared | src/shared/editorial-writing-styles.ts |
| writing-style:data | 文案风格 · 数据解读 | shared | src/shared/editorial-writing-styles.ts |
| writing-style:cultural-essay | 文案风格 · 文化随笔 | shared | src/shared/editorial-writing-styles.ts |
| comic-speaker-repair | 漫剧 · 对白归属修复 | motion-comic | src/shared/motion-comic-planner.ts |
| comic-script | 漫剧 · 剧本与资产规划 | motion-comic | src/shared/motion-comic-planner.ts |
| comic-storyboard | 漫剧 · 分镜导演 | motion-comic | src/shared/motion-comic-planner.ts |
| comic-episodes | 漫剧 · 分集边界规划 | motion-comic | src/shared/motion-comic-episode-planner.ts |
| lemo-system | 创意动画 · Lemo 导演与代码协议 | editorial-collage | src/shared/creative-animation/native-film.ts |
| comic-repair | 漫剧 · 剧本分镜校验修复 | motion-comic | src/shared/motion-comic-planner.ts |
| research-strategy-1 | 公共文案 · 素材策略 1 | shared | src/shared/research.ts |
| research-strategy-2 | 公共文案 · 素材策略 2 | shared | src/shared/research.ts |
| research-strategy-3 | 公共文案 · 素材策略 3 | shared | src/shared/research.ts |
| research-strategy-4 | 公共文案 · 素材策略 4 | shared | src/shared/research.ts |
| story-review-strategy-1 | 短片预审 · 素材策略 1 | story | src/shared/research.ts |
| story-review-strategy-2 | 短片预审 · 素材策略 2 | story | src/shared/research.ts |
| story-review-strategy-3 | 短片预审 · 素材策略 3 | story | src/shared/research.ts |
| story-review-strategy-4 | 短片预审 · 素材策略 4 | story | src/shared/research.ts |
| story-review-system | 短片 · 预审系统协议 | story | src/shared/research.ts |
| writing-expression | 公共文案 · 新媒体表达 | shared | src/shared/copywriting-tracks.ts |
| writing-refinement | 公共文案 · 精修与优先级 | shared | src/shared/copywriting-tracks.ts |
| comic-episodes-repair | 漫剧 · 分集校验修复 | motion-comic | src/shared/motion-comic-episode-planner.ts |
| lemo-stage-1 | Lemo · Return only JSON {"treatment":"complete treatment in Chinese","fps": | editorial-collage | src/shared/creative-animation/native-film.ts |
| lemo-stage-2 | Lemo · Write the treatment first: three candidate structures and your choic | editorial-collage | src/shared/creative-animation/native-film.ts |
| lemo-stage-3 | Lemo · Return ONLY one complete HTML document, no Markdown. Use Canvas2D, W | editorial-collage | src/shared/creative-animation/native-film.ts |
| lemo-stage-4 | Lemo · Implement the original protocol: window.DUR in seconds must equal th | editorial-collage | src/shared/creative-animation/native-film.ts |
| lemo-stage-5 | Lemo · Use seeded random from core/lib.js; no wall-clock animation or unsee | editorial-collage | src/shared/creative-animation/native-film.ts |
| lemo-stage-6 | Lemo · ES module imports available locally: "three" (0.170.0), "./core/lib. | editorial-collage | src/shared/creative-animation/native-film.ts |
| lemo-stage-7 | Lemo · Own all visible text including subtitles, integrated into this style | editorial-collage | src/shared/creative-animation/native-film.ts |
| lemo-stage-8 | Lemo · The host mixes the supplied voice and user-selected music. Do not pl | editorial-collage | src/shared/creative-animation/native-film.ts |
| lemo-batch-1 | Lemo · Create reusable canvas, palette, typography, prepared assets and dra | editorial-collage | electron/lemo-incremental-authoring.ts |
| lemo-batch-2 | Lemo · Compose scenes and transitions over absolute time; aggregate active  | editorial-collage | electron/lemo-incremental-authoring.ts |
| lemo-batch-3 | Lemo · Implement only assigned shot windows using shared APIs (target <=600 | editorial-collage | electron/lemo-incremental-authoring.ts |
| lemo-batch-4 | Lemo · Return strict JSON {baseHash, edits:[{search,replace}], done:boolean | editorial-collage | electron/lemo-incremental-authoring.ts |
| lemo-batch-5 | Lemo · Factory parameters (input,shared,scenes,core,THREE). Shared returns  | editorial-collage | electron/lemo-incremental-authoring.ts |
| lemo-file-1 | 创意动画 · 工程文件协议 1 | editorial-collage | electron/lemo-project-runtime.ts |
| lemo-file-2 | 创意动画 · 工程文件协议 2 | editorial-collage | electron/lemo-project-runtime.ts |
| lemo-file-3 | 创意动画 · 工程文件协议 3 | editorial-collage | electron/lemo-project-runtime.ts |
| lemo-file-4 | 创意动画 · 工程文件协议 4 | editorial-collage | electron/lemo-project-runtime.ts |
| lemo-host-1 | 创意动画 · 分批创作宿主 1 | editorial-collage | electron/main.ts |
| lemo-host-2 | 创意动画 · 分批创作宿主 2 | editorial-collage | electron/main.ts |
| director-copy-1 | 创意动画 · 完整原稿篇幅规则 | shared | src/shared/director-copy-assist.ts |
| director-copy-2 | AI 漫剧 · 核心设定格式 | shared | src/shared/director-copy-assist.ts |
| director-copy-3 | 创意动画 · 原稿修改规则 | shared | src/shared/director-copy-assist.ts |
| director-copy-4 | AI 漫剧 · 设定修改规则 | shared | src/shared/director-copy-assist.ts |
| director-copy-5 | 创意动画 · 用户要求优先级 | shared | src/shared/director-copy-assist.ts |
| editorial-intent-1 | 创意动画 · 画面意图 1 | editorial-collage | src/shared/editorial-image-prompts.ts |
| editorial-intent-2 | 创意动画 · 画面意图 2 | editorial-collage | src/shared/editorial-image-prompts.ts |
| editorial-target-1 | 创意动画 · 图片输出目标 1 | editorial-collage | src/shared/editorial-image-prompts.ts |
| editorial-target-2 | 创意动画 · 图片输出目标 2 | editorial-collage | src/shared/editorial-image-prompts.ts |
| editorial-target-3 | 创意动画 · 图片输出目标 3 | editorial-collage | src/shared/editorial-image-prompts.ts |
| editorial-target-4 | 创意动画 · 图片输出目标 4 | editorial-collage | src/shared/editorial-image-prompts.ts |
| creative-target-1 | 创意动画 · 材质图片输出目标 1 | editorial-collage | src/shared/creative-animation/image-prompts.ts |
| story-tail-anchors | 短片 · 分镜尾句锚点协议 | story | src/shared/runner.ts |
| html-authoring | HTML 动画 · HyperFrames 宿主协议 | html-video | src/shared/html-video-authoring.ts |
| lemo-director-reference | Lemo · 导演方法参考 | editorial-collage | vendor/lemo-opuscar/DIRECTOR.md |
| lemo-technique-reference | Lemo · 技术参考 | editorial-collage | vendor/lemo-opuscar/TECHNIQUE.md |
| lemo-style:caption-news | Lemo 完整风格 · 字幕新闻 | editorial-collage | vendor/lemo-opuscar/styles/caption-news/STYLE.md |
| lemo-style:newsreel | Lemo 完整风格 · 1920s 新闻影片 | editorial-collage | vendor/lemo-opuscar/styles/newsreel/STYLE.md |
| lemo-style:countdown | Lemo 完整风格 · 实时倒计时分屏 | editorial-collage | vendor/lemo-opuscar/styles/countdown/STYLE.md |
| lemo-style:city-symphony | Lemo 完整风格 · 延时交响 | editorial-collage | vendor/lemo-opuscar/styles/city-symphony/STYLE.md |
| lemo-style:visual-investigation | Lemo 完整风格 · 视觉调查 | editorial-collage | vendor/lemo-opuscar/styles/visual-investigation/STYLE.md |
| lemo-style:kino-montage | Lemo 完整风格 · 构成主义蒙太奇 | editorial-collage | vendor/lemo-opuscar/styles/kino-montage/STYLE.md |
| lemo-style:telestrator | Lemo 完整风格 · 体育战术板 | editorial-collage | vendor/lemo-opuscar/styles/telestrator/STYLE.md |
| lemo-style:news-package | Lemo 完整风格 · 电视新闻包装 | editorial-collage | vendor/lemo-opuscar/styles/news-package/STYLE.md |
| lemo-style:satellite-briefing | Lemo 完整风格 · 卫星简报 | editorial-collage | vendor/lemo-opuscar/styles/satellite-briefing/STYLE.md |
| lemo-style:briefing-board | Lemo 完整风格 · 工程简报板 | editorial-collage | vendor/lemo-opuscar/styles/briefing-board/STYLE.md |
| lemo-style:lidar-survey | Lemo 完整风格 · 点云测绘 | editorial-collage | vendor/lemo-opuscar/styles/lidar-survey/STYLE.md |
| lemo-style:white-model | Lemo 完整风格 · 白模投影 | editorial-collage | vendor/lemo-opuscar/styles/white-model/STYLE.md |
| lemo-style:data-physical | Lemo 完整风格 · 数据实物化 | editorial-collage | vendor/lemo-opuscar/styles/data-physical/STYLE.md |
| lemo-style:teardown | Lemo 完整风格 · 产品拆解 | editorial-collage | vendor/lemo-opuscar/styles/teardown/STYLE.md |
| lemo-style:microscope | Lemo 完整风格 · 显微叙事 | editorial-collage | vendor/lemo-opuscar/styles/microscope/STYLE.md |
| lemo-style:archive-lighttable | Lemo 完整风格 · 档案灯台 | editorial-collage | vendor/lemo-opuscar/styles/archive-lighttable/STYLE.md |
| lemo-style:crayon-book | Lemo 完整风格 · 蜡笔儿童绘本 | editorial-collage | vendor/lemo-opuscar/styles/crayon-book/STYLE.md |
| lemo-style:watercolor | Lemo 完整风格 · 水彩笔刷 | editorial-collage | vendor/lemo-opuscar/styles/watercolor/STYLE.md |
| lemo-style:ink-wash | Lemo 完整风格 · 中国水墨 | editorial-collage | vendor/lemo-opuscar/styles/ink-wash/STYLE.md |
| lemo-style:impasto | Lemo 完整风格 · 油画厚涂 | editorial-collage | vendor/lemo-opuscar/styles/impasto/STYLE.md |
| lemo-style:one-line | Lemo 完整风格 · 一笔画 | editorial-collage | vendor/lemo-opuscar/styles/one-line/STYLE.md |
| lemo-style:whiteboard | Lemo 完整风格 · 白板讲解 | editorial-collage | vendor/lemo-opuscar/styles/whiteboard/STYLE.md |
| lemo-style:urban-sketch | Lemo 完整风格 · 钢笔淡彩 | editorial-collage | vendor/lemo-opuscar/styles/urban-sketch/STYLE.md |
| lemo-style:shadow-puppet | Lemo 完整风格 · 皮影戏 | editorial-collage | vendor/lemo-opuscar/styles/shadow-puppet/STYLE.md |
| lemo-style:ukiyoe | Lemo 完整风格 · 浮世绘 | editorial-collage | vendor/lemo-opuscar/styles/ukiyoe/STYLE.md |
| lemo-style:papercut-red | Lemo 完整风格 · 红色窗花剪纸 | editorial-collage | vendor/lemo-opuscar/styles/papercut-red/STYLE.md |
| lemo-style:paper-lantern | Lemo 完整风格 · 纸雕灯影 | editorial-collage | vendor/lemo-opuscar/styles/paper-lantern/STYLE.md |
| lemo-style:risograph | Lemo 完整风格 · Risograph 孔版印刷 | editorial-collage | vendor/lemo-opuscar/styles/risograph/STYLE.md |
| lemo-style:halftone-dossier | Lemo 完整风格 · 复古半调案卷 | editorial-collage | vendor/lemo-opuscar/styles/halftone-dossier/STYLE.md |
| lemo-style:woodcut | Lemo 完整风格 · 木刻版画 | editorial-collage | vendor/lemo-opuscar/styles/woodcut/STYLE.md |
| lemo-style:engraving | Lemo 完整风格 · 铜版画 | editorial-collage | vendor/lemo-opuscar/styles/engraving/STYLE.md |
| lemo-style:silkscreen-poster | Lemo 完整风格 · 丝印旅行海报 | editorial-collage | vendor/lemo-opuscar/styles/silkscreen-poster/STYLE.md |
| lemo-style:swiss-motion | Lemo 完整风格 · 瑞士动态排版 | editorial-collage | vendor/lemo-opuscar/styles/swiss-motion/STYLE.md |
| lemo-style:spy-titles | Lemo 完整风格 · 60s 间谍片头 | editorial-collage | vendor/lemo-opuscar/styles/spy-titles/STYLE.md |
| lemo-style:art-deco | Lemo 完整风格 · 装饰艺术 | editorial-collage | vendor/lemo-opuscar/styles/art-deco/STYLE.md |
| lemo-style:blueprint | Lemo 完整风格 · 蓝图 / 工程制图 | editorial-collage | vendor/lemo-opuscar/styles/blueprint/STYLE.md |
| lemo-style:stained-glass | Lemo 完整风格 · 彩色玻璃窗 | editorial-collage | vendor/lemo-opuscar/styles/stained-glass/STYLE.md |
| lemo-style:pictogram-motion | Lemo 完整风格 · 象形运动图形 | editorial-collage | vendor/lemo-opuscar/styles/pictogram-motion/STYLE.md |
| lemo-style:ascii-crt | Lemo 完整风格 · ASCII / CRT 终端 | editorial-collage | vendor/lemo-opuscar/styles/ascii-crt/STYLE.md |
| lemo-style:dataviz | Lemo 完整风格 · 数据叙事 | editorial-collage | vendor/lemo-opuscar/styles/dataviz/STYLE.md |
| lemo-style:iso-infographic | Lemo 完整风格 · 等距信息图 | editorial-collage | vendor/lemo-opuscar/styles/iso-infographic/STYLE.md |
| lemo-style:dark-keynote | Lemo 完整风格 · 暗色科技发布 | editorial-collage | vendor/lemo-opuscar/styles/dark-keynote/STYLE.md |
| lemo-style:living-screencast | Lemo 完整风格 · 活体实机录屏 | editorial-collage | vendor/lemo-opuscar/styles/living-screencast/STYLE.md |
| lemo-style:hologram-hud | Lemo 完整风格 · 科幻全息界面 | editorial-collage | vendor/lemo-opuscar/styles/hologram-hud/STYLE.md |
| lemo-style:rubber-hose | Lemo 完整风格 · 1930s 橡皮管卡通 | editorial-collage | vendor/lemo-opuscar/styles/rubber-hose/STYLE.md |
| lemo-style:cel-anime-80s | Lemo 完整风格 · 80 年代赛璐璐动画 | editorial-collage | vendor/lemo-opuscar/styles/cel-anime-80s/STYLE.md |
| lemo-style:scifi-toon | Lemo 完整风格 · 科幻情景喜剧卡通 | editorial-collage | vendor/lemo-opuscar/styles/scifi-toon/STYLE.md |
| lemo-style:midcentury-toon | Lemo 完整风格 · 50s 扁平卡通 | editorial-collage | vendor/lemo-opuscar/styles/midcentury-toon/STYLE.md |
| lemo-style:pixel-rpg | Lemo 完整风格 · 16-bit 像素 RPG | editorial-collage | vendor/lemo-opuscar/styles/pixel-rpg/STYLE.md |
| lemo-style:hd-2d | Lemo 完整风格 · HD-2D | editorial-collage | vendor/lemo-opuscar/styles/hd-2d/STYLE.md |
| lemo-style:microgame | Lemo 完整风格 · 微游戏快闪 | editorial-collage | vendor/lemo-opuscar/styles/microgame/STYLE.md |
| lemo-style:game-show | Lemo 完整风格 · 综艺节奏扁平 | editorial-collage | vendor/lemo-opuscar/styles/game-show/STYLE.md |
| lemo-style:silent-film | Lemo 完整风格 · 1920s 默片 | editorial-collage | vendor/lemo-opuscar/styles/silent-film/STYLE.md |
| lemo-style:backrooms | Lemo 完整风格 · 后室 / 新怪谈 | editorial-collage | vendor/lemo-opuscar/styles/backrooms/STYLE.md |
| lemo-style:brick-toy | Lemo 完整风格 · 积木玩具 | editorial-collage | vendor/lemo-opuscar/styles/brick-toy/STYLE.md |
| lemo-style:paper-popup | Lemo 完整风格 · 纸片立体书 | editorial-collage | vendor/lemo-opuscar/styles/paper-popup/STYLE.md |
| lemo-style:tilt-shift | Lemo 完整风格 · 移轴微缩 | editorial-collage | vendor/lemo-opuscar/styles/tilt-shift/STYLE.md |
| lemo-style:lowpoly-island | Lemo 完整风格 · 低多边形等距 | editorial-collage | vendor/lemo-opuscar/styles/lowpoly-island/STYLE.md |
| lemo-style:glass-product | Lemo 完整风格 · 玻璃质感产品 | editorial-collage | vendor/lemo-opuscar/styles/glass-product/STYLE.md |
| director-format-1 | 创意动画 · 旁白篇幅 1 | editorial-collage | src/shared/director-copy-assist.ts |
| director-format-2 | 创意动画 · 旁白篇幅 2 | editorial-collage | src/shared/director-copy-assist.ts |
| html-elements-1 | HTML 动画 · 前景素材协议 1 | html-video | src/shared/task-runtime-providers.ts |
| html-elements-2 | HTML 动画 · 前景素材协议 2 | html-video | src/shared/task-runtime-providers.ts |
| creative-strategy-1 | 创意动画 · 素材计划策略 1 | editorial-collage | electron/vox-production-runtime.ts |
| creative-strategy-2 | 创意动画 · 素材计划策略 2 | editorial-collage | electron/vox-production-runtime.ts |
| creative-strategy-3 | 创意动画 · 素材计划策略 3 | editorial-collage | electron/vox-production-runtime.ts |
| creative-image-strategy-1 | 创意动画 · 禁用生图策略 1 | editorial-collage | electron/vox-production-runtime.ts |
| director-format-output | 创意动画 · 旁白输出格式 | editorial-collage | src/shared/director-copy-assist.ts |
| director-original | 公共文案 · 原创主题规则 | shared | src/shared/director-copy-assist.ts |
| creative-image:caption-news | 视觉风格 · 字幕新闻 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:caption-news | 视觉风格 · 字幕新闻 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:newsreel | 视觉风格 · 1920s 新闻影片 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:newsreel | 视觉风格 · 1920s 新闻影片 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:countdown | 视觉风格 · 实时倒计时分屏 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:countdown | 视觉风格 · 实时倒计时分屏 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:city-symphony | 视觉风格 · 延时交响 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:city-symphony | 视觉风格 · 延时交响 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:visual-investigation | 视觉风格 · 视觉调查 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:visual-investigation | 视觉风格 · 视觉调查 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:kino-montage | 视觉风格 · 构成主义蒙太奇 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:kino-montage | 视觉风格 · 构成主义蒙太奇 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:telestrator | 视觉风格 · 体育战术板 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:telestrator | 视觉风格 · 体育战术板 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:news-package | 视觉风格 · 电视新闻包装 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:news-package | 视觉风格 · 电视新闻包装 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:satellite-briefing | 视觉风格 · 卫星简报 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:satellite-briefing | 视觉风格 · 卫星简报 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:briefing-board | 视觉风格 · 工程简报板 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:briefing-board | 视觉风格 · 工程简报板 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:lidar-survey | 视觉风格 · 点云测绘 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:lidar-survey | 视觉风格 · 点云测绘 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:white-model | 视觉风格 · 白模投影 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:white-model | 视觉风格 · 白模投影 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:data-physical | 视觉风格 · 数据实物化 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:data-physical | 视觉风格 · 数据实物化 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:teardown | 视觉风格 · 产品拆解 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:teardown | 视觉风格 · 产品拆解 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:microscope | 视觉风格 · 显微叙事 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:microscope | 视觉风格 · 显微叙事 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:archive-lighttable | 视觉风格 · 档案灯台 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:archive-lighttable | 视觉风格 · 档案灯台 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:crayon-book | 视觉风格 · 蜡笔儿童绘本 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:crayon-book | 视觉风格 · 蜡笔儿童绘本 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:watercolor | 视觉风格 · 水彩笔刷 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:watercolor | 视觉风格 · 水彩笔刷 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:ink-wash | 视觉风格 · 中国水墨 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:ink-wash | 视觉风格 · 中国水墨 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:impasto | 视觉风格 · 油画厚涂 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:impasto | 视觉风格 · 油画厚涂 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:one-line | 视觉风格 · 一笔画 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:one-line | 视觉风格 · 一笔画 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:whiteboard | 视觉风格 · 白板讲解 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:whiteboard | 视觉风格 · 白板讲解 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:urban-sketch | 视觉风格 · 钢笔淡彩 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:urban-sketch | 视觉风格 · 钢笔淡彩 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:shadow-puppet | 视觉风格 · 皮影戏 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:shadow-puppet | 视觉风格 · 皮影戏 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:ukiyoe | 视觉风格 · 浮世绘 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:ukiyoe | 视觉风格 · 浮世绘 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:papercut-red | 视觉风格 · 红色窗花剪纸 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:papercut-red | 视觉风格 · 红色窗花剪纸 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:paper-lantern | 视觉风格 · 纸雕灯影 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:paper-lantern | 视觉风格 · 纸雕灯影 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:risograph | 视觉风格 · Risograph 孔版印刷 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:risograph | 视觉风格 · Risograph 孔版印刷 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:halftone-dossier | 视觉风格 · 复古半调案卷 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:halftone-dossier | 视觉风格 · 复古半调案卷 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:woodcut | 视觉风格 · 木刻版画 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:woodcut | 视觉风格 · 木刻版画 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:engraving | 视觉风格 · 铜版画 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:engraving | 视觉风格 · 铜版画 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:silkscreen-poster | 视觉风格 · 丝印旅行海报 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:silkscreen-poster | 视觉风格 · 丝印旅行海报 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:swiss-motion | 视觉风格 · 瑞士动态排版 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:swiss-motion | 视觉风格 · 瑞士动态排版 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:spy-titles | 视觉风格 · 60s 间谍片头 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:spy-titles | 视觉风格 · 60s 间谍片头 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:art-deco | 视觉风格 · 装饰艺术 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:art-deco | 视觉风格 · 装饰艺术 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:blueprint | 视觉风格 · 蓝图 / 工程制图 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:blueprint | 视觉风格 · 蓝图 / 工程制图 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:stained-glass | 视觉风格 · 彩色玻璃窗 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:stained-glass | 视觉风格 · 彩色玻璃窗 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:pictogram-motion | 视觉风格 · 象形运动图形 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:pictogram-motion | 视觉风格 · 象形运动图形 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:ascii-crt | 视觉风格 · ASCII / CRT 终端 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:ascii-crt | 视觉风格 · ASCII / CRT 终端 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:dataviz | 视觉风格 · 数据叙事 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:dataviz | 视觉风格 · 数据叙事 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:iso-infographic | 视觉风格 · 等距信息图 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:iso-infographic | 视觉风格 · 等距信息图 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:dark-keynote | 视觉风格 · 暗色科技发布 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:dark-keynote | 视觉风格 · 暗色科技发布 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:living-screencast | 视觉风格 · 活体实机录屏 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:living-screencast | 视觉风格 · 活体实机录屏 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:hologram-hud | 视觉风格 · 科幻全息界面 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:hologram-hud | 视觉风格 · 科幻全息界面 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:rubber-hose | 视觉风格 · 1930s 橡皮管卡通 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:rubber-hose | 视觉风格 · 1930s 橡皮管卡通 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:cel-anime-80s | 视觉风格 · 80 年代赛璐璐动画 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:cel-anime-80s | 视觉风格 · 80 年代赛璐璐动画 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:scifi-toon | 视觉风格 · 科幻情景喜剧卡通 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:scifi-toon | 视觉风格 · 科幻情景喜剧卡通 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:midcentury-toon | 视觉风格 · 50s 扁平卡通 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:midcentury-toon | 视觉风格 · 50s 扁平卡通 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:pixel-rpg | 视觉风格 · 16-bit 像素 RPG · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:pixel-rpg | 视觉风格 · 16-bit 像素 RPG · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:hd-2d | 视觉风格 · HD-2D · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:hd-2d | 视觉风格 · HD-2D · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:microgame | 视觉风格 · 微游戏快闪 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:microgame | 视觉风格 · 微游戏快闪 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:game-show | 视觉风格 · 综艺节奏扁平 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:game-show | 视觉风格 · 综艺节奏扁平 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:silent-film | 视觉风格 · 1920s 默片 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:silent-film | 视觉风格 · 1920s 默片 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:backrooms | 视觉风格 · 后室 / 新怪谈 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:backrooms | 视觉风格 · 后室 / 新怪谈 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:brick-toy | 视觉风格 · 积木玩具 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:brick-toy | 视觉风格 · 积木玩具 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:paper-popup | 视觉风格 · 纸片立体书 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:paper-popup | 视觉风格 · 纸片立体书 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:tilt-shift | 视觉风格 · 移轴微缩 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:tilt-shift | 视觉风格 · 移轴微缩 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:lowpoly-island | 视觉风格 · 低多边形等距 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:lowpoly-island | 视觉风格 · 低多边形等距 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-image:glass-product | 视觉风格 · 玻璃质感产品 · 图像指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
| creative-motion:glass-product | 视觉风格 · 玻璃质感产品 · 动作指导 | editorial-collage | src/shared/creative-animation/adapters.ts |
