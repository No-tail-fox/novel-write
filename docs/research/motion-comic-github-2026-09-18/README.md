# StoryDream AI 漫剧：GitHub 对标与移植建议

调研日期：2026-09-18。结论依据当前工作树、GitHub 实时 star、固定 commit 的 README / LICENSE / 源码；未运行付费模型或下载模型权重。Star 表示社区关注度，不代表生成质量排名。

**可以移植。首选 shuohao-skills 的编剧/分镜校验和 Jellyfish 的镜头生成逻辑；视频大模型走服务接入。** StoryDream 已有素材版本、角色参考图、逐句配音、队列和成片导出，适合在现有结构上补齐生成能力。

综合 ArcReel、BigBanana、Huobao、Toonflow、Jellyfish 与 shuohao 的实现/文档，成熟产品的主流程已经比较稳定：**源文导入 → 资产定义抽取 → 分集 → 单集分场/分镜并由人工确认 → 角色/场景/道具定妆 → 分镜图或九宫格 → 分镜图 + 视频提示词提交远程视频模型 → 配音/字幕 → 合成导出**。这里的“资产定义抽取”只建立角色、场景、道具及稳定引用，“定妆”才产生后续生成要用的视觉参考图；二者不应合并成一次不可审阅的黑盒生成。

`Act`（幕）可作为长剧本的可选分组、节奏标签或导航视图，但不是这些成熟项目都具备的独立必选实体。StoryDream 的核心持久化层级保持“项目 → 集 → 场/镜头”即可；需要三幕结构时，可把 `actId`/节拍区间作为可选元数据或派生视图，不能让未分幕阻断分场、分镜和生成。

## 1. 当前漫剧究竟完成到哪一步

| 环节 | 代码核实的现状 | 对成片的影响 |
| --- | --- | --- |
| 剧情与分镜 | 新项目固定两角色、三场六镜；续集复制上一集结构。已有 LLM 文案辅助主要润色设定 | 输入不同故事，未真正得到按剧情生成的角色、对白和分镜 |
| 角色一致性 | 真正向参考图编辑接口传多张角色/场景/道具图，并固定参考版本 | 有基础；“身份锁”仍是提示词，seed 也只作为文字，没有数值 seed/LoRA/embedding 控制 |
| 镜头图片 | 已真实调用生图，检查输入指纹，避免旧回包覆盖新编辑 | 可以直接承接更完整的 AI 分镜 |
| 角色动作视频 | 有 motionPrompt、尾帧、videoJobId 字段，但漫剧页面没有视频生成回调；IPC 仅接受 VOX | 尚未形成漫剧图生视频闭环 |
| 当前动态效果 | 漫剧渲染读取首帧并创建一个 depth=0 的图层，做整体平移/缩放 | 不能等同人物动作、口型动画或真实分层视差 |
| 配音与字幕 | 已有角色逐句 TTS、实测时长、独立音轨和字幕数据；emotion/voiceNotes 未传入 TTS | 可复用整条音频管线，补充情绪和参考音色即可；自动强制对齐尚未接入 |
| 调度与检查 | 有 DAG、失败补跑、并发、持久化和技术质检 | 无需整体替换队列；人物身份连续性仍需人工复核 |

本地定位：

- [固定首集模板](/I:/opc/src/shared/motion-comic.ts:514)、[创建入口](/I:/opc/src/shared/storage.ts:2588)、[续集复制](/I:/opc/src/shared/motion-comic.ts:676)。
- [参考图生成](/I:/opc/src/features/motion-comic/MotionComicPage.tsx:704)、[seed 仅进入提示词](/I:/opc/src/features/motion-comic/motion-comic-consistency.ts:83)。
- [仅 VOX 可生成视频的限制](/I:/opc/electron/main.ts:2827)、[漫剧单图层渲染](/I:/opc/src/shared/director-render.ts:644)。
- [对白输入](/I:/opc/src/shared/motion-comic-dialogue.ts:18)、[配音生成与回写](/I:/opc/src/features/director-desk/director-generation.ts:713)、[批量队列](/I:/opc/src/features/director-desk/director-batch.ts:95)。

## 2. 高星同类应用与工作流

以下项目是应用/编排工程或制作工具，自身都不是视频基础模型。Star 为当天分批查询的快照，因此固定提交和许可正文比排名更重要；shuohao 采用最后复核值 3,537。

