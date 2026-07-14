# StoryDream 编辑部工作台全量重设计

日期：2026-07-14

状态：视觉方向已确认；功能与参数保真审计已确认；实现前规格

## 1. 目标

将现有 StoryDream Electron 桌面工具重构为“编辑部工作台”：light 主题采用已确认的明亮中性视觉，dark 主题使用同一信息架构和组件系统的深色映射，媒体预览与画布在两种主题下都使用固定深色工作区。重设计覆盖全部页面、导航、交互密度、响应式布局和代码拆分，同时修复审核中确认的断链功能；现有新安装默认 dark 不变。

视觉重构不能缩减业务表面。页面可以换布局，参数可以重新分组，但已有功能、字段、默认值、校验、条件依赖、按钮、状态、提交载荷、IPC/API、持久化和运行时语义必须保留。

## 2. 不可妥协的保真门禁

1. 保留侧栏全部十五个功能入口，并保留独立的“新建任务”主操作；`task-detail` 继续作为内部详情路由。
2. 普通任务是七步流水线：Step 0 预审、Step 1 三轮改写与自评、Step 2 分镜、Step 3 主角档案与出图提示词、Step 4 批量生图、Step 5 配音、Step 6 草稿导出。
3. HTML 动画视频是独立六步流水线：改写与分句、场景规划、素材、配音、动画预览、出片。两类流水线不得混用步骤或 runner。
4. `CreateTaskInput` 的 51 个字段必须全部有明确所有者：真实控件、条件派生、专用流程或兼容持久化。任何字段不得在表单重构时被静默丢弃。
5. 所有现有 renderer API 动作继续可达，包括配置测试、模型与音色拉取、模板重置/导入/导出/克隆、人物素材 CRUD、逐镜重生图/重配音、提示词编辑、步骤重跑、诊断和路径操作。
6. 已保存密钥永不回填 renderer；空输入不代表删除；只有显式清除发送 `null`。配置档案稳定 ID 不得重建。
7. 已持久化但当前隐藏的兼容字段必须无损往返。无运行时消费者的字段不得做成“看起来能用”的假控件。
8. 旧行为测试保持通过；新增字段清单、控件映射、载荷、IPC、持久化和真实交互测试。不能用截图测试替代功能测试。

## 3. 规格来源与优先级

发生冲突时按以下顺序处理：

1. `src/shared/types.ts` 的类型与枚举。
2. `src/shared/ipc-contract.ts` 的运行时校验。
3. `src/shared/config.ts`、`src/shared/storage.ts` 和各运行时 consumer 的默认值与行为。
4. preload、Electron handler 和已有回归测试。
5. 本文的页面位置和视觉系统。
6. 视觉概念图。

视觉概念图只决定视觉语言、密度和容器模型，不得覆盖前四项业务契约。原概念中普通任务“六步”、队列/历史共用示意页和 `targetLength` 提示词变量均属已纠正内容。

## 4. 信息架构

| 分组 | 入口 | 新页面结构 | 保留的核心行为 |
| --- | --- | --- | --- |
| 主操作 | 新建任务 | 三段式编辑器 + 动态执行摘要 | 粘贴/AI、全部创作与输出参数、保存草稿、创建运行 |
| 创作生产 | 选品助手 | 左记录列表 + 右详情表单 | 查询、编辑、新建、删除、任务/对标交接 |
| 创作生产 | 对标导入 | 来源与文案双区 + 执行摘要 | 产品上下文、来源、字数、创建任务 |
| 创作生产 | 人物素材库 | 人物列表 + 图片网格 + 操作栏 | 创建、重命名、删除、导入、预览、打开目录 |
| 创作生产 | 任务队列 | 任务表 + 事件侧栏 | 暂停、取消、继续、重试、打开目录、错误详情 |
| 创作生产 | 历史任务 | 可分页表格 + 活跃/归档视图 | 全状态筛选、搜索、详情、归档、恢复、永久删除 |
| 素材与实验 | 画图实验室 | 左参数 + 中结果 + 右记录 | 智慧/文生图/参考编辑、批量、预览、历史 |
| 素材与实验 | 配音实验室 | 左参数 + 中播放器 + 右记录 | provider、音色、语速、试听、错误与历史 |
| 素材与实验 | 音乐 MV | 左参数 + 中歌词/画面 + 右执行摘要 | 完整 MV 任务输入与状态 |
| 素材与实验 | 爆款拆解 | 来源与参数 + 阶段进度 + 报告/复刻 | 登录/cookie、暂停/重试、模板提取、生产任务 |
| 素材与实验 | HTML 动画视频 | 左参数 + 深色画布/时间线 + 右六步运行栏 | 任务切换、六页签、媒体、恢复、暂停/重试/预览 |
| 模板与系统 | 提示词模板 | 列表 + 详情编辑器 + 变量/元数据栏 | 故事/图像模板、筛选、继承、导入导出、克隆、重置 |
| 模板与系统 | 草稿模板 | 列表 + 固定画布 + 可滚动 inspector | 全图层、拖拽缩放、效果、BGM、Coze 导入 |
| 模板与系统 | 系统设置 | 分区导航 + profile 列表 + provider 表单 | 档案生命周期、密钥、模型、测试、路径、诊断 |
| 模板与系统 | 账户中心 | 资料 + 余额/交易明细 | 资料保存、设备信息、余额与积分流水 |
| 模板与系统 | 激活管理 | 当前状态 + 激活编辑 | plan/status 一致性、到期时间与信息保存 |

`ShellView` route inventory 必须保持 17/17：`new-task`, `queue`, `history`, `task-detail`, `html-video`, `image-lab`, `voice-lab`, `music-mv`, `book-selection`, `benchmark`, `person-assets`, `viral-analyzer`, `prompt-templates`, `draft-templates`, `settings`, `account`, `activation`。其中 `task-detail` 是内部详情路由；其余 16 个可导航 view 包含独立的新建主操作和侧栏十五个入口。

最近三条任务移到顶部“最近任务”菜单，继续保留空态和详情直达。账户、剩余试用和积分压缩到侧栏底部，但仍分别进入账户与激活页面。

## 5. 视觉系统

### 5.1 双主题所有权与 token

主题功能继续支持 `dark | light`，不能把 dark 变成无效果控件。迁移完成后 `UiPreferences.theme` 是运行时和持久化唯一 owner；`AppConfig.ui.theme` 只作为兼容镜像，普通配置保存不得反向覆盖新 UI preference。`UiPreferences` 增加持久化的 `themePreferenceVersion: 1`：首次加载缺少该 marker 的数据库时，不能把初始化过程自动补种的 UI `dark` 当作用户选择，而要按“合法旧 `AppConfig.ui.theme`、合法原始 UI theme、新安装默认 `dark`”解析一次并在同一事务写回 UI theme、marker 和 config 镜像；marker 存在后只读取 UI theme。当前 renderer 没有真正的主题消费者，历史自动补种值不能证明用户主动选择；迁移后已有有效 dark/light 不再被后续导航或配置保存改写，默认也不为了匹配明亮概念而改变。

`UiPreferences.activeView` 继续作为当前路由的持久化 owner。主题迁移事务必须原样保留现有 `activeView`；导航保存只能更新 `activeView` 并保留 theme 与 marker，不能把默认 theme 重新写入或清除迁移版本。

