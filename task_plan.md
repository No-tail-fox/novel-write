# 当前优先任务：StoryDream Web / Electron UI 重构（2026-09-10）

## 2026-09-15 VOX 音画不同步与尾句截断

- [completed] 只读核对最新真实《撒日朗》项目：第 3／4 镜分别裁掉 282／414ms，第 1／2 镜多留 1084／433ms；各镜起点偏移 0ms，属于估算时长未校准导致的截尾。
- [completed] 新旁白按实测时长重排镜头、字幕及后续音轨；旧项目导出前按解码采样数重测并保存校准时间轴，保留本地／图生视频素材和手动裁剪。
- [completed] 真实 2.58 秒本地样片两段声音起点偏移 0ms、最后 250ms 相关度均 >0.999；历史隔离副本四段保留全长。122 项相关回归、独立采样测长测试和生产构建通过，最终兼容测试与既有类型问题记录见实施报告。
- 沿用用户选择：本地验收，不调用付费模型；保留工作区其他未提交改动，真实项目先只读检查。

## 2026-09-15 VOX 内容标题与多种叙事动作

- [completed] 分离内部节拍角色和每镜上屏标题；标题从镜头原文选取并可编辑，预览与导出统一，兼容旧项目。
- [completed] 将单一滑入扩展为五种叙事动作，按内容选择并支持逐镜修改，保留两条生成链路和既有素材。
- [completed] 核对短稿按句分镜、旧标题恢复、生成提示词、素材绑定和动作保存；最后两份核心测试 12 项、页面双链路 5 组、双主题双尺寸预览 12 组和最终生产构建通过。
- [completed] 真实渲染器输出五镜头 12.5 秒 1080p 本地样片，解码抽帧验证五种不同轨迹及内容标题。报告：docs/plans/2026-09-15-vox-story-titles-and-motion.md。扩展套件的 1 项旧源码断言与全局既有类型错误单独记录，不声称全仓检查通过。
- 本轮继续沿用用户选择：本地验证，不调用付费视频模型；不改写真实用户项目。

## 2026-09-14 VOX 双链路完整实现

- [completed] 保留并完善本地独立图层动画与图生视频两条链路；模型路线使用独立关键帧，切换镜头模式保留各自素材。
- [completed] 本地按背景/主体分别生成、自动透明抠图、逐层绑定，精确文字由代码渲染；旧单图镜头可补齐素材，失败重试只补缺失层。
- [completed] 图生视频明确元素动作和相机动作，完善素材引用与过期回包保护；关键帧完成不再标记视频已生成。
- [completed] 最终 19 文件 176 项聚焦测试、生产构建、双主题双尺寸截图、真实页面生成/补齐/切换/重开及 4 秒本地 MP4 验收通过。类型检查存在既有 browser-fallback/storage 接口与 main.ts ratio 类型错误，详见实施报告。
- 用户选择：新项目默认本地拼贴动画；本轮只完成两条链路和本地验收，不调用付费视频模型。实际验收未调用任何生成服务，未改写《撒日朗》项目。
- 授权：用户明确要求两条链路都保留并按成熟方案实现，无需再次确认实施方向。保留当前工作区其他任务的未提交改动。

## 2026-09-14 VOX 动画缺失调研

- [completed] 核对本地生成、素材绑定和逐帧导出链路；最新真实成片《撒日朗》4 镜头均只有背景图片，主体/标签无资产，历史无图生视频任务。
- [completed] 查阅 4 个相关 GitHub 仓库的 skill 与源码，核实图生视频、独立图层动画、降级行为及示例硬编码等限制。
- [completed] 保存带源码引用的调研结论和修复建议至 docs/plans/2026-09-14-vox-motion-skill-research.md；本轮完成调研诊断，未修改生成实现。
- 联网工具情况：gh 未安装、Firecrawl 未登录、CDP 未连接；已通过 GitHub 公开 API 和 raw 文件取得一手内容，无需用户配置。

## 2026-09-14 VOX AI 创作要求

- [completed] VOX 标题下增加可选的多行 AI 创作要求；创作/修改均读取，纳入草稿及过期响应保护。
- [completed] 59 项聚焦测试、25 项真实组件浏览器检查、生产构建通过；确认模型提示词包含用户方向、失败可重试、草稿可恢复。深浅主题及 1440/1040/390 截图复核通过，类型检查仍只有原有缺失接口。

## 2026-09-14 封面同步与火山音色列表

- [completed] 项目摘要接入已有自动/手动/HTML 封面，解析相对路径并随图片修订刷新；无需重新生成已有封面。
- [completed] 根据官方 SDK 取消加载全部音色时的合成资源筛选，保留字符串 Limit，补齐结构化错误、RequestId 和部分分页提示；未用真实 IAM 凭据在线验证。
- [completed] 9 文件 304 项回归与生产构建通过；隔离 Electron 4 张深浅主题/1440/1040 截图、自动刷新与重载验证通过，运行错误 0。类型检查仍为原有 browser-fallback/storage 接口缺失。
- 证据：项目卡片仅读 ordinaryCoverAsset/referenceImagePath；摘要 SQL 未选 ordinary_cover_asset_json；自动封面位于 pipeline/state.json 的 assets.cover。

## 2026-09-12 导演台生图概念方案

- [completed] 读取 Product Design、ui-ux-pro-max、既有主题与工作流规范；检查项目页及导演台截图。
- [in_progress] 用户已切换到 Image 2.5 通道并配置用户环境凭据；使用 `gpt-image-2.5` 生成三张独立概念图，统一视觉规范并探索三种布局。1440x1024 请求返回 HTTP 400，已改为该通道验证过的默认 3840x2160。
- [completed] 预览优先方案已由精简中文提示词生成，实际 3840x2160，本地未缩放；正在继续生成分镜和时间轴方案。
- [completed] 分镜总览方案已生成，实际 3840x2160，本地未缩放；视觉检查通过，中文个别字符仍需以代码实现为准。
- [blocked] 时间轴优先方案请求超时，工具已写入 `error.json` 并标记 billing status unknown；按 Image 2.5 规则不自动重试。当前已有两张可选概念图。
- 接口限制：前次带图 `/v1/images/edits` 请求返回 403/502。用户继续指定服务并要求生图后，已将提示词改为明确无附件的文字规范，使用本次提供的密钥请求 `/v1/images/generations`，返回 `503: No available compatible accounts`。需服务恢复可用生图账号后重试；当前没有图片产物。
- 按用户新指示切换到 `https://ai.input.im`，同一模型与用户当前密钥的文字生图请求仍返回相同 503；两个指定地址均未生成图片，不继续重复请求。
- [pending] 用户选择方案 1 或 2 后再改产品代码；本批不提前改业务状态和控件行为。若必须时间轴方案，需要服务侧确认账单/通道后再单独重试。
- 提示词：`docs/design/storydream-web-redesign/concepts-20260912/`；生图密钥仅从进程环境读取，不写入项目文件。

## 2026-09-12 共享页面视觉统一

- [completed] 按 ui-ux-pro-max 与项目 Fluent 规范统一字体、品牌选中态、导航与页头；保留所有旧路由。
- [completed] 优化项目筛选/集合与新建入口的对齐、密度和响应式布局；设置页改为分区表单。
- [completed] 6 类页面 x 双主题 x 三尺寸共 36 张浏览器截图，验证统一页头、侧栏尺寸、布局键盘切换、窄屏设置分类；9 文件 233 项测试、typecheck、build 通过。
- [completed] 生产 Electron 壳层 8 个捕获的对比度/焦点/重叠检查通过；500 项管理 15 组操作与 6 张截图通过，0 页面错误、0 生成调用。
- 证据：`.artifacts/storydream-web-redesign/shared-ui-20260912/` 与 `r2-project-home-20260912/`；有效设计规范已更新到 `docs/design-system/storydream/MASTER.md`。
- 边界：不生成虚构项目封面，不保存用户提供的服务密钥，不改变生成与交付业务逻辑。

## 2026-09-12 R1.1 关闭证据

- 实现：六入口导航、项目首页七状态详情、等待态对比度修复。
- 验证：`.artifacts/storydream-web-redesign/editorial-shell-p01-20260912/report.json` 为 8/8 捕获，4 个项目捕获七状态就绪，对比度/运行错误均为 0；定向测试 186/186、typecheck 通过。
- 下一步：执行 R2 项目流程后续页与导演台迁移；R3-R9 仍待完成。

## 2026-09-12 R2/P02 首轮

- [completed] 五类型制作入口、三步语义（制作类型 / 内容 / 制作设置）与“创建并开始生成”主动作落地；类型选择器支持桌面五列、紧凑两列和窄屏单列。
- [completed] 五类入口、390×844 无横向溢出、MV 无主歌曲门禁及 0 页面错误已由 `.artifacts/storydream-web-redesign/p02-new-task-20260912/report.json` 27/27 检查覆盖。
- [pending] R2.1 项目摘要分页/归档/500 项行为及真实 Electron 双尺寸创建重开仍待完成。

## 2026-09-12 R2.1 项目管理续推

