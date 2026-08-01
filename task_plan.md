# Storybound 中文全量复刻计划

Goal: 在 `codex/storybound-cn-full-replica` 分支上，以本机 `E:\Storybound` 和 `C:\Users\Administrator\AppData\Local\com.dudumd.storybound` 为参考，把当前项目改成 Storybound-first 的中文桌面工具壳，并保留现有扩展功能为次级模块。

## Phases

- [x] 创建 `codex/` 工作分支。
- [x] 读取现有项目、旧 Storybound parity 计划与参考应用本地配置。
- [x] 探测参考 SQLite 结构与资源目录。
- [x] 添加中文 Storybound-first 壳层、数据与流水线契约测试。
- [x] 重做壳层导航、最近任务、试用/激活、积分/账户入口与页面中文文案。
- [x] 补齐 Storybound 风格本地状态：任务、事件、草稿模板、积分、Clone voice、playground jobs 等参考兼容结构。
- [x] 对齐核心流水线可见命名：Step 0 预审、Step 1 三轮改写自评、Step 2 分镜、Step 3 主角档案与出图提示词、Step 4 批量生图、Step 5 配音、Step 6 草稿导出。
- [x] 模块重排：画图实验室、配音实验室、音乐 MV、爆款拆解、提示词模板、草稿模板、系统设置、账户中心、激活管理进入主线区；扩展工具区保留给后续非主线模块。
- [x] 按 `frontend-design` 优化为密集、克制、工具型但有辨识度的中文 UI。
- [x] 运行 typecheck、Vitest、构建与 Electron/浏览器烟测。

## Implemented

- 侧边栏拆成“主线工作流”和“扩展工具”，爆款拆解保留在主线工作流中，避免入口被误认为消失。
- 增加最近任务、试用剩余、积分明细、账户中心入口。
- 顶部继续显示剪映草稿目录、保存状态和浏览器预览提示。
- 流水线可见文案改为 Storybound 步骤名。
- SQLite 迁移新增 Storybound 参考兼容表：`user_prompt_templates`、`playground_jobs`、`credits_transactions`、`custom_cover_templates`。
- `tasks` 表新增参考字段并接入创建/读取：`material_source`、`task_type`、`pipeline_step`、`pipeline_data`、`target_length`、`target_scenes`、`script_format`、`cover_image_mode`、`cover_template_id`。
- 默认账户改为 `Storybound 本地工作区`，激活/积分文案改为试用口径。
- 修复一个旧样式文案错字：`80年代闭达` -> `80年代街拍`。
- 按 `frontend-design` 收口视觉系统：新增 cyanprint、timeline blue、paper warm、reel amber 令牌，使用轻量蓝图网格、导航时间轴标识、低圆角面板阴影和统一焦点环。
- 普通设置字段和浏览器预览 fallback 错误继续中文化；产品/API/模型名按原名保留。

## Verification

- `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/product-shell-ui.test.ts`: 74 tests passed.
- `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 tests/storage.test.ts`: 12 tests passed.
- `npm run typecheck`: passed.
- `npm test`: 39 files, 318 tests passed.
- `npm run build`: passed; Vite reported only the existing large chunk warning.
- `npm run smoke:electron`: passed, shell/new-task/draft-template smoke all true.
- Browser smoke on `http://127.0.0.1:5173`: verified 主线工作流、扩展工具、最近任务、试用剩余、积分明细、账户中心、新建任务页面、系统设置中文字段 and no checked fallback English leaks.

## Notes

- Existing untracked `src/shared/__pycache__/` and `tmp/` were preserved and not modified.
- Browser preview localStorage may still contain old custom style values until cleared; source code no longer contains `闭达`.

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| PowerShell/terminal 输出把正常中文显示成乱码。 | 直接 `Get-Content` 查看大文件。 | 用 Node 检查文件 UTF-8 内容和测试真实字符串，避免误判源文件编码。 |
| Node `-e` SQL 探测被 PowerShell 引号截断。 | 单行 `node -e` 嵌套 SQL 字符串。 | 改用 PowerShell here-string 管道给 Node 执行。 |
| 新增 `Task` 参考字段设为必填后，旧测试和工具里手工构造的 `Task` 失配。 | 首次 typecheck 失败。 | 将参考字段设为可选，并在数据库创建/读取时填默认值，保持向后兼容。 |

---

