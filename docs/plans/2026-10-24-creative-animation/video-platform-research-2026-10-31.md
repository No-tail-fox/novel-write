# 自动生成视频产品路线调研

核查日期：2026-10-31（Asia/Shanghai）。范围：公开官方仓库、README、核心流水线源码，以及 StoryDream 现有调度和 Lemo 接入。未安装第三方项目，未运行其真实付费生成，不把 README 宣传或 Star 当成稳定性/画质实测结论。

## 结论

优先参考 Pixelle-Video 的成片流水线、Toonflow 的项目/资产工作区、ViMax 的角色与镜头规划。MoneyPrinterTurbo 适合参考从主题到成片的工程拆分。它们不是 Lemo 动画效果的等价替换。

不建议继续整仓叠加第四套独立生产流程。保留 StoryDream 现有调度、回执、缓存、配音、字幕和合成能力，改进创作任务的阶段划分与输入准备，使不同画面能力可以在同一项目中组合。

## 仓库与热度快照

以下精确 Star 数来自本机抓取 GitHub 公开页面中的 stargazerCount；API 返回限流，未把失败响应当成数据。

| 仓库 | Star | 实际路线 | 对我们的价值与边界 |
| --- | ---: | --- | --- |
| harry0703/MoneyPrinterTurbo | 136494 | 文案、检索词、配音、字幕、素材、最终合成 | 核心调度是明确分阶段的流水线；当前素材源也包括 AI 图像/视频，并非只会素材拼接；不能据此推定能做 Lemo 级定制动画 |
| ATH-MaaS/Pixelle-Video | 29585 | 解说词、画面规划、分镜、逐镜音画、HTML 模板、合成 | 最接近“多种能力组成一个自动成片软件”；固定模板与任意生成代码的风险不同 |
| HBAI-Ltd/Toonflow-app | 19979 | 无限画布、剧本/分镜、角色场景资产、图片和视频节点、Agent | 适合学习可见、可编辑的中间产物；官方入门流程到预览/下载后继续处理，不能宣传为已验证的一键完整配音字幕成片 |
| chatfire-AI/huobao-drama | 16786 | 剧本/资产/分镜/视频、统一生成任务生命周期 | 适合对照持久化任务、供应商适配、轮询和结果下载；不能照搬其降级或重试语义 |
| HKUDS/ViMax | 12807 | 故事、角色参考、剧本、镜头规划、图像候选、视频与组装 | 值得研究镜头一致性和生成前规划；多轮、多候选增加调用量，需要预算与验收 |

另核查 NarratoAI：公开页面约 11.6k Star，重点是已有影视素材的理解、解说与自动剪辑，不是从零创造任意动画。
另核查 waoowaoo：公开页面约 14.7k Star；当前 README 明确为 preview，且当前预览版不含音乐和配音控件。不能把仓库简介中的“全流程工业级”直接当成功能验收。

## 源码揭示的分工

### MoneyPrinterTurbo

app/services/task.py 的 _run_pipeline 明确依次处理文案、检索词、音频、字幕、素材和最终视频，并提供 stop_at 中间产物。当前 README 也有 AI Agent/Skill 启动方式，但这不改变视频生产服务本身的分阶段实现。不能用“有 Agent / 没 Agent”简单二分。

### Pixelle-Video

pixelle_video/pipelines/standard.py 继承 LinearVideoPipeline，具有 setup_environment、generate_content、determine_title、plan_visuals、initialize_storyboard、produce_assets、post_production、finalize。StoryboardFrame 保存每镜信息，FrameProcessor 负责音画及片段；最终拼接片段并加入 BGM、保存结果。

这里的 HTML 主要充当可控构图/模板能力，不是要求模型一次输出整片任意 JS。它证明 HTML 路线本身不是问题，但固定图文模板也不能冒充复杂原创动画。

### Toonflow

官方 docs/development.md 将节点、工具、技能、提供方分别作为扩展类型；Agent 使用 Pi Agent SDK。它是“创作工作区 + 可见资产 + 可执行能力”的组合，不是只给一个模型超长提示词。当前技术栈为 Bun/Vue/Electrobun，不应误认为可以无缝替换 StoryDream 的 Electron/React。

### 火宝短剧

backend/src/services/generation.ts 明确共用 sys_task 生命周期：创建、适配器构建请求、同步完成或异步轮询、下载落盘、回写业务数据。代码区分提交不确定、原任务恢复和确认后重新生成。我们的未知付费请求保护应保留，不应为“自动”而盲目重发。

### ViMax