| 项目 | Star | 最有用的能力 | 是否适合移植 |
| --- | ---: | --- | --- |
| [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app) | 15,737 | 小说到剧本、角色资产、分镜与视频的整体工作流 | 适合对标。当前 LICENSE 有 Apache 之外的商业分发和品牌补充，不能按纯 Apache 项目处理 |
| [waoowaoo](https://github.com/waooAI/waoowaoo) | 14,127 | 影视生产步骤、任务与资源组织 | 适合对标。当前 Elastic License 2.0 对向第三方提供托管/代管实质功能有限制，不作默认移植底座 |
| [Jellyfish](https://github.com/Forget-C/Jellyfish) | 6,442 | 剧本拆解、资产实体、动作节拍、跨镜头上下文、视频准备度检查 | **优先复用其契约与生成逻辑**。标准 Apache-2.0；Python 服务需转换为 TS 或独立服务，不能把文件直接放入 React 就运行 |
| [ArcReel](https://github.com/ArcReel/ArcReel) | 5,015 | 分集账本、内容确认、资产定妆、分镜/视频、配音与剪映导出的完整生产状态 | **只借鉴流程和独立实现思路**。固定提交为 `200674feb06a9954a49a05181912bc0b06dcc16e`，AGPL-3.0 且 NOTICE 有界面署名附加条款，不复制源码进 StoryDream |
| [shuohao-skills](https://github.com/eternityspring/shuohao-skills) | 3,537 | 大纲→角色/美术→剧本→分镜，结构化 JSON、节拍覆盖、对白时长与引用校验 | **最适合第一批移植**。标准 Apache-2.0 + NOTICE，Node 标准库工具；需将 agent 工作流改造成应用内 LLM 调用 |
| [BigBanana AI Director](https://github.com/shuyu-labs/BigBanana-AI-Director) | 2,232 | 小说分集、资产定妆、九宫格/首尾帧、视频与粗剪交付的产品流程 | 仅作产品流程证据。固定提交 `ca3da0a430a6cd3c38b31d503596cc9b30a3db37` 的公开仓库只有说明、图片和 Docker Compose，没有产品源码；仓库 LICENSE 是自定义非商业许可 |

许可证已读实际正文：

- [Toonflow LICENSE](https://github.com/HBAI-Ltd/Toonflow-app/blob/e03cf590eb0cab63534a4040db9acb4ec95b42a6/LICENSE)：内部二次开发和内容生产有免费场景；向两个及以上独立第三方提供产品涉及事先书面商业授权；标识/版权有保留条款。这是按现有条文做接入判断，不是说其所有商业用途都禁止。
- [waoowaoo LICENSE](https://github.com/waooAI/waoowaoo/blob/6cbbe22cc6492159e0f649d507e4e21a9aec3074/LICENSE)：Elastic 2.0 允许一定范围的使用与修改，但禁止上述托管服务，并要求保留通知；不能简单说“禁止商用”，也不能称无条件开源。
- [Jellyfish LICENSE](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/LICENSE)、[shuohao LICENSE](https://github.com/eternityspring/shuohao-skills/blob/7ebef4f2f53159ee1eaaec2793271a114a8be8cc/LICENSE)、[shuohao NOTICE](https://github.com/eternityspring/shuohao-skills/blob/7ebef4f2f53159ee1eaaec2793271a114a8be8cc/NOTICE)：移植时随附许可、保留相应版权/NOTICE、标明修改。
- [ArcReel LICENSE](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/LICENSE) 与 [NOTICE](https://github.com/ArcReel/ArcReel/blob/200674feb06a9954a49a05181912bc0b06dcc16e/NOTICE)：采用 AGPL-3.0，网络服务修改版涉及对应源码提供义务；NOTICE 还要求修改版界面保留指定署名与仓库链接。StoryDream 只记录其公开工作流事实并独立实现，不复制其源码、提示词或 UI。
- [BigBanana LICENSE](https://github.com/shuyu-labs/BigBanana-AI-Director/blob/ca3da0a430a6cd3c38b31d503596cc9b30a3db37/LICENSE)：实际英文正文为 `BigBanana Community License 1.0`，声明不是 OSI 开源许可，未经书面授权禁止商业活动、付费服务、SaaS/OEM/白标及企业内部生产使用。README 底部仍写 CC BY-NC-SA 4.0，与 LICENSE 不一致；接入判断以仓库 LICENSE 原文为准。

各应用的逐模块证据见 [app-repos.md](/I:/opc/docs/research/motion-comic-github-2026-09-18/app-repos.md)。其中 Toonflow/Jellyfish 已读代码证明任务提交、轮询与状态记录，但不足以证明重启后不会重复付费；waoowaoo 的 checkpoint/attempt 设计更完整，也不能据此推断每个供应商接口都支持幂等提交。ArcReel 与 Huobao 的 Agent/状态设计也只作为实现对照；BigBanana 当前没有可核查的产品源码。

检索还找到 AIComicBuilder（1,872 星，API 标记 Apache-2.0）、LocalMiniDrama（1,745 星，API 标记 MIT）。本轮未完成这两者源码与许可全文审计，因此不把它们列为已确认可直接复制的来源。漫画翻译、追番、短视频剪辑等高星但不同任务的项目已排除。

## 3. 真正值得接入的底层模型

| 项目 | Star | 能补什么 | 部署/效果边界与建议 |
| --- | ---: | --- | --- |
| [Wan2.2](https://github.com/Wan-Video/Wan2.2) | 17,543 | 图生视频；S2V 音频驱动；Animate 动作迁移 | 代码 Apache-2.0。官方 TI2V-5B 推理指令至少 24GB 显存，S2V-14B 指令至少 80GB；Animate 另需驱动视频和预处理。推荐 API/远程 GPU 接入，按具体权重及依赖复核分发条件 |
| [StoryDiffusion](https://github.com/HVision-NKU/StoryDiffusion) | 6,460 | 跨镜头角色一致图生成 | 代码 Apache-2.0；基于 SD1.5/SDXL 注意力处理，适合整组镜头共享身份上下文。官方低显存方案仍建议 >20GB。不是给任意云端生图 API 添加一句提示词就能启用，也不能把论文演示当现成完整漫剧后端 |
| [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) | 61,877 | 固定角色声线、参考音频克隆、逐句中文对白 | 代码及所核实官方权重卡为 MIT；有 Windows 整合包、/tts 服务。适合较早接入，原生稳定情绪控制仍不应过度承诺 |
| [CosyVoice](https://github.com/QwenAudio/CosyVoice) | 23,672 | 情绪、方言、语速等可控配音 | 代码与所核实 CosyVoice3 权重卡 Apache-2.0；有 FastAPI/gRPC。建议包成独立 TTS 服务，使用角色 voiceNotes 与句级 emotion；官方部署示例偏 Linux |
| [LatentSync](https://github.com/bytedance/LatentSync) | 6,079 | 已有视频 + 配音的口型后处理 | 1.5 至少 8GB，1.6 至少 18GB；默认选最大脸，多人同框无法直接指定说话人。代码 Apache-2.0、1.6 权重 OpenRAIL++，实际依赖的 InsightFace 预训练模型有非商业研究限制。放后期实验阶段 |

本机 `nvidia-smi` 实测：**RTX 3060 Laptop，6144 MiB（6GB）**。它不满足上述官方视频推理配方的显存要求；社区量化/卸载能否运行及速度，本轮未实测，不承诺本机流畅生成。

当前最实际的架构：Electron 负责剧本、资产、任务、预览和导出；LLM / 图片 / 视频 / TTS 通过 provider 调用。已读取用户 paid-api-channels 登记表，可复用既有渠道；“渠道列有模型”不等于相应端点已与本项目适配，实施时仍需验证模型能力、请求格式和价格。本次没有发起付费调用。

## 4. 第一批具体搬哪些模块

### P0：让输入的故事真正生成自己的分镜

来源：shuohao 的剧本/分镜结构、质量门，配合 Jellyfish 的实体提取和拆镜逻辑。

建议新增 `src/shared/motion-comic-planning.ts` 和主进程编剧入口，输出经过 Zod 校验的角色、场景、道具、场次、镜头及对白；将 `createMotionComicStarterProject` 保留为空白起点，AI 生成后以新修订填入内容。

数据结构应直接围绕 `Episode → Scene → Shot` 与资产稳定 ID 建模。`Act` 只做可空的分组字段；没有 `Act` 的短篇、广告和单集内容必须完整可用，自动分幕也不得改写场/镜头 ID。单集分场和分镜生成后应停在可编辑确认态，确认通过后再批量定妆和生成媒体，避免脚本调整触发已付费资产整批作废。

| 上游字段/逻辑 | StoryDream 接入目标 |
| --- | --- |
| cast / art 中的角色、造型、场景、道具 | `characters[].looks`、`sceneAssets`、`props`，建立稳定 ID 映射 |
| script episodes / scenes / flow | `episodes[].script`、`scenes[]`、逐句 `dialogueCues`；保存原始结构化节拍以支持后续校验 |
| storyboard segment / cut | cut 对应 `MotionComicShot`；`seconds × 1000` → `durationMs`，`frame` → `prompt` |
| characters / props / sceneIndex | 转换为 `characterLookIds`、`propAssetIds`、`sceneAssetId`，拒绝悬空引用 |
| beat coverage / dialogue fit | 拦截漏剧情、重复认领、镜头装不下对白；台词初始按语速估算，生成后必须以音频实测时长重排 |
| segment 的多切点视频提示词 | 若保留一次生成多镜头，需另存 `generationGroupId` 和切点映射；不能把整段提示词重复塞给每个独立镜头 |

可复用源码：

- [剧本时长与校验](https://github.com/eternityspring/shuohao-skills/blob/7ebef4f2f53159ee1eaaec2793271a114a8be8cc/skills/novel-script/scripts/novel-script.mjs#L22)。
- [分镜结构与映射约定](https://github.com/eternityspring/shuohao-skills/blob/7ebef4f2f53159ee1eaaec2793271a114a8be8cc/skills/novel-storyboard/references/schema.md)。
- [节拍展开](https://github.com/eternityspring/shuohao-skills/blob/7ebef4f2f53159ee1eaaec2793271a114a8be8cc/skills/novel-storyboard/scripts/novel-storyboard.mjs#L188)、[分镜质量门](https://github.com/eternityspring/shuohao-skills/blob/7ebef4f2f53159ee1eaaec2793271a114a8be8cc/skills/novel-storyboard/scripts/novel-storyboard.mjs#L419)。
- [Jellyfish Agent 组成](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/chains/agents/script_processing_agents.py)。

需要适配的规则：上游 2–5 秒镜头、15 秒段长、H3 专用字段、英文提示词检查属于其制作策略。只复用通用校验，将时长上限改为所选模型能力；这些规则不能硬套到所有题材或模型。

验收：同一故事的角色和对白可追溯原文；每个剧情节拍恰好覆盖一次；不同故事不再固定三场六镜；非法 JSON/未知角色不会写入项目；重生成不覆盖手工修改和既有媒体。

### P0：打通漫剧首帧→动作视频→真实成片

来源：Jellyfish 的镜头上下文、参考帧准备度检查；复用 StoryDream 已有视频 provider、任务及渲染器。

- 扩展 [视频 IPC](/I:/opc/electron/main.ts:2827) 的漫剧分支，使用 `episodeId + shotId + 输入指纹` 标识请求，接通页面视频回调。
- 调用 [现有视频 provider](/I:/opc/src/shared/video-provider.ts:56)，传首帧、动作、运镜、时长；只有模型声明支持才传尾帧/音频/多参考图。无鉴权本地服务需明确的本地 provider 类型，现有 API key 必填判断也要调整。
- 新增/明确选中的视频资产版本，持久化远端任务 ID、状态及过期输入；提交状态不明先查询，避免重复付费生成。
- 修改 [漫剧渲染分支](/I:/opc/src/shared/director-render.ts:644)，真实消费选中的视频资产；只有生成按钮没有渲染接线不算完成。
- 保留静帧运镜作为可选择的制作方式；视频任务失败不能被标成“视频生成成功”。

Jellyfish 对应源码：[参考帧/任务/模型准备检查](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/services/studio/shot_video_readiness.py)、[动作节拍/前后镜/构图/朝向提示词包](https://github.com/Forget-C/Jellyfish/blob/a9678194ddf2d9be3ccbe78d4287d87d5089e123/backend/app/services/studio/shot_video_prompt_pack.py)。这些服务依赖其 SQLAlchemy 数据模型，应提取纯业务逻辑并映射到现有文档，不引入整套数据库。

验收：生成视频预览、保存重开和导出实际使用同一版本；人物动作确实出现在成片中；过期回包不覆盖新镜头；失败单镜补跑，已成功镜头不重付费。

### P1：补上角色演绎和跨镜头上下文

- 先在现有参考图提示词中加入上镜结束状态、本镜动作目的、视线/朝向、服装/道具变化；新增字段需贯穿持久化、输入指纹及质量检查。此举改善上下文，不能保证模型绝不漂移。
- TTS 接口增加角色参考音频/文本、可支持的情绪参数和真实 provider capability。优先 GPT-SoVITS 独立服务，情绪演绎再选 CosyVoice。
- GPT-SoVITS 的不同微调模型需隔离实例或串行切权重：其 API 使用全局 pipeline，并发切模型有串音风险；`aux_ref_audio_paths` 是音色融合，不是多人对白分配。
- CosyVoice 官方 FastAPI 返回 int16 PCM 流，适配器需按采样率封装 WAV；不能当成完整 WAV 直接存储。
- TTS 完成后用实测音频校准镜头，再接强制对齐；不能只靠“每秒多少字”保证字幕同步。

### P2：模型级身份控制与口型

- StoryDiffusion / ComfyUI 等作为独立服务接入整组参考与镜头批次；新增数值 seed、参考图映射等明确参数。现有文字 seed 不等价于推理器随机种子。
- LatentSync 先做单人特写实验，再处理多人目标选择和跟踪；在确认检测/关键点模型许可前不捆绑分发默认权重。
- 用双人同框、侧脸、遮挡、换衣、快速动作的真实短片对照身份保持、漏台词、口型和成本，再决定默认模型。本轮未作视觉质量排名。

## 5. 已完成的验证与未完成的工作

已完成本地链路审计、公开仓库检索、候选源码/许可证核实，以及 shuohao 固定 commit 的离线工具测试：

| 上游自测 | 结果 |
| --- | ---: |
| novel-outline | 249 项通过 |
| novel-script | 154 项通过 |
| novel-storyboard | 254 项通过 |
| 合计 | 657 项通过 |

这是上游确定性校验工具的运行证据，尚未证明与 StoryDream 数据结构兼容，也不代表生成画面/配音质量通过。本轮只新增研究文档，没有修改产品代码、安装上游 skill、改变真实项目或调用付费生成。下一轮实施应按两个 P0 闭环验收，然后做 P1/P2。

原始 GitHub 搜索、页面与只读源码快照保存在系统临时目录 `storydream-comic-research-20260918`；GitHub API 达到匿名额度后，改用官方 HTML/raw/git 取得证据。Agent Reach 版本检查同样遇到限流，未声称存在新版。

## 6. 模型来源与固定版本

- Wan2.2：`42bf4cfaa384bc21833865abc2f9e6c0e67233dc` — [README（显存、I2V/S2V/Animate）](https://github.com/Wan-Video/Wan2.2/blob/42bf4cfaa384bc21833865abc2f9e6c0e67233dc/README.md)、[代码许可](https://github.com/Wan-Video/Wan2.2/blob/42bf4cfaa384bc21833865abc2f9e6c0e67233dc/LICENSE.txt)。
- StoryDiffusion：`8de45e424887766fdd84dc917436ff8605f00149` — [README](https://github.com/HVision-NKU/StoryDiffusion/blob/8de45e424887766fdd84dc917436ff8605f00149/README.md)、[LICENSE](https://github.com/HVision-NKU/StoryDiffusion/blob/8de45e424887766fdd84dc917436ff8605f00149/LICENSE)。
- GPT-SoVITS：`48b1a0169a28582a8984402f82cf438d3bfa6aca` — [API](https://github.com/RVC-Boss/GPT-SoVITS/blob/48b1a0169a28582a8984402f82cf438d3bfa6aca/api_v2.py)、[权重许可](https://huggingface.co/lj1995/GPT-SoVITS/blob/336b2ec4e8d4ac74740798dd40af44e74659ecaf/README.md)。
- CosyVoice：`074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` — [情绪指令](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/utils/common.py#L28)、[FastAPI](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/runtime/python/fastapi/server.py)、[权重许可](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512/blob/29e01c4e8d000f4bcd70751be16fa94bf3d85a18/README.md)。
- LatentSync：`a229c3948406bc2cf6eaf4873e662e70c6a04746` — [显存要求](https://github.com/bytedance/LatentSync/blob/a229c3948406bc2cf6eaf4873e662e70c6a04746/README.md#L106)、[最大脸选择](https://github.com/bytedance/LatentSync/blob/a229c3948406bc2cf6eaf4873e662e70c6a04746/latentsync/utils/face_detector.py)、[权重许可](https://huggingface.co/ByteDance/LatentSync-1.6/blob/c42c7e6c8e9c213626389fa7d9a3c444b8536353/README.md)、[InsightFace 预训练模型许可](https://github.com/deepinsight/insightface/blob/1480e705287bc5d59f923b46c260ec6e3e4150f6/README.md#L32)。
