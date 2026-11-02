# 图文生成与创意动画测试报告

日期：2026-11-02（Asia/Shanghai）。分支：`codex/storydream-project-plan-20261102-upload`，基线 `458257114323a896a9f83514951f9946de5f316f`；本轮修改尚未提交或推送。

## 测试结论

两条流程本轮指定的核心回归、桌面界面和本地媒体输出检查均通过。图文生成按当前产品的“短片生成（图文素材·配音·剪辑）”链路验收；创意动画按 Lemo/Vox 现有入口与新增官方 SDK 文件会话分别验收。没有把离线响应或界面夹具称为真实 AI 创作完成。

| 范围 | 结果 | 主要覆盖 | 原始证据（仓库根目录相对路径） |
| --- | --- | --- | --- |
| 图文短片核心回归 | 13 文件，263/263 | 任务输入、文案/配图运行器、生图尺寸、批量/错误处理、生命周期、取消与双交付 | `.artifacts/two-flow-20261102/graphic-text/regression-final.json` |
| 普通短片实际渲染 | 3 种交付模式全部通过 | 真实 Electron/FFmpeg 输出；MP4、剪映草稿、双输出；本地 SAPI 配音实测时长、字幕共享时钟、BGM 循环、缓存与取消 | `.artifacts/two-flow-20261102/ordinary-render/report.json` |
| 图文/Pixelle 实际桌面 | 32/32 | 1440×900、1040×720；31 模板选择、原参数默认值、视频素材预检、文件选择失败保留、画幅与双输出 | `.artifacts/two-flow-20261102/graphic-text-ui-final/report.json` |
| 创意动画核心回归 | 11 文件，294/294 | 风格/原生项目、上游生产、阶段计划、增量续跑与阶段存储 | `.artifacts/two-flow-20261102/creative-animation/regression.json` |
| 创意动画隔离 Electron | 212/212 | 59 个离线封面、样片播放与网络失败、成片全屏、音乐/设置持久化、失败反馈、100 镜头、深浅主题、正常/紧凑/窄窗口和 200% 缩放 | `.artifacts/two-flow-20261102/creative-animation-ui-final/report.json` |
| Pixelle 专项回归 | 9 文件，205/205 | 原版 worker、模板参数与交付链 | `.artifacts/pixelle-validation-20261102/regression.json` |
| Pixelle 实际交付矩阵 | 31/31 模板；124 个媒体引用；3 个运动模板 | 实际 MP4/草稿媒体、字幕与音轨；视频运动及短源补齐；三张联系表目检 | `.artifacts/pixelle-validation-20261102/matrix/delivery-verification.json`、`clips/report.json` |
| 官方 SDK 会话/工具/阶段 | 3 文件，97/97 | 37 项请求与指纹契约、43 项阶段存储、17 项受控 MCP 工具；包含真实子进程故障 | `.artifacts/lemo-session-20261102/regression-final.json` |
| 官方 SDK 实际往返 | start、写入、resume、cancel 通过 | SDK 0.3.314 / CLI 2.1.314；本机提供商 3 次请求、付费 0 次；取消后 1 条 unknown 阻断续投 | `.artifacts/lemo-session-20261102/offline-session-report.json` |
| 类型与构建 | 全部通过 | 应用/Electron/scripts/独立 worker 四套 TypeScript；renderer、Electron、worker 构建；固定上游完整性 | `.artifacts/two-flow-20261102/typechecks.json`、`builds.json` 及构建日志 |

以上测试套件有重叠，例如阶段存储同时出现在创意动画和 SDK 专项内；不将各项相加为独立测试总数。之前 C4 的 320 项与旧日期记录保留在各自目录，不冒充本轮新增代码的验收。

## 本轮修正

