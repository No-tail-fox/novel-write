# Lemo 独立 worker（多协议试用版）

## 2026-11-03：当前行为

创意动画生产入口支持按已保存的模型配置选择三个协议：Anthropic Messages 使用 Claude Agent SDK 0.3.314；OpenAI Chat Completions 和 Responses 使用 AI SDK 7.0.159 与 @ai-sdk/openai 4.0.106。依赖版本在 worker 自己的 package-lock.json 固定，不修改 Lemo 上游插件。

AI SDK 负责原生请求、工具参数和多轮消息的协议转换。宿主按轮次先保存完整供应商回执和会话状态，再执行原有受控工具；没有开放 Shell、任意联网、自动安装或 SDK 自动工具执行。工具整批验证通过后才开始执行，审片图片必须进入下一轮，才能接受 finish_film。

- 三种协议均须先通过设置页的 Lemo 能力验证。只支持协议名并不意味着任意模型均能创作；模型和渠道还必须支持工具、图片输入、多轮反馈、取消与足够输出额度。能力验证会真实调用所选渠道，须由用户主动发起。
- 新后端保存协议、版本、会话身份、配置指纹、消息和审片状态。未完成请求、未结算工具和不匹配身份会阻断恢复，不自动重试未知结果。
- Chat / Responses 按总请求数、每阶段轮数、单次输出 Token 和固定总时限控制；暂停不会重置时限。没有可信渠道价格，故不提供美元费用上限。Messages 继续使用 SDK 的估算费用限制。
- 素材、旁白、字幕、渲染、镜头修复和成片登记继续由原有宿主流程负责。执行器返回成功仍不代表成片质量已验收。

## 当前构建与本地验证

使用独立 Node.js 22+，先在仓库根目录安装根依赖，再运行：

```text
npm ci --prefix services/lemo-agent-worker --ignore-scripts --no-audit --no-fund
npm run build:lemo-worker
npm run typecheck
npm run build
node node_modules/vitest/vitest.mjs run tests/lemo-native-provider.test.ts tests/lemo-native-session.test.ts
```

本地整片 QA 使用 scripts/run-lemo-official-production-qa.mjs；通过环境变量 STORYDREAM_LEMO_QA_PROTOCOL 选择 openai、responses 或 anthropic。模型响应由本机夹具提供，真实执行文件工具、Electron 审片、配音合成、MP4 导出和镜头修复。不会调用真实模型服务，也不能据此宣称真实渠道或审美质量已通过。

实际试用：保存模型及协议 → 在设置中执行该模型的 Lemo 能力验证 → 在项目中选择同一模型 → 按此风格创作全片。启动失败会保留设置并在弹窗内展示错误。

## 历史记录（2026-11-02，以下阶段状态不代表当前限制）

固定 `@anthropic-ai/claude-agent-sdk@0.3.314` 和 Lemo 上游提交 `f17136060781a0068a7951245a3aa7835a7230de`。这里使用官方 SDK，不是旧六工具循环，也不修改上游插件。

## 当前已实现

- 独立 Node 进程，带输入/输出大小限制、截止时间、取消和进程树清理。
- SDK 真实初始化；检查实际加载插件的路径及 `lemo-opuscar:lemo-opuscar` 技能；不能仅凭目录存在判断成功。
- 固定插件三文件哈希；拒绝新增 hooks、文件变更和符号链接。
- Worker 环境白名单，不继承用户 API/OAuth 密钥、代理、Node 注入参数或任意 shell 覆盖。状态、HOME、临时目录都在指定运行目录。
- 预检没有用户 prompt，所有工具被禁用，SDK 的 API 地址只指向拒绝请求的本机服务；不能产生付费调用。
- 协议边界明确：生产宿主需要 Anthropic Messages；OpenAI Chat/Responses 不能靠删 tools 自动冒充适配。
- `session.ts` 与 `electron/lemo-agent-session-runtime.ts` 已接通官方 SDK 的 start/resume/cancel：宿主保管渠道凭据、原请求账本与本机网关，worker 只接收本机令牌；产品主界面的影片生产路由尚未切换。
- `stage-store.ts` 先持久化会话、输入/配置指纹、工具开始/结果及工件哈希，再报告阶段状态。unknown、未完成工具、输入/预算变化、重复 start 均阻断；SDK 完成不等于成片验收，回执保持 `deliveryStatus: unverified`。
- `creative-tools.ts` 提供受控目录列举、文本读取/原子写入和图片读取，检查根目录、链接、敏感路径和大小。工具事件落盘失败时不继续写入；写入后失败明确记录已发生副作用。没有开放 Shell、联网、安装依赖或运行生成脚本。