# 2026-08-01 去 AI 味 Skill GitHub 可检索性梳理

Goal: 将用户提供文章中的重复 Skill 名称合并为唯一清单，并核验这些名称能否在 GitHub 上搜到精确或高度相关的仓库/文件，最后输出中文表格和判断。

## Phases

- [x] 去重并确定检索关键词。
- [x] 用 GitHub/网页检索核验精确命中、相近命中和未命中。
- [x] 汇总可信链接、注意事项和使用建议。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| GitHub API 中途 403。 | 批量 repository search。 | 已用网页搜索、直接仓库页面请求和普通 HTTP 200 检查补足。 |
| `git ls-remote` 大量假阴性。 | 批量核验仓库是否存在。 | 改用 GitHub 页面请求；22 个候选仓库均返回 HTTP 200。 |

---

# 2026-06-23 G:\Storybound 后端逻辑逆向计划

Goal: 以 `G:\Storybound` 为新的参考程序目录，尽量还原它的本地后端/业务逻辑结构：启动形态、资源封装、IPC/API 边界、SQLite/本地配置、任务流水线、模型调用适配、草稿导出逻辑和远程依赖。只做兼容性与功能复刻分析，不绕过激活、破解授权或提取可用密钥。

## Phases

- [ ] 确认 `G:\Storybound` 目录结构、可执行文件、资源封装格式和版本信息。
- [ ] 识别是否为 Electron/Tauri/Node/Python/Go 等运行时，定位可读源码、bundle、asar、native 模块和配置。
- [ ] 提取并索引可读资源到临时分析目录，不修改参考程序。
- [ ] 搜索 API endpoint、IPC channel、SQLite schema、任务 pipeline、模板、prompt、模型 provider 和导出器关键词。
- [ ] 对比 `I:\opc` 现有实现，整理可复刻逻辑、缺口、不可逆/高风险部分。
- [ ] 输出后端逻辑逆向结论和下一步实现建议。

## Constraints

- 不运行可疑网络请求，不提交参考程序原始私有资源。
- 不绕过 license/activation/credits 检查，不提取或复用用户密钥。
- 优先静态分析；如果需要动态观察，只记录请求形态和本地状态变化。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| `planning-with-files` 文档中的 `.claude` catchup 脚本路径不存在。 | 按技能说明直接运行 `$HOME\.claude\skills\...`。 | 改用实际安装路径 `C:\Users\foxnotail\.codex\skills\planning-with-files\scripts\session-catchup.py`。 |

---

# 2026-07-09 Storybound Latest Practical Migration

Goal: 用户选择“方案 B：实用移植版”后，将 `E:\Storybound` 最新版中可安全、本地化复用的能力迁移到当前 Electron/React/sql.js 项目中，同时避开私有远端接口、授权/积分绕过和不可控的服务端依赖。

## Phases

- [x] 逆向确认最新版可迁移功能：文案把控三件套、人物素材库真图分镜、选品助手、对标导入本地版。
- [x] 扩展本地类型和 SQLite 契约：任务新增 `product_info`、`material_person`、`draft_dir`、`fixed_intro`、`outro_cta`、`lock_intro_sentences`；新增 `book_selection` 本地表。
- [x] 接入 Step 1 文案把控：固定开头、结尾 CTA、锁定开头句数、产品信息提示和目标字数修复上下文。
- [x] 新增人物素材库 helper，并在 Step 4 支持 `materialSource = local` 时复制本地人物图片替代 AI 生图。
- [x] 暴露 Electron IPC/preload API：本地选品和人物素材库 CRUD、导入图片、列图。
- [x] 新增 UI：选品助手、对标导入、人物素材库；新建任务高级设置新增文案把控和素材来源。
- [x] 完成规格审查、代码质量审查和最终验证。

## Deliberate Exclusions

- 不接入 Storybound 私有远端接口，如 `/v1/dajiala/*`、`/v1/bugpk/parse` 或下载解密相关逻辑。
- 不实现服务端积分返还、授权绕过、密钥提取或 token 复用。
- 不实现完整图生视频远程工作流。
- 人物素材首版使用本地图片复制铺分镜，不新增裁剪/抠图依赖。

---

# 2026-06-23 Backend Reverse Follow-up

Goal: keep extending the `G:\Storybound` reverse-engineering pass until the backend contract is explicit enough to drive a faithful implementation plan.

