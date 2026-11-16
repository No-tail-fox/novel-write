# 代码视频实施记录

## 授权与范围

用户已授权按整体方案推进。采用 Pi，允许编写与受控执行代码；加入声音层和小型预置音色包；字幕模式可选；允许申请旁白停顿。目标时长 30/60/90/120/180 秒，默认 60 秒；Lemo 保留上游导出，审片对齐上游路径。

## 当前接线与验证

- 新建代码视频设置选择 v4；旧运行仍按原 authoringVersion 恢复。main 已组合 Pi operations、原生网关、外部旁白时钟、声音母带和最终导出。未完成分段保存后暂停，继续按钮才启动下一分段。
- 新增质量适配器，使用最终外部时钟验证镜头连续性、字幕及旁白源切片，保留实际黑场、音量和编码检查，避免把 v4 整片映射到旧镜头时间线。
- 完整构建通过。真实四秒离线样片验证了乐器、音效、母带、两轮审片、逐帧字幕、上游视频和最终 AAC 解码：480×270、12fps，48k stereo、192000 帧，旁白留白内采样峰值为零。证据在 `.artifacts/pi-film-pipeline/run-Uy1e1S/report.json`；此样片最终混流直接使用 FFmpeg，尚未覆盖应用最终 compositor。
- LPAC Python 启动仍为 0xC0000022；run_python 不开放。当前声音能力是固定可信渲染器读取严格乐谱/音效数据，不能把它称为 Agent 任意 Python 沙箱执行。
- 首次缓存创建已改为原地受标记保护的构建，真实无缓存样片通过（`.artifacts/pi-film-pipeline/run-jgKmWf/report.json`）。130 项集成回归通过；金额/令牌预算新增实际请求上界检查，实际 SDK 三协议 payload 离线兼容性验证通过。媒体实际时长上限统一为 198 秒，保留目标最长 180 秒及 10% 容差。
- HyperFrames/Remotion 完成承诺等待、React 提交标记和 delayRender 握手；真实 Electron 异步 canvas 捕获通过。应用 compositor 验证发现并修复 12→24fps 同一解码帧等待死锁；48kHz 最终采样率传播已完成，真实 compositor 双字幕模式样片均通过：1080p24fps、96 帧、48k stereo192000 音频帧、留白峰值零；报告 `.artifacts/pi-director-export/run-Hmd4sL/report.json`。该样片覆盖 buildPiFilmExportScenes→renderDirectorVideo；另有真实 preparePiFilmExport 测试完成浏览器/FFmpeg 导出、暂停后的精确 SRT、四类哈希失效拒绝及追加成片后的项目重载，5/5 通过。测试就绪证据为明确标记的合成 fixture，不是人工创作质量批准。
- 长文在配音前拦截超时文案，新增准备对话框：无损拆成独立项目草稿，或显式调用一次 AI 精简并把可编辑结果另存待审核草稿；不自动配音/启动，原稿保留。精简禁自动重试与模型 fallback。需继续补对话框交互 QA 和多草稿中途失败恢复验证。SRT 从权威字幕时钟导出，与视频并存。
- Pi 48k 主混音参数进入 compositor，并提供真实 Chromium/FFmpeg 导出测试。离线 Pi worker smoke 以 Node 24.21 通过：SDK1.5.2、真实工具/图片返回、会话恢复不重放、压缩、429 无重试、Chat/Responses 共 7 请求。Windows unpacked 包已包含 worker 主文件和 dependencies；包内 SDK 实际 import 157 exports 成功，package.json 精确版本 1.5.2。已校验包含 258 样本的 starter manifest 尺寸和三个安装音色索引一致；包内 Python 3.12.4 可启动，但 LPAC 工作进程仍 ACCESS_DENIED，因此 Agent 任意 Python 执行保持关闭。未打付费模型请求。
- 上下文窗口实现（2026-11，当前代码状态）：新增确定性、无损的文本窗口切分（默认最多 12,000 UTF-16 字符，优先句末/空白，保留原有字符与 grapheme），生产 DAG 为每个窗口创建可恢复 `pi-segment:N` 节点；这只是模型请求运行段，不是影片时间章节。每次宿主 prompt 现在只附全局简报（12,000 字符上限）、当前旁白文本窗口、最多 4,000 字符前段 handoff、样式与画布元数据，不再附带完整 `lemoProductionContext`（其中含全文/全部 cues/shots）。`TREATMENT.md` 的 `## Segment handoff` 摘要受 host 字符上限验证并持久化到 Pi checkpoint，后续段以此续接。全局旁白 cue/timing 仍由 host 保留并用于最终整片合成；Pi SDK compaction 显式设为 enabled、reserveTokens=16,384、keepRecentTokens=12,000，retry 仍关闭。字符数是提示规划上限，不是 token/contextWindow 保证；精确序列化请求上限仍由网关 admission 执行，按字符估算不能替代 token/cost 账本。聚焦测试 23/23、App/Electron TypeScript 检查通过、production build 通过；未完成紧凑窗口视觉 QA、段间真实长文模型测试和 packaged worker utilityProcess IPC harness。没有发起付费模型请求。
- 剩余验收：长文对话框正常/紧凑窗口可视 QA、多草稿中途失败恢复、长文入口与生产门禁集成自动化、长文分段真实时间线与人工创作 QA、Windows packaged worker utilityProcess IPC harness（SDK import 与 standalone offline worker smoke 已通过；直接启动打包主程序未生成回执，不计为通过）、真实付费模型验收（需单独授权/测试凭证）。金额预算模式保守禁用图片工具结果，避免无法证明的图片计费上限；无金额上限时识图模型保留真实审片图像。