| 语义 token | Light 壳层 | Dark 壳层 |
| --- | --- | --- |
| `--shell-bg` | `#f3f5f7` | `#15181c` |
| `--surface` | `#ffffff` | `#1d2126` |
| `--surface-muted` | `#eef1f4` | `#252a30` |
| `--text` | `#1b1d1f` | `#f4f6f8` |
| `--text-muted` | `#5f6972` | `#aab2bb` |
| `--border` | `#d8dde3` | `#343b43` |
| `--hover` | `#e9edf1` | `#2a3037` |
| `--accent / --on-accent` | `#c2412d / #ffffff` | `#ff6847 / #15181c` |
| `--focus` | `#147d92` | `#55c7d8` |
| `--info-fg / --info-bg` | `#116b7d / #e3f5f8` | `#6dd7e5 / #17363d` |
| `--success-fg / --success-bg` | `#18734a / #e7f6ee` | `#61d19a / #183d2d` |
| `--warning-fg / --warning-bg` | `#805300 / #fff2d8` | `#f4bd57 / #493515` |
| `--danger-fg / --danger-bg` | `#a92d36 / #fdeaea` | `#ff8a8a / #4c2428` |
| `--on-info / --on-success / --on-warning / --on-danger` | `#ffffff` | `#15181c` |

媒体 token 不随壳层切换：`--media-bg: #101317`、`--media-surface: #181d22`、`--media-border: #303841`、`--media-text: #f5f7f8`、`--media-muted: #aeb7c0`。图片、视频、HTML 预览、草稿画布和时间线都在 `[data-media-canvas]` 作用域内使用这组 token，禁止继承 light surface，也禁止在 dark 壳层中再包一层装饰卡片。

主题切换更新 `document.documentElement.dataset.theme` 并立即持久化；失败时回滚控件和 DOM theme。`ui:save-preferences` 在同一存储提交中更新 preference、`themePreferenceVersion` 与兼容镜像；导航等非主题保存必须保留 marker，不得把默认值重新标记为用户选择。`app:save-config` 使用当前 preference 覆盖 stale settings draft 中的 theme。迁移测试必须证明：仅有 legacy light 时迁移为 light；同时存在历史自动补种 UI dark 和 legacy config light 时仍迁移为 light；marker 已存在时 UI dark/light 优先；新安装仍为 dark；切换后重启保持选择；配置档案和导航保存不会把 theme 改回旧值。

### 5.2 组件视觉规则

- Light 壳层使用真正的白色/浅中性背景；Dark 壳层使用上表的中性深色，二者都使用细分隔线、低阴影和最大 8px 圆角。
- 主色：朱红用于主要动作、选中状态和关键进度，不铺满大面积背景。
- 语义色：绿色成功、青色运行、琥珀警告、红色错误；状态同时使用文本或图标，不能只靠颜色。
- 媒体区：图片、视频、HTML 画布和时间线使用固定深色无框工作区；表单与治理表格跟随当前壳层主题。
- 字体：`Segoe UI Variable` / `Microsoft YaHei UI`，界面字重 400/500，字距始终为 0。
- 密度：平衡密度。页面标题紧凑，表格优先于任务卡片；只对真正独立的重复项、模态框和工具使用卡片。
- 图标：继续使用 `lucide-react`。图标按钮必须有 `aria-label` 和 tooltip；熟悉的归档、恢复、删除、播放、暂停、重试、打开目录不使用文字矩形替代。
- 焦点与键盘：保留明显焦点环、原生 tab 顺序、Enter/Space 行打开和 HTML 页签方向键/Home/End。

## 6. 前端架构

保持 React 19、Vite、Electron、sql.js、Lucide，不引入新的 UI 框架。

建议模块边界：

- `src/app/App.tsx`：bootstrap、delta、reconciliation、路由选择和全局错误。
- `src/app/AppShell.tsx`：窗口栏、侧栏、最近任务、账户/试用区和页面头。
- `src/components/`：按钮、字段、segmented control、状态、确认框、错误详情、表格与分页原语。
- `src/features/tasks/`：新建、队列、历史、详情、任务载荷 builder 和字段 manifest。
- `src/features/labs/`：画图、配音、人物、选品、对标。
- `src/features/music-mv/`、`src/features/viral/`、`src/features/html-video/`：独立媒体工作流。
- `src/features/templates/`、`src/features/settings/`：`React.lazy` 的重型 chunk。
- `src/styles/`：tokens、shell、forms、tables、media-canvas 和 feature 样式。

`main.tsx` 最终只负责挂载 root 和导入全局 tokens。任务载荷构造、配置档案规范化、默认值、状态 delta 和 async action 继续单一来源，不能随页面复制。

首屏 renderer JS 目标低于 500 kB。`storybound-system-templates.ts` 只能进入模板 lazy chunk；列表加载 summary，正文/模板详情按 ID 获取。

当前 `config.ts` 静态导入系统模板语料，因此只 lazy-load 页面仍不够。实现时把 `defaultPromptTemplates` 与语料构造移入独立动态模块，轻量配置默认值留在 `config.ts`；browser fallback 也只能动态导入同一模板 chunk。

## 7. 普通新建任务保真矩阵

### 7.1 三段式位置

| 新位置 | 字段/行为 | 条件与默认 | API/测试所有者 |
| --- | --- | --- | --- |
| 素材输入 | `title`, `inputText`, `mode` | paste 默认；文案必填；标题空值按修复后的自动标题规则 | `task:create-and-run`; IPC/task storage tests |
| 素材输入 | `aiKeyword`, `aiSources`, `selectedSources`, `extraRequirements` | 仅 AI 模式；候选前十条；合成至少选择一条 | `research:web-search`, `research:compose-copy` |
| 素材输入 | `productInfo`, `materialSource`, `materialPerson` | 产品由选品交接；local 必须存在人物且至少一张图 | book/person APIs + runner preflight |
| 素材输入 | `fixedIntro`, `outroCta`, `lockIntroSentences` | 锁句 0..20；结尾支持 `{主角}` | runner rewrite-control tests |
| 创作参数 | `track`, `promptTemplateId`, `promptTemplateType` | 动态赛道；自动匹配，可手动覆盖；类型为 task | prompt-template helpers/tests |
| 创作参数 | `style`, `templateId`, `ratio`, `referenceImagePath` | 模板联动画风/草稿/比例；均可手动覆盖 | local-image, template tests |
| 创作参数 | `videoForm`, `podcastImageMode`, `podcastSpeakers` | narration 默认；双人播客才显示配图和主播组合 | podcast tests |
| 创作参数 | `podcastSpeakerA`, `podcastSpeakerB`, `scriptFormat` | 根据 provider/组合派生；非播客为 null/narration | payload tests |
| 创作参数 | `coverImageMode`, `coverTemplateId` | off 默认；封面模式语义必须修正后区分 | runner cover tests |
| 创作参数 | `processingMode`, `publishMode`, `pausePoints` | full-auto、review-rewrite、none | runner lifecycle tests |
| 创作参数 | `rewriteIntensity`, `narrativePov`, `keepPromotion` | standard、keep-original、false；修正文案正反语义 | runner prompt tests |
| 创作参数 | `llmProfileId`, `imagePromptReference` | 当前 LLM 默认；爆款复刻可带入图像参考提示 | provider/viral payload tests |
| 输出设置 | `ttsProvider`, `speaker`, `ttsSpeed` | 当前 provider/默认音色/1；provider 切换重置音色 | TTS voice tests |
| 输出设置 | `bgmId` | 配置默认 BGM 或无 BGM；支持添加本地音频 | config save + local audio |
| 输出设置 | `targetLength` | 空为自动；100..5000，step 50，规范化 clamp | content metrics tests |
| 输出设置 | `targetScenes`, `storyboardSceneCount` | 空为自动；1..60；两个兼容字段同值 | storage/runner tests |
| 专用流程 | `taskKind`, `musicMv` | Music MV 页面拥有 | Music MV tests |
| 专用流程 | `taskType`, `pipelineStep`, `pipelineData`, `htmlVideoForeground` | HTML 视频页面拥有，不能进入普通 runner | HTML workflow tests |
| 运行时/兼容 | `step3PromptSnapshot`, `draftDir` | runner 或兼容持久化拥有；普通表单不清空 | storage round-trip tests |