## Current Focus

- [x] Recover Tauri IPC command names and payload shapes from the browser bundles.
- [x] Recover `draft-generator.exe` sidecar modes and the Step 6 JSON contract.
- [x] Recover remote license/account/system-template API shapes and local secret keys.
- [x] Recover the current reference `tasks` schema/migration shape from the JS bundles.
- [ ] Compare the recovered contract against `I:\opc\src\shared\runner.ts`, `storage.ts`, `draft.ts`, and `jianying-bridge.ts` in more detail.
- [ ] Summarize the remaining parity gaps as implementation notes, not just research notes.

## Notes

- The reference app's backend is split between Rust/Tauri host commands and the Python sidecar.
- The current `I:\opc` code mirrors many Storybound concepts, but it still uses Electron/Node and a different draft bridge.
- The biggest unresolved compatibility boundary is the exact draft export flow and the Tauri IPC layer.

---

# 2026-07-31 Storyboard Response Compatibility

Goal: 修复模型把分镜结果返回为 `{ "tail anchor": [...] }` 时流程直接报错的问题，并提高 Step 2 对非标准但可恢复 JSON 的兼容性，同时保持严格的场景数据校验。

## Phases

- [x] 定位 Step 2 提示词、JSON 解析和 `scenes` 校验链路，复现 `tail anchor` 返回。
- [x] 先添加回归测试，再实现多形状兼容修复；保留现有严格提示词协议。
- [x] 运行定向测试、类型检查和构建，记录结果。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| `LLM storyboard response did not include scenes`，顶层仅有 `tail anchor`。 | 用户实际生成分镜。 | 通过键名归一化、受限容器递归和纯文本列表解析修复。 |
| 新增用户响应形状回归测试后按预期失败。 | `tests/runner.test.ts -t "spaced singular key"`。 | 已证明缺失别名是直接原因，开始补解析兼容。 |
| 全仓测试 1585 项中 1 项无关的 HTML 封面用例报 `ENOENT: mkdir '\\\\?'`。 | 并行运行后又隔离重跑。 | 确认测试硬编码当前不存在的 `I:/managed`；与分镜改动无关，本次不扩大范围修改。 |

---

# 2026-07-31 Storyboard Format Failure Recovery

Goal: 参考最新版 Storybound 的 Step 2 容错方式，正确识别 LLM/供应商错误对象，对可重试的分镜格式错误进行自动修复；持续失败时清晰暂停，避免普通模式静默降级为机械拆句。

## Phases

- [x] 从 `E:\Storybound` 及已提取资源确认 Step 2 的输出协议、重试和本地还原逻辑。
- [x] 添加 `{ "error": "strict JSON schema conflict" }`、数组根协议及反馈重试回归测试。
- [x] 实现错误对象识别、数组根协议和三轮反馈重试，保留原文覆盖校验。
- [x] 运行 runner 全量测试、类型检查、构建和 Electron 烟测。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| `LLM storyboard tail anchors did not match rewritten copy: strict JSON schema c…`，原始响应为 `{ "error": "strict JSON schema conflict" }`。 | 用户从 Step 2 生成分镜。 | 已修复数组根协议冲突，并在锚点解析前识别显式错误对象。 |
| Windows `rg` 对 `storybound_*` 路径参数报文件名语法错误。 | 同时搜索多个参考报告。 | 改用 `.reverse/storybound-latest-assets` 和明确文件路径。 |
| 用跨行正则直接截取压缩 bundle 无输出。 | `rg --pcre2` 搜索完整函数。 | 改按 bundle 行号读取，成功恢复 `qM()` 完整实现。 |
| 新增 3 类回归测试后均按预期失败。 | OpenAI/Anthropic 数组根请求、Step 2 错误对象重试。 | 已确认协议层和 runner 层两个根因，开始实现。 |
| 类型检查发现 `llm-provider.ts` 两个测试连接调用仍传旧版 `messages` 参数。 | 首轮实现后运行 `npm run typecheck`。 | 已改为传完整 JSON 请求对象；类型检查通过。 |
| 并行执行 exe 元数据与大范围 bundle 搜索时，搜索返回非零并遮住元数据输出。 | 核对当前 `E:\Storybound` 版本。 | 改为分别读取文件哈希和版本信息。 |

---

# 2026-08-01 Settings Save Recovery

