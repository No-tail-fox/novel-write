# 漫剧工作流项目源码核查

核查日期：2026-09-18。Star 来自本次 GitHub 搜索 API 快照；源码通过只读浅克隆固定到以下提交。只核查代码、文档与许可证，没有运行付费生成，因此不将项目演示当成画质、人物一致性或失败恢复的实测证明。

| 项目 | Star | 固定提交 | 当前许可 | 移植判断 |
| --- | ---: | --- | --- | --- |
| HBAI-Ltd/Toonflow-app | 15,737 | `e03cf590eb0cab63534a4040db9acb4ec95b42a6` | Apache 2.0 正文 + 产品分发商业限制补充协议 | 技术接近 Electron/TS，但不能按纯 Apache 任意复制进对外产品 |
| Forget-C/Jellyfish | 6,442 | `a9678194ddf2d9be3ccbe78d4287d87d5089e123` | Apache 2.0 | 最适合优先移植拆镜契约、资产引用与生成准备度检查；Python 实现需要转写或服务适配 |
| waooAI/waoowaoo | 14,127 | `6cbbe22cc6492159e0f649d507e4e21a9aec3074` | Elastic License 2.0 | 值得参考任务恢复、显式参考图角色与能力验证；移植须保留 ELv2 条款，不能直接当 MIT/Apache 依赖 |
| ArcReel/ArcReel | 5,015 | `200674feb06a9954a49a05181912bc0b06dcc16e` | AGPL-3.0 + NOTICE 第 7 条附加署名要求 | 成熟流程和状态机很有参考价值；只借鉴流程、协议边界和测试思路，不复制源码进 StoryDream |
| shuyu-labs/BigBanana-AI-Director | 2,232 | `ca3da0a430a6cd3c38b31d503596cc9b30a3db37` | BigBanana Community License 1.0，自定义非商业许可（非 OSI） | 可验证产品流程与九宫格/首尾帧交互；当前公开仓库没有产品源码，不存在可直接移植的实现 |
| chatfire-AI/huobao-drama | 未复核 | `575790acaad0d0ed5346bdbe5a202ac6a3d02ee0` | CC BY-NC-SA 4.0 | Agent 拆分和工具写库值得对照；非商业、署名、相同方式共享限制不适合作为 StoryDream 默认代码来源 |

这些项目是调用大模型的制作应用/工作流，不是新训练的图像或视频基础模型。它们共同收敛出的成熟链路是：**源文导入 → 资产定义抽取 → 分集 → 单集分场/分镜人工确认 → 角色/场景/道具定妆 → 分镜图/九宫格 → 图 + 提示词远程视频 → 配音/字幕 → 合成导出**。资产定义与定妆必须分开：前者解决身份和引用，后者生成可复用的视觉锚点。

在已核查的 ArcReel、Huobao、Toonflow 主数据与生产路径中，集可以直接拥有场/分镜；`Act` 并不是完整流水线成立所依赖的共同实体。StoryDream 若要支持三幕结构，应把它设计成可选分组或节拍元数据，而不是每个项目、每集都必须创建的层级。

## ArcReel：完整状态机证据强，但 AGPL 边界必须隔离

- [README](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/README.md) 和 [PRODUCT.md](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/PRODUCT.md) 明确把源文件、内容分析、角色/场景/道具、分集与结构化脚本、分镜图或视频单元、视频/音轨、成片或剪映草稿串成可审核、可局部重做的流程。这比首页演示更有用：它明确“自动产出默认可见、可改、可单独重做”，并区分脚本规划与正式脚本。
- [CONTEXT.md](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/CONTEXT.md) 定义内容确认、分集账本、角色/场景/道具资产、分镜、视频单元和产物时效；[tool_runtime.py](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/server/tool_runtime.py) 暴露 `plan_episodes`、`generate_episode_script`、`patch_episode_script`、`complete_asset_inventory` 等受校验工具。可借鉴的是阶段状态、稳定 ID、修订冲突和生成前准入思想，不是 Python 文件本身。
- [前端 API 契约](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/frontend/src/api.ts) 有显式的 script plan 内容确认；[GridStoryboardBar.tsx](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/frontend/src/components/shared/GridStoryboardBar.tsx) 与分镜模板表明九宫格属于镜头视觉方案，不是剧本结构层。其核心骨架直接使用 `segments / scenes / shots / video_units`，没有要求独立 `Act` 才能继续生产。
- [PRODUCT.md](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/PRODUCT.md) 还明确：只有已记录供应商任务号且供应商支持续查的视频任务才自动恢复，其余中断任务等待人工重试，以免二次计费。StoryDream 应采用同样保守的提交/恢复边界。

