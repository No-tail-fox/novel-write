# Lemo 原生 Agent 正式接入（2026-10-30）

## 目标与边界

完整上游工程只读保存，每个任务建立独立可写工程。Agent 读取资料、逐文件创作、实际抽帧、看图修复；不修改上游样片冒充生成。旧任务保留原运行版本、已付费回执与恢复语义。

## 已落地的正式路径

- 上游：`lemomo-ai/lemo-opuscar`，固定提交 `f17136060781a0068a7951245a3aa7835a7230de`；`vendor/lemo-upstream` 共 2,519 个原文件，另有来源清单。构建时核验原文件哈希。
- 新建原生创意任务默认 `authoringVersion: 3`。旧 v1/v2 不静默迁移；v3 暂不支持锁镜混合，预检明确拒绝。
- 多文件 Agent：`list_files/read_file/write_file/replace_text/review_frames/finish`。小 JSON 工具头与原始源码分开，不强制模型原生 function-call。每轮一次模型请求/一个动作，最多 64 轮；耗尽上限不是成功。
- 每轮持久化提交、完整回复、文件修改和结果。先落盘回复，再执行工具；截断不应用；本地 IO 失败可恢复重放；云端结果未知不自动重发。
- `review_frames` 用真实 Electron 截取三帧；下一轮模型实际收到图像才能进入 `finish`。技术检查、模型视觉意见与人工审美验收分开记录。
- 调度衔接现有配音、时间线、渲染和媒体检查。整片原生画面由独立捕获器生成；字幕与声音由程序合成。

## 本地化与导出修复

1. `prepareLemoUpstreamPicture` 统一 `director:render`、`vox:export-shot`、`director:recheck-subtitles`、`director:recheck-media` 四个正式入口。v3 没有已验证原生画面时拒绝，绝不回退旧逐镜引擎。
2. 裸画面缓存按捕获编码版本、runId、源码指纹、上游提交、时长、画布与帧率区分；前后校验源版本；复用前核对文件长度与 SHA-256。失败/取消捕获没有成功回执，字幕变更可以复用原画面。
3. 单镜导出从原生整片的真实时间窗口截取，字幕复检保留全局时间坐标；不是从零播放整片片头。
4. UI 明确标注原生整片制作状态；移除无效的旧逐镜代码编辑器与渲染策略切换。未就绪禁用单镜导出，保留字幕/配音编辑。当前不提供精确逐镜内联预览。
5. 实测修复异步导出按钮禁用后焦点落到 body、Escape 无法关闭抽屉的问题：使用 Fluent 的可聚焦禁用状态，禁止重复激活并保留键盘焦点。
6. 实际导出抽帧发现旧合成器给原生画面额外叠加暗角、逐镜标题、模式/镜头角标。新增 `preserveSourcePicture`，只在 v3 原生画面路径启用，保留程序字幕与音频，不改旧工程默认。提高原生成片组合版本指纹，避免旧叠加版仍被标为当前成片。
7. Windows 并发回归暴露原生源服务 socket 关闭早于文件句柄释放；正式关闭逻辑现在等待读取流关闭且幂等。测试清理不会因一次失败重复关闭前例服务、导致后续用例连锁失败。
8. 实测发现 JPEG 捕获编码继承 full-range 元数据后，当前 Electron 离屏视频回放将高光进一步提亮、暗部压低。正式编码器现在显式转换到 limited range，同时转换 BT.709 色彩矩阵，明确标记 BT.709/sRGB 原色与传递函数。使用准确舍入以避免变换产生明显色差；不通过改画面颜色补偿。裸画面缓存版本升至 3、原生成片组合指纹升至 4，旧编码产物必须本地重捕获，不重发模型请求。

### 色彩修复的可复现证据

- `.artifacts/lemo-upstream-production/color-diagnostic-20261030`：同一 JPEG 色块经旧编码后，FFmpeg 解码为 `[249,239,221]`，实际 Electron 回放截图为 `[255,255,240]`；显式 limited-range 版回放为 `[248,241,221]`（JPEG 源为 `[249,241,222]`）。因此问题在编码/回放边界，不是模型写错了色值。
- 新增 `tests/html-video-color-range-integration.test.ts`：实际运行 3 帧缓存式和 97 帧流式编码，再执行正式合成/时长归一化；检查 limited-range、BT.709/sRGB 元数据与五组色块误差。修复前两项均失败，修复后通过，单通道误差阈值仍为 3。
- 新增缓存回归：旧版本即使文件长度/SHA-256 均有效也不得复用。定向 4 文件 18 项通过（包含旧缓存版本 1、2 的失效验证）。
- 中间验证 `.artifacts/lemo-upstream-production/fixture-color-fixed-20261030` 仅修正 range，14 项技术质量门通过，但新增绿色区域像素核对仍失败（均差最高 5.33）。此版本不算视觉通过，证据保留，不放宽阈值。
- 原因继续定位为缺少原色/传递函数元数据；显式 sRGB/BT.709 的实际 Electron 色块回放与 JPEG 源最大单通道差为 1。
- 使用同一份未修改 fixture，在 `.artifacts/lemo-upstream-production/fixture-color-profile-fixed-20261030` 重跑完整色彩修复后的真实导出；整片、单镜、字幕复检和像素对比结果见后续验收记录。

