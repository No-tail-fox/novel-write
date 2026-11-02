# Lemo 官方 SDK 新路径：主界面整片生产接线验收

日期：2026-11-02（Asia/Shanghai）。分支：codex/storydream-project-plan-20261102-upload；基线：458257114323a896a9f83514951f9946de5f316f。本轮实现尚未提交或推送。

## 1. 当前结论与范围

按用户“目前只保留新路径，旧项目先不考虑”的要求，原生 Lemo 整片生产只走官方 SDK v4。主进程不再调度旧 native 创作循环；旧版本任务拒绝执行，不做迁移或兼容回退。共享的素材、时间轴、渲染器与纯解析工具继续复用，不影响图文短片和其他制作模式。

主界面所用制作服务现已接通：素材与旁白准备 → 实测旁白时长/唯一时间轴 → 官方 SDK 创作 → 宿主实际抽帧反馈 → 独立完成回执 → 连续画面渲染 → 字幕/音频合成 → MP4 登记。此前“新链仅有文件会话、未接主生产入口”的状态已过期。

本轮由两类证据共同验证：真实 React 隔离 Electron 界面测试验证入口、原任务恢复和交互；整片脚本调用同一制作服务/runtime，使用真实官方 SDK、Electron 捕帧和 FFmpeg 生成 MP4。整片脚本使用本机确定性 Messages 响应、本地图片和 Windows SAPI，不冒充一次真实付费渠道的 GUI 点击到作品交付验收。

## 2. 实现落点

| 部分 | 当前行为 | 主要文件 |
| --- | --- | --- |
| 主入口与制作图 | 新 native run 固定 v4；素材、抠图、声音和测长完成后执行 official-authoring，再经 official-ready 进入渲染/质量检查；缺少新宿主能力在付费素材操作前阻断。 | electron/main.ts；electron/vox-production-service.ts；electron/vox-production-runtime.ts；src/shared/lemo-upstream-graph.ts |
| 配置与独立运行时 | 使用所选项目的 Messages 协议/模型；检查固定插件、worker 与独立 Node 20+；排除 Electron 可执行文件并清理注入型环境变量。 | electron/lemo-official-runtime-config.ts；electron/lemo-agent-session-runtime.ts |
| 素材与时间轴桥 | 图片规范化为 PNG 并限制单图/总大小，工件按独占方式创建；导入素材清单带哈希。已批准文案、实测音频和绝对毫秒 cue/shot 窗口送入 SDK，最终字幕与混音复用同一时间轴。 | electron/lemo-official-production.ts |
| 官方工具循环 | read_library 校验固定清单与逐文件哈希；review_film 返回当前源码实际渲染的三张图片；模型收到图片后，在后续轮次调用 finish_film。宿主工具开始/完成事件先持久化。 | services/lemo-agent-worker/production-tools.ts；session.ts；worker.ts；src/shared/lemo-agent-session.ts |
| 完成与恢复 | SDK completed 单独不表示作品可交付。ready 检查源码、素材、review 图片、finish 回执、实际工具操作 ID 和未阻断账本。固定 run/stage；原账本或阶段身份缺失时不新建替代记录。 | electron/lemo-official-production.ts；services/lemo-agent-worker/request-ledger.ts |
| 取消与恢复界面 | pause/cancel/shutdown 传播取消；等待宿主清理后释放 worker/网关。unknown 保留原任务，不允许新 run 绕过。界面可记录人工核查信息，但不因此清除 SDK 请求账本。 | electron/lemo-agent-session-runtime.ts；electron/vox-production-service.ts；EditorialCollagePage.tsx；VoxProductionProgress.tsx |

当前执行能力为受控文件/MCP 工具与宿主沙箱 Chromium 捕帧；没有开放任意生成脚本、Shell 或通用操作系统执行。独立进程和环境过滤不被称为通用系统沙箱。

## 3. 实际整片与恢复证据

最终整片目录：.artifacts/lemo-official-production-20261102/run-1793594163773。