许可边界：[LICENSE](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/LICENSE) 是 AGPL-3.0；[NOTICE](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/NOTICE) 根据第 7 条要求修改版界面保留 `Powered by ArcReel` 及仓库链接，并将名称和标识排除在 AGPL 授权外。StoryDream 本轮只提炼通用流程和独立实现需求，不复制 ArcReel 源码、提示词、界面或文案；若未来确需代码级复用，必须先单独评估 AGPL 对整个分发/网络服务形态的影响。

## BigBanana：产品链路清晰，当前公开仓库无产品源码

- [README](https://github.com/shuyu-labs/BigBanana-AI-Director/blob/ca3da0a430a6cd3c38b31d503596cc9b30a3db37/README.md) 展示“整篇小说导入和分集 → 叙事规划 → 角色/场景/道具一致性资产 → 镜头九宫格或首尾帧 → 图生视频/插值 → CutOS 粗剪与成片导出”的阶段，并强调全自动计划仍可逐镜选择九宫格或首尾帧。它能佐证交互顺序和人工决策点，不能证明画质、身份一致性或失败恢复水平。
- 固定提交实际只有 README、多语言说明、许可证、截图与 `docker-compose.yaml`，共 31 个受 Git 跟踪文件；公开部署依赖官方 Docker 镜像，仓库没有前后端产品源码。因此无法核查其模型请求、任务幂等、数据结构或九宫格裁切实现，也没有可移植源码。
- README 底部写“CC BY-NC-SA 4.0”，但同一提交的 [LICENSE](https://github.com/shuyu-labs/BigBanana-AI-Director/blob/ca3da0a430a6cd3c38b31d503596cc9b30a3db37/LICENSE) 实际是 `BigBanana Community License 1.0`，并明确声明不是 OSI 批准的开源许可。它只授权个人、教育、研究、测试等非商业使用；商业活动、企业内部生产、付费服务、SaaS、OEM 和白标均需书面授权。许可判断以英文 LICENSE 原文为准，不能因 README 或可拉取镜像就视为可商用开源。

## Jellyfish：优先借鉴的模块

1. **分镜保留原文证据和实体身份。** [script_processing.py](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/schemas/skills/script_processing.py) 定义 `ShotDivision`（行号、原文摘录）、全局 `EntityEntry`（稳定 ID、别名、证据、出场镜头、变体），以及分镜对角色/场景/道具的引用。[script_divider_agent.py](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/chains/agents/script_divider_agent.py) 对模型的列表、包装对象、字段别名做正规化再 Pydantic 验证。[entity_merger_agent.py](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/chains/agents/entity_merger_agent.py) 支持历史实体库、上一次合并、人工冲突解决意见。
   - 对 StoryDream 的价值：结构化拆镜与“原文 → 镜头 → 角色资产”关联，比单段自由文本提示词更便于检查漏台词、角色混淆和局部重做。
   - 移植建议：转为当前 TypeScript/Zod 契约；稳定 ID 在应用中分配和校验，避免只依赖 LLM“尽量保持 ID”。源码只规定起止行各自大于零，没有自动保证不倒置、不重叠和完整覆盖，这些应补成应用级校验。
2. **多视角参考图以确定顺序传递。** [image_task_references.py](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/services/studio/image_task_references.py) 按资产条目顺序、指定视角顺序选择图片，并解析存储文件到模型输入。基础资产、服装、人物与镜头的引用解耦，适合保留角色外观并允许剧情变体。
   - 移植建议：保存 `assetId + variantId + imageId + role + order`，生成请求保存引用快照，提示词中的“图 1 / 图 2”与实际附件一一对应。不能仅用“保持一致”文本代替图片条件，也不能声称多图输入必然保证人物一致。
3. **生成前能说明具体缺什么。** [shot_video_readiness.py](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/services/studio/shot_video_readiness.py) 聚合候选资产/对白确认、镜头时长、提示词、参考帧、模型/供应商配置、同镜头已有任务。[build_context.py](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/services/studio/generation/video/build_context.py) 明确规定首帧、尾帧、关键帧等模式与图片数量。
   - 移植建议：将 readiness 规则放共享业务层，同时用于按钮状态和提交入口，减少到了付费 API 才发现参数不支持的失败。
4. **任务中心有持久化，但不能据此认定具备无重复计费的断点续跑。** [execute_task.py](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/tasks/execute_task.py) 用 Celery 执行业务 task ID，记录 executor ID、支持撤销。[video_generation_tasks.py](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/core/tasks/video_generation_tasks.py) 的 `run()` 先创建供应商任务，再用实例变量中的任务 ID 轮询；已读路径没有显示在首次提交后立即持久化远端 ID、重启后复用远端任务的机制。不要原样拿它解决断点恢复。

部署成本：React 18/Vite/Ant Design，Python 3.11+/FastAPI/LangChain/SQLAlchemy/Celery；[Compose](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/deploy/compose/docker-compose.yml) 包含 MySQL、Redis、RustFS、后端、Celery Worker、前端以及初始化服务。整套塞进 Electron 会增加运行和维护负担；抽取业务规则更合适。模型调用成本另外支付，项目自身不是本地 GPU 模型。

许可：[LICENSE](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/LICENSE) 是 Apache 2.0 正文；实际复制/转写派生模块时保留许可、来源和改动说明，并检查相关第三方依赖。

## Toonflow：资产驱动的制作流程可借鉴，许可证不能只看徽章

- [productionAgent/tools.ts](https://github.com/HBAI-Ltd/Toonflow-app/blob/e03cf590eb0cab63534a4040db9acb4ec95b42a6/src/agents/productionAgent/tools.ts) 用 Zod 定义基础/衍生资产、镜头时长、关联资产 ID；[productionAgent/index.ts](https://github.com/HBAI-Ltd/Toonflow-app/blob/e03cf590eb0cab63534a4040db9acb4ec95b42a6/src/agents/productionAgent/index.ts) 调度决策与制作子 Agent。值得借鉴的是“资产先确定，再拆镜，再用资产生成画面”的阶段划分。
- 后续 Agent 实现把编剧和制作进一步分工：[scriptAgent/index.ts](https://github.com/HBAI-Ltd/Toonflow-app/blob/e03cf590eb0cab63534a4040db9acb4ec95b42a6/src/agents/scriptAgent/index.ts) 由决策 Agent 调用故事骨架、改编策略、分集剧本与监督子 Agent；[productionAgent/index.ts](https://github.com/HBAI-Ltd/Toonflow-app/blob/e03cf590eb0cab63534a4040db9acb4ec95b42a6/src/agents/productionAgent/index.ts) 再调度衍生资产分析/生成、导演规划和分镜生成。这个“决策层 + 专用执行 Agent + 监督”的组织方式可以参考，但其 XML 工作区协议和记忆实现属于项目内约定，不能当作 StoryDream 必需架构。
- [production_execution_storyboard_table.md](https://github.com/HBAI-Ltd/Toonflow-app/blob/e03cf590eb0cab63534a4040db9acb4ec95b42a6/data/skills/production_execution_storyboard_table.md) 规定台词保真、时长预算、人物在场、相邻镜头动作/空间衔接。它是提示词规则，不是已验证的程序校验，不能直接作为质量保证。
- [batchGenerateImage.ts](https://github.com/HBAI-Ltd/Toonflow-app/blob/e03cf590eb0cab63534a4040db9acb4ec95b42a6/src/routes/production/storyboard/batchGenerateImage.ts) 按关联顺序解析资产参考图并控制图片生成并发，证明其一致性手段包含实际参考图输入。
- [batchGenerateVideo.ts](https://github.com/HBAI-Ltd/Toonflow-app/blob/e03cf590eb0cab63534a4040db9acb4ec95b42a6/src/routes/production/workbench/batchGenerateVideo.ts) 插入“生成中”记录后启动后台 Promise，成功/失败更新状态；[vm.ts](https://github.com/HBAI-Ltd/Toonflow-app/blob/e03cf590eb0cab63534a4040db9acb4ec95b42a6/src/utils/vm.ts) 的轮询遇异常直接退出。这些已读路径不是持久化工作流恢复方案。
- 技术：TypeScript、Electron 40、Express、SQLite/Knex、AI SDK 6，接近桌面技术栈，但服务、数据库、前端通信用自己的约定，不能直接整体替换 StoryDream 的生成模块。

**实际限制**：[LICENSE](https://github.com/HBAI-Ltd/Toonflow-app/blob/e03cf590eb0cab63534a4040db9acb4ec95b42a6/LICENSE) 的 Apache 正文后附补充协议：软件或衍生版本作为产品提供给两个及以上独立第三方主体，须事先取得书面商业授权；不得删除/修改 Toonflow 标识和版权信息；团队内部二次开发等列为免费。GitHub API 与 package.json 标注 Apache-2.0 没有体现这些额外条件。对外产品不应在未解决许可兼容问题时整段搬源码或提示词；可以独立实现通用制作流程。

## Huobao：四个 Agent 串联真实写库工具

- [README](https://github.com/chatfire-AI/huobao-drama/blob/575790acaad0d0ed5346bdbe5a202ac6a3d02ee0/README.md) 给出的实作顺序是源小说改写为按集、场和角色标注的拍摄剧本，随后抽取角色/场景/道具并生成参考图，再拆分镜、编辑视频提示词、批量生成视频，最后用 FFmpeg 合并和导出。它支持这一报告的成熟流程结论，但当前流程没有独立的分镜图/九宫格确认阶段，不能据此证明所有项目都应跳过静态分镜。
- [agents/index.ts](https://github.com/chatfire-AI/huobao-drama/blob/575790acaad0d0ed5346bdbe5a202ac6a3d02ee0/backend/src/agents/index.ts) 注册 `script_rewriter`、`extractor`、`storyboard_breaker`、`prompt_generator` 四个 Mastra Agent，并绑定读取/保存工具。抽取 Agent 先读取已有资产再按名称或地点+时段去重；分镜 Agent 用已保存的资产 ID 绑定场景、角色和道具；提示词 Agent 只更新目标提示词字段。这种“LLM 负责决策，工具负责受约束写入”的边界值得独立实现。
- 同一实现的分镜 Agent 把每个视频任务定义为 8–15 秒的分镜段落，内部可包含 2–4 个子镜头，并会先清空旧分镜再分批保存全集。时长、每段子镜头数和整集替换是 Huobao 当前生产策略，不应直接成为 StoryDream 的通用规则；尤其重生成前必须保护人工修改和既有付费媒体。

许可：[LICENSE](https://github.com/chatfire-AI/huobao-drama/blob/575790acaad0d0ed5346bdbe5a202ac6a3d02ee0/LICENSE) 是 CC BY-NC-SA 4.0，包含非商业、署名和相同方式共享条件。即使仓库包含完整 TypeScript 源码，也只适合作为流程与 Agent 边界对照；商业 StoryDream 不应默认复制这些实现。

## waoowaoo：最值得研究执行恢复与能力契约

- **参考输入角色清晰。** [reference-images.ts](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/src/lib/video-generation/reference-images.ts) 区分 `reference_image / first_frame / last_frame`，去重普通参考图，拒绝重复首/尾帧、尾帧无首帧、普通参考图混用首尾帧等情况；不会因为传了一张图就自动当成首帧。[generation-reference-policy.ts](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/src/lib/ai-registry/generation-reference-policy.ts) 验证模型支持的模式、各种参考数量、总数和参考音频对视觉输入的要求。这是小而明确的领域模块，适合在 StoryDream 独立实现同类规则。
- **创作规划与机器 schema 配合。** [output-registry.ts](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/src/lib/creative-skills/output-registry.ts) 定义结构化输出类型；[asset-development](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/src/lib/creative-skills/skills/asset-development/SKILL.md) 区分稳定身份与镜头瞬时动作；[video-direction](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/src/lib/creative-skills/skills/video-direction/SKILL.md) 强調镜头入口/出口状态、对白时间线和参考资源身份。可借鉴其数据分工，质量仍依赖实际生成验证。
- **区分基础设施重试与新业务尝试。** [workflows/task.ts](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/src/lib/temporal/workflows/task.ts) 使用 Temporal Activity、心跳、指数退避、取消补偿；基础设施重试复用 attempt ID，新业务尝试需要归类后允许重试。[activities/task.ts](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/src/lib/temporal/activities/task.ts) 开始执行前查结果 checkpoint；[execution-checkpoint.ts](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/src/lib/task/execution-checkpoint.ts) 使用任务 ID、步骤 key、输入指纹与唯一索引避免互相覆盖；[retry-policy.ts](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/src/lib/task/retry-policy.ts) 仅允许标记为 safe 的任务重放。
  - 对 StoryDream：可用现有本地持久化实现同类任务状态机。关键是提交前记录输入指纹，远端返回 ID 后立即落盘，把“查询已有任务/下载结果”与“重新付费创建”分离；不必把整个 Temporal 集群引入桌面应用。
  - 限制：本次只核查上述执行与 checkpoint 路径，未逐个证明所有供应商在“请求已到达远端但本地未收到 ID”时均幂等；不能承诺绝不会重复计费。

部署成本：Next.js 16、React 19、MySQL/Prisma、Temporal、Redis、MinIO、FFmpeg；自托管容器还有 HTTPS 入口和 runtime 服务，明显重于本地 Electron 功能模块。当前 README 推荐 OpenRouter 用户密钥，不能据此假设无需适配即可使用现有中转渠道。

**NOASSERTION 已查明**：[LICENSE](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/LICENSE) 明确为 Elastic License 2.0，并非没有许可证。允许在条款内使用、修改、分发；禁止将其作为可访问实质功能的托管/代管服务提供给第三方，禁止规避许可功能、去除许可/版权声明。README 说明从 `v0.5.0-beta.1` 起切换为该许可、早期版本保留原许可。若想用旧版，必须固定旧提交重新核查，不能将当前源码套上旧许可证。

## 实施优先级

1. 优先从 Jellyfish 的 Apache 许可模块抽取结构化拆镜、资产身份/变体引用、参考帧准备度规则，适配 StoryDream 现有模型调用和存储；避免引入另一套前后端服务。
2. 按“定义抽取 → 分集 → 单集分场/分镜确认 → 定妆 → 分镜图/九宫格 → 远程视频 → 配音字幕 → 合成导出”实现阶段状态；`Act` 仅作可选分组，不进入最小必需层级。
3. 独立实现显式参考图角色与模型能力校验；没有能力时在提交前明确指出，不静默丢参考图或改模式。
4. 参考 waoowaoo 的执行原理补任务指纹、远端 ID、checkpoint、恢复与受控重试；最后用模拟断网/重启与假供应商验证，再用少量真实生成验证效果和成本。
5. ArcReel、BigBanana、Huobao 和 Toonflow 用于流程/Agent 对标；分别受 AGPL、自定义非商业许可、CC BY-NC-SA 和 Toonflow 补充协议约束，未单独完成许可决策前不复制其源码或提示词。

原始材料只保存在 Windows TEMP 的 `storydream-comic-research-20260918` 与 `storydream-comic-flow-research`，未将第三方实现复制到产品源文件。