- [completed] 搜索与中文组字不中断，删除弹窗可取消/重试，失效封面回退；路由级会话保留项目往返后的筛选/分页/布局，VOX/漫剧按来源返回项目。
- [completed] 500 项摘要分页、搜索/收藏/归档/恢复、删除失败与延迟查询回包的 Electron 行为回归。
- [completed] 桌面/紧凑/390px 网格与列表 6 张截图；11 文件 299 项定向回归、typecheck、生产 build 通过。
- [completed] 关闭并重启 Electron，已删除记录保持删除，保存的 VOX 项目可重开；最终 15 组操作、6 张截图、0 页面错误，报告见 `.artifacts/storydream-web-redesign/r2-project-home-20260912/report.json`。
- [pending] P02 各类型创建草稿隔离、失败恢复与完整生成交付继续在 R2.2/R4 收口；R3 编辑器框架仍待迁移。


- [completed] R0 首轮现状审计、项目首页/编辑器生图与架构边界；设计稿已可查看。
- [completed] R1 共享壳层、tokens、独立 Web 启动入口、六入口导航与 P01 项目首页七状态已完成并通过 shell QA。
- [pending] R2-R5 项目流程、导演台、各创作类型及管理页面迁移。
- [pending] R6-R9 本地服务抽离、本机 Web/剪映连接器、公网架构和整体回归。
- 详细任务与验收：`docs/plans/2026-09-10-web-ui-rebuild.md`。
- 逐页规格与实施顺序：`docs/plans/2026-09-10-page-reconstruction-spec.md`；覆盖 20 个旧视图、六入口、两类 shell、Web/Electron 能力矩阵和发布回退。
- 当前浏览器 fallback 是预览实现，完整 Web 运行能力尚未交付。
- 已有底层验收按用户要求暂停；历史记录保留如下。

# 任务计划：平顶山市数据标注先行先试申报答辩 PPT 大纲

## 目标
基于指定 PPT 模板与 Word 建设方案，整理一份 8 分钟、最多 25 页、信息密度足、与申报材料逐项对应的完整 PPT 大纲；确保基础条件、建设思路与目标、重点任务及拆解、保障措施、特色亮点均不漏项，并覆盖 4 个核心优势。

## 本轮扩展目标（2026-08-19）
递归检查 `H:\xwechat_files\wxid_8z59e591g3qj22_dc7f\msg\file\2026-08\新建文件夹\新建文件夹` 下全部文件，区分可直接补充、仅作证明、重复或不宜采用的材料，并把可靠补充事实、图表和图片建议加入现有 25 页大纲，不突破 25 页上限。

## 阶段
- [completed] 1. 读取技能规则、初始化文件化计划
- [completed] 2. 抽取并核对 Word 方案全文与结构
- [completed] 3. 抽取并核对 PPT 模板页数、标题、页型和硬性要求
- [completed] 4. 建立材料-页码覆盖矩阵并压缩到 25 页内
- [completed] 5. 编写最终中文 PPT 大纲、讲述节奏和缺项风险说明
- [completed] 6. 终检页数、每项至少 2 页、四大优势及材料字段覆盖
- [completed] 7. 盘点补充材料目录全部文件与格式
- [completed] 8. 逐份抽取正文、表格、图片和可引用事实
- [completed] 9. 建立补充材料价值分级与页码映射
- [completed] 10. 更新 25 页大纲、来源表和制作建议
- [completed] 11. 终检所有文件处置状态与新增事实一致性
- [completed] 12. 使用 ppt-master 对照渲染官方模板与内页参考课件
- [completed] 13. 提炼统一的“官方外框 + 高密度内页”视觉规则
- [completed] 14. 将逐页版式映射写入 25 页大纲并终检
- [completed] 15. 按 PPT Master Quick Generate 初始化项目并导入源材料
- [completed] 16. 手工编写 25 页原生 SVG 幻灯片
- [completed] 17. 通过 final SVG 质量门并导出可编辑 PPTX
- [completed] 18. 使用 PowerPoint 渲染 25 页并完成视觉、文本和包结构验收
- [completed] 19. 读取并解析用户提供的 v4 亮点扩展版大纲
- [completed] 20. 备份当前成品并按 v4 重新编排 P01-P25
- [completed] 21. 按 v4 内容重写页面并保持既有样式、图片和密度
- [completed] 22. 重新通过 SVG 质量门、导出 PPTX 和 PowerPoint 视觉验收
- [completed] 23. 完整抽取 DB 新汇报稿 38 段内容与五章结构
- [completed] 24. 建立 DB 新稿 20 页映射并新建独立 PPT Master 项目
- [completed] 25. 按 DB 新稿手工编写 20 页 SVG，保留既有视觉体系并强化图片
- [completed] 26. 通过 SVG 质量门、导出 DB 新纲版 PPTX 并完成 PowerPoint 渲染验收
- [completed] 27. 初始化原生 PPTX 增强项目并确认仅启用演讲者备注
- [completed] 28. 为 20 页逐页撰写约 300 字忠实解说
- [completed] 29. 校验备注覆盖与长度并应用到新 PPTX
- [completed] 30. 对比可见页指纹、备注回读和 PowerPoint 渲染结果
- [completed] 31. 对比 DB-v1 与 DB 旧稿，诊断新增亮点缺失原因
- [completed] 32. 输出新增亮点原文、当前覆盖状态与建议页码
- [completed] 33. 将四个正式亮点拆为 P19-P22 独立页面
- [completed] 34. 顺延结语至 P23 并更新全部页码
- [completed] 35. 生成 23 页 PPTX 并补齐 23 页约 300 字备注
- [completed] 36. 通过 SVG、PPTX、备注与 PowerPoint 渲染验收

## 约束
- 演讲时长最多 8 分钟；正文页最多 25 页。
- 用户要求每一项至少 2 页；“特色亮点”可多页，4 个优势必须全部出现。
- PPT 只看幻灯片、不看文字材料，因此大纲必须承载材料中的对照信息。
- 原始附件只读，不修改；中文文件按 UTF-8 读取和复核。

## 错误记录
| 错误 | 尝试 | 处理 |
|---|---:|---|
| PowerShell 管道空元素 | 1 | 改为先收集对象再格式化 |

---

# 当前任务：StoryDream VOX P0-3 前端贯通（2026-09-05）

## 目标
在不修改 Electron 后端与 sidecar 的前提下，贯通 VOX 的 `renderStrategy`、`videoJobId`、视频资产、时间轴 clip 和权威 `playbackMs` 预览；UI 仅开放本地图层与 AI 动态海报两种策略，明确阻断 `hybrid`。

## 阶段
- [completed] 1. 审计领域模型、时间轴、页面状态所有权和现有测试
- [completed] 2. 扩展 editorial-collage 领域契约与纯函数测试
- [completed] 3. 改造 DirectorDeskWorkspace 权威时间预览和最小视频回调接口
- [completed] 4. 接通 EditorialCollagePage 策略、视频资产与 timeline 更新
- [completed] 5. 补齐 Fluent/Lucide/token 样式与 compact 行为
- [completed] 6. 运行聚焦测试、typecheck、生产构建和 Electron 双视口 QA

## 约束
- 不修改 `electron/**` 和 sidecar。
- 保留工作树已有变更，不覆盖并行修改。
- UI 只暴露 `deterministic-layers` 与 `living-poster`；`hybrid` 必须阻断。
- 时间轴 clip 是预览素材与策略的权威来源，预览时间只由 `playbackMs` 驱动。

## 错误记录
| 错误 | 尝试 | 处理 |
|---|---:|---|
| 暂无 | 0 | - |

## StoryDream 持续改造 checkpoint（2026-09-07）

- [completed] R06 首轮请求去重与 Provider Job 权威状态；失败重试、跨项目/分集清理已完成
- [completed] U01 首轮空项目真实性修复；移除导演台默认素材、伪造队列和示例缩略图
- [completed] 聚焦测试 41/41、typecheck、production build、生产 Electron 导演台 QA
- [in_progress] R06 浏览器重复点击/失败重试与重启恢复补充验收
- [pending] R07 跨页面/重启可恢复批次执行层
- [pending] R08 队列事件统一与工作流进度隔离
- [completed] R07 首轮批次写回竞态修复与持久化回归
- [completed] R07 生产 Electron 重启/切页/暂停/取消验收与远端状态核对交互
- [completed] R08 首轮事件隔离与导演任务进度语义修复
- [completed] R07/R08 生产 Electron 跨页、重启、远端核对续跑和队列事件乱序验收
- [completed] R11 音乐 MV 主歌曲创建门禁
- [completed] R09 人物素材删除/引用保护与 R07/R08 生产验收
- [completed] R09 人物素材删除/引用保护与回收恢复
- [in_progress] U02-U04 前端密度、素材可达性与术语/状态语义收敛
  - [completed] U03 素材架保留紧凑九张预览并支持搜索/分类结果“显示全部素材”，补充可访问性与布局契约测试。
  - [in_progress] U02 将导演台检查器服务、音色与状态文本提升到可读层级，并为长 provider 名称增加省略与 title 提示。
- [in_progress] U04 统一图片/视频/旁白服务及音色提示；未配置时下拉项明确说明配置动作，继续检查其他工作台术语。

## 2026-09-07 U04/U08 与回归 checkpoint

