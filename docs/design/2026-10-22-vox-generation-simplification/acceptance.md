# Vox 实施验收与真实样片边界

**2026-10-24 续接：** 本页保留 10 月 23 日模板自动链的历史证据。新增的创意动画入口、Lemo 59 风格收录 / 6 适配、后台逐镜 AI 代码与最多一次修复、跨进程组件恢复和混合样片，见 [创意动画当前实施验收](../../plans/2026-10-24-creative-animation/acceptance.md)。新版代码真实组件验证已完成，正式产品 IPC 因本机 `LICENSE_REQUIRED` 尚未验收；不以组件集成替代正式入口。最新界面报告已更新为 **97 项 / 32 张截图**，下方 85 / 28 为历史次数。

**同日质量收尾：** 当前审查为 v3，增加最终字号/背景约束，保存的 AI 镜头未通过。新输出 [四模板质量片](I:/opc/.artifacts/creative-quality-v3/creative-nasa-quality-v3.mp4) 为 23.88 秒 1080p，直切、−16 LUFS / −1.4 dBTP，完整解码和抽帧通过；不作为 AI 代码或整片审美通过证据。最新 168 项质量 + 52 项兼容、typecheck/build 通过，额外八项 shell 合同失败仍单列。此质量收尾未调整第三张页面布局。

更新：2026-10-23。按用户选择的第三张 process-outline 实施。页面减法、三预设契约、主进程任务链及定向恢复验证已完成；数据柱形图已完成真实完整自动链和基础媒体/人工抽帧验收。纸拼贴、地图与档案的完整样片仍未验收通过。

## 实际交付

1. 左侧集中「文案 / 分镜 / 配音字幕 / 成片」，直接选择镜头；中央真实预览下方编辑旁白/画面描述，高级能力进入抽屉。固定底栏负责项目主操作，局部镜头操作保留明确范围。
2. 自动制作设置提供「纸拼贴讲解 / 数据与地图 / 档案叙事」。数据要求至少两条有出处的数值；地图坐标校验范围；档案引用已导入图片并要求出处和许可。高级入口可锁定自定义镜头。
3. `src/shared/vox-production.ts` 定义版本化设置、锁定、来源、依赖节点与运行记录；`electron/vox-production-service.ts` 持有调度，`vox-production-runtime.ts` 接通画面规划、素材/抠图、配音/排时、模板动画/编译、渲染与媒体门控。
4. 应用保持打开时可离开 Vox 页面继续执行。暂停/取消停止新节点派发，等待在途请求保存；不承诺服务商没有提供的远端取消能力。关闭应用后不继续派发，重启先暂停恢复，未保存结果的付费节点进入 unknown。
5. 请求先持久化稳定 ID 和输入指纹。图片同步响应的 URL/base64、异步 task ID 在下载/轮询前落盘；恢复只下载或查询已保存结果，不发送新的生成 POST。提示词、模型/参数或参考图内容改变时拒绝旧响应。没有回执不代表服务商确认无结果。
6. 主按钮根据真实状态显示「自动制作… / 暂停制作 / 继续自动制作 / 云端结果待核对」。手动整片渲染进行时显示「正在生成成片…」并禁用重复自动启动；空镜头不能启动。进度中提供「恢复已保存结果」与需记录依据的无结果人工核对。
7. 修复纯标点旧镜头触发 TTS 的问题；恢复旧计划也先检查可读文本。旁白编辑继续保留同句数 cue 的 ID/时间，同文本不清配音，实际变化使旧配音/对齐失效。
8. 数据预设保留来源数值精度和单位，负数使用共享零基线。自动柱形图只在首个未锁定镜头短暂揭示，数值标签固定为来源原值；后续镜头从完整图表开始，并匹配「二零二四年」等旁白标签，以估算句级时间高亮对应年份。新增表现字段为可选，旧项目的手动模板继续按原 payload 读取。

截至 10 月 23 日的边界：创建流程先拆出镜头，自动画面规划保留其 ID，只补充标题和画面提示；动画按预设装配现有模板与语义 cue，锁定的自定义代码进行编译校验。当时没有新增自动 AI 代码创作或任意重写镜头结构的能力。10 月 24 日已新增逐镜代码链，详见页首续接；数据预设仍不创建生图节点，档案素材来自导入资料，背景仍可能调用生图。