## 验证证据与严格区分

- 原版 Brick Toy / Memphis：仅运行环境和抽帧基准，未修改示例代码；不代表新 AI 影片。
- `.artifacts/lemo-upstream-production/fixture-entrypoints-20261030`：15 秒离线 fixture，真实 Electron 捕获、整片合成、末镜导出与字幕复检；付费调用 0。整片 14 项质量检查通过，末镜字幕复检 3 项通过。它是验证用画面，不是 AI 创作或审美样片。
- 上述 fixture 抽帧暴露装饰叠加问题；旧回执保留作为修复前证据。修复后的重复验证使用独立目录 `.artifacts/lemo-upstream-production/fixture-clean-picture-20261030`，不覆盖旧样片。
- `.artifacts/lemo-upstream-production/ui-entrypoints-20261030/report.json`：190 项真实 Electron 界面/键盘/原生播放检查通过，35 张截图，覆盖明暗主题、常规和最小窗口；付费调用 0。已查看实际截图。
- 回归范围包括全局 UI/契约、Lemo、director-render、字幕、LLM 协议/多模态/预算/流回执、licensing。最终统计与构建结果见本文件后续验收记录；不把源码契约测试称为生产 IPC 端到端实测。

## 真实 AI 新片：尚未完成

目录：`.artifacts/lemo-upstream-production/live-rain-garden-20261030`。

- 模型是 Moe `gemini-3.1-pro-high`，不是 Claude Opus；主题“一滴雨水的花园旅程”，15 秒、16:9、Brick Toy。
- 最新实测从 2026-10-30 23:12（北京时间）开始：用户授权承担原第七轮可能重复扣费后，通过正式 `retry-unknown` 控制恢复；新第七轮和第八轮保存完整回执，第九轮再次发生 `ECONNRESET`。
- 当前阻塞为第九轮 `upstream-turn:9`，请求 ID `933cb623-9ecb-4642-a333-efc40acd558e`，云端结果未知，尚未重发。原第七轮的云端结果仍未核清；用户授权仅允许重试那一次，不授权未来任意未知请求。
- 本次续跑新增 3 次模型请求尝试，前六轮节点与 journal 内容保持不变。第七轮是读取示例代码、第八轮是列举核心文件；项目源码文件数仍为 0，没有生成可验收的新 AI 成片。
- 不能说“全流程跑通”，也不能拿离线 fixture/上游 demo 代替。继续第九轮需供应商可核对结果/未执行证据，或用户明确接受该轮可能重复扣费的重试授权。

## 尚未覆盖

- 本轮 `narration:false`、`generateImages:false`：TTS 生成、词级对齐以及素材生成端到端均未验收。
- Agent 暂无生成/下载素材工具；独立资源缓存只覆盖已验证的少数风格，不代表 66 风格全离线可用。
- 原生逐镜代码编辑、精确逐镜内联预览、锁镜混合尚不支持；UI 不冒充已具备。
- 原始画面与字幕合成仍有两次编码；未做安装包验收。
- 未重跑 `E:\StoryDreamCreativeAudit-20261029-opus-paper` 的旧付费任务，未改原稿或削弱质量门。

## 最终本地验收记录（2026-10-30）

验收记录时间：`2026-10-30T23:09:04+08:00`。本节只确认正式本地渲染/界面接入和回归，不代表真实 AI 新片验收。

- **最终离线真实导出**：`.artifacts/lemo-upstream-production/fixture-color-profile-fixed-20261030` 完成整片、末镜和字幕复检。整片 15,000ms、1920×1080，14/14 技术检查通过；末镜从全片 6,038ms 处开始，输出 9,000ms；字幕复检 3/3 通过。三次模拟 Agent 回复不是付费模型调用，付费请求数为 0。此 fixture 按设置静音，不用音轨存在冒充配音验收。
- **画面保真**：`visual-verification/picture-preservation.json` 的整片/单镜/字幕复检共 9 个时间样本、36 个稳定区域对比全部通过。区域平均每通道绝对差阈值保持 3，最大实际均差 `0.005972222222`（0–255 色阶）。四份视频均带 limited-range、BT.709/sRGB 完整元数据。已实际查看 `source-vs-export.png`：对比区域未见此前的明显色偏、额外暗角、重复标题/角标；字幕仍由宿主合成。这不是 AI 作品审美评分，也不是逐帧像素完全相同的承诺。
- **产物校验**：整片文件存在且 SHA-256 与导出回执一致；原生画面、末镜和字幕复检视频均存在且非空。源样片不作为修改对象，误差阈值未放宽。
- **最终回归**：`regression-profile-final-20261030.json` 覆盖 93 个测试文件，1558/1558 通过、0 失败；`typecheck` 和正式构建通过。构建重新确认上游固定提交 `f17136060781a0068a7951245a3aa7835a7230de` 的 2519 个原文件哈希。
- **实际界面验收**：沿用本轮已完成且之后未修改 UI 的 `ui-entrypoints-20261030/report.json`：190 项检查通过、35 张截图、付费调用 0，包含深浅主题、正常/最小窗口、键盘和原生播放路径。未把这些结果扩写为完整生产 IPC 或全部功能实测。
- **收尾检查**：`git diff --check` 通过；仅移除 `tests/electron-ipc-contract.test.ts` 文件尾部一个多余空行，未改变测试断言或程序逻辑。
- **机器汇总**：`.artifacts/lemo-upstream-production/final-local-acceptance-20261030.json`。所有回归、构建与像素原始报告保留，早期失败产物也保留作对照。