- U04/U08 bounded slice：移除导演台硬编码名人音色伪单选；统一图片生成服务/视频生成服务/旁白服务语义；阻断未连接或能力不支持的图片服务切换；未连接旁白时不写入默认音色；MV 预览枚举改为中文。
- 新增共享状态解析 `src/shared/director-system-status.ts` 及专项测试，区分图片服务、视频服务、旁白服务、参考图能力和一致性基准状态。
- 生产 Electron：导演台 QA `status=passed`，覆盖 1440×1024、1536×1024、1040×720；漫剧 QA `status=passed`，覆盖桌面/紧凑视口、参考图托管、保存重开和缺失文件提示。
- 回归：全量 178 个测试文件、2191/2191 通过；`npm run build`、`npx tsc --noEmit`、`git diff --check` 通过。测试临时目录使用 I 盘，因为 C 盘可用空间为 0。

## 2026-09-07 验证 checkpoint

- 全量回归：`npm test -- --runInBand`，176 个测试文件、2185/2185 通过。
- 生产检查：`npm run typecheck`、`npm run build`、`git diff --check` 通过。
- R07 生产 Electron 证据：`.artifacts/director-r07-batch-qa/report.json`，覆盖批次状态转换、项目/分集隔离、重启恢复、远端核对后只续跑未完成节点。
- html-video Windows teardown 竞态通过扩大临时目录清理重试窗口修复，专项 146/146 通过。

- VOX P0-3 阶段证据：editorial-collage 领域/渲染/工作台聚焦测试已纳入全量回归；生产 Electron QA 已覆盖 VOX 关键帧、AI 动态海报、Provider 切换、失败重试、视频播放/seek、字幕编辑和重载持久化。

- [completed] F03 15/30/60 秒起步时长、时间线/字幕联动、生产 Electron 时长选项验收
- [in_progress] F02 六类硬质量门、审片报告 UI、生产失败阻断和局部重检范围已接入；待扩展响度/削顶、黑帧区间、字形安全区与连续性分析

- [completed] F03 结构编辑契约与 VOX 增删/排序/拆分/合并 UI 已接入；生产保存、重载与重开验收通过
- [in_progress] F04 VOX 风格候选选择、样片生成、provider job/资产/成本追踪和重开验收已接入；待补真实 provider 费用回传与样片级局部重检证据
- [completed] F05 VOX 图层与运镜编辑器：图层排序/显隐/位置/尺度/旋转/透明度、相机与图层关键帧增删改、首尾定位和局部/整镜预览已接入；保存重开、预览/导出 seek 对照、真实 MP4 烟测及生产 Electron 全流程 QA 通过（2026-09-08 13:27）；无运行错误或付费调用。

## 2026-09-08 结构保存修复 checkpoint

- [completed] 修复结构编辑提前改写保存版本号，以及拆分镜头错误保留原镜头生成任务引用；真实数据库生成素材夹具回归通过，原任务/资产历史保留。
- [completed] 修正生产 QA 的 Promise 等待假阳性；保存检查改为等待实际 IPC 查询结果，再验证保存状态及重开。
- [completed] 删除 QA 强制隐藏 Fluent 遮罩的 DOM 干预；正常 Escape、弹窗关闭和后续点击的完整复跑通过。聚焦 84/84、typecheck、build 均通过。
- [completed] F03 本轮：首段扩展保存、镜头连续编号、结构非法结果即时反馈；拆分保留原运动片段、合并硬切与字幕偏移、移动字幕同步词级时间和指纹。55 项聚焦回归及生产 UI 保存重开通过。
- [completed] F03 多轨音频结构编辑归属/裁剪：镜头移动同步起点，拆分/合并保留源文件位置、旁白、静音与淡入淡出，旧成片退出当前版本；152 项专项回归通过。
- [in_progress] F03 后续：节拍操作已接入；跨节拍完整时序补验发现并修复双向偏移问题，长文实际可读性和输入上限仍待验收。
- [completed] U02 本轮：长错误信息限宽且可打开完整详情；1536x1024、1040x720 稳定截图与弹窗关闭后的操作通过，顶部导航完整。最终生产 QA 2026-09-08 13:49 passed。

## 2026-09-08 F03 音频结构与实际成片 checkpoint

- [completed] 旧版旁白显式保留、无时长音效固定原区间、连续拆分的源裁剪/包络继承、静音尾段与资产历史保留。
- [completed] 预览使用共享包络增益；FFmpeg 延续原淡化并严格裁剪硬切音频，单帧源在逐镜头编码前补足画面，避免短场景丢失。
- [completed] 漫剧 director:render IPC 接受可选 episodeId；渲染错误解码为可读消息，保留严格参数校验。
- [completed] 16 个文件 152/152 回归，typecheck、生产 build；含真实 PCM 逐采样比较、实际 MP4 切点音量及短镜头黑场/彩色画面检测。
- [completed] 最终生产声音 QA：VOX/漫剧本地音频编辑导出，VOX 结构操作、预览、双尺寸、保存重开；2026-09-08 14:21 passed，runtimeErrors=0、paidGenerationCalls=0。
- [completed] 节拍增删、相邻节拍重排、跨节拍镜头移动已接入；跨节拍移动保留字幕 cue/token 相对镜头偏移、音频片段起点和 shot ownership，最后一个节拍/镜头边界有阻断。
- [completed] 长文源稿以文档级 `sourceText` 持久化；起步字幕按最多 18 字分 cue，回归确认 240 段中文原文、字幕 cue 文本和重开解析均无丢失。
- [completed] 结构 UI 将镜头与节拍操作分组，显示当前节拍序号，删除节拍需要确认；节拍标题用于场景显示，重排后不再显示过时的固定“开场/背景/证据”标签。
- [completed] 聚焦回归 3 文件 24/24，`npm run typecheck`、`npm run build`、UI 契约测试 21/21 通过；生产 Electron `.artifacts/director-desk-qa/report.json` 于 2026-09-08 15:12 通过，包含节拍新增/重排/删除确认/保存重开，`runtimeErrors=[]`、`paidGenerationCalls=0`。

## 2026-09-08 F02/F03 续推核验

- [completed] F03 双向跨节拍：按操作前镜头顺序重排源/目标已有字幕；回归覆盖所有镜头 cue/token、音频源偏移、无 shotId 的旧字幕和源文档不可变。
- [completed] F02 媒体分析显式状态、缺值/非法值不可通过、异常/超时报告、无黑帧空数组；指标通过渲染结果保存至 VOX/漫剧报告和导出 manifest。
- [completed] F02 审片区分警告与阻断，展示平均电平/峰值/黑帧证据；报告滚动归检查器所有，复检按钮保持可达。
- [completed] 新生产 Electron 媒体质量 QA：本地正常/低电平实际 MP4、warning 放行、blocking 拒绝、保存重开与双尺寸截图；19:56:50 passed。
- [pending] F02 后续：字形安全区、连续性分析、可执行局部重检；平均电平仅为 dBFS 测量，不能替代 LUFS/true-peak 验收。

## 2026-09-09 F02 续推纠偏与验收

- [completed] 加入主进程退出码、窗口关闭和 renderer 崩溃诊断；ownership attempt-7/8 完成重复渲染、跨集及重启。
- [pending] 旧 attempt-4/5 关闭原因仍未确定，后续渲染专项保留诊断，不因两次复跑通过便宣称修复。
- [completed] 复检导航补齐字幕/素材到镜头归属、全局时钟、暂停播放和过滤可见性；人工确认覆盖整份报告并等待持久化。
- [completed] 生产双尺寸真实点击、确认保存失败重试、当前确认与过期确认重启、旧报告推导验证；修复紧凑窗口抽屉盖住顶部返回按钮。
- [in_progress] 实际输出画布上测量字幕边界、行数、安全区与标题重叠，证据写入两工作流和 manifest；随后局部复检执行与帧级连续性。
- 纠正旧记录：ownership attempt-4 在漫剧首次渲染中断，attempt-5 在第二集渲染中断，尚无共同根因证据。confirmation attempt-2 仅证明确认后截图及过期记录重启保留，未断言确认按钮命中或横向溢出。
- 诊断 attempt-6 启动失败为新增 QA 的 NODE_OPTIONS 提前加载 Electron app 导致；改用项目已有的独立 QA 主入口模式，不改产品启动逻辑。
- 最终验收：59/59 聚焦测试、类型检查和生产构建通过；confirmation attempt-8（16:27:25）、ownership attempt-8（16:27:27）均 passed。前者 18 张截图，后者 40 张截图，代表性双尺寸画面已复审。两者 runtimeErrors=0、生成任务核对为零付费调用，生命周期网络拦截记录为 0。

## 2026-09-09 F02 局部重检定位增量