Goal: 修复设置页在其他设置操作进行中时点击“保存配置”无响应的问题，并把真实配置保存纳入 Electron 冒烟检查。

## Phases

- [x] 用正式配置和数据库副本验证 IPC、配置服务、加密密钥库及页面保存链路。
- [x] 定位设置页保存与模型列表/诊断等操作共用忙碌锁导致的静默丢弃。
- [x] 为保存配置使用独立动作通道，并显示保存忙碌反馈。
- [x] 运行配置测试、类型检查、构建和包含真实配置保存的 Electron 冒烟。

---

# 2026-08-01 Storybound HTML Animation Full Parity

Goal: 以最新版 `E:\Storybound` 为行为和页面参考，修复普通任务图片预览未同步、预览未使用草稿模板的问题，并完整迁移 HTML 动画工作台的页面、状态机、素材同步、预览和导出逻辑。

## Acceptance Criteria

- 普通任务 Step 4 新生成或重生成的图片立即出现在“图片”页和预览画布，不依赖重启或手动刷新。
- 普通任务预览使用任务选择的草稿模板，正确还原画布比例、素材框位置/尺寸、标题与字幕内容、字体、字号、颜色、描边和对齐。
- HTML 动画入口、六步工作台、步骤状态、配置区域、场景规划、素材、配音、动画预览和出片页面与最新版 Storybound 的信息架构及主要交互一致。
- HTML 动画的 pipeline 数据、素材映射、预览 HTML、运行时动画、音频时长、渲染和导出逻辑形成完整闭环，不复用普通视频 runner。
- 使用真实任务数据、自动化截图、运行时错误捕获和关键像素/DOM 检查验证。

## Phases

- [x] 捕获当前 StoryDream 普通任务与 HTML 动画的实际状态，复现图片同步和模板预览偏差。
- [x] 打开最新版 Storybound 页面，恢复 HTML 动画 UI、状态机、前端数据结构、Tauri 命令和 sidecar/渲染逻辑。
- [x] 形成字段级差异表和实现设计，确定可直接复用与需要替换的本地模块。
- [x] 修复普通任务图片同步，并实现草稿模板驱动的预览布局/文字样式。
- [x] 完整迁移 HTML 动画工作台页面和底层流水线闭环。
- [x] 添加回归测试，完成构建、Electron 冒烟、真实任务截图和视觉比对。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| 当前图片页显示 `9 / 30 已生成`，中央预览仍为空且显示占位图标。 | 用户实际任务截图。 | 调查中：先核对任务详情增量同步、图片路径协议和预览素材解析。 |
| 当前预览使用固定标题/字幕布局，未体现草稿模板。 | 用户实际任务截图。 | 调查中：对照 draft template schema、普通任务预览和 Storybound 页面实现。 |
| 首次 `view_image` 结果包装方式错误，报返回值不可迭代。 | 原图检查。 | 改为直接转发单个图像结果，原尺寸截图读取成功。 |
| 组合 `rg` 搜索因某一子搜索无匹配返回非零且输出截断。 | 初次代码面扫描。 | 已获得关键命中；后续改为明确文件逐个读取，避免大范围噪声。 |
| `npm run qa:editorial -- --scope=task-operations` 的 scope 参数被 package script 中的 `&&` 吞掉。 | 普通任务专项实机 QA。 | 改为直接运行 `scripts/run-npm-node.cmd ... editorial-qa-electron.ts --scope=task-operations`。 |
| 普通任务专项 QA 预期 6 个状态只上报 2 个，停在 `task-detail-operations-desktop`。 | 直接运行专项实机 QA。 | 修正把当前场景误当生成计数的 ready 条件，并在每次 QA 前重建 `dist-electron`；最终 6/6 通过。 |
| 自定义任务模板 ID 正确，但预览仍显示默认模板的 `0%/100%` 图片框和 `25px/#FFDE00` 标题。 | 加强后的自定义模板实机 QA。 | 任务详情按 `templateId` 懒加载真实模板 detail，并隔离任务切换竞态；最终显示 `22%/44%` 和 `31px/#38F2B0`。 |
| 无 cover 元数据时副标题显示模板占位文案“副标题示例文字”。 | 自定义模板实机 QA 内容断言。 | 副标题回退顺序改为 cover 副标题、cover 摘要、当前场景文案、模板文案。 |