| 验证项 | 实测结果 |
| --- | --- |
| 官方会话 | SDK 0.3.314 / CLI 2.1.314；write_text → review_film → finish_film → end_turn，共 4 次本机请求、0 次付费请求、0 次外部获取尝试。 |
| 图像反馈 | 3 张 1920×1080 实际审片帧进入 SDK 后续请求，图片哈希不同；finish 与当前审片和源码绑定。 |
| 声音与时间轴 | 两段真实 SAPI WAV，实测 2333.75 ms / 2223.8125 ms；保留中文原文和绝对时间窗，整片约 4.916 秒。 |
| 实际 MP4 | 1920×1080；实际解码 24 fps / 118 帧；最大 PTS 误差 0.0000003333 秒；包含音轨与中文烧录字幕，qualityObservations 为空。 |
| 画面目检 | 1 秒、3.5 秒成片抽帧的两句中文字幕清晰；本地 Pixelle 样图与确定性花园动画仅用于技术验收。 |
| 恢复防护 | 源码、素材清单、审片图片、finish 回执的篡改，以及账本、阶段状态、阶段身份缺失共 7 项全部拒绝；缺失文件不被重建，恢复原件后可恢复 ready。 |
| 请求不重投 | 7 项负例和恢复全程本机请求数量保持 4。 |

最终 MP4 SHA-256：5861b190153bf336a8c2dbcc2446d52418f1e1e117f2c2c9d267f517c74027f6。

原始证据：

- report.json：会话、请求/图像、素材/旁白、时间轴、成片路径/哈希、恢复结果。
- final-frame-timing-evidence.json：实际 MP4 解码帧序号与 PTS。
- final-mp4-frame-1s.png、final-mp4-frame-3.5s.png：成片抽帧。
- session-receipt.json、review.json、finish.json、film.json、阶段/工具记录：位于上述运行目录内固定 lemo-official/runId/film 路径。

## 4. 回归与构建

- 扩大回归：最终同轮 **36 文件、855/855 通过，0 失败、0 pending**。上一轮 854/855 的目录清理错误单独保留在 regression-before-cleanup-fix.json；修复测试超时后异步操作仍在执行、清理抢先删除目录的竞态，保留原 5 秒标准和全部断言，不改生产代码。另注入 1 ms 超时，确认仍正确报告失败且清理无残留。
- 官方生产界面：62/62，普通 1536×1024 与紧凑 1040×720、深浅主题、failed/unknown 与原会话继续，8 张截图；证据 .artifacts/lemo-official-ui-20261102/report.json。
- 四套 TypeScript 全部通过：应用、Electron、scripts、独立 worker；renderer/Electron 与 worker 构建均退出 0。renderer 保留既有 bundle 体积提示。
- 宿主传输、材料/硬链接/账本缺失保护、阶段恢复与旧入口拒绝均在扩大回归范围。测试范围存在重叠，不相加。
- 旧入口测试改为“拒绝旧版本且无新副作用”或 v4 场景；原解析、诊断、补丁、哈希、共享字体修复和轮次上限覆盖保留，不使用 skip 隐藏失败。

验收中发现并修复两个真实媒体问题：TTC 的 cmap 偏移本为文件绝对偏移，额外叠加成员偏移会误报缺中文字形；短 hard-cut 合成补齐输出 fps/CFR，避免 FFmpeg 默认帧率改变 900 ms 切点。对应新增真实字体和实际解码帧时钟回归。

最新类型/构建及扩大回归记录位于 .artifacts/lemo-official-production-20261102/verification；verification.json 汇集当前源码、测试、原始报告与 MP4 的 SHA-256。历史两流程、文件会话和 Pixelle 验收报告保留，不能用本轮新源码覆盖其旧哈希或冒充全部重跑。

## 5. 尚未关闭的项目任务

1. 真实外部 Messages 渠道的工具、图片、SSE、预算和取消能力，以及真实模型创作的 15–30 秒原创有声片。
2. 作品艺术效果、逐句听审、更多风格/更长时长及横竖画幅验收。
3. Lemo 新路径的剪映草稿/双输出恢复闭环；图文 Pixelle 已通过的双输出矩阵不能代替此项。
4. SDK worker、独立 Node、CLI 的完整安装发行资源、运行准备/回滚与干净 Windows 安装验收；当前缺资源会在预检中明确失败。
5. 普通短片网络素材提供商接入、剪映实际打开与历史 UI 失败证据映射等独立待办。

旧项目迁移、旧 native 续跑或回退不在当前范围。当前完成的是新路径主生产接线及本地技术验收，不是所有项目任务关闭。

## 6. 工作区与复现

保留已有无关修改、用户项目、样片和固定上游源码；本轮无新增付费模型调用，无 package/lock 调整，无 commit/push。中文文档保持 UTF-8。

整片离线复现入口：node scripts/run-lemo-official-production-qa.mjs；只连接脚本建立的本机 Messages fixture，使用 D 盘 .artifacts 隔离目录。扩大回归为 tests/lemo-*.test.ts，加 tests/vox-production.test.ts、tests/storybound-font-cmap.test.ts、tests/storybound-sidecar.test.ts；具体命令与当前文件哈希随 verification.json 保存。