### 7.2 交互规则

- 三个步骤按钮必须是真实页签；返回上一步不能清空未保存数据。
- 执行摘要从当前 state 计算，不能写死。至少显示处理/发布模式、目标字数、分镜、比例、视频形态、TTS/音色、草稿模板、封面和素材来源。
- 模板改变时继续同步赛道、提示词模板、默认画风、草稿模板和比例；手动覆盖后不得被后台 refresh 重置。
- AI 合成后保留 `selectedSources` 和 AI 溯源，不能因切回 paste 编辑而提交空来源。
- “保存为草稿”必须调用真实持久化 API，并产生 `status=draft` 的可恢复任务；不能只显示 notice。
- 标题为空时必须在写库前生成并持久化标题，或移除自动提取承诺。设计选择前者。
- `custom` 暂停只有在存在自定义步骤选择器和 runner 语义后才保留；否则不得与 critical 重复。

## 8. 队列、历史与详情

### 8.1 任务队列

- 表格显示标题、来源模式、比例、状态、真实步骤、创建时间和紧凑错误摘要。
- running：暂停、取消；pending：取消；paused/failed：继续或重试；completed 且有输出：打开目录。
- “继续”与“重试”必须有明确不同的 handler/文案语义，或合并成一个真实动作，不能两个按钮调用同一 API。
- 右侧事件流默认跟随选中任务，而不是固定最新任务；保留至少当前 24 条快速流和完整错误对话框。
- 队列统计使用实际状态和活动 image profile 并发，不能硬编码“草稿”或“3 路并发”。

### 8.2 历史任务

- 活跃与已归档使用 tabs；状态筛选包含 draft、pending、running、paused、completed、failed、cancelled。
- 使用服务端 keyset/cursor 分页，不在 bootstrap 后自动拉完全部页面。
- 搜索基于服务端可查询字段或明确的 summary 字段；不能声称搜索完整正文却只查 160 字预览。
- 归档/恢复使用低风险即时动作；永久删除必须二次确认，running/pending 任务禁用并说明原因。
- 现有详情、输出目录、错误摘要、暂停/取消/继续/重试入口不能被治理按钮替换。

### 8.3 任务详情

- 七步状态轨保留各步状态、最近事件、错误详情和重新生成/改写后继续。
- 主视图保留产物预览、分镜画廊和配音试听；新增事件视图必须真正消费分页 API。
- 产物保留 AI 来源、预审、改写、封面元数据、分镜、角色卡/出图提示词、图片、配音/字幕和草稿路径。
- 每镜保留提示词编辑/保存/取消、图片重生成、音频播放、每主播片段和重配音。
- 侧栏保留 ID 复制、总耗时、完成步数、事件数、agent、图片进度、更新时间、输出目录、失败/恢复步骤、状态文件和最近心跳。
- `clip-only` 完成度按实际终止步骤计算，不能把任何 completed 任务画成 7/7。

## 9. 工具与实验室矩阵

### 9.1 选品、对标与人物素材

| 页面 | 现有字段/动作 | 新位置 | 修复项 |
| --- | --- | --- | --- |
| 选品 | theme、name、author、category、keyword、price、audience、persons、era、url、sellPoint、note、记录选择/新建/保存/删除/任务/对标交接 | 列表 + 详情 | `coverPath`/`materialFolder` 无损编辑；主题改名不留重复键；删除确认 |
| 对标 | sourceLink、benchmarkTitle、keyword、script、产品摘要、字数、创建任务 | 来源区 + 文案区 + 摘要 | 持久化 source/keyword 溯源；keyword 映射 `aiKeyword` |
| 人物 | 创建/选择/重命名/删除、打开目录、导入图片、预览、数量/时间 | 列表 + 图片网格 | 删除确认；保留名称/扩展名/冲突安全规则 |

### 9.2 画图实验室

- 页面初始值保持：tab=`smart`、`smartMode='podcast-cover'`、ratio=`9:16`、style=`photo-real`、resolution=`1K`、输出数 3、参考图上限 10。

| 入口/用途 | 可选模式 | 参考图条件 | 提交载荷与数量 |
| --- | --- | --- | --- |
| 文生图 tab | `text-to-image` | 隐藏参考图并提交空数组 | `smartMode='text-to-image'`，固定生成 1 张 |
| 智慧生图 · 封面 | `cover` | 无参考图时使用该模式 | `smartMode='cover'`，输出 1..10 |
| 智慧生图 · 博客封面 | `blog-cover` | 无参考图时使用该模式 | `smartMode='blog-cover'`，输出 1..10 |
| 智慧生图 · 播客封面 | `podcast-cover`，默认 | 无参考图时使用该模式 | `smartMode='podcast-cover'`，输出 1..10 |
| 智慧生图 · 旁白视频 | `video-narration` | 无参考图时使用该模式 | `smartMode='video-narration'`，输出 1..10 |
| 智慧生图 · 双人播客 | `two-host-podcast` | 无参考图时使用该模式 | `smartMode='two-host-podcast'`，输出 1..10 |
| 图像参考 tab | `reference-edit` | 必须 1..10 张参考图 | `smartMode='reference-edit'`，输出 1..10 |

智慧生图继续允许添加参考图；一旦存在参考图，现有 resolver 会把有效 payload 切换为 `reference-edit`。新 UI 必须同时显示“选择的用途”和“实际提交模式”，不能让该条件切换静默发生。移除最后一张参考图后恢复选择的五种智慧用途。这样七个 `ImageLabSmartMode` 均有明确入口或条件路径，而不是只保留类型声明。

- 参数完整保留：prompt、ratio 的八个选项、全部 style、1K/2K/4K、1-10 输出、最多十张参考图、provider/模式/成本摘要。
- 结果：缩略图、放大、移除参考、真实记录、状态、错误和路径。
- 修复 provider 字段与实际激活 provider 的一致性：若 UI 提供 provider 选择，generator 必须消费该字段；否则 payload 省略 provider 并明确显示当前激活配置，不能保存一个未被执行的值。
- 多图成本乘输出数；“智能规划”必须生成独立分图计划，否则改为准确的“批量生成”文案。
- `ImageLabRecord` 全字段无损往返：`id`, `prompt`, `ratio`, `style`, `provider`, `imagePath`, `status`, `errorMessage`, `resolution`, `smartMode`, `referenceImagePaths`, `referenceImagePath`, `upstreamTaskId`, `createdAt`, `finishedAt`。

### 9.3 配音实验室

- 参数：text、provider、voiceId、speed；当前四个速度预设继续保留，输入校验仍接受 0.1..10。
- provider 切换和配置变化继续重置不可用音色。
- 结果保留当前音色、audio player、路径、状态、错误和历史。
- 生成失败必须写失败记录或页面不再声称有失败历史；新增重试/打开操作时必须接真实 API。
- `VoiceLabRecord` 全字段无损往返：`id`, `text`, `provider`, `voiceId`, `voiceLabel`, `speed`, `audioPath`, `status`, `errorMessage`, `createdAt`, `finishedAt`。

### 9.4 音乐 MV