---

# 2026-08-01 HTML 动画浅色底栏可读性

Goal: 修复 HTML 动画任务工作台在浅色主题下仍混用深色媒体背景与浅色 shell 字色的问题，确保出片页底部元数据、输出路径和可视编排状态栏清晰可读。

## Phases

- [x] 对照现有浅色/深色截图，定位出片底栏和可视编排状态栏的实际 DOM 与主题令牌。
- [x] 统一有任务工作区的浅色表面和底栏前景色，提高编排状态栏字号与高度。
- [x] 增加静态样式契约和浅色出片真实 Electron 对比度回归。
- [x] 运行定向测试、类型检查、构建、HTML 视频 UI QA，并检查最终浅色截图。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| 现有 `theme-light.png` 只拍到系统设置页，没有覆盖 HTML 动画底部。 | 复用既有浅色截图判断问题。 | 改为在完成任务的“出片”标签下新增浅色截图与底栏计算样式采样。 |
| 整页浅色 QA 检出场景时长仅 `1.84:1` 到 `2.05:1`，并把新版双栏识别为 `unknown`。 | 首次运行 `--scope=html-video`。 | 提高有任务标签页 `small/figcaption` 选择器优先级，并将布局验收同步到 1.17 的左侧纵向双栏结构。 |
| 对比度与双栏识别通过后，专项 QA 的场景仍被判定未就绪。 | 第二次运行 `--scope=html-video`。 | 就绪条件仍查找旧 `.hv-media-frame`；改为验证 `.hv-reference-thumb` 图片和 `.hv-reference-phone iframe`，参数顺序改按左栏区域坐标判断。 |

---

# 2026-08-01 配置持久化与 HTML 动画失败态复核

Goal: 修复重启后已存配置被误判为空，以及 HTML 动画场景规划失败时展示下游空壳的问题；以 Storybound 1.17 的任务工作台为验收依据。

## Phases

- [x] 复核实际配置目录、迁移标记、任务快照和失败事件。
- [x] 修正活动 TTS/LLM/图片档案的加密密钥状态投影。
- [x] 验证严格 JSON 冲突可无约束重试并回退为本地场景规划。
- [x] 重新构建并进行隔离 Electron 视觉验收。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| 初次实际任务 SQL 查询使用了不存在的 `updated_at` 字段。 | 读取 HTML 任务摘要。 | 先读取真实 SQLite schema，改用 `created_at`、`started_at`、`completed_at` 与 `task_events.seq/detail`；全程只读。 |
| HTML 视频 UI QA 在保存字幕后判定失败。 | 首轮 Electron UI 验收。 | 预览已正确失效，但编辑器随空预览被隐藏；保留字幕编辑器并显示“等待动画预览”阻断面板，重跑 QA 通过。 |

---

# 2026-08-01 HTML 动画独立创作页

Goal: 对齐 Storybound 1.17 的两阶段入口，首次进入 HTML 动画时先显示独立创作页，创建任务或选择历史任务后才进入六步工作区。

## Phases

- [x] 恢复 Storybound 无任务 ID 时的创作页信息架构和五段参数分组。
- [x] 取消自动打开第一条历史任务，增加“已有任务”和工作区“新建”双向入口。
- [x] 删除工作区残留的隐藏旧创建表单并统一“开始生成”文案。
- [x] 修复 `storydream-media:` 跨源场景与 HyperFrames Player 的 runtime 就绪握手。
- [x] 完成类型检查、专项测试、完整 Electron QA 和桌面/紧凑截图检查。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| 第二次进入可视编排时 Player 始终 `ready=false`，但 iframe 内 GSAP 与时间轴均已就绪。 | 完整 HTML 视频 UI QA。 | 场景 HTML 增加 HyperFrames `hf-preview` 的 `ready`/`timeline` 标准协议消息；保留现有 StoryDream 消息兼容旧预览。 |
| 产品壳全量静态测试有 1 条设置页字符串断言仍期待 `draft`。 | 附加运行 `product-shell-ui.test.ts`。 | 判定为本次范围外的旧断言；HTML/HyperFrames 专项 108 项、类型检查和完整 Electron QA 均通过。 |

---

# 2026-08-01 网页搜索 Fake-IP 兼容

Goal: 修复代理 Fake-IP 环境下网页搜索被网络安全策略误拦截并只显示 `fetch failed` 的问题，同时保持 SSRF 防护边界。

