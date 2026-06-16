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