| 参数/行为 | 当前值与选项 | 新位置与要求 |
| --- | --- | --- |
| title / inputText | `音乐MV`；歌词必填 | 左参数区；结构预览使用与 runner 相同的分段 helper |
| style / ratio | modern-film；12 画风；4 比例 | 画面分组；比例同时作用生图和草稿画布 |
| templateId / storyboardSceneCount | 首模板；8/12/16/20/30 | 草稿/分镜分组；runner 必须实际消费 |
| processingMode / pausePoints | full-auto；none/critical/every/custom | 执行分组；custom 修复后才显示 |
| rhythmMode | lyric-sync/fast-cut/slow-cinematic | 节奏分组；lyric-sync 必须基于音频时长/时间轴，不是固定 2.4 秒 |
| captionStyle | karaoke/minimal/none | 字幕分组；最终字幕轨必须呈现真实差异 |
| visualMotif | 默认雨夜霓虹描述 | 画面分组；继续进入分镜/生图提示 |
| audioPath | 本地输入/选择，可为空 | 音频分组；完整生成前必须有主音轨或明确的 BGM 替代规则 |
| bgmId | 默认 BGM / 无 BGM | 音频分组；runner/sidecar 必须消费，不能只持久化 |

MV 草稿导出必须应用草稿模板、画布、字幕样式和原生轨道；若某项尚未实现，实施顺序是先补 runtime consumer 和测试，再保留/启用控件。

### 9.5 爆款拆解

- 输入参数完整保留：url、auto/douyin/kuaishou/bilibili、track、style、ratio、templateId、keyFrameCount、storyboardSceneCount、extraRequirements。
- 精确输入字段为 `url`, `platform`, `title`, `settings`；生产任务 options 为 `title`, `track`, `style`, `ratio`, `templateId`, `storyboardSceneCount`。
- 补出当前类型已有但不可达的分镜数和额外要求控件；关键帧 UI 保持 1..40，IPC/runner 使用同一 clamp。
- Cookie 区保留登录窗口、选择文件、清空、失焦保存和当前路径；平台识别改为 URL parser，不按整段字符串正则猜测。
- 历史使用真实分页；打开记录后，保存模板和生成生产任务必须使用该记录持久化 settings，而不是当前空白表单 state。
- 状态轨保留下载、抽帧、转写、画面、拆解、复刻、完成；补 paused/cancelled/failed/queued 状态和暂停、取消、继续、重试按钮。
- 启动恢复处理遗留 running viral analysis；暂停 abort 不得被 catch 覆盖为 cancelled。
- 报告分组展示结果文件的完整数据：来源/时长/互动/封面、转写时间轴和词级数据、镜头运动/转场、标题与封面建议、结构/爆点证据、复刻公式、故事六要素、备选开头/标题/封面、分镜建议和任务默认参数。
- 结果 JSON 先做版本化运行时 schema 解析；损坏/旧版显示诊断而不是解引用崩溃。
- 保存故事/图像模板使用一个原子业务操作或可回滚组合，防止半成品。

## 10. 模板保真矩阵

### 10.1 提示词与图像模板

- 故事/图像 tabs、类型和赛道筛选、summary/detail 按需加载。
- 新建、打开、保存、克隆、系统 reset、JSON 导入/导出和冲突 ID 处理。
- 故事字段：`name`, `description`, `type`, `baseTrack`, `defaultStyles[]`, `defaultDraftTemplateId`, `characterPolicy`, `step3SkeletonModules[]`, `referenceKind`, `marketTags[]`, `imageSeedPoolsJson`。
- task 模板保留总指令及 review/rewrite/cover/storyboard/image-prompt 五个步骤覆盖；“继承全局”删除 override 键，不写空字符串。
- `stepPrompts` 是五步覆盖的精确持久化字段，不能在组件拆分时改名或展平后丢失。
- 系统模板保存 fork 新 UUID；自定义模板保留 ID；`baseTemplateId`, `origin`, `usedCount`, `isBuiltin`, `updatedAt` 不被误写。
- Scoped variables 继续支持点击和 `//` 插入。不得展示 `targetLength`、`targetLengthRange` 或 `storyboardSceneCount` 为运行时变量。
- 图像模板字段完整保留 `id/name/tag/shortName/prefix/suffix/negativePrompt/allowColor/description/createdAt/updatedAt`，以及基准风格、AI 生成状态、导入导出和克隆。

### 10.2 草稿模板

| 分组 | 全部字段 |
| --- | --- |
| 模板 | `id`, `name`, `isDefault`, `updatedAt` |
| Canvas | `width`, `height`, `ratio`, `backgroundColor`, `backgroundImage` |
| Image | `visible`, `ratio`, `fit`, `top`, `height`, `animation` |
| Title/Subtitle/Disclaimer | `visible`, `text`, `x`, `y`, `width`, `fontSize`, `color`, `alpha`, `bold`, `underline`, `align`, `letterSpacing`, `lineSpacing`, `border` |
| Caption | 上述样式 + `maxCharsPerLine`, `background.color`, `background.alpha`, `background.roundRadius` |
| Border | `color`, `width`, `alpha` |
| Audio/effects | `narrationVolume`, `bgmVolume`, `transitionType`, `transitionDurationMs`, `narrationFadeInMs`, `narrationFadeOutMs`, `bgmFadeInMs`, `bgmFadeOutMs`, `filterType`, `videoEffectType`, `audioEffectType` |

保留画布拖拽坐标与宽度缩放、背景选择、颜色双输入、所有范围校验、完整 124 项图片动画、Jianying effect catalog、Coze 单个/批量导入与诊断。右 inspector 可以折叠分组，但不能删除控件或截断选项。

顶层对象名保持 `canvas`, `image`, `title`, `subtitle`, `caption`, `disclaimer`, `audio`，并保留 `id`, `name`, `isDefault`, `updatedAt`；拆分组件不能改变序列化结构。

### 10.3 封面模板与 MiniMax 克隆音色

`CustomCoverTemplate` 是 runner 直接消费的本地封面提示目录。当前没有独立编辑 API，因此重设计只保留选择和只读目录，不伪造保存/删除按钮；以后增加编辑能力时必须先补严格 IPC 与存储方法。

| 字段组 | 必须无损往返的字段 | 所有权 |
| --- | --- | --- |
| 标识与时间 | `id`, `createdAt`, `updatedAt` | ID 与创建时间不因启动同步被改写；更新时间只由真实保存动作更新 |
| 基本信息 | `name`, `description` | 选择器标签、说明和 runner 模板查找 |
| 提示结构 | `directions`, `compositionRule`, `titleLayout`, `subtitleLayout`, `plainHint` | 封面 prompt consumer；空字符串也是合法兼容值，不能被默认文案覆盖 |

默认 `cinematic-poster`、`ancient-cinematic`、`podcast-cover` 等记录只在缺失时补种，不能 `INSERT OR REPLACE` 覆盖用户本地记录。bootstrap、reset/reconciliation、任务模板选择和 runner prompt 都必须保留上述 10/10 字段；删除或缺失引用只能在读取时提示并选择显式 fallback，不能静默改写历史任务的 `coverTemplateId`。测试覆盖数据库列映射、bootstrap、状态 reset、任务选择、runner prompt 和重启后的 10 字段相等。

`MinimaxCloneVoice` 当前是本地兼容目录和设置页数量信息，不声称已经接通克隆接口。必须保留 `voiceId`, `displayName`, `sourceAudioPath`, `createdAt`, `lastUsedAt` 5/5 字段，并遵守：

- 默认记录仅在表为空时补种；配置保存、profile 切换、页面 lazy 卸载、bootstrap reset 和 delta reconcile 均不得删除或重排掉记录。
- `sourceAudioPath` 是外部元数据，不构成递归删除授权，也不回填为 secret；路径不存在时显示诊断但保留记录。
- bootstrap 当前只投影最近 100 条，它不是可反写的完整数据集；新增 SQL `COUNT(*)` 或 cursor list/count API 提供真实 `totalCount`。设置概览不能继续用 `state.minimaxCloneVoices.length` 冒充总数，未来选择器分页读取。
- 只有未来真实成功使用克隆音色后才能更新 `lastUsedAt`；在此之前保持原值。新增克隆/重命名/删除 UI 前必须先增加对应 IPC、schema、存储与失败测试。
- round-trip 测试覆盖 SQL 列映射、启动补种、bootstrap/full state、配置保存与重启，断言 5 字段完全相等；插入 101+ 条时 bootstrap 可以截断，但 DB 总数和记录不能被截断或反写。