## 代码、构建与界面验证

| 检查 | 最新结果 | 范围与限制 |
| --- | --- | --- |
| 聚焦 Vitest | 9 文件 / 93 项通过 | 图片响应恢复、Image Lab、Vox 预设/依赖/持久调度、数据精度/零基线/句级高亮、旧动画 payload、脚本拆分、主操作、语义 cue、旧批次持久化 |
| `scripts/typecheck.ps1` | 通过 | renderer / Electron / scripts 三套 `--noEmit` |
| `scripts/build.ps1` | 通过 | renderer 生产构建及 Electron main/preload；保留已有 Node 模块 browser externalization 警告 |
| Vox 实际页面 | 85 项检查 / 28 张截图通过 | 最新运行；真实 React + Vox runtime，隔离 Electron，模拟 API/保存，无付费调用 |
| 共享漫剧定向回归 | 此前 22 项检查 / 4 张截图通过 | 生产 Electron、隔离 profile、离线持久化夹具；数据动画局部修正后未重复此项 |
| 数据完整自动链 | 19/19 节点完成 | 正式 IPC、真实文本/配音服务、4 镜头；跨页继续、重启复用、其他项目未受影响 |
| 数据本地视觉修正 | 通过，0 新增付费调用 | 正式 IPC 重算失效动画/编译/渲染/验证，五个付费节点 ID/attempt 保持不变 |

聚焦命令：

```powershell
& 'I:/nodejs/node.exe' node_modules/vitest/vitest.mjs run tests/vox-data-chart.test.ts tests/vox-animation.test.ts tests/media-providers.test.ts tests/image-lab.test.ts tests/vox-production.test.ts tests/editorial-script.test.ts tests/vox-project-action.test.ts tests/editorial-cue-plan.test.ts tests/director-batch-persistence.test.ts --pool=threads --maxWorkers=1
$env:PATH = 'I:/nodejs;' + $env:PATH
pwsh -NoProfile -File scripts/typecheck.ps1
pwsh -NoProfile -File scripts/build.ps1
& 'I:/opc/vendor/python/python.exe' scripts/qa-vox-process-workspace.py
& 'I:/opc/vendor/python/python.exe' scripts/qa-director-process-regression.py
```

Vox 检查包含普通 1536×1024、紧凑 1040×720、窄窗口 860×720、深浅色、实际 200% 缩放、100 镜头/长标题、编辑保存重载、模板草稿、抽屉 Tab/Escape/焦点返回、模拟渲染忙碌/失败与三预设输入条件及数据单位输入。85 项含多次键盘/几何断言，不表示 85 个相互独立的端到端用例；渲染忙碌等另有脚本 `expect`。截图等待字体和有限入场动画稳定，没有关闭产品动态效果来掩盖遮挡。

- [Vox 当前界面报告（已更新为 97 项 / 32 张）](implementation-evidence/report.json)
- [漫剧定向回归报告](implementation-evidence/comic-regression/report.json)
- [历史同画布设计比较](design-qa.md)
- [最新构建日志](I:/opc/.artifacts/vox-production-data/final-build.log)

界面预览中的城市图取自已选设计图，仅用于隔离夹具，不是生图质量证据。真正素材证据见下方样片。

额外的只读正式项目预览检查已进入 `data-vox-ready=true`，首个桌面深色状态的页面溢出与主操作几何断言通过，但隐藏 Electron 窗口的 `Page.screenshot()` 超时，因此这次附加截图检查记为未完成，不计入上表的 85 项 / 28 张已通过界面回归。没有启动新的生成；持久化项目仍为 19/19 完成且无运行节点，已仅停止该隔离检查进程。详见 [附加预览检查记录](I:/opc/.artifacts/vox-production-data/ui-report.json)。

## 真实完整数据短片

**[nasa-temperature-auto.mp4](I:/opc/.artifacts/vox-production-data/nasa-temperature-auto.mp4)**：23.88 秒、1920×1080、775,478 字节。SHA-256：`161fe8e24971b4eac42d227571c054c4c0fcf3196f7c091fe920c34a0087b3cd`。

