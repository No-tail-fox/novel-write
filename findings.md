# Findings

## Current Project

- 当前分支已切到 `codex/storybound-cn-full-replica`。
- 项目是 React + Vite + Electron + sql.js，主 UI 在 `src/main.tsx`，主要样式在 `src/styles.css`，本地数据库在 `src/shared/storage.ts`。
- 现有代码已经包含旧 Storybound parity 工作：语音实验室、画图实验室、音乐 MV、爆款拆解、提示词模板、草稿模板、设置、账号和激活页。
- 当前 `ShellView` 已有 `new-task`、`queue`、`history`、`task-detail`、`image-lab`、`voice-lab`、`music-mv`、`viral-analyzer`、`prompt-templates`、`draft-templates`、`settings`、`account`、`activation`。
- 终端显示中文时会出现 mojibake，但 Node 读取确认文件内存在真实中文，例如 `新建任务`、`任务队列`、`画图实验室`。

## Reference App

- 参考应用目录：`E:\Storybound`。
- 参考可执行文件：`storybound.exe`、`draft-generator.exe`、`uninstall.exe`。
- 参考资源：`resources/default-bgm.mp3`。
- 参考本地配置：`C:\Users\Administrator\AppData\Local\com.dudumd.storybound\config.json`。
- 参考配置内容：
  - LLM: custom/openai protocol, `base_url: https://input.codes`, `model: gpt-5.5`。
  - Image: `gpt_image` 为当前 provider；即梦模型 `jimeng-4.5`；自定义生图默认模型 `gpt-image-1`。
  - TTS: `volcengine` 当前 provider；火山默认 speaker `zh_male_dongfanghaoran_moon_bigtts`；MiniMax 默认模型 `speech-2.8-hd`。
  - Jianying: `draft_path` 字段存在但为空。
  - UI: dark theme。

## Reference Database

- 数据库：`C:\Users\Administrator\AppData\Local\com.dudumd.storybound\data.db`。
- 表结构：
  - `tasks` 1 row。
  - `task_events` 25 rows。
  - `draft_templates` 4 rows。
  - `user_prompt_templates` 0 rows。
  - `playground_jobs` 0 rows。
  - `minimax_clone_voices` 0 rows。
  - `credits_transactions` 0 rows。
  - `custom_styles` 0 rows。
  - `custom_cover_templates` 0 rows。
- `tasks` 参考字段强调 Storybound 主工作流：`material_source`、`task_type`、`pipeline_step`、`pipeline_data`、`target_length`、`target_scenes`、`script_format`、`podcast_*`、`video_intro_*`、`cover_image_mode`、`cover_template_id`。
- `user_prompt_templates` 参考字段包含：`step1_rewrite_system_prompt`、`step1_metadata_system_prompt`、`step3_system_prompt`、`style_id`、`image_seed_pools_json`、`needs_character_card`、`step3_skeleton_modules_json`、`reference_kind`、市场分享/统计字段。
- 当前项目的数据层已经有对应超集或近似实体，但缺少参考表名/语义的显式 playground job 与 credits 表名兼容层。

## UI Gap

- 当前壳层功能已经丰富，但主线/次级区分不够明确；爆款拆解和扩展模块与 Storybound 主工作流同级。
- 计划要求重新变成 Storybound-first：新建任务、任务队列、历史任务、实验室、模板、设置、账户、激活为主；爆款拆解等扩展放次级区。
- 顶部需要恢复试用/激活条、积分/账户入口、最近任务和可见中文状态。
- 页面需要更好看，但仍保持工具型：低圆角、密集表单、状态芯片、双栏设置面板、可扫描列表。

## Testing Direction

- 先新增/改造文件级契约测试，断言所有主要入口、标题、按钮、空态和流水线状态为中文。
- 再跑现有 runtime tests，确保三轮改写、自评、主角档案、暂停/续跑、草稿输出不被 UI 重排破坏。