## 11. 系统设置矩阵

### 11.1 公共行为

- 分区：LLM、AI 绘图、TTS、语音转文字、剪映、激活与订阅、AI 创作、关于/诊断。
- LLM/Image/TTS 都保留新增、选择、编辑、复制、删除、启用；至少保留一个档案且唯一启用。
- “保存并测试”先保存当前所选档案与 secret changes，再测试同一档案。
- dirty settings 不被后台 state refresh 覆盖。
- 模型列表保留拉取、清除、手动输入和首项自动选择。
- 保存 secret 状态、显式替换和 `null` 清除；renderer 不显示真实已保存值。

### 11.2 参数

| 域 | 必须保留的现有可见参数 | 必须无损保留的隐藏/兼容参数 |
| --- | --- | --- |
| LLM | name、provider/protocol、apiKey、baseUrl、model、timeout、requestParamsJson | id、enabled、proxyUrl |
| GPT Image | baseUrl、apiKey、model、resolution、concurrency | ratio、proxyUrl、timeoutMs |
| Jimeng | sessionId/accessKeyId/secretAccessKey、reqKey、resolution、concurrency | model、ratio、endpoint、region、service、pollIntervalMs、timeoutMs |
| Custom Image | baseUrl、apiKey、model、resolution、concurrency | displayName、ratio、proxyUrl、asyncMode、ratioMappingJson、pollIntervalMs、timeoutMs |
| Volcengine TTS | V3 key、音色凭证/列表、预设/自定义 voice type | legacy appId/accessKey、resourceId、endpoint、cluster |
| MiniMax TTS | apiKey、model、voiceId、克隆音色数量 | profile id/enabled |
| STT | provider、baseUrl、apiKey、model、language、prompt、responseFormat、temperature、timestamps、chunking、timeout | SiliconFlow 强制值仍由 normalize 函数管理 |
| Jianying/BGM | draftPath、自动检测/选择目录、上传、每首 volume、默认项、删除 | BGM id/path/duration |
| IMA | clientId、apiKey、kbName | `kbId` 必须补为可编辑或可选知识库结果 |
| Viral | cookie path/source/fallback、frame interval、max frames、download timeout、vision LLM | legacy whisper/HF 字段仅在有 consumer 时展示 |
| UI | theme | `AppConfig.ui.theme` 与 `UiPreferences.theme` 迁移为一个明确所有者 |

`AppConfig` 顶层字段必须完整 round-trip：`llm`, `llmProfiles`, `activeLlmProfileId`, `imageProvider`, `image`, `gptImage`, `jimeng`, `customImage`, `imageProfiles`, `activeImageProfileId`, `tts`, `ttsProfiles`, `activeTtsProfileId`, `speechToText`, `jianying`, `ima`, `viral`, `ui`。

### 11.3 HTML Video 作业配置

`HtmlVideoJobConfig` 共 17 个字段，执行期唯一 owner 是 `pipelineData.config`。Task 顶层字段只作旧版本镜像和损坏恢复来源，不能形成第二套可编辑 state。新增共享 default resolver/factory；UI、创建 helper、恢复和 runtime 都读取它，不能各自复制 `fade`、`3:4`、`8` 等字面量。已有 snapshot 的缺失字段保持缺失语义，只有新建或用户主动修改才写入解析值。

所有字段都会进入 rewrite/planning LLM 和 checkpoint hash；下表的“consumer”专指会改变确定性 HTML 产物的运行时消费者。无 consumer 的字段只能无损保留或只读检查，必须先在同一实现批次补 consumer 和测试，之后才能开放编辑控件。

| 字段 | 当前默认/fallback 与校验 | 当前 -> 目标可见性 | 确定性 consumer、持久化与测试门禁 |
| --- | --- | --- | --- |
| `style?: string` | 新建 `modern-film`；空回退 task style；config 字符串 <=1024 | 已有画面风格 -> 创建区/素材 inspector | 图片 prompt/runtime task；config owner + task mirror；内置/自定义、provider 实收、重试 round-trip |
| `voiceId?: string` | 从 active TTS 默认音色派生；字符串 <=1024，空回退 task speaker | 当前隐藏派生 -> 配音 tab 音色选择 | voice 阶段 speaker；config + task mirror；provider 切换、无效音色、合成实收、重启 |
| `ttsProvider?: string` | shipped default `volcengine`；嵌套 parser 当前接受任意 <=1024 字符串，runtime 只认 volcengine/minimax/mock | 当前隐藏派生 -> 配音 tab provider | TTS 路由；统一为三值 schema，原子同步 task mirror；三 provider/非法值/凭证失败 |
| `ttsSpeed?: number` | 新建/存储 `1`；parser 当前允许非负，顶层 IPC 为 0.1..10 | 当前固定 1 -> 配音 tab slider + 数值输入 | TTS speed；共享 schema 统一 0.1..10；边界、NaN/Infinity、合成实收、恢复 |
| `bgmId?: string` | 配置默认/首个合法项/空字符串；config <=1024、task mirror <=256 | 已有 BGM chips -> 出片/音频区 | 主进程校验库项并 render 混音；旧任务缺歌报错不静默换歌；空/有效/缺失/损坏文件测试 |
| `captionPreset?: string` | 缺失，兼容当前硬编码外观；仅字符串 <=1024 | 隐藏 -> 补 HTML CSS consumer 后进入预览 tab | 当前无 consumer；config-only；preset CSS/截图、非法值、缺失保持旧外观、预览/成片一致 |
| `captionAnim?: string` | 缺失，当前固定 timeline；仅字符串 <=1024 | 隐藏 -> 补 timeline consumer 后进入预览 tab | 当前无 consumer；config-only；关键帧、非法值、reduced-motion、preview/render 一致 |
| `captionColors?: Record<string,string>` | 缺失，当前 CSS 固定；最多 32 项，key <=128、value <=1024 | 隐藏 -> 补 CSS variable consumer 后进入预览 tab | 当前无 consumer；深拷贝 config；允许 key/CSS 色值/注入/33 项/V1-V2 round-trip |
| `bgmVolume?: soft|medium|loud` | 缺失等同 soft=-28dB，medium=-22，loud=-16；严格三值 | 当前隐藏 -> 出片/音频三段控制 | render `bgmTargetDb`；config-only；四种缺失/枚举映射、无 BGM、compose payload |
| `transitionType?: string` | 创建/恢复/runtime fallback `fade`；当前仅 <=1024 字符串 | 出片只读 -> 合法 catalog 菜单 | render/sidecar transition；非法值在 IPC 前拒绝；单/多场景、时长、恢复告警 |
| `coverImageMode?: string` | HTML 创建/恢复 `titled`，通用 task 缺失却为 `off`，存在双默认 | cover tab 只读结果 -> 先统一模式并补 cover 子流程再编辑 | 当前无 consumer；config + task mirror；legacy titled 迁移及 off/auto/manual 真实产物测试 |
| `coverTemplate?: string` | `cinematic-poster`；config <=1024、task ID <=256 | 隐藏 -> cover consumer 完成后显示模板 | 当前无 consumer；config + task mirror；内置/自定义/缺失模板和完整模板字段测试 |
| `coverRatio?: string` | `3:4`，当前只读 fallback；无 ratio 合法性校验 | 出片只读 -> cover consumer 完成后显示比例 | 当前无 consumer；config-only；尺寸、非法比例、缺失 snapshot、checkpoint round-trip |
| `draftTemplate?: string` | 缺失；仅字符串 <=1024，无模板存在性校验 | 隐藏 -> 明确控制 HTML 导出还是剪映草稿并补 consumer 后显示 | 当前无 consumer；config-only；有效/缺失模板、真实导出差异、无 consumer 时 UI 不可编辑 |
| `foreground?: boolean` | 新建/恢复 `true`；严格 boolean | 已有生成/跳过 -> 创建区/素材 inspector | asset 生成、完整性校验和合成；config + task mirror；true/false 数量、重跑清理、恢复 |
| `maxScenes?: number` | UI/规划默认 8；安全整数 1..30，HTML IPC hard limit 30 | 已有 8/12/16/20/30 -> 允许契约支持的 1..30 | rewrite/planning/provider 数量；config + 两个 task 镜像；1/8/30、0/31/小数、旧值告警 |
| `ratio?: string` | 新建/fallback `9:16`；当前 renderer 只认 9:16/16:9/1:1/4:3，非法会静默回 9:16 | 已有四比例 -> 同一 catalog 用于创建/输出 | 图片比例、preview/render canvas；config + task mirror；四尺寸一致，非法值在 IPC 拒绝 |