## 本地构建与实测

从仓库根目录，用独立 Node 20+ 执行（Windows 将 TEMP/TMP/npm cache 放到有空间的盘）：

```text
npm ci --prefix services/lemo-agent-worker --ignore-scripts --no-audit --no-fund
node node_modules/typescript/bin/tsc -p services/lemo-agent-worker/tsconfig.json --noEmit
node scripts/build-lemo-agent-worker.mjs
node node_modules/tsx/dist/cli.mjs scripts/smoke-lemo-agent-sdk.ts
```

实测报告位于 `.artifacts/lemo-agent-sdk-smoke/report.json`。测试输出 `runtime-ready` 与 `productionReady: false` 是有意区分，不能解读为影片生成完成。

## 尚未启用的生产能力

此 worker 尚未替换创意动画生产入口。不能通过增加 `bypassPermissions`、允许任意 Bash、继承全部环境变量、执行上游 setup 自动更新来绕过下一阶段。

仍需：真实渠道工具/图片/流式兼容验证；产品生产入口及阶段依赖失效接线；Windows 受限脚本执行与资源策略；素材、渲染和音频服务桥接；故障后工具副作用的产品级核对流程；安装器资源与 Node 运行时；原创有声成片及剪映实开验收。

`cwd`、工具白名单和独立进程都不是 OS 沙箱。本次预检不执行模型生成代码，不能代表 Windows 生产执行已被隔离。

## 许可和体积

Lemo 插件为 MIT；Anthropic SDK/CLI 使用其自己的法律条款，并非 MIT。保留依赖包原 LICENSE/README，不把软件 SDK 与 Lemo 的许可混写。Windows 原生 CLI 约 301 MB，真实依赖安装不能称为“零体积”。SDK依赖与类型检查独立，根项目普通构建不会隐式加载SDK。本阶段没有自动加入安装器，不让未验收功能改变现有发行物。


## 逐请求保护与真实 SDK 离线交互验证

新增 `request-ledger.ts` 与 `messages-gateway.ts`。每次上游提交前先 fsync 账本；只记录不透明 ID、请求/响应哈希、HTTP 状态与 stop_reason，不保存 prompt、响应正文或凭据。账本必须由生产宿主以稳定的 run/stage ID 定位，不能换目录绕过旧 unknown。

网关仅监听 127.0.0.1，用随机会话令牌认证。真实渠道凭据留在宿主；SDK 只拿本机凭据。固定每阶段的显式 Anthropic Messages 地址、模型与输出额度，保留 tools/image 原文，不静默降级协议、不裁成 4096 token、不跟随重定向。模型返回 max_tokens 会保留为已收到的供应商回执，不代表作品完整。

断流、超时、无法持久化、未知回执都会关闭本阶段的后续调用；包括 SDK 内部重试。重复请求即使 metadata 改变也不重新提交。429/其他拒绝不自动重试。独占锁阻止并发宿主；遗留锁、损坏账本不自动删除或抢占，恢复需要明确核对。请求数上限是显式阶段参数，不是无限纠错。

当前 SSE 在完整终止回执落盘后才交给 SDK，保留 SSE 协议内容，但**还不是逐 token 展示**。调用本机协议实测：

