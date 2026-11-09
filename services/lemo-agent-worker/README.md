# Lemo 官方 Agent SDK 独立 worker（运行时与离线协议验证，生产未开放）

固定 `@anthropic-ai/claude-agent-sdk@0.3.314` 和 Lemo 上游提交 `f17136060781a0068a7951245a3aa7835a7230de`。这里使用官方 SDK，不是旧六工具循环，也不修改上游插件。

## 当前已实现

- 独立 Node 进程，带输入/输出大小限制、截止时间、取消和进程树清理。
- SDK 真实初始化；检查实际加载插件的路径及 `lemo-opuscar:lemo-opuscar` 技能；不能仅凭目录存在判断成功。
- 固定插件三文件哈希；拒绝新增 hooks、文件变更和符号链接。
- Worker 环境白名单，不继承用户 API/OAuth 密钥、代理、Node 注入参数或任意 shell 覆盖。状态、HOME、临时目录都在指定运行目录。
- 预检没有用户 prompt，所有工具被禁用，SDK 的 API 地址只指向拒绝请求的本机服务；不能产生付费调用。
- 协议边界明确：生产宿主需要 Anthropic Messages；OpenAI Chat/Responses 不能靠删 tools 自动冒充适配。

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

仍需：真实渠道工具/图片/流式兼容验证；每次上游请求的持久化账本与未知回执阻断（包括 SDK 内部重试）；受限执行/文件访问策略；现有素材与音频服务桥接；分阶段会话接续；生产安装器资源与 Node 运行时；原创有声成片及剪映实开验收。

`cwd`、工具白名单和独立进程都不是 OS 沙箱。本次预检不执行模型生成代码，不能代表 Windows 生产执行已被隔离。

## 许可和体积

Lemo 插件为 MIT；Anthropic SDK/CLI 使用其自己的法律条款，并非 MIT。保留依赖包原 LICENSE/README，不把软件 SDK 与 Lemo 的许可混写。Windows 原生 CLI 约 301 MB，真实依赖安装不能称为“零体积”。SDK依赖与类型检查独立，根项目普通构建不会隐式加载SDK。本阶段没有自动加入安装器，不让未验收功能改变现有发行物。


## 逐请求保护与真实 SDK 离线交互验证

新增 `request-ledger.ts` 与 `messages-gateway.ts`。每次上游提交前先 fsync 账本；只记录不透明 ID、请求/响应哈希、HTTP 状态与 stop_reason，不保存 prompt、响应正文或凭据。账本必须由生产宿主以稳定的 run/stage ID 定位，不能换目录绕过旧 unknown。

网关仅监听 127.0.0.1，用随机单次宿主凭据认证。真实渠道凭据留在宿主；SDK 只拿本机凭据。固定每阶段的显式 Anthropic Messages 地址、模型与输出额度，保留 tools/image 原文，不静默降级协议、不裁成 4096 token、不跟随重定向。模型返回 max_tokens 会保留为已收到的供应商回执，不代表作品完整。

断流、超时、无法持久化、未知回执都会关闭本阶段的后续调用；包括 SDK 内部重试。重复请求即使 metadata 改变也不重新提交。429/其他拒绝不透明重试。独占锁阻止并发宿主；遗留锁、损坏账本不自动删除或抢占，恢复需要明确核对。请求数上限是显式阶段参数，不是无限纠错。

当前 SSE 在完整终止回执落盘后才交给 SDK，保留 SSE 协议内容，但**还不是逐 token 展示**。调用本机协议实测：

```text
node node_modules/tsx/dist/cli.mjs services/lemo-agent-worker/offline-gateway-smoke.ts
node node_modules/vitest/vitest.mjs run tests/lemo-agent-sdk.test.ts tests/lemo-agent-gateway.test.ts
```

`.artifacts/lemo-agent-gateway-smoke/report.json` 验证真实官方 CLI 的两轮工具拒绝→反馈→下一轮结果，以及上游截断后的 SDK 内部重试被账本阻断。响应由本机模拟服务器提供，0 次付费请求；不证明真实 Claude 渠道兼容，也不是原创视频、视觉效果或成片验收。新网关尚未替换生产入口。