17 个字段必须进入独立版本化 control manifest：导出 `HTML_VIDEO_CONTROL_MANIFEST_VERSION = 1` 和 `HTML_VIDEO_CONTROL_MANIFEST_V1`，使用 `satisfies { [K in keyof HtmlVideoJobConfig]-?: HtmlVideoControlContract<K> }` 做编译期穷尽，并为每项记录 `defaultResolver/schema/uiLocation/persistencePath/legacyMirror/consumerStages/invalidateFrom/availability/tests`。V2 parser 和 V1 `_cfg` migration 做全字段 round-trip；当前没有损坏恢复镜像的 caption 三项、bgmVolume、draftTemplate，以及会被恢复默认覆盖的自定义 transition/coverRatio，都必须形成显式告警与测试。

六个 pipeline stage 与六个 tab 数量相同只是巧合，不是一一映射：

| Pipeline 状态 | 自动聚焦 tab | 关系 |
| --- | --- | --- |
| `rewrite` | `text` | text tab 的第一个生产阶段 |
| `planning` | `text` | 与 rewrite 共用 text tab |
| `assets` | `assets` | 一对一 |
| `voice` | `voice` | 一对一 |
| `preview` | `preview` | 一对一 |
| `render` | `output` | output 展示渲染中和最终成片 |
| `done`（终态，不计入六 stage） | `output` | 与 render 共用 output |
| 无独立 stage | `cover` | 正交 inspector；挂到 render 的封面子流程，不能伪装成第七 stage |

stage 变化才可按上表自动切 tab；手动进入 cover 不改变 stage。测试精确断言 `rewrite -> planning` 留在 text、`render -> done` 留在 output、cover 失败归属 render 并在 cover tab 展示细分错误。普通任务始终 `x/7`，只有 HTML Video 使用 `x/6`。

IMA“测试并拉取知识库”和“清理历史”不能继续是无 handler 按钮。前者接 `config:test`/真实拉取流程；后者进入历史治理并执行可确认的归档/删除操作。

## 12. 账户与激活

- 账户保留 `displayName`, `email`, `workspace` 编辑；`avatarInitial` 从显示名派生；`deviceId` 与 `balance` 只读。
- 展示已加载的 `creditTransactions`，使用真实条目而不是伪统计。
- 增加 email 格式校验但兼容已有本地值。
- 激活保留 `code`, `plan`, `status`, `expiresAt`, `message`；plan/status 使用合法状态转换，不能保存 `plan=local,status=trial`。
- 剩余试用天数处理无效日期，最小为 0；侧栏与激活页使用同一 helper。

## 13. 历史治理与删除安全

### 13.1 数据规则

- tasks、viral analyses、image lab、voice lab 增加 `archivedAt` 或等价归档字段，列表 API 明确 active/archived filter。
- 四类实体共用同步 `HistoryActivityRegistry`，每个 `(family,id)` 只有 `active` 或 `governing` 两种互斥 reservation。start/resume/retry/generate 必须在任何异步工作和目录创建前原子取得 `active`；archive/delete 必须在读取状态和提交数据库前原子取得 `governing`；任一 reservation 已存在时另一方向立即拒绝，并都在 `finally` 释放。这样同时封住“检查后启动”和“启动后状态未落库”两个竞态。
- task/viral 的 `pending`、`running`、中央 active reservation 或仍位于现有主进程 active map 的实体同时拒绝归档和永久删除；现有 `runningTasks` / `runningViralAnalyses` 只保留运行句柄，不再单独拥有互斥语义。image/voice 即使记录尚未落库或当前状态类型没有 running，也由同一 registry 拒绝同 ID 的在途生成与治理。数据库状态、主进程 registry 和 UI 三层执行一致守卫，归档与删除仍在数据库写队列中串行。
- 永久删除只能作用于已归档实体；活跃列表只提供归档，已归档列表才提供恢复和永久删除。归档不删除文件、不改变原 status，也不等同于暂停或取消。
- 删除 task 同事务删除 task events；删除 viral analysis 同事务删除 viral events；lab 删除对应记录。
- 图片记录删除同时清理其 `playground_jobs` 镜像；数据库 API 本身也拒绝 running，不能只依赖 UI。
- 主进程同时检查 `runningTasks` / `runningViralAnalyses`；竞态窗口内即使数据库仍是 draft/paused，也必须拒绝归档与删除。归档实体不得更新状态、重试或重新启动；runner 进入 active map 与状态落库之间、退出 active map 与终态落库之间都要有契约测试。
- 每类删除都发布 tombstone delta。renderer reducer、reconciliation、reset buffering、mutation revision slices 和浏览器 fallback 都按 ID 移除记录，防止重放复活。

### 13.2 文件规则

- 数据库里的 `outputDir`, `draftDir`, `artifactStatePath`, reference/media/result/video/image/audio path 永远不是递归删除授权。
- 可删除目录只能从可信 appData 根 + 内部受验证 ID 推导。治理 ID 采用至少 `^[A-Za-z0-9_-]{1,256}$` 的专用 schema，禁止绝对 ID、`..`、根目录、空 ID、路径分隔符和保留设备名；不能复用当前过宽的通用 `idSchema`。
- 新建四类实体在任何文件写入前生成并持久化独立的安全 `managedStorageKey`，受管目录只能由 appData 根 + 该 key 推导，不能再用调用方可传入的业务 ID。迁移旧记录时，只有原 ID 通过专用 schema、解析后仍在受管根内且无 symlink/junction/reparse 才可回填 key；其他旧记录保持 key 为 null，永久删除只删数据库并明确报告“未删除旧外部/不可信路径”，绝不把原 ID 或数据库路径重新解释为递归删除授权。
- 删除前验证 lexical path、`lstat` 类型、realpath、根目录 containment、无 symlink/junction/reparse point；quarantine rename 前后重新验证 identity，处理 TOCTOU。
- 先将受管目录原子 rename 到同根 quarantine，再提交 DB；DB 失败时恢复；提交成功后清理 quarantine。清理失败保留可诊断 tombstone，不恢复数据库记录。
- rename 前后比较 `dev/ino`，回滚前再次验证 identity，且目标已被重建时绝不覆盖。递归清理使用不跟随 symlink/junction 的 walker。
- 外部剪映草稿、用户选择的素材、BGM、参考图和任意数据库路径绝不递归删除。

### 13.3 四类列表与 API 契约

