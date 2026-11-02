# Lemo 多协议执行层：GitHub 方案调研

日期：2026-11-03。范围：上游仓库、官方文档、公开 npm 元数据与本项目源码对照。此次仅调研与记录，没有安装依赖、改动生成链路、启动第三方 Agent 或调用模型。

## 建议

建议优先验证 **Vercel AI SDK 的原生 Provider + ToolLoopAgent + Lemo 现有任务记录与受控工具**，把 **Pi 的 pi-ai + pi-agent-core** 作为第二候选。它们都已有工具循环，不必重新实现全部消息协议和 Agent 基础机制。

这个排序是针对当前项目的工程判断，不是框架通用排名，也不是已完成的兼容性测试。Lemo 已经拥有阶段编排、请求与工具账本、渲染、抽帧和交付检查；本次主要缺口是多协议 Agent 会话。AI SDK 与现有 TypeScript、Zod 和宿主拥有工具的方式较吻合。

如果目标扩展为重建整个任务平台，LangGraph JS 和 Mastra 值得进一步评估；如果目标是直接托管一个现成编码 Agent，OpenCode 可行，但它的 SDK 是服务客户端，需要增加进程与配置管理。

## 候选比较

| 方案与仓库 | 已核实能力 | 放入 Lemo 的位置 | 主要集成边界 | 本轮判断 |
| --- | --- | --- | --- | --- |
| [Vercel AI SDK](https://github.com/vercel/ai) | 多 Provider；OpenAI Chat、Responses 与 Anthropic Messages；ToolLoopAgent 自动工具循环；Zod/JSON Schema 工具；取消与重试配置 | 当前 SDK 会话执行层与协议适配层 | 普通 ToolLoopAgent 是内存循环；仍需接入现有持久化、请求记录和交付检查 | 首选验证 |
| [Pi](https://github.com/earendil-works/pi) | pi-ai 提供三种目标协议及其他 Provider；pi-agent-core 提供工具循环、事件、前后钩子、取消；coding-agent SDK 提供会话存储 | 轻量 Agent 内核，或进一步复用编码会话 | 核心状态不等于持久化事务；默认工具和资源发现需替换；pi-durable 仍为实验性 | 第二候选；编码 Agent 复用优势明显 |
| [LangGraph JS](https://github.com/langchain-ai/langgraphjs) | 有状态图、Checkpointer、恢复、人工中断；可结合模型集成层 | 全片多阶段工作流编排 | 不是单独的三协议传输适配器；需增加持久化后端并重映射现有阶段状态 | 未来工作流复杂化时考虑 |
| [Mastra](https://github.com/mastra-ai/mastra) | TypeScript Agent、模型路由、工作流、存储、暂停恢复、评估与观测 | 整体 Agent/工作流平台 | 需决定哪套存储和阶段状态具有权威性，避免同时维护两套真相 | 整体平台升级候选，本轮范围偏大 |
| [OpenCode](https://github.com/anomalyco/opencode) | 现成编码 Agent；JS/TS SDK 管理服务、会话、消息与事件 | 独立 Agent 服务或子进程 | createOpencode 会启动服务；需管理二进制、端口、进程、配置发现、权限与版本匹配 | 可做独立后端，不作为最小改造首选 |

以上“适配位置”和排序是依据文档及本地源码作出的判断；没有测量安装体积、延迟、成片成功率或艺术质量。

## 版本与维护证据

读取了上游代码、文档和公开 npm latest 标签。以下是本轮观测值，实施时仍需固定精确版本及锁文件，并核对与该版本一致的文档；main 分支不应当作稳定版本合同。

| 包 | 本轮 latest 标签 | 声明的 Node 要求 | 元数据中的许可证 |
| --- | --- | --- | --- |
| ai | 7.0.159 | >=22 | Apache-2.0 |
| @earendil-works/pi-agent-core | 1.5.0 | >=22.19.0 | MIT |
| @langchain/langgraph | 1.6.0 | >=18 | MIT |
| @mastra/core | 1.81.0 | >=22.13.0 | Apache-2.0 |
| @opencode-ai/sdk | 1.19.5 | 此包未声明 | MIT |

证据文件：.artifacts/lemo-framework-research/npm-latest.json。许可证列仅记录包元数据，不代表整个仓库每个组件均采用相同条款；Mastra README 明确区分核心 Apache-2.0 与 ee 目录企业许可。

当前 Lemo worker 的 package.json 声明 node >=20，不能据此认为满足上述新库要求。接入前应检查实际启动 worker 的 Node/Electron 运行时。OpenCode SDK 未声明 engines 也不能推断服务端没有运行环境要求。

GitHub 未认证 API 本轮返回 403 限流，因此没有伪造精确更新时间或提交活动统计，改用仓库页面、原始文档和 npm 发布元数据。框架有公开版本和文档是筛选依据，但不能据此宣布其在本项目中生产可用。

## 为什么优先 AI SDK

1. 直接支持目标协议。OpenAI Provider 可显式选择 chat 和 responses；Anthropic Provider 使用 Messages；支持自定义 baseURL、凭证、请求头和 fetch。用户可以继续使用自己的渠道。使用具体 Provider 实例即可直连，不要求使用 Vercel Gateway。
2. 已有 ToolLoopAgent，提供工具调用、结果回传、下一轮和停止条件。工具接受 Zod/JSON Schema，本项目现有工具已使用 Zod，减少无关重写。
3. 现有文件操作、读图、read_library、review_film、finish_film 的处理器可以保留，替换当前 Claude SDK 专属包装。框架负责模型交互，Lemo 宿主继续负责文件边界、渲染和交付检查。
4. 普通 ToolLoopAgent 不提供崩溃后自动恢复，但 Lemo 已有 stage-store 与请求/工具账本。接入这些现有结构比同时更换整个工作流平台更符合当前目标。

特别注意：官方默认 openai(modelId) 使用 Responses。如果用户选择的是 Chat Completions 渠道，必须显式使用 chat 工厂或兼容 Provider；否则即使更换框架也会再次出现协议不匹配。

AI SDK 当前还有 WorkflowAgent，能够持久化及恢复，但需要额外的 Workflow 运行时和构建集成。不能把普通 ToolLoopAgent 描述成自带持久化，也不能断言 AI SDK 整个生态没有持久化。首轮没有必要连同该运行时一起引入。

## Pi 的适用范围与边界

Pi 提供独立的 pi-ai 和 pi-agent-core 包，内核可独立于 CLI 使用。pi-ai 明确提供 anthropic-messages、openai-completions、openai-responses，并提供自定义渠道、图像、工具结果、流事件和上下文序列化。pi-agent-core 可配置工具执行方式、工具执行前后检查、请求前上下文与回合结束行为。

如果希望复用编码 Agent 的上下文压缩、会话树、资源加载与事件系统，coding-agent SDK 比从基础库逐项拼装更接近成品。不过它默认会建立资源加载器、设置存储和默认工具，Lemo 应显式提供自己的工具集合、模型配置、资源加载和会话位置。

当前 pi-durable 提供持久化 Agent，但 README 首行明确标为 Experimental，API 可以在版本间变化；其说明还包含崩溃中请求计为失败并重试的行为。这不能直接替换 Lemo 对“请求结果未知”的核对逻辑。不要因为名字包含 durable 就按成熟恢复组件接入。

Pi 核心工具默认可并行执行。写工程、渲染、审片、结束成片等有顺序关系的工具，需要按本地规则串行化并接入操作账本。Pi 仓库也说明不内置文件、进程等权限隔离；应复用 Lemo 已有的受控工具，而不是开放默认 shell 权限。

## 对接方案

建议保留以下边界：

    项目模型设置：协议、端点、模型、凭证、能力记录
                         ↓
    Lemo 执行器接口：新 AI SDK 后端 / 原 Claude SDK 后端
                         ↓
    框架原生 Provider + 工具循环 + Lemo 请求与会话持久化
                         ↓
    Lemo 受控文件工具 / 风格库 / review_film / finish_film
                         ↓
    原有素材、音频、时间轴、渲染、验收与交付

需要明确的约束：

- SDK 后端之间不能直接共享 resume ID；保存后端、协议、配置指纹和格式版本。
- 框架停止、会话结束和工具调用成功都不等于成片验收通过。
- review_film 的真实图片必须进入下一轮模型上下文；finish_film 仍由宿主检查审片顺序。
- 保留完整的提供商消息/推理续接信息，不能只存最终文本。
- 自动重试必须与请求账本统一。AI SDK 的文档默认重试次数为 2；首轮建议显式禁用自动请求重试，再由本地策略决定哪些失败可重试。
- “回执持久化后才能执行副作用工具”的顺序必须实测。不能只增加一个 onStepFinish 日志回调就假定顺序满足。必要时使用框架的模型/工具类型与单回合 API，由 Lemo 在持久化之后派发工具。
- 创作模型与视觉审片模型可以分开，但每个渠道仍需验证工具往返、图片输入、输出长度及取消；协议兼容不等于任何模型都胜任。

## 最小验证顺序

1. 在隔离 worker 中固定 AI SDK 及三种 Provider 的版本，验证与发布运行时的兼容性；不替换现行后端。
2. 用本地协议夹具验证工具往返、图片返回、流结束、截断、取消、错误参数及事件顺序，禁止未验证回执触发文件工具。
3. 把 Lemo 三个生产工具接入，验证“写工程 → 真渲染 → 看图 → 修复 → 宿主验收”。
4. 注入断线与进程终止，验证 pending/unknown 状态不会自动触发重复生成或重复文件操作，核对恢复版本。
5. 在约定渠道与预算下，用同一脚本和风格跑真实短片，确认请求兼容性和成片质量。框架的通用能力不能代替这一步。

## 资料与核查限制

- AI SDK 仓库：https://github.com/vercel/ai
- Agent 概览：https://ai-sdk.dev/docs/agents/overview
- ToolLoopAgent：https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
- 工具接口：https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- OpenAI Provider：https://ai-sdk.dev/providers/ai-sdk-providers/openai
- Anthropic Provider：https://ai-sdk.dev/providers/ai-sdk-providers/anthropic
- WorkflowAgent：https://ai-sdk.dev/docs/agents/workflow-agent
- Pi 仓库与包入口：https://github.com/earendil-works/pi
- Pi 模型库：https://github.com/earendil-works/pi/blob/main/packages/ai/README.md
- Pi Agent 核心：https://github.com/earendil-works/pi/blob/main/packages/agent/README.md
- Pi 编码 SDK：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- Pi 持久化实验模块：https://github.com/earendil-works/pi/blob/main/packages/durable/README.md
- LangGraph JS：https://github.com/langchain-ai/langgraphjs
- LangGraph 持久化：https://docs.langchain.com/oss/javascript/langgraph/persistence
- Mastra：https://github.com/mastra-ai/mastra
- OpenCode：https://github.com/anomalyco/opencode
- OpenCode SDK：https://opencode.ai/docs/sdk/
- 公开包元数据：https://registry.npmjs.org/ （本地快照列出实际包与版本）

部分原始文档已存于 .artifacts/lemo-framework-research/。未执行框架安装、构建、真实模型请求或动画对照实验。本报告是带依据的选型建议，不是已经接通多协议的功能交付。