- [completed] 新增 `resolveProductionQualityRecheckScope` 纯函数：去重并过滤已不存在的镜头，按字幕/音频/媒体/项目范围解析检查器页签、首个镜头和时间轴定位点。
- [completed] 审片检查卡新增“定位复检范围”：镜头/资产定位到受影响镜头，字幕范围切换字幕检查器并聚焦字幕句，音频范围切换声音检查器，媒体范围保留在审片证据，项目范围明确要求重新生成整片。
- [completed] 字幕检查器支持外部聚焦 cue；缺失镜头或项目级范围只显示明确提示，不冒充已执行局部媒体重检。
- [completed] 聚焦回归 `production-quality-recheck`、质量归属和导演台契约测试 26/26，`npx tsc --noEmit`、`npm run build` 通过。
- [pending] 尚无局部媒体探针/局部渲染 IPC；后续若实现，必须以真实执行记录和当前 fingerprint 回写报告，不能仅凭 UI 定位标记通过。
- [completed] 人工复核确认记录：仅当前 fingerprint、当前分集且无阻断项的报告可确认；报告保存 `reportId`、`renderFingerprint`、scope 与确认时间，过期/未核对/阻断报告均拒绝。
- [completed] 初轮人工确认验收：VOX/漫剧覆盖确认成功、编辑后失效、保存重开和过期记录完整重启；双尺寸仅采集截图，按钮命中与溢出断言尚需补验。
- [completed] 修复复检定位的字幕 cue 接线，报告定位后字幕检查器实际聚焦指定句，并通过工作区契约回归。
- [pending] 跨分集归属脚本 attempt-4 在漫剧首次渲染、attempt-5 在第二集渲染关闭 Electron 页面；带窗口/进程诊断的 attempt-7 全流程通过，未复现异常，根因仍未确定。
- [in_progress] F02 音频证据增量：sidecar 已测量并持久化 LUFS/true-peak，审片 UI 已显示；阈值解释、静音素材处理、质量门和局部重检仍待完成。
- [completed] F03 新增节拍保持空旁白/空 cue，避免占位句混入作者正文；明确传入旁白仍保留。
- [pending] F03 后续：长文最大输入、实际字幕阅读速度、保存重开 UI。已复现 8000 字创建超出单镜头 100 cue，4000 字/60 秒虽合法但达到 66.7 字/秒；需要处理原稿与目标时长的冲突，不能通过截断原文解决。

本轮最终验证 11 文件 112/112、typecheck、production build、git diff --check。质量专项 `.artifacts/director-quality-qa/report.json` 19:56:50 passed，导演台完整 `.artifacts/director-desk-qa/report.json` 19:58:24 passed；两份均无运行错误、无付费调用。整体验收继续以 `docs/plans/2026-09-06-storydream-current-audit-and-backlog.md` 为范围，以上不代表总计划完成。

## 2026-09-08 F03 全文时长工作流

- [completed] 全文按阅读估计分配时长，固定 15/30/60 秒不足时提前拒绝；原稿精确保留、Unicode 分段、单镜头 15 秒及持久化容量约束。
- [completed] 创建页显示实际时长、节拍和镜头数；剧本入口查看只读原稿；AI 文案字数与固定时长匹配；全文模式草稿恢复兼容原数值时长。
- [completed] 长文 4000/8000/12000 字、18,000 字多节拍角色归属、极短/不均匀内容、容量边界和 SQLite 保存重开回归；17 文件 153/153、typecheck、build 通过。
- [completed] 生产 Electron 全文创建、错误状态、双尺寸布局、最后镜头和保存重开验收；最终构建 20:40:52 passed，11,990 字符、224 镜头、668 cue、46 分 20 秒，无运行错误/付费调用。
- [completed] 长列表选中镜头和胶片自动定位，未生成胶片使用真实空态；新建各镜头保持完整默认运镜。
- [completed] 复跑原导演台完整工作流，20:39:43 passed；短片、生成素材、结构编辑及保存重开无回归，无运行错误/付费调用。
- [pending] 高容量项目完整生成/导出与资源占用实测；资产/providerJobs 各 500 条上限需纳入后续生成预算和历史保留策略。F02 字形安全区、连续性、LUFS/true-peak 和局部重检仍未完成。

## 2026-09-08 长项目生成与导出

- 上一目标轮分类：progress。权威证据为已修改源码、153 项通过测试、生产长文与完整导演台验收；总目标仍未完成。
- [completed] 区分 500 镜头与最多 1501 个生成节点，创建/更新批次及依赖数组使用领域容量；601/1501 节点真实 SQLite 与生产 Electron 重启恢复通过，保留全部依赖和已完成项。
- [completed] 批次写入先于服务调用，写入失败停止新派发并等待在途调用；取消正确落盘，启动保存门禁、暂停/恢复、父页面刷新与无执行器恢复/取消已验收。
- [completed] 增加长项目多轮素材版本持久化容量与前置反馈；素材/生成任务/审片各 20000 条、累计 attempt、音轨和参考图版本容量统一，页内并发预留与批次 cue 数预算已接入。
- [completed] 历史 UI 分页与容量预检：生成记录/版本/批次每页 20 条，素材每页 36 项；双工作流生产本地桩跨过旧 500 限制、两句漫剧配音预检、满额零生成调用、20000 条重启、分页搜索和双尺寸截图通过。
- [pending] 较长时间线实际本地导出、镜头切点/声音/资源清理验收；逐镜头编码以限制临时帧峰值仍需研究。

### 2026-09-08 批次可靠性验证

- 8 文件 124/124、typecheck、production build 通过；1501 节点全模拟执行时未落盘状态转换不超过并发数 4，依赖等待 completed 持久化。
- `.artifacts/director-batch-faults-qa/report.json` 21:10:07 passed。专门测试入口先注入再加载真实生产 main；确实触发 1 次保存异常，生成 IPC 0 次、网络调用 0 次。
- UI：保存失败显示暂停，未派发节点不转圈；父页面编辑不覆盖恢复状态；同一主进程中重进页面必须核对，取消只影响未开始节点、不假装终止未知远端请求。双尺寸截图已复审。
- 601/1501 节点的生产 IPC 创建、更新、应用重启均通过；各保留已完成 300 项与 600/1500 条最终依赖。
- 原导演台完整生产 QA 21:11:59 passed，runtimeErrors=[]、paidGenerationCalls=0；总目标保持 active。本轮仍不代表 500 镜头实际素材生成、资产历史扩容或长片导出已经完成。

### 2026-09-08 历史容量最终验证

- 16 文件 92/92、typecheck、production build、diff check 通过；含第 101 次图片生成、每工作流 4500 素材/4500 任务/500 音频片段的 SQLite 重启测试。
- 原导演台完整流程 21:56:22 passed；历史专项 `.artifacts/director-history-qa/report.json` 21:58:05 passed，VOX/漫剧均保留 20000 素材和任务，4 次图片与 3 次配音均为本地响应；无运行错误或付费调用。
- 8 个历史/容量双尺寸组合通过；列表 DOM 受分页约束，搜索末页素材可达，旁白面板固定 162px，容量弹窗完整落在视口内。
- 最终批次故障专项 21:59:45 passed：真实保存异常后生成调用为 0，取消/重新进入页面/601 与 1501 节点重启恢复通过，双尺寸无溢出。
- 当前只完成历史容量与相应 UI，不代表 500 镜头完整生成、长片资源占用或总计划完成。后续依次推进大批次实际本地生成、逐镜头编码释放临时帧、长片输出与资源实测，再回到 F02/U02 未完成项。

### 2026-09-08 长片临时帧续推

- 上一目标轮分类：progress；全文时长选择已实现，用户再次确认相同选择，无需重复改动创建逻辑。
- [completed] 提取 sidecar 单镜头编码能力，Electron 每镜头编码成功后立即释放图片帧；临时片段和混音使用本次渲染独占目录，并在成功/失败/取消后清理。
- [completed] 回归旧帧输入合成、多轨音频与声明时长；覆盖逐镜释放、编码失败、取消和合成失败。真实新旧硬切/转场成片逐字节一致，实际取消 sidecar 进程已退出。
- [completed] 本轮实际 Electron 输出与磁盘峰值测量：最终 22:31:27 passed，12 镜头/3 分钟/4320 帧、全镜声音区间复验通过。最终合成仍同时打开各片段，不把图片帧释放等同于全部资源恒定。
- [completed] 核对用户选择后补齐新建页默认值：从 30 秒改为全文，已有草稿恢复原选择；25 项聚焦、typecheck/build 通过，生产双尺寸长文 QA 22:31:59 passed，defaultFullText=true，11,990 字/224 镜头/668 cue/草稿恢复/保存重开通过。
- 大批次逐镜头生成、完整长片和 F02/U02 余项继续保留在总计划中。

### 2026-09-08 大批次实际生成续推

- 上一目标轮分类：progress；完成逐镜头编码、有限规模资源实测、GSAP seek/转场目标修复与全文默认值，权威源码和生产报告均已更新。
- [completed] 从空素材的 500 镜头项目执行实际生产图片/旁白 IPC（本地响应），1000 节点/文件、任务归属、时间线图片/音频引用通过，耗时 423.11 秒。
- [completed] 重复生成后选择历史/最新版本、跨项目和重启恢复；本地响应只验证管线，不证明真实服务品质与费用。
- [completed] 实测版本恢复失败：重复生成后保留 1002 素材/任务，但切回旧图未同步 selected。修复两个工作流的引用与选中状态同步，复用已生成 profile 的 UI/保存/重启验收通过。
- [completed] 22:57:14 恢复专项 passed：VOX 500 镜头/1002 文件及素材/1002 任务、1000 选中版本；漫剧两集各两次图片和两句配音，共 8 个实际本地请求；分集/项目切换和生产应用重启数据一致。6 张双尺寸截图复审，无运行错误或外部请求。
- [completed] 最终构建原导演台完整流程 23:00:05 passed，24 张状态截图、runtimeErrors=[]、paidGenerationCalls=0；8 文件 67/67、typecheck、build、diff check 通过。
- [pending] 后续继续较长高分辨率输出、最终拼接资源和完整磁盘预算，再推进 F02/U02 余项。总目标保持 active，本轮属于 progress。