当前四类 preload/list channel 必须保留名称以兼容旧调用，但不能继续共用只有 `cursor/limit` 的无类型请求。新增 `HistoryArchiveFilter = 'active' | 'archived'` 和以 `family` 判别的严格联合：

```ts
type TaskHistoryStatusFilter =
  | { status?: TaskStatus; statuses?: never }
  | { status?: never; statuses: TaskStatus[] };

type HistoryListRequest =
  | ({ family: 'task'; filter: HistoryArchiveFilter; taskType?: 'story' | 'music-mv' | 'html-video'; query?: string; cursor?: string | null; limit?: number } & TaskHistoryStatusFilter)
  | { family: 'viral-analysis'; filter: HistoryArchiveFilter; status?: ViralAnalysisStatus; query?: string; cursor?: string | null; limit?: number }
  | { family: 'image-lab'; filter: HistoryArchiveFilter; status?: ImageLabRecord['status']; query?: string; cursor?: string | null; limit?: number }
  | { family: 'voice-lab'; filter: HistoryArchiveFilter; status?: VoiceLabRecord['status']; query?: string; cursor?: string | null; limit?: number };

interface HistoryPage<F extends HistoryFamily, T> {
  family: F;
  items: T[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}
```

task request 在类型和 Zod `.strict()` schema 两层都必须保证 `status` 与 `statuses` 互斥；`statuses` 最多 7 项、去重并按固定枚举顺序规范化后进入 cursor fingerprint，`taskType` 严格限制为 `story | music-mv | html-video`。历史单状态筛选使用 `status`；队列使用明确的工作状态集合分页，不能让 completed 首屏遮住较早的 pending/running；HTML task selector 使用 `taskType='html-video'` 的独立 cursor 栈和“加载更多”，不能依赖 bootstrap 恰好含有旧 HTML 任务。共享 `normalizeTaskHistoryType(task)` 必须先 trim `taskType`：合法 `html-video/story/music-mv` 原样返回，空值再按 `taskKind === 'music-mv' ? 'music-mv' : 'story'` 回退，未知非空旧值作为 legacy unknown 保留。storage SQL/row mapper、renderer 和 browser fallback 共用该语义；unknown 只在未指定 taskType 时可见，不伪装成三种合法过滤值。

renderer 省略 `filter` 时，现有四个 preload list 方法统一补 `active` 和固定 family；IPC 使用 `.strict()` schema，禁止跨 family status。query trim 后空值等同省略、最长 256；limit 必须是 1..100 整数、默认 50。搜索字段为：task 的 `title/input_text/ai_keyword`，viral 的 `title/url/platform`，image 的 `prompt/provider/style`，voice 的 `text/voice_label/provider`。搜索完整持久化字段，不在 summary preview 上伪装全文搜索。

active 按 `created_at DESC,id DESC`，archived 按 `archived_at DESC,id DESC`。opaque cursor 绑定版本、family、filter、status/statuses、taskType、query fingerprint、排序值和 ID；跨查询复用返回 `CURSOR_INVALID`。`totalCount` 是当前过滤条件的完整命中数，`hasMore === (nextCursor !== null)`。bootstrap 每类只取 active 首屏，不再自动拉完全部 cursor 页面；队列和 HTML selector 按上述专用过滤自行分页。

| family | 保留/新增 preload | IPC | FileDatabase |
| --- | --- | --- | --- |
| task | `listTasks` / `archiveTask` / `restoreTask` / `deleteTaskPermanently` | `task:list/archive/restore/delete` | `listTaskSummaries/archiveTask/restoreTask/deleteTaskPermanently` |
| viral-analysis | `listViralAnalyses` / `archiveViralAnalysis` / `restoreViralAnalysis` / `deleteViralAnalysisPermanently` | `viral:list/archive/restore/delete` | 同名 list/archive/restore/delete 方法 |
| image-lab | `listImageLabRecords` / `archiveImageLabRecord` / `restoreImageLabRecord` / `deleteImageLabRecordPermanently` | `image-lab:list/archive/restore/delete` | 同名 list/archive/restore/delete 方法 |
| voice-lab | `listVoiceLabRecords` / `archiveVoiceLabRecord` / `restoreVoiceLabRecord` / `deleteVoiceLabRecordPermanently` | `voice-lab:list/archive/restore/delete` | 同名 list/archive/restore/delete 方法 |

四张表增加 nullable `archived_at` 及筛选/排序索引。archive/restore 幂等并返回对应 summary upsert；永久删除幂等返回 tombstone。task/viral 的 pending/running 同时由数据库状态和主进程 active map 拒绝；image/voice 即使尚未落库或没有 running 状态，也由统一 active lock 拒绝同 ID 治理。task/viral 级联删除事件，image 同事务删除 `playground_jobs` 镜像，voice 永远不删除 `MinimaxCloneVoice` 或克隆源音频。

### 13.4 Tombstone、分页状态与页面动作

最小 `history_tombstones` ledger 记录 `family/id/managed_storage_key/deleted_at/cleanup_state/quarantine_name/quarantine_identity_json/diagnostic`；identity 至少保留 rename 后的 `dev/ino`，并允许 Windows 平台补充等价 volume/file identity。启动 reaper 重新 `lstat/realpath` 后只有 identity、受管根和 reparse 检查全部匹配才清理；不匹配只写诊断，绝不按名称盲删。所有 upsert/status/retry 路径写入前检查 tombstone。`AppDelta` 增加 `task-tombstone`、`viral-tombstone`、`image-lab-tombstone`、`voice-lab-tombstone` 四个明确分支，并纳入 `AppMutationResult`、delta replay、mutation revision slice、reset buffering、force reset 和 browser fallback。renderer 按 ID 同时清除 summary、详情选择和页面缓存；archive/restore 使记录改变 tab 后重新请求当前 query，不能把 upsert 插入错误列表。

四类页面统一提供活跃/已归档 tabs、family 合法状态筛选、服务端搜索、`totalCount` 和 cursor 分页。active 只显示归档；archived 显示恢复和永久删除。归档/恢复不确认；永久删除 modal 展示标题/ID、将删除的受管数据和明确不会删除的外部文件。爆款保留报告/模板/生产任务动作，画图保留图片/模式/provider，配音保留播放器/音色/语速；归档记录只读且不能重试或继续。

每个 family/filter/status/statuses/taskType/query 组合维护独立 cursor 栈，初始 `[null]`。下一页 push response cursor，上一页 pop 后用栈顶重查；条件变化重置。请求携带 query token，迟到响应不得覆盖新查询。治理后重载当前 cursor；若页空则退回上一页。当前详情被删除时关闭详情或选择同页相邻记录。

永久删除先按 `managedStorageKey` 分支。key 为 null 的 legacy 记录不做任何路径解析、rename 或递归清理，直接在数据库事务中删除记录并写 `cleanup_state='unmanaged-legacy'` tombstone/诊断，再发布 delta。key 非 null 时才执行：验证受管路径与 identity -> 同根 quarantine rename -> 再验 identity -> 排队提交数据库和 tombstone -> 发布 delta -> 不跟随链接地清理 quarantine。数据库失败只在 identity 未变且目标不存在时回滚；提交后清理失败只记录诊断并由启动 reaper 重试，绝不恢复数据库/UI 记录。用户级可恢复操作只有归档恢复。

## 14. 已确认的功能修复清单