Idea2VideoPipeline 将编剧、角色提取、人物参考图和 Script2VideoPipeline 分开。角色/参考数据保存到工作目录并复用；Script2VideoPipeline 中有图像候选和 BestImageSelector。其价值在于视觉计划和参考约束，不是多 Agent 的名称本身。

## StoryDream 现有代码核查

- I:\opc\electron\vox-production-service.ts：已经存在 checkpoint、reconcile、unknown 状态和受控 retry-unknown。不能声称项目完全没有调度、恢复或状态模型，也不建议重写。
- I:\opc\src\shared\lemo-upstream-graph.ts：当前已先处理配音/时序，再进行上游创作轮次，最后 finalize/render/verify。因此“字幕配音与画面分工”部分已经存在。
- I:\opc\electron\lemo-upstream-agent.ts：当前六工具循环要求模型自行读取风格资料、每轮一个动作；禁用网络/shell/npm/Node；画面资料和工具范围受限。禁止任意网络/shell本身是安全边界，不应直接移除；需要的是程序预装资料与受控素材工具。
- I:\opc\.artifacts\lemo-upstream-production\live-rain-garden-20261030\resume-audit-20261030\live-resume-result.json：最近实测第7轮 read_file、第8轮 list_files、第9轮 ECONNRESET/unknown，源码数仍为0。说明此例尚未进入有效画面交付，不是已成功生成但审美稍差。
- 连接中断、空响应、协议/工具能力兼容属于另一个必须独立解决的层，换工作流或 Agent 不会自动消除这些问题。

## 建议架构（尚未实施）

统一项目/素材库/时间线/任务状态
→ 创意简报与全片风格约定
→ 解说/分镜/镜头时长
→ 角色、场景与关键帧参考
→ 按镜头或连贯场景组选择画面实现
→ 实际渲染、技术检查、视觉检查和局部修复
→ 程序统一字幕/配音/配乐/合成
→ 可编辑工程 + 最终视频。

画面实现可包含：Vox 拼贴、HTML/Lemo 动效、图生视频和已有素材剪辑。选择应基于内容目标，不让用户反复选择底层技术。共享全片色彩、字体、人物设定和镜头节奏，避免同片风格割裂。

代码动画可以按连续场景组创作，不能为拆分而破坏跨镜连续动作。模型代码修复只改当前生成工程；开发过程中发现宿主缺陷才修改宿主程序。样片和验收门槛保持不变。

程序负责已知资料装配、资源准备、任务执行、状态与合成；AI负责创意选择、镜头设计、必要代码生成和有证据的局部修复。默认自动前进，只有偏好决策、质量不达标或费用不确定需要用户介入。未知付费结果必须继续保护。

## 下一步应验证而非承诺

选择同一真实主题，分别验证：模板/拼贴成片、Lemo连续动效、生成式视频镜头。统一记录完整成功率、人工介入次数、费用、耗时、音画对齐、视觉质量和修改后局部重做范围。缺少任一必需产物不算通过。未经新的计费授权，不重发旧第九轮未知请求。

本次仅形成调研结果；没有安装新框架、改应用代码、修改样片、触发模型计费或宣称全流程跑通。

## 一手来源

- https://github.com/harry0703/MoneyPrinterTurbo
- https://raw.githubusercontent.com/harry0703/MoneyPrinterTurbo/main/app/services/task.py
- https://github.com/ATH-MaaS/Pixelle-Video
- https://raw.githubusercontent.com/ATH-MaaS/Pixelle-Video/main/pixelle_video/pipelines/standard.py
- https://raw.githubusercontent.com/ATH-MaaS/Pixelle-Video/main/pixelle_video/service.py
- https://github.com/HBAI-Ltd/Toonflow-app
- https://raw.githubusercontent.com/HBAI-Ltd/Toonflow-app/master/docs/development.md
- https://github.com/chatfire-AI/huobao-drama
- https://raw.githubusercontent.com/chatfire-AI/huobao-drama/master/backend/src/services/generation.ts
- https://github.com/HKUDS/ViMax
- https://raw.githubusercontent.com/HKUDS/ViMax/main/pipelines/idea2video_pipeline.py
- https://raw.githubusercontent.com/HKUDS/ViMax/main/pipelines/script2video_pipeline.py
- https://github.com/linyqh/NarratoAI
- https://github.com/waooAI/waoowaoo

证据快照：I:\opc\.artifacts\video-architecture-research-20261031。远程仓库可能继续更新；本记录不代替版本锁定、许可证审查或实际生成验收。