### 2026-09-08 长片磁盘预算续推

- 上一目标轮分类：progress；500 镜头本地生成、版本恢复修复和跨项目/分集重启证据已落盘。
- [completed] 按单镜 JPEG、单镜混音、全部编码片段、源片/时长修正/BGM/最终副本统一空间估计；HTML 保留帧数门禁，导演台在复制素材前检查并计入所有暂存素材副本。157 项预算/预检回归通过；两工作流生产低空间阻断/旧片保留通过。
- [completed] 主进程成片登记改为 64KiB 分块 SHA-256，并校验大小/文件身份；真实 MP4/manifest 哈希一致。修复错误详情双诊断号；最终磁盘专项 23:26:27 passed，4 张双尺寸截图，无运行错误和外部请求。
- [completed] 本轮 60 镜头/十分钟/1080p 实际输出与抽帧、全镜静音起点及音量验收：原捕获已完成，最新代码复用全部片段拼接通过；原整链 40 分钟超时保留为失败证据。
- [completed] Windows 500 输入命令启动修复，实际小片段合成通过；滤镜文件成功/失败/超时/写入错误清理回归通过。
- [completed] 10 短镜头连续转场旧缺陷已复现并修复，输入音频分块和 AAC 填充裁剪保持实际声音总长、各镜音量；3 项真实 Python/MP4 回归通过。
- [completed] 最终 200 项回归、类型检查、生产构建、导演台实际输出 smoke、故障取消/清理和最新 60 段合成复验。23:52:13 合成 passed，600 秒、8 个抽帧、60 镜声音检查、零滤镜文件残留；画面已复审。
- [pending] 多输入拼接的更低内存策略、更高容量完整输出、较深阶段取消和最新整链资源复跑。最新 60 段 FFmpeg 峰值 3.89GB，仍不支持宣称 500 镜头 1080p 已验收；随后继续 F02/U02 余项，总目标 active。

### 2026-09-09 F02 报告归属续推

- 上一目标轮分类：progress；音频阈值、静音测量与结构连续性已获得专项回归和生产验收证据。
- [completed] 新报告绑定任务/分集/输入指纹；旧报告仅按精确任务 ID 恢复归属，不按时间或当前活动分集猜测。
- [completed] 审片区分当前、过期、版本待核对和当前分集无报告；按请求顺序抵御旧请求晚完成，并保留历史数据。
- [completed] 镜头/字幕编辑、跨分集、并发乱序、旧报告兼容与真实 SQLite/生产应用重启验收。7 文件 77/77、typecheck、build、diff check 通过；`.artifacts/director-quality-ownership-qa/report.json` 14:52:31 passed。
- [completed] 版本绑定人工确认已完成；局部字幕复检已接入执行链路。真实字体安全区、视觉连续性及其他计划项继续保留。

### 2026-09-09 F02 音频与连续性续推

- 上一目标轮分类：progress；新增质量门源码和 16 项测试，但静音意图、漫剧分集时间线及可选音频时长边界仍需修正，不能以局部测试通过作为验收完成。
- [completed] 建立产品响度建议范围（-20 至 -14 LUFS、真峰值 <= -1 dBTP），超出以 warning 复核；明确全静音测量，缺指标不通过，区分显式静音/背景音与意外静音。
- [completed] 按实际渲染分集检查时间线切点、片段归属/重复/总长、音轨源裁剪及输出比例；复用现有音轨校验，保留合法省略时长。
- [completed] 新增边界回归、生产构建和双工作流实际输出、审片/保存重开与双视口验收。3 文件 62/62、7 文件 62/62、typecheck/build/diff check 通过；生产报告 `.artifacts/director-quality-policy-qa/attempt-3/report.json` 于 14:02:42 passed，24 个状态/尺寸组合、48 张截图，无运行错误或付费调用。
- [pending] 先修报告分集与输入版本归属：当前检查器仍取全项目最新报告，需要区分当前/过期/其他分集，再承接局部重检与人工确认。
- [completed] 绑定版本的人工确认与可执行局部字幕复检已落地；局部复检只更新受影响排版证据，不改变整片成片通过结论。真实字体安全区及帧级连续性仍待后续推进；字幕安全区几何证据不能代表真实字形检测。

### 2026-09-09 硬切分组合成续推

- 上一目标轮分类：progress；磁盘预算、分块哈希、拼接命令修复、转场音轨修复及限定规模实际成片证据已落盘。
- [completed] 超过 8 镜头的硬切按组编码画面，浮点 PCM 暂存声音，最终顺序读取分组并仅编码一次 AAC；实际分组音频纳入磁盘估计，转场仍单独保留后续资源任务。
- [completed] 17 镜头非整帧时长与原单图对照：跨两个分组边界后帧数相同、PCM 长度一致且逐采样差不超过 2；输入最多 8 个。初轮 ffconcat 清单写成转义换行导致拒绝，修正真实换行后 4 项专项通过。
- [completed] 60 段十分钟 1080p 峰值复测、17 镜头完整捕获/输出、第二组实际编码中途取消、回归和生产构建；最新分组输出 600 秒，FFmpeg 峰值约 1.35GB。
- [pending] 继续验证转场模式的分段内存策略、500 镜头 1080p、低帧率自定义输出以及编码中更深层的取消语义；返回 F02/U02 余项。

### 2026-09-09 F02 实际字幕排版 checkpoint

- [completed] 实际隐藏输出窗口在字体/图片就绪后测量每句字幕的文本与元素边界、真实行数、5% 安全区及标题重叠；隐藏 cue 测量后恢复原状态，证据包含镜头、cue 和全片时间。
- [completed] 标题/字幕共用稳定网格，保留作者空行、长词折行；新布局更新 director-v3 指纹。测量记录进入 VOX/漫剧严格 schema、数据库、审片检查器与导出 manifest。
- [completed] Windows DPI 坐标映射修正：记录 CSS 视口，所有边界映射至最终画布；缺失、失败、对象/时钟/尺寸不匹配均不判通过。字形覆盖继续单列待人工复核。
- [completed] 生产 attempt-3（16:49:00）完成两工作流横竖屏正常/极长字幕共 8 次真实输出、一次测量故障和四项目重启；36 张界面截图及 16 张成片抽帧，代表性画面复审，无运行错误/生成服务调用。
- [completed] 新增渲染器字体/图片两种就绪顺序、等待测量、失败、取消、超时和资源释放测试。聚焦 6 文件 122/122 后再增强就绪顺序，html-video 76/76；类型检查通过。
- [completed] 两工作流横竖屏的真实同时字幕碰撞补验，attempt-4-overlap（16:55:31）passed；4 次碰撞输出、一次测量失败、四项目重启，碰撞的两句均写入报告和定位范围。20 张界面截图/8 张抽帧，代表性横竖屏碰撞画面已复审。
- [completed] 预览基础一致性问题已修复并获横竖屏实际对照：项目画幅、镜头/节拍标题、字幕样式和安全区已对齐；长标题、空字幕及纪录片版式的边界补验见下方记录。
- [completed] 可执行局部字幕复检与版本校验已接入；逐字字形覆盖/人工证据、帧级连续性、创建页及真实封面、转场分组和 500 镜头 1080p 验收继续保留。总计划仍在进行。

### 2026-09-09 编辑预览一致性验收

- [completed] 编辑画布按项目比例显示，支持 16:9、9:16、1:1、4:3；竖屏按窗口可用高度收缩，播放条放在画面外并保留完整中央工作区宽度。
- [completed] 预览使用镜头/节拍标题和输出字体，按实际输出尺寸换算字号、间距、描边、阴影与漫画边框；标题改为成片白色，加入相同画面遮罩和镜头标记，安全区统一 5%。移除紧凑窗口的固定标题字号。
- [completed] 全部字幕保留网格占位，按时间控制可见性；保留空行与长词换行，同时字幕按成片相同规则显示，换句不移动标题。
- [completed] geometry-attempt-2 于 17:57:01 passed：两工作流横竖屏 8 次实际输出、32 组预览/成片几何比较，另一次测量故障与四项目重启；无运行错误或生成调用。归一化边界容差 0.8%，不是逐像素等同结论。
- [completed] desk-attempt-3 于 17:58:00 passed：四画幅双尺寸、关键帧/视频播放、状态/重试、真实报告归属、导出原生播放器与保存重开；34 组工作台截图，零付费调用。41 项聚焦、npm run typecheck、生产 build、diff check 通过。
- [pending] 预览专项继续补长标题、空字幕、纪录片版式的边界样例；随后按总计划推进可执行局部复检、字形证据、视觉连续性、创建页/真实封面和长片资源验收。总体仍进行中。

### 2026-09-09 F02 切点实际帧续推

- [completed] 修正未验收的首版探针：按输出帧号批量解码，保存实际帧时间，覆盖最多 499 个切点；缺失证据不通过，暗场/亮度突变仅提示复核。
- [completed] 两工作流证据持久化、切点异常范围与审片显示，真实黑闪/白闪/硬切/非整帧切点和 499 切点测试；12 文件 136/136 通过。
- [completed] 类型检查与生产构建通过；最终 Electron `director-visual-cuts-20260909-212907` 验证双工作流/双尺寸/当前与过期重启、实际字幕复检和渲染失败清理。修正临时目录过长导致的 Windows ENAMETOOLONG；无运行错误或生成服务调用。
- [pending] 视觉局部探针执行与逐帧/人物语义连续性仍为后续范围，本轮切点采样不能替代整片检查。

