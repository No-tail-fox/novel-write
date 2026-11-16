# StoryDream 整体 UI 统一与渐进重构方案

> 状态：分析与设计方案，尚未实施正式 UI 修改。
> 本次交付为重构方案与重构前远程备份；尚未修改正式 UI、依赖或业务数据。
> 重构前源码快照：`93a889eb002654bbf5ce85e138f994e68f06125a`；备份分支：`backup/pre-ui-unification-20261116-152721`。Gitee 已核验该快照。快照保留原工作分支与暂存区；排除本地私有归档、运行数据、临时输出及非本次原型的 QA 产物。此为恢复基线，不代表当前全部功能已通过构建验收。
> 方向依据：用户认可分镜总览原型的紧凑深色、珊瑚红强调色和轻量交互反馈，希望全局控件、布局与适配统一。

## 1. 目标与范围

统一成一个适合个人创作者长期使用的桌面制作工具：画面是主角，控件紧凑但可读，状态明确，操作有反馈。保留当前路由、制作流程、业务状态、Electron 窗体行为、IPC 与持久化。优先整理已有组件与样式，不以重写页面、强换组件库或增加导航层级作为默认方案。

视觉方向称为「紧凑创作工作台」：深灰分层底色、珊瑚红主操作和选中反馈、小圆角、细分隔线、有限阴影；保留浅色主题。紧凑不是把所有字缩小或把图片拉伸填满空白，而是减少重复标题、重复列表、无意义容器与过大的间距，将空间交给内容。

成功标准：同类控件跨页行为一致；核心操作在紧凑桌面窗口可达；切换镜头或路由不会丢草稿；数据状态不被装饰性动画覆盖；视觉方向在真实内容、空态、错误态下均成立。

## 2. 已核实的源码事实

以下路径相对项目根目录，链接相对本文件；行号是本次阅读定位，不是永久 API。当前结论来自源码阅读，不能代替正式应用的视觉验收。