1. 按现有生图契约修正两条陈旧尺寸断言：显式 2K 方图为 2048×2048，默认 16:9 编辑为 2048×1152。尺寸专项同时通过。
2. 补齐生命周期测试抽取真实主进程处理器所需的新依赖；保持原取消、活动所有权与持久化断言，不放宽测试超时。生图活动测试中项目额度预留为局部替身，不据此宣称真实额度服务已验收。
3. 创意动画 QA 补齐仅允许当前项目本地影片夹具的媒体 URL 解析；采用当前“按此风格创作全片”按钮。原生模式使用项目模型配置，Vox 模式验证素材一致性面板，模式切换后确认创作要求保留。
4. QA 脚本移除失效 I 盘 Node 路径假设，支持输出目录、本地运动视频和实际短片报告的环境变量。短片界面种子仍要求真实渲染报告 passed，未用伪造成功替代。
5. 官方 SDK 文件会话接入宿主网关/原账本、固定阶段指纹、持久化会话及工具工件记录。修正回合预算结束后的 CLI 非零退出处理、取消时等待网关关闭的顺序，以及非法端口的统一错误码。

## 实际与模拟边界

- 普通短片/Pixelle 使用真实编码、解码和本地文件交付；素材是工程测试图、运动色条与本地语音，不是模型生成作品。草稿媒体引用已检查，尚未在剪映应用实际打开。
- 图文桌面运行真实应用与数据库，采用隔离授权夹具；不验证正式激活或真实供应商。创意动画运行真实 React 页面与 Electron 媒体播放，API/持久化及输出影片为隔离夹具。
- 官方 SDK/CLI 和 MCP 工具实际执行，提供商响应来自本机测试服务。先写中文 `TREATMENT.md`，达到回合上限后同会话续跑；重复提交及改变 brief 被阻断，取消未知请求保留账本。阶段工件 `deliveryStatus` 始终为 `unverified`。
- 代表正常/紧凑界面与 Pixelle 三张联系表已目检；未发现工程夹具丢图或横向溢出。联系表中的色条、测试字幕及原模板装饰不代表真实美术或听感验收。
- 本轮未调用付费模型、未读取用户凭据、未改用户项目/样片/上游源码、未改 package/lock；原 CSS 与封面测试改动保留。

## 保留的失败记录

- 图文初轮 `graphic-text/regression.json`：251 项通过、9 项失败及 6 个未处理错误；修正夹具依赖与旧尺寸断言后，原 12 文件加尺寸专项共 263 项通过。
- 创意动画初轮 `creative-animation-ui/report.json`：9 项后缺少媒体接口；后续 `stale-action-selector-attempt.json` 与 `stale-service-selector-attempt.json` 记录旧选择器失败，最后完整 212 项通过。临时目录缺失的环境失败也单独保留。
- `lemo-session-20261102/invalid-port-error-attempt.json`：新增契约测试定位端口越界返回原始 URL 错误，修正后 97 项通过。测试 provider 字段初次类型错误已修正；旧类型结果保留为 `typechecks-before-test-fixture-fix.json`。
- 普通短片首次 GUI 启动没有可靠日志且进程未完成；仅终止该次自建进程树，保留中间文件。改用隐藏启动和标准输出/错误日志后，在 `ordinary-render` 独立目录完整通过。

## 仍未完成

- `electron/main.ts` 影片生产入口仍使用旧 `createLemoUpstreamOperations`；新增宿主目前提供受控文件会话，未接整片生产按钮。
- Windows 系统级执行隔离、上游生成脚本执行、素材/渲染/声音桥接、跨阶段依赖失效和产品恢复确认流程。
- 真实渠道的工具/图片/SSE 与预算兼容、官方 Agent 原创有声片、完整视觉和听审、剪映实开及干净 Windows 安装。
- MoneyPrinter 网络素材来源与授权记录闭环。

这些项目继续在[剩余工作状态对照](remaining-work-status-2026-11-02.md)保持未完成，不以本轮测试通过整体关闭 C1–C4 或迁移计划。机器可读汇总及当前源码哈希见 `.artifacts/two-flow-20261102/verification.json`。