### 2026-09-10 F02 运动边界与局部复检续核

- [completed] 续核现有帧探针、局部复检、审片 UI 与历史验收；确认已有真实局部执行，但证据映射只移动时间、不移动帧号，且可能误纳不相邻镜头的临时切点。
- [completed] 增加相邻采样帧逐像素亮度差、准确异常区间；修复全局帧号映射、非相邻切点过滤及未采样证据保留，旧证据不冒充已测帧差。
- [completed] 真实 FFmpeg 正负向、非零起点局部复检、双工作流双尺寸 Electron 验收及回归。
- [completed] 隐藏输出窗口按实际时间线 seek 采样每个字幕开始/结束边界，保存实际可见 cue 并加入字幕切换质量门；生产双工作流回归通过。
- [completed] 统一 AI 漫剧未显式保存版式的预览/导出默认值，并将普通/纪录片标题字号比例统一；长标题双工作流横竖画幅几何容差收紧至 0.8% 实测通过。
- [pending] 后续补字幕切换异常负向截图、更极端混排长标题样例、U02/U05/U01 页面与长片资源；人物/场景语义连续性仍需人工复核。

### U05 创建页操作可达性续推

- [completed] 普通新建任务 sticky footer 与紧凑窗口等宽动作按钮。
- [completed] HTML 动画视频 sticky 提交栏与窄窗口全宽提交按钮。
- [completed] 音乐 MV 长表单表头生成操作保持可见，窄窗口纵向排列。
- [completed] 音频导入命名回调契约恢复，容量预留行为保持。
- [completed] HTML 动画创建页真实 Electron 双尺寸滚动截图与 sticky footer 运行检查，证据在 `.artifacts/html-video-create-sticky-qa/`。
- [completed] NewTask/MusicMv 创建页真实 Electron 双尺寸滚动截图与 sticky 动作栏检查，证据在 `E:/StoryDream-QA/workspace-unsaved/report.json`。
- [pending] 继续 F02 字幕切换负向、极端混排长标题和长片资源专项。

### F02 字幕可见性负向专项

- [completed] QA 隔离窗口的一次性错误 active cue 注入与清理。
- [completed] VOX/AI 漫剧横竖画幅真实成片、审片 pending 徽章、定位范围、双尺寸截图和重启恢复。
- [pending] 极端中日韩混排长标题、人物/场景语义连续性人工证据及长片资源专项。

### 2026-09-10 U01/U05 前端增量

- [completed] U01 导演台项目摘要只使用真实资产/镜头缩略图作为封面；空项目显示明确未生成空态。
- [completed] U05 共享创建向导底部动作栏改为滚动内 sticky footer，紧凑窗口长表单操作可达。
- [completed] 产品流程契约 12/12、typecheck、生产 build、diff check。
- [completed] U01 生产 Electron 双尺寸证据：`.artifacts/director-desk-qa/report.json` 为 `status: passed`，空项目封面和预览均无图片且呈现真实空态；历史页验收也已通过并覆盖重启恢复和容量边界。
- [completed] U02 右侧队列和生成状态关键说明从 9px 提升到 10px；保留紧凑列宽、文本省略和现有检查器页签行为。

## 2026-09-10 后续推进记录

- [completed] F02 极端中英日韩混排长标题与纪录片版式真实 Electron QA：双工作流、横竖画幅、双尺寸截图和重启恢复通过，报告位于 `.artifacts/director-subtitle-mixed-documentary-qa/report.json`。
- [completed] 修复 QA 对新 case 的质量徽章断言遗漏，并完成脚本语法检查。
- [pending] 人物/场景语义连续性人工证据：需要基于同一批实际输出建立镜头级对照和可追溯人工复核记录，不能用 YDIF、四帧或字幕安全区替代。
- [pending] 长片资源专项：继续更高容量、多输入转场、深阶段取消、低帧率和完整磁盘预算的真实 Electron/FFmpeg 验收。
- [pending] U02/U04/U05 页面整体复核：继续检查紧凑窗口状态信息、服务/音色术语、素材可达性和各创建页真实截图，保持总计划 active。
- [completed] U02 检查器语义状态字号收口：服务/引擎/视频就绪/批次能力与摘要等关键说明统一到 10px，并通过 41 项导演台 UI/状态回归。
- [completed] 修正长片容量 QA 的假精确路径：`--long-1080p` 现在要求 500 个实际片段并记录 `expectedInputs`，普通 500 输入容量回归通过。
- [completed] 生成并验收 500 段 1920x1080、5000 秒完整输出；`.artifacts/compose-long-1080p-qa/report.json` 记录 `inputs=500`、`expectedInputs=500`、`duration=5000`、500 个场景起始静音检查、8 个帧点和峰值约 1.27GB。长片 QA 专用外层超时提升到 30 分钟以覆盖真实分组编码耗时。
- [pending] 继续补做转场模式的更高容量磁盘预算、低帧率和深阶段取消；当前 500 段证据使用重复本地片段，不能代表真实 AI 内容的语义连续性。
- [completed] F03 阅读速度可见化：规划结果记录有效字素数、最低预计阅读速度和最长 cue 速度，创建向导显示指标；固定时长过快文案继续阻断，全文模式保留完整正文。
- [completed] 真实 Electron 长文双尺寸回归：11,990 字、224 镜头、668 cue、草稿恢复/保存重开/项目重启通过，12 张截图无横向溢出，报告为 `.artifacts/director-long-script-qa/report.json`。
- [completed] 真实 Electron 本地旁白时长回填：`.artifacts/director-sound/report.json` 的 VOX/AI 漫剧导出均写入 `narrationAlignment.status=passed`；覆盖静音旁白、拆分片段有效时长、导出和保存重开。
- [completed] 对齐证据改用作者时间线中的对白/旁白资产，并用拆分后的 `sourceDurationMs` 避免同一源文件完整时长重复计入；新增 30/30 聚焦回归、typecheck、build 和 diff check。
- [pending] 继续真实 AI 多镜头人物/场景抽检及 U02/U04/U05 页面人工整体复核；500 段硬切长片资源专项已完成，转场/低帧率/深阶段取消仍待补验。

### 2026-09-10 U02/U04/U05 页面契约复核

- [completed] 导演台/服务状态/音色语义/创建流程/产品壳层聚焦回归 5 文件 180/180 通过。
- [completed] 已有真实 Electron 双尺寸证据继续有效：导演台 `.artifacts/director-desk-qa/report.json`、NewTask/Music MV `E:/StoryDream-QA/workspace-unsaved/report.json` 均为 passed，运行错误和付费调用为 0。
- [pending] 仍需人工复审更多实际生成项目的长状态文本、素材分类和系列场景语义；这不能由契约测试替代。
- [completed] F02 受控语义连续性人工证据：切点 QA 使用同一人物/街区的无文字本地素材，VOX/AI 漫剧实际渲染并保存双工作流人工观察记录；黑帧负向单独标注，不混入语义通过。
- [pending] 扩展到真实 AI 生成素材和多个切点/镜头的人工抽检；当前受控夹具证据不代表通用人物/场景连续性已完成。

## 2026-09-10 F03 真实旁白时长回填第一步

- [completed] 音频资产和旁白时间线支持持久化实测时长；VOX/AI 漫剧生成旁白在当前镜头绑定前读取本地音频元数据。
- [completed] 新增规划时长与实测时长、有效字素和实际字符每秒的审片证据及检查器展示。
- [completed] 纯函数/结构回归、类型检查和生产构建通过。
- [completed] 用真实 Electron 本地旁白时长回填复跑，确认真实报告和保存重开；证据见 `.artifacts/director-sound/report.json`，两工作流 `narrationAlignment=passed`。
- [pending] 继续人物/场景多切点抽检、转场/低帧率长片资源和 U02/U04/U05 页面人工整体复核。

## 2026-09-12 联网技能发现与安装

- [in_progress] 读取安装、联网检索和文件化计划规范；盘点现有技能与官方精选清单。
- [pending] 从官方清单和可信 GitHub 来源筛选维护活跃、用途互补的联网技能。
- [pending] 安装候选并校验目录、清单与技能元数据，记录重启/下轮生效说明。
- 约束：不覆盖现有技能；优先官方或可审计开源来源；避免安装与现有 `agent-reach`、`web-access` 完全重复的项目。
- 错误：官方清单脚本访问 GitHub API 返回 HTTP 403；不重试同一路径，改用官方仓库 Git/公开网页读取。

### 2026-09-13 工作区公共返回导航