| 证据 | 实际结果 |
| --- | --- |
| 项目 | `61d661ee-0892-472d-a9c2-863144ac4475`，原始旁白、数据与单位输入，4 镜头 |
| 数据来源 | 已保存的 [NASA GISTEMP v4 CSV](I:/opc/.artifacts/vox-production-paper/gistemp-source.csv)；J-D 年平均异常以 1951–1980 为基期，2000 / 2010 / 2020 / 2024 年分别为 0.39 / 0.72 / 1.01 / 1.28 ℃，不是预测 |
| 自动链 | 原运行 `b4c2031a-3be4-4e66-9063-01c29e9c5bf2`；计划、4×旁白/排时/动画/编译、渲染、验证，共 19/19 节点完成；未点击局部生成按钮 |
| 服务 | Moe `gemini-3.7-flash-high` 文本一次，火山 `seed-tts-2.0` 配音四次；不创建生图/抠图节点 |
| 生命周期 | 离开 Vox 页并进入另一项目后继续运行；真实应用进程重启后复用已保存计划和首段旁白，原请求 ID 保持不变；另一项目内容未改变 |
| 本地修正 | 运行 `2b99b82f-5d07-4fcb-9d6d-0b0648818296`；动画表现版本使本地动画/编译/渲染/验证失效重做，全部五个付费节点保持原 ID、attempt=1；Electron 默认 session 的 HTTP(S) 被阻止且无请求尝试 |
| 媒体 | 完整 ffmpeg 音视频解码通过，非静音；峰值 −5.3 dB、综合响度 −20.7 LUFS；无黑屏区间；计划时长 23,874ms，文件 23.88 秒 |
| 人工画面复核 | 12 时点涵盖首中末与切镜，来源值、单位、标题、出处及字幕可见，未见明显裁切；后续图表不重复从零进入，按叙述年份高亮 |

首版抽帧发现每镜重播计数，导致旁白念来源值时画面仍是中间值；现已改为原值标签、一次短揭示、后续稳定图表与句级高亮。数值/高亮修正复用原计划及四段配音，未新增付费请求。原片和记录保留为 `first-pass-*`，便于复核前后差异。

通过范围是**数据柱形图完整自动链、媒体有效性与基础可读性**。高亮/字幕为实测音频总时长上的句级估算，未验证逐词声画同步，未调用 VLM；人工抽帧不代替完整听审。图表仍采用预设模板，不是自动 AI 动画代码创作，也不证明纸拼贴、地图或档案预设已成熟。

证据：[原始自动运行报告](I:/opc/.artifacts/vox-production-data/report.json)、[当前项目快照](I:/opc/.artifacts/vox-production-data/document.json)、[本地修正报告](I:/opc/.artifacts/vox-production-data/refinement-report.json)、[媒体与来源报告](I:/opc/.artifacts/vox-production-data/media-report.json)、[12 帧联系表](I:/opc/.artifacts/vox-production-data/contact-sheet.jpg)、[完整解码日志](I:/opc/.artifacts/vox-production-data/decode.log)。

## 纸拼贴受阻记录与可播放局部样片

真实运行使用生产 Electron IPC 与已配置模型：文本 `gemini-3.7-flash-high`，图片 `gpt-image-2.5-sunburst`，火山配音 `seed-tts-2.0`。模型配置未因恢复测试而切换。

| 证据 | 实际结果 |
| --- | --- |
| 项目 | `70483edb-ad11-4a34-a0c2-7e5ee0fafd88`，城市热岛文案、初始 7 镜头 |
| 自动链 | 31 个节点完成，最终运行状态 failed，存在 unknown 图片节点 |
| 页面生命周期 | 真实离开 Vox 路由后主进程继续执行，重新打开已持久化项目及前次进程产物，保持原请求 ID |
| 阻塞节点 | `image:shot-3-b:shot-3-b-background` |
| 阻塞请求 | `01b87434-337e-47db-990e-5747b89b36fb`，发出约 34 秒后 `fetch failed`；无响应回执、图片或 task ID |
| 处理 | 保留 unknown，未重复提交。新增回执机制不能补回这次已丢失的旧响应 |
| 局部导出 | 仅克隆已完成的 `shot-1` 与 `shot-2-a`，使用正式渲染器导出；未修改源项目/原运行，未调用模型 |