1. 修正普通任务六步概念为七步。
2. AI 合成后保留 selected sources 与来源溯源。
3. 实现真实“保存为草稿”。
4. 实现并持久化自动标题。
5. 修正 `keepPromotion` 文案与布尔语义。
6. 为 custom 暂停提供真实步骤选择，或移除重复模式。
7. 区分封面 off/auto/manual 的运行时行为。
8. 让队列继续/重试语义一致且不重复伪动作。
9. 使用真实状态/并发统计，修复 clip-only 完成度。
10. 历史增加 pending/paused、服务端分页和准确搜索。
11. 详情事件消费完整分页。
12. 选品全字段 round-trip，修复主题改名重复记录。
13. 对标来源与关键词持久化。
14. 画图 provider/smart mode/批量成本与规划语义对齐。
15. 配音失败状态形成真实历史。
16. IMA 测试、清理历史、积分明细和激活一致性成为真功能。
17. DraftTemplate IPC 改为严格嵌套 schema，避免坏对象进入存储。
18. HTML Video 暴露已消费的 `bgmVolume` 和 `transitionType`；不展示无 consumer 的参数。
19. Music MV 让分镜数、BGM、草稿模板、画布和字幕样式真正生效，并补真实歌词同步与音频前置校验。
20. 爆款拆解补暂停/取消/继续、崩溃恢复、历史设置隔离、完整报告和原子模板保存。

## 15. 响应式与可访问性

- 1440x900 为主设计尺寸，1080x720 为紧凑桌面门禁；不得出现水平页面溢出或按钮裁剪。
- 侧栏在紧凑桌面可缩为图标 rail，但十五个入口仍可通过 tooltip 访问；不折叠为“更多”。
- 新建任务在窄屏把摘要移到编辑器下方；媒体工作台按参数、画布、运行栏顺序堆叠。
- 表格窄屏隐藏次要列但保留状态和动作；不把治理表格改成卡片网格。
- 所有 dialog 聚焦、Escape 关闭、危险操作确认、loading/disabled/empty/error 状态完整。
- 所有媒体使用真实 `img/audio/video` 状态，失败时显示可操作错误，不使用假进度。

## 16. 验收与测试

### 16.1 功能保真

- 新增轻量 `src/features/tasks/task-control-manifest.ts`，导出 `TASK_CONTROL_MANIFEST_VERSION = 1` 和 `TASK_CONTROL_MANIFEST_V1`，使用 `satisfies { [K in keyof CreateTaskInput]-?: TaskControlContract<K> }` 对 51 个字段编译期穷尽。每项记录 `field`, `flowOwner`, `surface`, `visibility`, `defaultSource`, `uiControl`, `uiRange`, `ipcContracts`, `normalizer`, `persistenceConsumer`, `tests`；`hidden-compatible` 字段同样必须有 owner/consumer/test。
- manifest 版本只描述 renderer 控件、默认/显隐/规范化，不发送给 strict `CreateTaskInput`。真实任务草稿用 `{ controlManifestVersion, values }` 包装并由 `migrateTaskDraft(vN -> vN+1)` 迁移；字段位置、显隐、默认或 normalizer 变化才 bump，纯 CSS 不 bump。
- 数值 boundary 放入无 Zod 依赖的 `src/shared/task-control-limits.ts`，由 manifest、payload normalizer 与 IPC schema 引用。DOM `min/max/step` 只负责交互提示，不拥有协议上限。

| 字段 | UI 新建值域 | IPC/旧客户端兼容上限 | owner 与 normalizer |
| --- | --- | --- | --- |
| `targetLength` | 空=自动；100..5000，step 50 | generic create/research 0..1,000,000 | new-task 输出；`normalizeTargetLength` 将实际运行值 clamp 到 100..5000 |
| `targetScenes` + `storyboardSceneCount` | 普通任务空=自动；1..60 | generic create 0..500；HTML 专用 hard limit 30 | 普通 builder 写同一规范值；HTML 再经 `requireHtmlVideoMaxScenes` |
| `lockIntroSentences` | 默认 0；0..20 | generic create 0..100 | new-task 文案把控；整数截断并 clamp 到 0..20 |

- 对每个代表数字测试 blank、min-1、min、max、max+1、fraction、NaN；独立证明 UI max+1 但仍在兼容范围内的旧 IPC payload 可通过 boundary，而 IPC max+1 拒绝。HTML 的 30 不能被普通任务 60 或 generic IPC 500 覆盖。
- 对 51 个 `CreateTaskInput` 字段做编译期 exhaustiveness 和 payload 行为测试。
- 对 AppConfig、PromptTemplate、CustomStyle、CustomCoverTemplate、DraftTemplate、HTML config 和 MinimaxCloneVoice 做完整 round-trip 测试，包含隐藏兼容字段。
- 对全部 preload 方法与 IPC channel 保持一一对应测试；新增 archive/delete channel 同样进入 schema inventory。
- 行为测试覆盖条件显示、默认值、模板联动、按钮调用、成功/失败/取消和 browser-preview 限制。

### 16.2 数据与安全

- 归档、恢复、running 拒绝、级联、tombstone replay、分页稳定性。
- task/viral/image-lab/voice-lab 四个 list 都使用 family-specific 严格请求：archive filter、合法 status、query、整数 limit、opaque cursor，并返回 `family/items/totalCount/hasMore/nextCursor`；每个 family/query 独立维护上一页 cursor 栈。
- 受管根、外部路径、`..`、绝对 ID、根目录、symlink、junction、swap/TOCTOU、quarantine rollback 和清理失败。
- 删除后强制 reconcile/reset 也不能复活记录。

### 16.3 性能与视觉

- 双 TypeScript、全量 Vitest、build、真实 Electron smoke、HTML video smoke 和 CDP/截图 QA。
- entry JS < 500 kB；模板语料只在 lazy chunk；无一秒全量 state polling。
- 九张已确认概念只对照其覆盖状态：新建素材/创作/输出、队列、历史活跃、普通详情、HTML studio、提示词模板和紧凑新建。其余入口按本文信息架构、共享组件、token、容器模型和 control manifest 验收，不声称存在未制作的逐页概念图。
- Light 主题在全部十五个入口做 1440x900 和 1080x720 截图/交互 QA；Dark 主题至少覆盖新建、历史、HTML、画图/配音媒体、草稿画布和设置，并对全部入口做 overflow/clip/computed-token 自动检查。两主题均要求 0 页面横向溢出、0 控件裁剪、0 重叠、0 未解析 token。
- computed style 断言壳层 token 随主题变化、media canvas token 完全不变；按实际使用的 foreground/background 组合逐对计算对比度，包含 `text-muted/surface-muted`、`on-accent/accent` 以及 info/success/warning/danger 的 fg/bg 配对。文本对比度至少 4.5:1，非文本焦点至少 3:1；禁止只测单个色值或默认白底。主题切换不改变画布像素、时间线色阶、默认缩放/平移或尺寸。
- 普通任务所有列表/详情/概念统一显示完成数 `x/7`，当前 Step 4 对应第 5 个阶段；HTML 视频独立显示 `x/6`。`clip-only` 使用真实终止步骤，不伪装 7/7。
- 浏览器工具不可用时继续使用仓库真实 Electron `capturePage`，并记录原因。

## 17. 概念资产

提交到 `docs/plans/assets/storydream-editorial-workbench/` 的修订资产：

- `storydream-parity-concept-new-task-material-1440x900.png`
- `storydream-parity-concept-new-task-creative-1440x900.png`
- `storydream-parity-concept-new-task-output-1440x900.png`
- `storydream-parity-concept-queue-1440x900.png`
- `storydream-parity-concept-history-1440x900.png`
- `storydream-parity-concept-detail-1440x900.png`
- `storydream-parity-concept-studio-1440x900.png`
- `storydream-parity-concept-templates-1440x900.png`
- `storydream-parity-concept-new-task-1080x720.png`

这些修订资产是 light 主题已覆盖状态的实现视觉基准；dark 主题及未覆盖页面按本文 token、组件和容器规格验收。本文的保真矩阵是功能基准。两者冲突时以功能基准为准，并修订概念而不是删功能。