- [completed] 用户截图复核纠偏：此前遗漏 VOX/AI 漫剧创建页。本轮将全部 productionNavItems 接入公共返回，移除导演创建/加载/恢复状态的局部返回；沉浸导演台仍使用自身页头，外层页头按既有 CSS 隐藏。
- [completed] 本轮 8 文件 243 项测试、生产构建通过。隔离 Electron 四种创建类型 34 张截图通过；实际 Vite 浏览器预览四页深浅主题/三尺寸 24 张截图通过，断言返回按钮坐标、36x36 尺寸和唯一入口一致。
- [completed] 确认 HTML/MV 创建页缺少公共返回；项目列表已有持久化 session，沿用未保存拦截器。
- [completed] 公共页头覆盖新建任务、HTML 动画、音乐 MV、普通任务详情；记录来源并避免设置往返产生自循环。
- [completed] 生产构建、9 文件 254 项聚焦测试通过；隔离 Electron 22 张截图覆盖桌面/紧凑/手机宽度及深浅主题，来源与草稿返回验证通过。
- [completed] 500 项目回归复测通过：15 项检查、6 张截图，分页/搜索/类型筛选/重启恢复不回退。
- 类型检查已执行但未通过：原有 browser-fallback 缺少 updateHtmlVideoSceneStructure / updateMusicMvTask，原有 storage 测试引用未实现的 FileDatabase.updateMusicMvTask。本次未扩展这些业务接口。
- 构建前置修复：同名 removeMotionComicShot 重复实现改为兼容三/四参数调用，保留两套已有语义并新增测试。
- 测试错误记录：初次夹具 compositions 数量不匹配已修正；恢复原先被 CSS 隐藏的 HTML 模式工具栏；项目全量 QA 首次重启阶段路由意外变化，完整复跑通过。
- 浏览器限制：内置浏览器不可用，用户已同意使用项目 Playwright 测试浏览器。

### 2026-09-13 模板图片与文字层级

- [completed] 定位图片 z-index:1、变换框 3/4，而文字外层 transform 建立 z-index:auto 层叠上下文，文字绘制和鼠标命中均落在图片之后。
- [completed] 原始实测四类文字中心均命中 image-frame；现将图片保持在 1、变换框 2/3、文字整体 4，并隔离画布层叠上下文。
- [completed] 深浅主题、1440x1000/1040x720、两种图片对象共 40 项鼠标检查、16 张截图通过；四类文字选中/拖动/缩放、右侧面板展开和图片自身移动/缩放正常。
- [completed] 5 文件 215 项聚焦测试、生产构建通过；类型检查仍为此前 browser-fallback/storage 接口缺失。未改模板数据和导出配置。
- QA 调整：默认副标题和字幕已有位置重叠，先用实际鼠标将上方字幕拖开，再单独验证各文字，未修改产品默认模板。证据 `.artifacts/draft-layer-order/`。

### 2026-09-13 公共控件悬停闪屏

- [completed] 返回按钮/草稿提示复现：237 帧中 112 帧被全屏浮层遮挡，根节点/路由/主题不变，导航预加载未复现闪屏。
- [completed] Provider 设置 applyStylesToPortals=false，仅向浮层传播主题变量；减弱动态效果规则继续覆盖浮层。
- [completed] 深浅主题、1440/1040/390 三宽度：浏览器 60 项悬停、10,550 帧；Electron 66 项悬停、13,813 帧通过，整屏遮挡/提示反复关闭/主题异常均为 0。
- [completed] 209 项聚焦测试、生产构建、diff check 通过；菜单/未保存弹窗/键盘返回/减弱动态效果通过，补拍动画结束后的浮层截图复核正常。
- 测试调整：浏览器模式窗体按钮被隐藏，改用可见返回按钮复现；初次计划补丁上下文不匹配，未写入后纠正。
- Electron 首轮像素断言检测到项目列表加载动画，截图确认不是悬停闪屏；回归脚本增加列表就绪等待后再采样。
- 本轮类型检查仍受先前记录的 browser-fallback / storage 接口缺失阻塞，无新增错误；本地 5173 已确认提供 applyStylesToPortals=false 的新代码。

### 2026-09-13 素材库入口与操作反馈

- [completed] 浏览器复现：主导航误入画图实验室，创建接口返回假成功且列表为空。
- [completed] 修正默认入口与预览能力提示，禁用不支持的操作，兜住删除引用查询错误；操作反馈移至图片区前，窄窗口工具栏换行但按钮文字不拆行。
- [completed] 217 项聚焦测试及生产构建通过；浏览器/隔离 Electron 17 张截图、真实图片创建/导入/重命名/删除/撤销/重载恢复通过。
- [completed] 主按钮文字颜色与忙碌尺寸收尾后最终复跑通过；运行错误/付费调用均为 0，类型检查仍只有此前记录的两个接口缺失报错。未操作真实项目或素材数据。

### 2026-09-13 Provider Credential Portals

- [completed] Inspect selected-profile state and official console destinations; distinguish speech keys from Ark and IAM credentials.
- [completed] Add shared settings footer links and trusted system-browser navigation without touching credentials or saving drafts.
- [completed] Final 269 tests and production build passed. Browser/Electron click, failure/retry, selected-profile switching, draft preservation, and 12 screenshots at 1440/1040/390 passed with zero runtime errors, contrast >=4.5, and stable hover geometry.
- [completed] Existing typecheck failures and missing music-mv:update IPC remain unchanged. User app/configuration was not restarted or modified.

### 2026-09-13 LLM API Protocol Selection

- [completed] Trace settings normalization, IPC, generation, model tests, and official Responses request documentation.
- [completed] Add persistent protocol selection and real Responses text/JSON adapters; preserve custom provider identity. Frame vision and preview diagnostics also use the selected protocol.
- [completed] Final focused regression: 14 files, 425 tests passed; production build passed. Isolated Electron and browser QA passed with 8 screenshots at 1440/1040/390 widths, both themes, zero runtime errors, and no live provider calls.
- [completed] Recorded pre-existing validation blockers: typecheck still reports missing browser fallback/storage APIs; expanded IPC test rejects VOX beatCount/totalDurationMs. User application/configuration was not restarted or changed.

### 2026-09-13 Gemini 配置 JSON 探测

- [completed] 检查保存配置和服务模型清单，确认 moeapi.cloud / OpenAI 兼容 / gemini-3.7-flash-high 已正确保存。
- [completed] 实测旧 20 与新 1024 token 请求均得到完整 JSON，本次未复现用户的偶发残缺回复；发现旧测试固定 20 token 且忽略 finish_reason。
- [completed] 提高探测预算和超时，区分截断/空响应/无效 JSON，兼容 max_completion_tokens 和 Anthropic 工具响应；不修改正式生成参数。
- [completed] 200 项聚焦测试、生产构建、修复后真实探测通过（4114 ms）。扩大回归 285/286，原有 music-mv:update IPC 缺失导致一项失败；类型检查仍为原有 browser-fallback/storage 接口缺失。

### 2026-09-13 项目列表统一使用封面

- [completed] 项目卡片优先使用正式封面，缺少正式封面时使用已有参考图兜底，保留统一占位态。
- [completed] 封面解析、项目壳、路由测试 166 项通过，生产构建通过。

### 2026-09-12 预览优先导演台改造

- [completed] 采用已选中的 Preview-first 概念方向：四阶段流程栏、左侧项目/镜头、中部大预览与胶片条、右侧上下文检查器，保留七个既有制作步骤和原业务状态。
- [completed] 镜头缩略图改用真实项目媒体；移动/紧凑窗口提供侧栏与检查器显隐、关闭、Escape 和焦点回归；预览选镜不再滚动标题区。
- [completed] Electron 窗体控制保留；保存标识只反映真实 dirty 状态；预览比例、版本、审片、导出入口继续走原有路由/状态。
- [completed] `tests/director-preview-first.test.ts` 及相关导演台/工作区测试 8 文件 122/122 通过，`npm run typecheck` 与生产 `npm run build` 通过。
- [completed] 生产 Electron 已覆盖本地真实媒体、空态、16:9/1:1/4:3/9:16、1536x1024/1440x1024/1040x720；最终报告 `.artifacts/storydream-web-redesign/r3-preview-first-20260912-final/report.json` 为 passed，36 张截图、运行时错误 0、付费生成调用 0。

### 2026-09-14 抖音常见草稿版式

- [completed] 实看抖音公开作品封面、图文和播放器预览图；来源、日期及证据范围已保存。
- [completed] 五种 9:16 版式、默认文字分区、等比缩略图、旧库幂等补齐与用户改动保护已完成。
- [completed] 相关回归合计 289 项通过；生产构建通过；浏览器 / 隔离 Electron 70 个画布测量及保存重载验证通过，运行时错误为 0。


### 2026-09-14 Restore standalone generation workbenches
- [completed] Restore always-visible image and voice generation navigation, retaining route IDs and saved records.
- [completed] User confirmed standalone video clips. Added prompt/reference video workbench, production IPC, provider reuse and local history.
- [completed] 267 related tests and production build passed; 12 Electron screenshots at 1440/1040, no runtime errors or paid calls. Typecheck retains pre-existing HTML/MV API/storage omissions; inventory retains three unrelated missing command entries.

### 2026-09-14 B站横屏草稿模板
- [completed] 实看 B站五个 16:9 作品的 15 张播放进度预览帧，记录标题、主体、字幕分区及来源。
- [completed] 新增五种 1920x1080 草稿版式与全部/横屏/竖屏筛选，沿用已有库幂等补齐机制；横屏筛选下的新模板也使用横屏。
- [completed] 修正任务切换模板时同步画幅，完成选用、导出桥接参数、保存重载及两种窗口验证。284 项测试、生产构建、浏览器和隔离 Electron QA 通过；类型检查仍为此前已记录的 HTML/MV 接口缺失。


### 2026-09-14 Generation workbenches under assets
- [completed] Move image, voice and video generation into the asset library navigation, preserving route IDs and functionality.
- [completed] 171 navigation/product/parity tests passed; production build and 10 normal/compact Electron captures passed.

