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