## Phases

- [x] 复现搜索调用链并展开 Undici cause，确认真实错误为 `NETWORK_ADDRESS_BLOCKED`。
- [x] 区分域名 DNS Fake-IP 与用户直接输入的基准网段 IP。
- [x] 增加中文错误提示和网络策略回归测试。
- [x] 完成类型检查、专项测试、真实搜索、provider 联网、构建和应用重启。

---

# 2026-08-01 自定义模板删除与任务详情标题栏

Goal: 为本地自定义草稿模板补齐安全删除能力，并修复任务详情在常用桌面窗口宽度下状态、指标和操作按钮错行的问题。

## Phases

- [x] 贯通自定义模板删除的数据库、IPC、preload、API 与状态同步链路。
- [x] 添加仅自定义模板可见的删除按钮和二次确认，数据库层保护系统默认模板。
- [x] 去除标题栏重复进度，调整桌面 flex 收缩与换行规则。
- [x] 完成类型检查、相关测试、构建、差异检查和 Electron 专项视觉验收。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| `npm run qa:editorial -- --scope=task-operations` 没有把 scope 参数传给底层脚本，误跑 90 张全量 QA。 | 通过 npm script 传递专项参数。 | 直接调用 `scripts/run-npm-node.cmd ... scripts/editorial-qa-electron.ts --scope=task-operations`，专项 4/4 通过。 |

---

# 2026-08-01 任务详情草稿模板切换

Goal: 允许用户在普通任务详情中随时选择并预览其他草稿模板，确认后持久化应用，并仅重做必要的草稿导出步骤。

## Phases

- [x] 在任务详情工具条增加模板选择、即时预览、应用和模板管理入口。
- [x] 贯通任务模板更新的数据库、IPC、preload、renderer API 与状态增量同步。
- [x] 让运行中的导出步骤读取最新模板，让已完成任务只重新执行草稿导出。
- [x] 完成类型检查、相关测试、构建、差异检查与 Electron 专项视觉验收。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| 在单次 Electron 截图事务中连续切换、应用、切回并再次应用时，与专项 QA 总时限竞争。 | 用一条视觉事务同时验证交互和持久化。 | 持久化由 SQLite、IPC 和状态契约测试覆盖；视觉 QA 专注验证控件、当前值、模板数量、按钮状态和管理入口。 |

---

# 2026-08-01 草稿模板卡片操作区对齐

Goal: 修复自定义模板删除按钮与编辑、复制按钮规格混用造成的错位，并建立真实 Electron 几何回归门禁。

## Phases

- [x] 将普通模板卡拆分为预览、元数据和操作三段稳定网格。
- [x] 将系统模板操作区设为两列、自定义模板操作区设为三列等宽按钮。
- [x] 将删除操作改为 Lucide 图标加明确文字，与其他操作使用同一按钮规格。
- [x] 完成深浅主题、桌面与紧凑窗口 Electron QA、测试、构建和差异检查。

---

# 2026-08-01 草稿模板下拉主题适配

Goal: 修复任务详情中原生草稿模板下拉在 Windows 深色主题下展开为白底、文字难以辨认的问题。

## Phases

- [x] 将原生 `select` 替换为应用内主题化 listbox，保持原有预览与应用逻辑。
- [x] 补齐鼠标、点击外部关闭和完整键盘操作，并标识当前模板。
- [x] 使用 shell 主题变量统一触发器、菜单、悬停与选中状态。
- [x] 完成类型检查、相关测试、构建、差异检查和 Electron 深色主题专项验收。

---

# 2026-08-01 草稿封面标题钩子化

Goal: 确保草稿模板顶部主标题与副标题始终是概括冲突、反差或结果的吸引力文案，而不是人物姓名或资料字段，并让预览与剪映导出保持一致。

## Phases