## 2026-09-14 图文与文章创作设计
- [completed] 梳理现有创作入口与平台表达差异，设计两类工作台。
- [completed] 制作沿用 StoryDream 组件和主题的可交互原型与功能方案。
- [completed] 验证桌面/紧凑布局、编辑、版本切换和本地导出，交付预览。
- Scope: 按可交互原型＋方案交付，位于 docs/design/content-studio；生产路由、模型、数据库未接入。
- 验证：原型类型检查与构建通过；隔离 Electron 19 项行为检查、12 次截图通过（11 个独立截图文件），覆盖 1440/1040/390 和明暗主题，零运行错误。
- 过程问题：初始组件与 preflight 路径猜测不正确，已通过 rg 定位；原型 tsconfig 缺 CSS 类型已补齐 vite/client；内置浏览器不可用，采用隔离 Electron。QA 脚本的换行转义、Fluent 隐藏重复标签匹配与未保存刷新拦截均已修正。
## 2026-09-15 素材库文案创作工作台

- [completed] 梳理素材库导航、网页搜索、文案生成、任务创建与视频生成的数据边界。
- [completed] 设计并实现独立文案创作工作台：来源检索、多轮精修、赛道强化、版本留痕。
- [completed] 实现将定稿文案回传视频生成位置，并支持跳过预审。
- [completed] 增加聚焦测试，完成类型检查、构建与正常/紧凑窗口视觉验证。

### 本轮约束

- 保留既有路由 ID 和其他素材工具；复用 `src/ui` 控件与语义 token。
- 不触发真实联网搜索、付费模型或真实视频生成；验证使用隔离数据/桩。
- 工作区已有大量用户改动，只做与文案创作链路直接相关的局部编辑。

### 本轮错误

| 错误 | 尝试 | 处理 |
|---|---:|---|
| 登记的 `C:\Users\foxnotail\.agents\skills\storydream-ui` 不存在 | 1 | 使用仓库内 `I:\opc\.agents\skills\storydream-ui`，已完整读取技能与组件契约。 |
| `AiSourceSection` 没有 `id` 字段 | 1 | 沿用现有搜索流程的来源+网址+标题稳定键，类型检查不再出现本轮错误。 |
| 壳层测试仍固定旧菜单/路由数量 | 1 | 将断言同步到当前真实的文案创作与既有对话工作台入口。 |
| Codex 内置浏览器不可用 | 1 | 使用项目自带 Playwright Python + 隔离 Electron 完成截图和交互验证。 |

### 验证结果

- 相关回归 7 文件 241 项通过；最后合约复跑 4 文件 52 项通过。
- `npm run build` 与 `git diff --check` 通过（仅既有 CRLF 提示）。
- `npm run typecheck` 本轮新增错误为 0；仍被既有 browser fallback / music MV 接口缺失阻塞。
- 隔离 Electron QA 通过：1440×900 三栏，1040×720 紧凑布局，无横向溢出、无运行时错误、付费调用 0；跳过预审实测写入 `direct-copy`。


## 2026-09-15 Remotion 动画入口与模板扩充
- [completed] 搜集官方模板、开源动画库、商业参考和中文制作案例，核验页面内容与许可。
- [completed] 整理 163 条上游模板、157 张镜头配方与 40 个适配候选，明确模板/AI 代码生成入口。
- [completed] 按本轮“现在全网搜一些”的明确请求交付研究与扩充方案；范围问题未收到回复，采用推荐项“整理清单”。4 个上游模板完成真实本地渲染。
- 约束：保留大量既有改动；不把链接目录当作已安装模板；外部源码只在确认许可后才复用。
- 已知网络限制：Firecrawl 未登录且匿名 IP 被拒；Exa/GitHub CLI 不在 PATH；采用公开官方页面、GitHub API、B 站 API，浏览器按可用性回退。
## 2026-09-15 VOX 八类模板定向补充

- [completed] 为纸张拼贴、证据讲解、时间叙事、对比分析、数据解释、地图叙事、原理流程、书籍推荐寻找对应源码和预览。
- [completed] 核验新增来源的实现、许可证和可迁移范围，形成 8 类 32 项候选与 27 组来源映射。
- [completed] 将八类与候选补入功能规划，交付来源清单、结构化 JSON 和 8 秒中文源码样片。
- 本轮依据“这些补充，再找找有没有对应的模板”扩充规划和源码研究；页面接入状态单独标明。
- 验证：32 项唯一 ID、8 类及来源引用检查通过；中文 UTF-8 复读通过；纸卡/连线/翻页 240 帧全解码通过，四帧联系表已实看。未改生产源码或增加主项目依赖。
- 过程错误：CDP 超时、GitHub API TLS 失败、部分 LICENSE/配方路径 404 已记录；转向公开 HTML/raw。ffprobe 不在 PATH，使用已安装 imageio_ffmpeg 完整解码验证。Shotcraft 具体 demo 保持未实渲状态。
## 2026-09-15 VOX Remotion 模板与 AI 动画正式接入

- [completed] 核对现有项目/镜头/预览/导出架构，建立兼容旧镜头的动画持久化模型。
- [completed] 实现八类模板及前述常用动效，提供真实参数、素材输入和确定性预览。
- [completed] 接入 AI TSX 生成、修改、编译反馈与保存为个人模板。
- [completed] 接入单镜头/全片导出及音频同步，完成保存重开、横竖屏、错误恢复和取消验证。
- [completed] 完成类型检查、相关回归、生产构建与正常/紧凑窗口截图，交付可使用功能。
- 用户已明确授权接入全部上述功能；保留工作区既有改动。只采用许可可复用源码，缺少现成模板的能力以本项目组件实现。

- 验收：49 个模板 × 2 比例；正常/紧凑窗口交互与代码错误恢复通过；8 秒 1080p 192 帧 MP4 全解码；111 项相关测试通过。既有音乐 MV 接口缺失仍导致一项测试和全项目类型检查失败。构建、Electron 冒烟通过。详见 docs/research/remotion-templates-2026-09-15/implementation.md。

## 2026-09-15 VOX 视频技能安装与工作台接入
- [completed] 安装 paper-cut、vox-skill、vox-editorial、gbro-collage-broll、vox-collage-art-animation-nantian 到用户 Codex skills。
- [completed] 增加持久化镜头制作方式，关联参考原画分层、Remotion 旁白动画、B-roll 和首尾帧拼贴。
- [completed] 接通尾帧资产、供应商能力校验、输入变更失效与生成请求；复用现有模型与资产系统。
- [completed] 完成聚焦测试、类型检查、构建及正常/紧凑窗口交互截图。
- 保留所有既有工作区改动。Nantian 仅安装给用户，不将许可未明确的上游源码复制进产品；产品适配由本项目独立实现。验证使用本地桩，不触发付费模型。
- 验收：新增 7 项单测通过；双尺寸完整页面与 5 项既有双链路流程通过；生产构建、Electron 6 项冒烟通过。首次大图调度超时后隔离重跑 21 项全部通过。旧导航数量断言和既有 Renderer/Electron/Scripts 类型错误仍在，详见 docs/plans/2026-09-15-vox-skill-integration.md。
- 本机技能补充中文词匹配与 UTF-8 读写，隔离夹具验证不同中文词的帧号及中文输出。收尾误读双链路 report.json，已定位正确产物 result.json。

## 2026-09-16 联网搜索备用源扩充

- [completed] 核验免费/免 Key 搜索服务的当前接口、匿名可用性和产品集成边界。
- [completed] 接入 DuckDuckGo 兼容引擎与 MediaWiki 末级知识兜底，保留真实后端状态。
- [completed] 补充回归测试，完成聚焦验证与类型检查。
- 范围：只接入无需用户新增凭据且现场可验证的来源；需注册、绑卡或依赖脆弱页面抓取的候选只记录。
- 已知环境限制：`agent-reach` 的 Exa 后端未安装；`web-access` Chrome CDP 代理连接超时，因此使用技能允许的公开 HTTP/Jina Reader 路径。
- 验证脚本错误：`tsx -e` 顶层 `await` 不支持 CJS 输出；已改用异步 IIFE。
- 验收：真实 DuckDuckGo 端到端返回 10 条；搜索 41 项、UI/草稿 13 项、IPC 新来源聚焦测试通过；生产构建通过。类型检查仅剩既有的 browser fallback、ViralReferenceReport 缺失与 music MV 数据库接口错误。无可用浏览器，未生成本轮截图。

## 2026-09-16 热榜联网补搜修复

- [completed] 用用户截图中的完整标题复现热榜三源查询为 0 条。
- [completed] 将 DuckDuckGo 接入热榜实际请求，并区分“额度受限/无结果”和真实后端失败。
- [completed] 跑热榜与搜索回归，真实复测该标题并验证桌面弹窗。
- 验收：截图标题在 SearXNG 禁用、Tavily 额度耗尽时仍由兼容源返回 2 条可用结果；聚焦测试 39/39 通过，生产构建产物已更新，正常与紧凑窗口截图实看通过。
- 已知限制：完整类型检查仍被既有 `browser-fallback` API 缺失和 `FileDatabase.updateMusicMvTask` 缺失阻塞；截图 QA 后续在无关的旧“去创作交接”夹具处超时，不影响本轮搜索弹窗验证。