| 证据 | 已有能力 / 发现 | 对方案的约束 |
|---|---|---|
| [AGENTS.md](../../AGENTS.md#L1-L16) | 项目文件留在当前根目录；UTF-8；本地归档不可发布 | 文档、QA 证据均留项目内，不读写无关工程或私有归档 |
| [navigation.ts](../../src/app/navigation.ts#L34-L116) | 六组主导航：项目、素材库、灵感、模板、任务、设置；账户和授权为辅助入口 | 保持一级导航与已有 view ID，统一视觉不另造“漫剧系统”入口 |
| [route-registry.ts](../../src/app/route-registry.ts#L30-L88) | 28 个路由键，懒加载；short-video 复用 NewTaskPage，template-animation 复用 EditorialCollagePage；person-assets 实际加载 AssetLibraryPage | 按实际组件去重实施，同时验收共享组件的不同路由模式 |
| [package.json](../../package.json#L30-L70) | 已声明 Fluent UI、React、Lucide；本次阅读的 dependencies/devDependencies 未声明 Arco | 不声称 Arco 已安装或已集成；现有原型不是 Arco 运行证据 |
| [theme.ts](../../src/ui/theme.ts#L1-L83) | 已有 Fluent 深浅主题和珊瑚红交互色；暗色 on-brand 为 #101214 | 保留主题 Provider 与现有语义体系，先核对两层主题映射 |
| [tokens.css](../../src/styles/tokens.css#L1-L91) | 壳层、媒体、状态语义色；36px 控件高度、6px 圆角、140ms 快反馈；深浅两套 | 扩充缺失语义，不在各 feature 复制颜色/时长常量 |
| [Button.tsx](../../src/ui/Button.tsx#L5-L55) | primary/secondary/subtle/danger；compact/comfortable/spacious；disabledFocusable | 复用现有 API，不虚构 loading 属性或新密度 API |
| [Pane.tsx](../../src/ui/Pane.tsx#L4-L16)、[Toolbar.tsx](../../src/ui/Toolbar.tsx#L1-L9) | Pane 支持 as 与 tone=base/subtle/raised；Toolbar 封装 FluentToolbar | 之前占位稿中的 Pane type=workspace/inspector 不是现有 API；布局由 className/CSS 承担 |
| [storydream-ui.css](../../src/styles/storydream-ui.css#L11-L40) | 按钮已有颜色过渡；IconButton 为 32px；字段 min-width:0 | 统一工作应从共享层增量改进，不是认定目前完全没有动效或适配 |
| [MotionComicPage.tsx](../../src/features/motion-comic/MotionComicPage.tsx#L149-L207) | 页面持有 document、selectedShotId、保存引用、异步请求标识和离开保护 | 表现层重排不能另建第二份选中状态或绕开保存与异步保护 |
| [MotionComicPage.tsx](../../src/features/motion-comic/MotionComicPage.tsx#L2657-L2701) | storyboard/video 实际渲染 MotionComicMakeWorkspace；audio/export 走 DirectorDeskWorkspace | 首轮试点针对真实制作入口，而非只改名字相似的旧组件 |
| [MotionComicProductionWorkspace.tsx](../../src/features/motion-comic/MotionComicProductionWorkspace.tsx#L76-L145) | 剧本/资产/制作/预览域；storyboard 映射 video 标签；保留导航记忆 | 沿用领域导航，不把原型“总览/单镜头”升级为新主路由 |
| [MotionComicMakeWorkspace.tsx](../../src/features/motion-comic/MotionComicMakeWorkspace.tsx#L34-L163) | 当前为左分镜、中编辑/参考、右预览/候选/生成；存在真实生成锁、失败状态、首尾帧与参考模式 | 总览只能作为既有制作流程的视图变体，生成规则、候选采纳及引用关系完整保留 |
| [MotionComicStoryboardWorkspace.tsx](../../src/features/motion-comic/MotionComicStoryboardWorkspace.tsx#L28-L103) | 存量列表/卡片、排序、检查器；含原生 button，删除确认未用 danger | 可参考和列为清理候选；本次在 motion-comic 范围检索未发现其调用，不能当作已挂载主入口，也不据此直接删除 |
| [ProjectHomePage.tsx](../../src/features/projects/ProjectHomePage.tsx#L19-L100) | 共用组件、列表/网格、筛选会话、分页请求控制 | 统一筛选栏与项目卡片时保留筛选和分页恢复 |
| [AssetLibraryPage.tsx](../../src/features/asset-library/AssetLibraryPage.tsx#L12-L44) | selectedId、dirty、request token、requestLeave | 资产检查器是状态契约参考；不能为了抽屉动画让旧请求覆盖新选择 |
| [QueuePage.tsx](../../src/features/tasks/QueuePage.tsx#L34-L115) | 来自任务状态的进度、暂停/重试等动作、事件隔离 | 队列用紧凑表格，不套分镜卡片；不能用模拟百分比冒充真实进度 |
| [SettingsPage.tsx](../../src/features/settings/SettingsPage.tsx#L19-L100) | 同时有 components 适配控件与 src/ui；draft、secretChanges、未保存保护 | 先追踪旧适配层是否已代理共享控件，避免机械替换与破坏凭证编辑 |
| [ImageLabPage.tsx](../../src/features/labs/ImageLabPage.tsx#L13-L85) | 已用共享字段、滑块、预览；比例选项和本地工作区草稿 | 统一生成表单与结果区，保留各自比例与生成条件 |
| [storydream-ui-system.test.ts](../../tests/storydream-ui-system.test.ts#L10-L150) | 已检验 Provider、对比度、组件导出及部分页面的控件边界 | 在现有测试上增加交互/布局覆盖；静态字符串测试不能替代浏览器检查 |

需要优先核对的具体差异：暗色 [tokens.css](../../src/styles/tokens.css#L17-L21) 的 shell-accent-contrast 是白色，而 [theme.ts](../../src/ui/theme.ts#L22) 的 Fluent 品牌背景文字是深色。应按实际消费者逐一检查背景/前景组合并确定统一语义，不能仅据这两个值宣称所有按钮对比度不合格。

## 3. 原型如何使用、哪些不能照搬

参考 [storyboard-overview.html](../../artifacts/storyboard-overview.html#L151-L176)：双列镜头图、紧凑信息、选中描边、约 200ms 反馈、轻微悬浮抬升、总览/单镜头切换。它是视觉与交互讨论依据，不是生产组件规格或正式实现。

已知限制：

- 四张图来自同一张示意素材的不同缩放/裁切；无法验证连续叙事、真实景别、角色一致性。
- 生成按钮未接后端；状态、4 秒时长等为示例，不能进入真实项目数据。
- 原型草稿仅有局部内存交互，没有完整项目保存、并发更新、撤销、任务恢复或失败重试契约。
- 网格图采用固定区间高度与 cover 裁切；正式缩略图可裁切但应明确，单镜头预览必须按项目比例完整展示。不能为减留白牺牲画面比例。
- 存在多轮 CSS 追加覆盖和固定四格宽度公式；正式代码应归纳成可变镜头数量的布局，不能复制整份 CSS。
- 左列表、中央网格、底部顺序条仍有信息重复；总览时左栏改为分集/场次与筛选，底部顺序条默认收起或仅承担排序/时长。
- 单镜头时使用一处镜头导航；音视频剪辑才启用真正时间轴，保留音轨、字幕、播放头与时间尺度。顺序条不可冒充时间轴。
- 双击放大只是快捷方式，必须保留可聚焦的“查看单镜头”按钮。
- 原型未构成正式 Fluent 组件、浅色、全部状态、长内容、完整键盘/屏幕阅读器与 Electron 验收；不能把原型宽度检查当成全应用质量证明。

## 4. 全部页面分组与优先级

P0 为迁移前置与安全问题；P1 为核心创作闭环；P2 为相邻高频/共享生产路径；P3 为后续长尾。优先级不代表删减范围。所有 28 个 route key 均列入最终覆盖。

| 分组 | 路由（实际 ID） | 优先级 | 页面模式与本轮统一重点 |
|---|---|---|---|
| 全局基础 | AppShell、Provider、加载/错误边界、公告、返回与保存状态 | P0 | 控件与壳层 token、统一焦点、头部密度、弹层层级；保持窗体控制 |
| 项目入口 | projects、new-task、short-video | P1 | 项目库 + 分步创建；筛选、网格/列表、创建按钮、未保存/恢复状态；后两者共享组件分别验收 |
| 漫剧 | motion-comic | P1 | 项目总览、剧本、资产、制作、预览/配音/导出；优先真实 MakeWorkspace，总览与单镜头复用同一数据 |
| 素材库 | person-assets | P1 | 过滤/搜索 + 集合 + 检查器；导入、回收、恢复、选中与草稿保护 |
| 任务运维 | queue、history、task-detail | P1 | 状态、进度、表格/列表、重试/恢复、错误说明与输出入口 |
| 系统设置 | settings | P1 | 先统一外观、图片/视频模型配置和从制作返回链路；全部设置分区随后完成 |
| 动画与音乐制作 | editorial-collage、template-animation、html-video、music-mv | P2 | 保留原生生产流程及不同渲染引擎；共享预览、表单、工具栏、候选与导出门禁；前两者同组件不同模式 |
| 独立生成 | image-lab、voice-lab、video-lab、music-lab | P2 | 输入/参数 + 结果/历史；试听、重试、模型不可用、费用提示与本地草稿 |
| 文案与对话 | copy-studio、conversation-workbench | P2 | 可读文本宽度、编辑器、消息流、生成与引用反馈；不强行变三栏图片工作台 |
| 模板 | prompt-templates、draft-templates | P2 | 模板库/编辑器；克隆、导入、保存、画布配置与预览 |
| 灵感 | hot-board、benchmark、book-selection、viral-analyzer | P3 | 筛选/结果/详情，信息来源、加载/失败、进入创作的动作；长表格保留局部滚动 |
| 账户辅助 | account、activation | P3 | 资料/积分/授权状态、表单与反馈，不把模拟余额或授权说明改成真实支付承诺 |

任何 P2/P3 页面若因共享层变更受影响，必须在对应共享层交付时回归，不等排期。任何页面已有的阻断性可访问问题、数据丢失或无法操作问题均提升 P0。

## 5. 控件与状态规范

### 5.1 视觉尺度

以既有 token 为基线，建议试点尺度而非直接全局替换：间距 4/8/12/16/24px；工具区 8–12px，分组 16px，页面边距随可用宽度在 12–24px 调整。正文 13–14px，辅助说明不低于 12px，面板标题 14–16px；系统中文字体栈保持现状。避免将原型 11px 标签作为全站标准。

普通表单优先 comfortable，密集工具栏 compact，spacious 仅用于明确的大操作区域。先检查 Fluent 实际计算尺寸，再为项目密度建立语义映射；32px 图标按钮保持稳定，触控场景扩充命中区域。圆角沿用 6px 控件 / 8px 资产容器，弹层阴影高于卡片，不给每个字段套悬浮卡片。

### 5.2 控件矩阵

| 控件 | 统一规则 | 必验状态与行为 |
|---|---|---|
| Button / IconButton | primary 表示局部关键下一步，secondary 普通命令，subtle 工具命令，danger 最终破坏操作；图标保留 Lucide 与可访问名称 | default/hover/pressed/focus-visible/disabled/busy；异步保留几何尺寸；需保留焦点时评估 disabledFocusable；不禁用无关导航 |
| TextField / TextAreaField | 可见 label、辅助说明和字段错误；长文本允许垂直调整；字符限制真实反馈 | 空值/输入/只读/禁用/错误/待保存/保存失败；中文输入法组合期间不触发错误提交；切换镜头不丢草稿 |
| Select / PreviewSelect | 稳定 ID、模型/素材预览与文字名称并存；长名称可完整查看 | 加载/无结果/服务不可用/选项过期/重试；关闭弹层回到触发控件 |
| Checkbox / Switch / Slider | 多选用 checkbox，即时生效用 switch；滑块显示单位和当前值，精确值可输入 | checked/mixed/disabled、键盘步进、0 值可见；延后保存不能伪装即时生效 |
| Tabs / SegmentedControl | Tabs 为同对象内容区；分段为少量互斥显示模式；命令不用 tab | selected/focus/disabled；正确角色和键盘行为；模式切换保留对象与未保存内容 |
| Pane / Toolbar | Pane 使用 tone/as；工具栏有名称、稳定主次顺序；容器不重复绘制标题与边框 | 可用宽度不足时换行/更多菜单；主操作和返回不能被挤出；检查 Toolbar 子控件键盘行为 |
| 资产/镜头卡片 | 媒体 + 名称 + 必要元信息 + 文本状态；视觉选中从稳定 ID 派生 | loading/empty/broken/selected/running/failed/stale；多选与当前编辑对象明确区分；内部按钮不形成嵌套交互 |
| 表格/列表 | 表头与单元格语义完整；排序筛选分页持久一致；操作列稳定 | 长标题、0 条、部分加载、失败、失效选择；整行打开与内部操作不冲突 |
| Dialog / Drawer / Menu / Tooltip | 共享层负责弹层、焦点和主题；有关闭路径；关键错误不得只放 tooltip | 打开/关闭/Escape/焦点恢复/嵌套弹层；未保存修改遵守既有离开保护 |
| 状态 / 反馈 / Progress | 文本或图标 + 语义色；未知进度显示真实阶段；空态提供相关下一步 | pending/running/paused/failed/cancelled/completed、结果过期与提交未知分开；错误给恢复路径，避免误导用户重复付费提交 |

所有控件至少建立深浅主题的默认、悬浮、按下、焦点、禁用样例；可适用组件增加加载、空、错误、选中、展开、未保存/保存失败。状态不只用颜色，不能用固定绿色圆点代表任意真实生成结果。

## 6. 布局、适配与内容密度

按页面模式统一，不统一成一种模板：创作工作台、素材/项目库、任务操作、设置表单、文本编辑五类即可。

- 优先按扣除全局侧栏后的内容区域决定列数；建议使用容器宽度或等效测量，避免只看浏览器 viewport。
- 宽桌面：主区域优先，检查器建议 280–320px；镜头总览网格用 minmax 自适应，不硬编码四格占满整行。
- 紧凑桌面：先收起局部列表/项目树并保留入口，再将检查器移入 Drawer；字段值与选中状态不随开合重建。工具栏将低频操作进入更多菜单。
- 窄屏预览：单列/可折叠区，表单不溢出；此为网页查看保障，不据此声称完整手机剪辑体验。
- 文本编辑页面保留阅读宽度；素材页按内容增加列；不能以无上限撑宽表单来消灭所有留白。
- 明确滚动所有者：壳层固定；集合与检查器各有受控滚动区；表格/真实时间轴允许局部横向滚动，页面根节点不能无意横向溢出。弹层内键盘焦点不得被 sticky 区遮挡。
- 预览使用项目比例；缩略图裁切和完整预览是不同语义。长标签优先换行，确需截断则提供鼠标和键盘均可访问的完整信息。

漫剧去重复：总览时中央唯一镜头集合，左侧只放分集/场次导航或筛选；单镜头时中央完整预览，镜头列表只出现一次；需要排序才展开紧凑顺序条；audio/export 保留真正音视频时间轴。不要同时常驻左列表 + 中网格 + 底大缩略图三份相同镜头集合。

## 7. 灵动反馈与无障碍

沿用当前 140ms 快反馈，试点补充 180–220ms 的选择/卡片反馈和约 240ms 的抽屉进入，形成共享语义 token；最终数值由实机结果确定。缓动以 ease-out 为主，轻回弹只用在少数媒体卡片。候选卡片可抬升 2–3px，按钮按压幅度从不位移反馈或不小于 0.98 的轻缩放评估，密集工具栏优先不缩放。

禁止 transition:all、动画 width/height 导致整体重排、每卡循环闪光、与真实进度无关的无限脉冲。只动画 transform/opacity 或短颜色变化；新状态必须立即可操作，快速连续点击能中断动画。prefers-reduced-motion 下取消位移/缩放，仍保留选中、文本进度和焦点信息。

可访问验收：正文前景/背景对比度目标至少 4.5:1，必要图形/边界和焦点指示目标至少 3:1；分别测深浅主题与组合背景。键盘可完成选中、查看、排序、删除确认、保存、抽屉开合；拖拽必须有上移/下移或其他无需拖动的替代。目标大小以桌面 Web 可操作性检查，32px 图标控件不能进一步为了密度缩小；触控环境使用更大命中区。

鼠标选择不抢输入焦点；键盘选择按明确契约移动焦点。Dialog 限定焦点并回到触发点；Drawer 模态与否按组件实现一致处理。ARIA 的 pressed/selected/expanded 不混用，图片提供恰当 alt，装饰图标隐藏。错误连接字段，重大失败可 alert，普通保存/进度用克制的 status，避免每帧播报。

## 8. 共享层与业务层边界

| 层 | 负责 | 不负责 |
|---|---|---|
| src/styles/tokens.css | 壳层/媒体语义色、尺寸/间距、焦点、层级和共用动效参数 | 每页特有网格与业务状态推断 |
| src/ui/theme.ts + Provider | Fluent 深浅主题映射、品牌前景/背景、控件状态、portal 主题 | 项目数据、路由、生成任务 |
| src/ui + storydream-ui.css | 可复用控件行为、密度、焦点、禁用、必要弹层与标准外观 | 镜头编辑、素材绑定、重试策略、自动保存 |
| src/components | 业务中立组合，如空态、错误详情、确认、分页、状态反馈 | 新建第二套基础控件或复制 Fluent 细节 |
| feature + feature CSS | 数据编排、局部布局、stable ID 选择、加载/错误语义和业务动作 | 私自重定义全局按钮色、高度、焦点、品牌主题 |
| app | 路由、全局壳层、返回、工作区保护、跨页面状态 | 镜头提示词等具体业务字段 |

继续使用 storydream-ui 的契约：feature 从 src/ui 导入基础控件，不直接引 Fluent 内部；已有原生控件按当前被迁移的完整工作流逐步替换，不能全仓机械替换。选中 ID 只更新一次，列表、预览、检查器派生一致；保留 stale 请求防护和草稿。

Fluent 不需要因为用户喜欢原型而强换库。Arco 如需比较，仅做独立、可移除的对照试点，先验证版本/来源/许可证/React 兼容和离线构建，再用同一数据集比较输入、按钮、选择、弹层与主题。试点与生产 Provider/CSS 隔离，不默认加主依赖或替换所有路由。现有 package 声明未见 Arco，原型用自定义 CSS 不等于使用真实 Arco。也不能声称 Arco 一装就必然破坏现有主题；冲突需要实测，组件库更换需单独成本收益决策。

## 9. 分阶段交付、验收、回滚

| 阶段 | 交付边界 | 进入下一阶段条件 | 回滚方式 |
|---|---|---|---|
| A：基线与契约 | 固定代表页面/测试数据，记录深浅、宽窄、状态截图；核对组件消费者和正式入口；建立缺陷清单 | 所有路线映射、状态所有者、关键交互可复现；确认视觉目标，指标有基线 | 只产生基线与文档，无业务影响 |
| B：共享控件样板 | 统一主题映射、密度/动效 token 和控件状态样板；先兼容旧 API，避免全站尺寸同时变化 | 原有 UI 契约测试 + typecheck；共享层生产 build；代表页面视觉与焦点回归 | 恢复该批 theme/token/CSS/组件变更；新 token 留兼容默认值，不触碰项目数据 |
| C：漫剧试点 | 在实际 MakeWorkspace 集成总览/单镜头表现，减少重复集合；保留生成、引用、版本候选与持久化 | 真实任务与空态/失败态都可用；选择/草稿/快速切换/返回/生成防重/恢复查询通过 | 按项目现有配置机制或短期可移除视图开关切回旧布局；同一数据与动作，无双份数据迁移 |
| D：核心闭环 | 项目入口、素材库、任务与模型设置统一，按页面族小批迁移 | P1 页完整；跨页到设置再返回、项目筛选、保存/取消/重试链路通过 | 每个页面族独立恢复表现层，不连带回退已验证其他页面 |
| E：扩展与收尾 | P2/P3 页面族顺次完成；真实消费者清零后删除废弃 CSS/旧适配与临时开关 | 全路由矩阵、两套主题、生产构建、Electron QA 与残留检查完成 | 删除前保留恢复清单；回滚到最近已验收批次，禁止清空用户草稿或降级数据 |

每批交付需列出：修改范围、行为未变/新增的具体说明、代表截图、自动检查结果、手动步骤、已知缺陷、回滚范围。未通过不能宣称全局统一完成。按 1–2 个页面族推进，避免共享层与全部 feature 一次大改。

## 10. 验收矩阵与完成定义

### 自动检查（后续实施阶段执行，本次未执行）

- 保留并运行 [storydream-ui-system.test.ts](../../tests/storydream-ui-system.test.ts)、[shared-ui-polish.test.ts](../../tests/shared-ui-polish.test.ts)、[product-shell-ui.test.ts](../../tests/product-shell-ui.test.ts)、[editorial-shell-ui.test.ts](../../tests/editorial-shell-ui.test.ts) 与受影响页面测试。测试名已在仓库发现，具体断言需实施时阅读后补充，不能假设已覆盖新行为。
- 页面族优先关联 [task-operations-ui.test.ts](../../tests/task-operations-ui.test.ts)、[asset-library-ui.test.ts](../../tests/asset-library-ui.test.ts)、[new-task-workbench-ui.test.ts](../../tests/new-task-workbench-ui.test.ts) 及 motion-comic 的状态/恢复/引用测试。
- 执行项目既有 typecheck；共享组件、Provider、壳层修改执行 production build。依据实际 scripts 使用项目包装器，不擅自改工具链。
- 补可执行交互测试：稳定 ID 选中、输入法、草稿保存失败、请求乱序、对话框关闭/焦点回归、键盘排序、多路由共享组件。静态源码测试只作边界约束。

### 视觉与行为

| 维度 | 最小覆盖 | 通过条件 |
|---|---|---|
| 窗口 | 1440×900、1024×768；1920 宽屏；390 窄屏预览；系统缩放/200% 页面缩放代表场景 | 根页面无意外横溢；重要内容与操作可达；允许的局部表格/时间轴滚动有边界 |
| 主题 | 深色、浅色、系统高对比/减少动效代表检查 | 焦点、边界、状态可识别；不依赖特定截图背景才可读 |
| 内容 | 0/1/4/较多镜头，长标题/中文/长 URL，横竖比例，图片失败，长错误 | 无固定四格假设；无变形；必要信息可查看；不靠假数据填空间 |
| 状态 | 加载、空、只读、禁用、选中、展开、保存中、未保存、失败、取消、提交未知、过期结果 | 文本与操作匹配后端状态；未知不自动重发；失效结果不能显示为已就绪 |
| 路径 | 新建→编辑→切换→保存→重开；制作→设置→返回；生成→失败→恢复；候选选择→预览→导出 | ID/草稿/引用/筛选保持；一次操作不重复提交；门禁和恢复语义完整 |
| 性能 | 同一项目数据集的前后比较；多图与长列表 | 不增加页面抖动；图像有尺寸占位与按需加载；数据量超出常态再依据测量决定虚拟化 |

正式应用需做浏览器与 Electron 真实截图检查；不能仅凭 CSS 阅读、文件存在或离线 HTML 没报错通过。无固定真实性能基线前，不宣称已经达到某一帧率或交互时延。

完成定义：28 个路由都有页面族归属与验收记录；基础控件状态和主题映射一致；主要工作流可键盘操作；没有新增根级横溢、不可见按钮或草稿丢失；原型伪状态不进入产品；废弃样式在消费者清零与视觉回归后删除；回滚不会改变业务数据。

## 11. 推荐实施起点

先做 B 阶段的共享样板与主题差异核对，再做 C 阶段实际漫剧制作页试点。优先给已有 MotionComicMakeWorkspace 增加总览表现及统一控件状态，保持其 props、selectedShotId、生成锁和父页面更新回调。不要新建一套孤立 comic 编辑器来替代已有生产链，也不要为视觉讨论立即迁移 Arco。

本方案复用已载入的 storydream-ui 与 ui-ux-pro-max 指导，结合当前源码形成；不声称本次执行了未运行的设计检索、正式 UI 测试、生产构建或浏览器 QA。