## 历史实施基线（下列为接线前记录）

- 工作目录：I:/opc。工作区有大量已有未提交变更，包括 Lemo v1/v2 清理、v3 工作台和漫剧功能；保留这些改动，不执行 reset、清理或整批提交。
- 根依赖仍为 HyperFrames 0.8.40、Remotion 4.0.524、three 0.170.0。计划中的版本表是历史调研，不等于已升级。
- 当前生产 authoringVersion 仅允许 v3 新建；v4 尚未接线。
- Pi 尚无生产 worker；正在建立独立子包和零付费协议验证，核实真实 SDK API 后再接入。
- 当前上游导出默认 upstream，审片使用 Electron；一致性改造待实施。

## 正在执行

1. 独立 Pi worker：固定实际可获取版本、工具往返、会话持久化、隔离配置和无额外请求验证。
2. 当前生产接线审计：模型、账本、图结构、暂停恢复与 v4 迁移边界。
3. 已建立 production-policy、narration-pauses、pi-film、agent-audio、film-captions 契约。Pi 状态独立写入文档 piFilm，旧项目不自动迁移；codeVideo 设置可选，不改变旧默认。
4. 新增宿主文件桥、工具回执、模型协议映射和预算预检。文件桥禁写 material/out，限定源文件与体积，要求先写 Treatment 才能看 demo；仍需补完整结构门禁及工具清单。
5. 初批五文件 107 项测试通过（包含原 vox-production 70 项）；文件桥与回执另有 6 项、字幕与预算 4 项通过。应用和 Electron 两套 TypeScript 检查通过；后续改动仍需再次检查。
6. 三协议网关 23 项测试通过，原生请求/工具/图片不经过文本适配器。Pi 1.5.2 实际 SDK 在 Electron Node24 上通过 7 请求离线验收：工具与图片、恢复不重放、压缩、429 不重试、Chat 与 Responses。
7. 实际 Electron utilityProcess 启动验证通过（修正 ESM 顶层 await app.whenReady 的启动死锁）；宿主 session/process/tool router 已建立，尚未切换生产 v4 默认入口。
8. 上游 still 审片适配器已接入，真实无付费样片抽帧测试通过；独立页面 probe 已验证实际 DUR/字体/TEXTS/EV 与 captions=0/1，仍待组合进 finish 门禁。
9. CC0 Karoryfer 三乐器包已落地并加入安装资源：73.0144 MiB，258 FLAC，alto_sax/jazz_bass/erhu，原 LICENSE + SHA 清单，实际 48k 合成通过。Pi worker 也加入资源并在 build 阶段构建。
10. AppContainer+LPAC 真实令牌与 Job Object 超时/关闭回收已通过；须创建唯一临时 profile 并清理，最小环境不能缺 USERPROFILE 等变量。Python 文件/网络/内存限制仍在验证，不能宣称生产沙箱可用。

## 接线注意

- v3 入口直接使用 createConfiguredTextLlm；旧 SDK 网关不在生产路径。Pi 必须新增 v4 分支。
- Responses 文本适配器会删除 tools，不可用于 Pi；需原生协议透传。
- 旁白 cue 可能只是换行切片，停顿只能由宿主认定的完整句末批准，不能把任意字幕边界当句末。
- 沙箱、最终画面采样、音频检测和已提交付费回执必须由宿主提供，Agent 自述不能作为验收证据。

## 验收原则

测试桩通过不等于真实模型通过；有声样片需检查最终解码视频及音轨。缺失的系统隔离能力不得以普通子进程冒充。保留原片、用户项目与默认模型配置。不得将 unknown 请求自动重发。