- [x] 追踪封面标题从 LLM 响应到预览和导出的完整数据链，确认错误降级点。
- [x] 收紧生成约束并增加确定性标题修复，兼容旧任务和不合格模型输出。
- [x] 增加语义回归测试，覆盖人物姓名标题、空副标题和正常钩子标题。
- [x] 完成类型检查、专项测试、构建与真实 Electron 预览验收。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| 一次组合检索包含不存在的旧路径 `src/shared/core.ts`，并因 `rg` 非零退出使并行读取中断。 | 初次追踪封面类型与生成函数。 | 去除旧路径，改为读取现行 `story.ts`、`runner.ts` 与 `storybound-system-templates.ts`。 |
| `npm test -- <files>` 仍由项目包装脚本执行 106 个全量文件；本次新测试发现副标题会额外补入一条近义正文，另有 4 条既有 HTML 封面/IPC 清单失败。 | 首轮专项回归。 | 有显式剩余副标题时不再追加正文兜底；后续改用 Vitest CLI 精确执行本次文件，既有失败单独记录为范围外状态。 |

---

# 2026-08-01 任务已应用模板持久化

Goal: 将任务已应用模板与下拉候选模板严格分离，只有用户显式点击“应用模板”后才持久化变更，并把珊瑚色应用按钮文字改为黑色。

## Phases

- [x] 复核截图、模板候选回退、按钮样式级联与现有 Electron QA。
- [x] 移除缺失模板时静默选择列表第一项的行为，建立明确的已应用/待应用状态。
- [x] 补齐按钮黑色前景与模板固定语义的静态及 Electron 回归断言。
- [x] 完成类型检查、专项测试、构建、差异检查和真实应用重启验收。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| 首次数据库路径检索的 `rg` 正则括号未闭合。 | 并行定位真实任务持久化状态。 | 改用多个 `-e` 固定检索项继续定位。 |
| `ui-ux-pro-max` 的 `scripts` 是路径指针文件，不是本机实体目录，直接调用 `search.py` 失败。 | 按技能流程生成设计建议。 | 读取指针的真实目标后再调用脚本；实现继续遵循既有 StoryDream 设计令牌。 |
| 首次读取 Electron QA 报告时沿用了旧的 `user-data/editorial-qa-report.json` 路径。 | 汇总实机验收结果。 | 使用本次脚本输出根目录下的 `report.json`，报告与 7 张截图均完整。 |

---

# 2026-08-01 最终封面元数据与双层字幕拆分

Goal: 对齐 Storybound 1.17，让封面主标题/副标题始终基于最终成稿生成，并将画面级分镜与短字幕断行分成两个可靠阶段，避免整条长分镜直接成为字幕。

## Phases

- [x] 逆向确认 Storybound 1.17 的最终成稿封面时序、分镜规则与 12 字字幕断行规则。
- [x] 核对真实任务长句和当前封面生成时序，确定兼容旧任务的最小数据模型改动。
- [x] 实现最终成稿封面回填、画面级分镜长度校验和无损字幕短行拆分。
- [x] 补齐语义、覆盖率、时长分配、旧产物兼容和 UI 预览回归测试。
- [x] 完成类型检查、专项测试、构建、Electron 实机验收和正式应用重启。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| `npm test -- --run ...` 在 124 秒后超时。 | 通过 npm 包装脚本传递专项文件参数。 | 确认 `scripts/test.ps1` 不转发参数，改为直接调用 Vitest；专项测试正常在 1-17 秒内完成。 |
| Editorial QA 报 `Usage: editorial-qa-electron.ts [--scope=<scope>]`。 | 使用位置参数 `task-operations`。 | 改用 `--scope=task-operations`，7/7 实机用例通过。 |
| 全量测试 5/1626 失败。 | 运行当前脏工作区全部 107 个测试文件。 | 确认为既有 IPC/HTML 动画命令清单、Windows 临时路径和测试基线漂移；本次封面、分镜、字幕、草稿和预览相关专项全部通过。 |

---

# 2026-08-01 人名关键词搜索偏移排查

Goal: 定位“李在明”搜索结果大量偏移到“李姓/李氏”泛化页面的根因，区分查询改写、搜索源分词、候选解析和本地排序问题。

## Phases

- [x] 追踪关键词从页面到搜索请求的完整调用链。
- [x] 用真实“李在明”请求核对各搜索源的原始返回与本地解析结果。
- [x] 确定根因、影响范围和最小修复点，本轮先输出诊断结论。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| `tsx.cmd -e` 退出码为 0 但未执行诊断输出。 | 用 PowerShell 变量向 cmd shim 传递多行 ESM 脚本。 | 改用 Node `--import tsx --input-type=module -e` 加载 TypeScript，避免 cmd shim 参数丢失。 |

---

# 2026-08-02 多渠道精准网页检索