样片：**[urban-heat-partial.mp4](I:/opc/.artifacts/vox-production-paper/saved-sample/urban-heat-partial.mp4)**。23.46 秒、1920×1080、5,146,706 字节，包含真实生图、透明主体、配音和语义动作。

- 完整 ffmpeg 解码通过，存在视频和音轨，音轨非静音；峰值 −5.9 dB、综合响度约 −21 LUFS。
- 未检测到黑屏区间；对首中末、转场等 10 个时点抽帧，未见明显缺图或字幕裁切。
- **观感未通过**：第二镜头背景与独立主体重复建筑内容；动作主要是揭示/强调，尚不能证明成熟的解释性动画。
- **精度限制**：字幕为基于真实音频总时长估算的句级时间，语义动作标记为 estimated；未做词级对齐或 VLM 审片。
- 这是已完成镜头的本地局部渲染，不能作为纸拼贴完整自动链成功证据。完整纸拼贴全片、地图与档案叙事的真实整片样片仍待完成；数据柱形图完整成功证据见上节。

证据：[真实运行记录](I:/opc/.artifacts/vox-production-paper/report.json)、[源项目快照](I:/opc/.artifacts/vox-production-paper/document.json)、[局部样片/媒体报告](I:/opc/.artifacts/vox-production-paper/saved-sample/report.json)、[10 帧联系表](I:/opc/.artifacts/vox-production-paper/saved-sample/contact-sheet.jpg)、[解码日志](I:/opc/.artifacts/vox-production-paper/saved-sample/decode.log)。

## 恢复验证及未验证项

- 已以聚焦测试覆盖同步下载断开、异步轮询断开、有回执复用、无回执禁止恢复、提示词/参考图变化拒绝旧结果，验证恢复不产生第二次付费生成 POST。
- 真实运行中的纯标点 TTS 请求已由服务商明确返回 `No readable text!`；仅在保存该无结果依据后恢复原运行，并增加可读文本保护。另一未知生图请求没有类似依据，仍保持锁定。[TTS 核对证据](I:/opc/.artifacts/vox-production-paper/speech-rejection-recovery.json)。
- 尚未真实验证新回执机制在所有服务商及每种网络中断下的完整上传/下载恢复，也未验证供应商取消能力。回执恢复不等于完整字节级续传。
- HTML 已有两次六镜 48.78 秒 1080p 基准通过，耗时约 303/366 秒、进程树私有内存峰值约 2.70/1.56 GB；4K 在 3.5 GiB 保护线上中止，24 镜、并发和新组件链未测。Vox 词级对齐与 VLM 审片未做；AI 漫剧远程角色连续性、口型、完整上传下载断点恢复仍未验证。
- `tests/director-product-flow.test.ts` 有 4 条已对照 HEAD 的既有源码断言失败；旧 `qa-motion-comic.py` 期待 8 阶段而现有页为 7 阶段加项目资产标签。它们未计入通过范围，本次漫剧只做生产 Electron 定向回归。
- 未做全应用辅助技术审计或独立减少动态效果专项验收。离线 UI/API 测试不能代替真实服务商与成片观感验收。

## 当前阶段与剩余门槛

| 阶段 | 当前状态 | 剩余门槛 |
| --- | --- | --- |
| A 页面减法 | 已完成本次范围 | 保持固定入口、按需高级与共享漫剧兼容 |
| B 预设契约 | 已实现；数据柱形图真实整片通过 | 纸拼贴、地图与档案实际完整证据 |
| C 自动任务链 | 数据 19/19 节点完整成功；纸拼贴 31 节点后阻塞 | 原未知请求核对；其余预设完整链与观感检查 |
| D 脱离页面执行 | 主进程持有、切页继续及持久恢复已验证 | 新回执机制更多服务商真实中断验证；不承诺关应用后继续执行 |
| E 真实自动样片 | 23.88 秒数据整片通过；23.46 秒纸拼贴仅局部 | 纸拼贴素材重复与解释性动作、地图/档案完整样片、语音同步精度 |

下一步继续修复纸拼贴主体/背景重复与解释性表达，补齐地图和档案完整样片；原受阻任务仅在找回结果或取得服务商无结果依据后恢复。数据柱形图的成功与其他预设的缺口分别记录，不将单一样片结论扩展到全部动画能力。