### 23:09 时的真实生成验收状态（历史记录）

以下是续跑前的记录；当前阻塞以随后第九轮实测记录为准。

- 再次只读确认真实新片第 7 轮请求 `4c1ce7fc-8bee-4973-9f11-3de0c14a7a96` 仍为 `unknown`；没有重发该请求，也没有重跑旧 Opus 任务。
- 此新片实际使用 Moe `gemini-3.1-pro-high`，不是用户此前要求的 Claude Opus。不能将它或离线 fixture 写成 Opus 效果验收。
- 真实 AI 新片完成、审美质量、TTS/词级对齐、素材生成、安装包与全部风格仍未验收；本地验收通过不消除这些边界。
- 下一次付费恢复前，需拿到可核对的供应商结果/未执行证明，或得到用户对该未知轮可能重复扣费的明确授权。



## 授权续跑与错误分类修复（2026-10-30，23:12 起）

### 真实请求与恢复边界

- QA 驱动新增 `STORYDREAM_LEMO_QA_RETRY_UNKNOWN_REQUEST`，只允许 live + resume 下精确匹配一个 unknown 请求；与“确认未提交”路径互斥，先记录授权，再调用正式 `VoxProductionService.control({action:'retry-unknown'})`。没有伪造供应商未执行证明。
- 原第七轮未知请求 `4c1ce7fc-8bee-4973-9f11-3de0c14a7a96` 的授权重试产生请求 `23b25b8b-396d-4cb0-b5b7-48c0b57af105`，完成 `read_file`；第八轮请求 `298da870-8326-46c6-b69d-7f9d8c7e8fb2` 完成 `list_files`。
- 第九轮于 `2026-10-30T15:12:54.940Z` 提交（北京时间 23:12:54.940），请求 `933cb623-9ecb-4642-a333-efc40acd558e` 无完整回执，被保留为 unknown。运行没有进入生成源码、画面审查或导出阶段。
- 通过前后文档、journal 和日志交叉核对：前六轮节点及 journal 不变，本次只发出第 7、8、9 轮请求。旧 Opus 工程未重跑；没有修改样片、原稿或降低质量门。

### 程序修复与尚未定位的原因

- 真实第六轮虽有完成回执，但 `text` 与 `raw` 均为空，`finishReason=stop`，usage 记录 `completion_tokens=10539`；原来直接 `JSON.parse` 导致 `Unexpected end of JSON input`。
- 正式解析器现在将空白正文归为 `LEMO_AGENT_EMPTY_RESPONSE`，不再混同于普通 JSON 语法错误。提示明确说明“解析后的正文为空”本身不足以证明 JSON/tool-schema 不兼容，不武断排除适配器丢字段的可能。
- 新增空字符串、空格、CRLF 和空付费回执恢复测试：保存已有回执，不改项目源码；本地恢复不会再买一轮。没有更改已保存的真实回执来制造成功。
- 本次修复的是错误分类，**不是**修复 `ECONNRESET`。现有证据无法确定断连发生于本机网络、中转站还是上游；也没有原始 SSE 可判定空正文来自供应商还是适配器。
- 用正式 `fetchWithNetworkPolicy` 免费请求 `GET /v1/models` 返回 200，用时 2941ms，列出 29 个模型且包含当前配置。它只证明当时基本连通性，不证明生成接口健康。

### 证据与验证范围

- 机器汇总：`.artifacts/lemo-upstream-production/live-rain-garden-20261030/resume-audit-20261030/live-resume-result.json`。目录中保留续跑前备份、请求日志、连通性核验和回归报告。
- 最新代码重新执行 7 个测试文件，169/169 通过、0 失败（`regression-final.json`）；`npm run typecheck` 和 `npm run build` 均退出 0。构建重新核验上游固定提交的 2519 个原文件，保留非阻断的大 chunk 体积警告。此前 93 文件 / 1558 测试与 190 项 UI 检查属于前一阶段，不冒充本次重跑结果。
- 当前模型仍为 Moe `gemini-3.1-pro-high`，不能称为 Claude Opus 效果验收；TTS、词级对齐、AI 素材生成和新片审美仍未覆盖。