Goal: 将 AI 创作的网页搜索改为可控、可追溯的多渠道精准检索，覆盖必应、百度、搜狗和头条等中文信息源，拒绝仅由侧栏/推荐词命中的无关页面，并在 UI 显示渠道与实际查询。

## Acceptance Criteria

- 关键词作为完整主题传给每个搜索渠道，不做单字拆分。
- 结果携带明确渠道标识，可区分必应、百度、搜狗、头条及其他可靠正文源。
- 仅搜索摘要推荐区命中、而标题与抓取正文都不含主题的页面必须被过滤。
- 一个渠道失败时保留其他渠道的精准结果，并返回可理解的渠道状态。
- 关键词改变立即使旧结果失效；页面显示本次实际查询和每条来源。

## Phases

- [x] 盘点现有搜索类型、网络策略、各引擎 HTML 形态与回归测试。
- [x] 先补充多渠道、精准二次校验和旧结果失效的失败回归用例。
- [x] 实现渠道适配、精准聚合/去重/排序和查询状态契约。
- [x] 更新创作页的渠道选择、来源标识、查询归属与忙碌反馈。
- [x] 运行专项测试、类型检查、构建、真实多渠道搜索和 Electron 验收。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Windows `rg` 对 `src/styles/features/*.css` 报文件名语法错误。 | 用未展开的 glob 同时查样式文件。 | 改用明确文件路径或对目录执行 `rg`，不重复原命令。 |
| 新增 3 个多渠道回归测试首轮失败：`searchWebSourcesDetailed is not a function`。 | 在实现前先运行渠道聚合、精准复核与故障隔离用例。 | 这是预期红测试；原有 23 个用例全通过，开始实现新入口。 |
| 底层首轮实现后 26 个用例中 3 个旧用例失败。 | 运行完整 `tests/research.test.ts`。 | 新增 3 用例已通过；调整单渠道候选配额、恢复百科优先级，并把旧“删除生平后缀”断言更新为完整查询契约。 |
| Electron IPC 静态测试读取 runner 超时基线时得到 19，测试仍期望 18。 | 联合运行 IPC 契约测试。 | 确认为当前脏工作区既有 `runner.test.ts` 基线漂移；搜索 IPC 白名单用例通过，本任务不修改无关 runner 测试。 |
| 搜狗精确标题结果最终跳到 `/antispider/`，UI 一度展示 IP/访问时间而非正文。 | Electron 真实“李在明”搜索截图。 | 抓取后拒绝搜索引擎反爬/验证中间页，并按同渠道标题去重；新增回归后重新实搜和截图通过。 |

---

# 2026-08-02 草稿模板画布与属性面板联动

Goal: 在草稿模板编辑器中点击画布上的主标题、副标题、图片、字幕等可编辑框时，右侧自动展开并滚动到对应属性面板，同时保持明确焦点和键盘可达性。

## Acceptance Criteria

- 点击画布中的可编辑框后，右侧对应折叠面板自动展开。
- 属性区滚动到该面板可见位置，不停留在上一个元素的参数上。
- 连续选择不同元素时定位稳定，不造成整页跳动或错误滚动容器移动。
- 原有表单编辑、画布拖拽和模板保存行为不受影响。

## Phases

- [x] 定位画布选择事件、属性面板折叠状态与实际滚动容器。
- [x] 添加联动行为与回归测试。
- [x] 完成类型检查、构建和 Electron 实机验收。

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| `ui-ux-pro-max` 的 `scripts` 指针解析到不存在的 `C:\Users\Administrator\src\ui-ux-pro-max\scripts`。 | 按技能要求执行设计系统查询。 | 无法运行本机技能脚本；继续采用技能文档中的选择反馈、焦点定位、键盘可达性和稳定布局规则。 |
| Electron 首轮编辑器截图报告“副标题”标签对比度 `3.87:1`。 | 将原列表态 QA 扩展到真实打开编辑器并选择副标题。 | 把深色标签底上的小字改为近白色，复验对比度失败为 0。 |
| Electron 媒体主题校验报告编辑画布 SHA-256 不一致。 | 先固定选区色，再保留临时截图做逐像素比较。 | 确认为主题化编辑标记和 GPU 渐变的 1 色阶差异；只对交互编辑画布跳过精确哈希，仍检查尺寸、非空像素和所有视觉/运行时指标。 |
