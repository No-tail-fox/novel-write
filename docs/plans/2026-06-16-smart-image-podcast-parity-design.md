# Storybound 智慧生图与双人播客补齐设计

## 目标

本轮补齐参考软件中已经暴露、但当前项目只做到字段或入口的能力：

- 新建任务的视频形态：旁白视频 / 双人播客。
- 双人播客的配图方式：按分镜配图 / 单图封面。
- 双人播客的主播组合：咔仔 x 大壹、刘飞 x 潇磊。
- 封面、播客封面、单图封面进入真实任务产物。
- 画图实验室增加“智慧生图”模式，支持智能封面、播客封面、多参考图编辑、异步轮询。

本轮不做提示词市场、分享、下载、评分，也不做积分账号、订阅、真实激活。

## 产品行为

### 新建任务

新建任务增加“视频形态”区域：

- 旁白视频：默认形态，使用单人配音，继续显示普通配音模型、音色和语速。
- 双人播客：生成对谈式内容。普通配音模型、音色和语速隐藏，改由主播组合决定默认双人音色。

双人播客下显示：

- 配图方式：
  - 按分镜配图：每轮对话一张图。
  - 单图封面：一张主题封面铺满全程。
- 主播组合：
  - 咔仔 x 大壹（默认）
  - 刘飞 x 潇磊

任务创建时写入：

- `videoForm`
- `podcastImageMode`
- `podcastSpeakers`
- `scriptFormat`
- `targetLength`
- `targetScenes`
- `coverImageMode`
- `coverTemplateId`

### 任务运行

旁白视频沿用现有流水线。

双人播客调整流水线输入：

- Step 1 改写阶段要求输出一问一答式口播稿。
- Step 2 分镜阶段按对话轮次拆分。
- Step 3 出图提示词阶段带入播客封面 / 双主播视觉要求。
- Step 4 生图阶段：
  - `podcastImageMode=multi`：按分镜生成图片。
  - `podcastImageMode=single`：只生成或复用一张封面图，并把它映射给所有场景。

封面生成：

- `coverImageMode=off`：只生成标题/标签等元数据。
- `coverImageMode=auto` 或 `manual`：在内容产物之后生成 `cover-image.png`，写入 artifact。
- `coverTemplateId=podcast-cover` 时使用播客封面提示词；其他模板使用对应 `customCoverTemplates` 的方向、构图和标题布局字段。

### 画图实验室智慧生图

画图实验室增加“智慧生图”模式，并保留原有文生图 / 图像参考入口。

智慧生图任务类型：

- 智能封面
- 播客封面
- 视频封面
- 多参考图编辑

参考图规则：

- 多参考图编辑至少 1 张参考图，最多 10 张。
- 普通文生图不强制参考图。
- 参考图会传给支持编辑的 GPT Image / OpenAI 兼容接口。

接口策略：

- 同步生成：调用 `/images/generations` 或 `/images/edits`。
- 异步生成：当 provider 配置 `asyncMode=true` 时，提交到 `?async=true`，再轮询任务结果。

记录：

- 继续写 `image_lab_records`。
- 同步写兼容表 `playground_jobs`，记录 prompt、style、provider、ratio、model、reference image paths、upstream task id 和状态。

## 技术切分

- 类型层：扩展 `Task`、`CreateTaskInput`、`ImageLabGenerateInput`、`ImageLabRecord`、`PipelineArtifact`。
- 存储层：补 `video_form`、`video_intro` 字段映射，扩展 image lab / playground 记录。
- 媒体层：新增 OpenAI-compatible image generation/edit request builder 和 async poll helper。
- 运行层：补封面产物生成、单图封面复用、双人播客 prompt context。
- UI 层：新建任务补截图中的视频形态区域；画图实验室补智慧生图模式。
- 测试：先写 storage / runner / media-providers / image-lab / product-shell-ui 合约测试，再实现。

## 风险与边界

- 参考软件内部 prompt 无法完全反编译，本轮使用本地 `customCoverTemplates` 和清晰规则复刻行为。
- 不接账号积分，因此不会实现“积分不足”拦截。
- 不接提示词市场，因此 `user_prompt_templates` 的 market 字段继续作为兼容数据。