```text
node node_modules/tsx/dist/cli.mjs services/lemo-agent-worker/offline-gateway-smoke.ts
node node_modules/vitest/vitest.mjs run tests/lemo-agent-sdk.test.ts tests/lemo-agent-gateway.test.ts
```

`.artifacts/lemo-agent-gateway-smoke/report.json` 验证真实官方 CLI 的两轮工具拒绝→反馈→下一轮结果，以及上游截断后的 SDK 内部重试被账本阻断。响应由本机模拟服务器提供，0 次付费请求；不证明真实 Claude 渠道兼容，也不是原创视频、视觉效果或成片验收。新网关尚未替换生产入口。

## 2026-11-02：显式崩溃恢复接口

普通 `LemoRequestLedger.open()` 继续拒绝遗留锁。宿主在原 run/stage 目录先调用 `inspectInterruptedOwner(directory)` 获取 owner 快照，明确恢复时再调用 `recoverInterruptedOwner(directory, maxRequests, snapshot.fingerprint)`。恢复必须匹配快照、同主机且能确认旧 PID 已退出；任何仍存活的 PID（包括复用 PID）、无法判定的进程、旧 v1 锁或链接路径均拒绝。

恢复通过 `recovery.lock` 排他，校验原 journal 后将旧 owner 归档到 `owner-history/`，然后取得新 owner。损坏或丢失 journal 不会被截断、重建或转移到新 run。参与此协议的 owner 在写账和关闭时核对持有权，避免旧宿主误删新锁；该机制不是抵御同一用户恶意替换文件的系统安全边界。若恢复过程自身硬退出留下 `recovery.lock`，继续阻断并保留证据供人工检查，不自动递归抢锁。

取得 ledger 后，宿主可调用 `recoverStoredLemoResponse(ledger, fingerprint)` 校验并取回完整私有响应；只有完整回执证据才能把相应 unknown 转为 received。恢复不调用供应商、不执行工具，也不将 received 当作 SDK 已应用或创作阶段已完成。`worker.ts` 已支持预检和受控文件会话；产品主界面的阶段操作与恢复确认尚待接线。

响应目录通过版本化 `limits.json` 保存原始大小上限，重开与恢复沿用该配置。显式冲突值、损坏策略和运行中策略变化会阻断。旧目录缺少策略时使用默认 32 MiB，宿主也可向 `recoverStoredLemoResponse` 的第三参数传入已知的原上限；不会依据响应 manifest 自行扩大上限。

本轮新增 `lemo-agent-recovery.test.ts` 的真实子进程硬退出场景，以及 `lemo-agent-response-store.test.ts`、`lemo-agent-receipt.test.ts`。与旧本机 SDK 协议报告分开记录，不能用旧报告或单元测试宣称真实渠道/原创影片已验收。

## 2026-11-02：实际 SDK 文件会话与两条流程测试

```text
node scripts/build-lemo-agent-worker.mjs
node node_modules/tsx/dist/cli.mjs services/lemo-agent-worker/offline-session-smoke.ts
node node_modules/vitest/vitest.mjs run tests/lemo-agent-session.test.ts tests/lemo-agent-stage-store.test.ts tests/lemo-agent-creative-tools.test.ts --pool=threads --maxWorkers=1
```

本轮三文件 97 项通过。实际官方 CLI 经本机提供商调用受控 MCP 工具写入中文 `TREATMENT.md`，达到回合上限后使用同一 sessionId 续跑，返回可校验工件；重复 start/resume、改变原 brief 被阻断。提交中的取消保留 1 条 unknown，重启前即拒绝新调用。共 3 次本机请求、0 次付费请求，见 `.artifacts/lemo-session-20261102/offline-session-report.json`。

图文短片与创意动画分别验收，证据与边界见 `docs/plans/2026-10-24-creative-animation/two-flow-test-report-2026-11-02.md`。本地 SDK 响应、UI 夹具和模板输出不能替代真实渠道及原创有声影片验收。
