# StoryDream 本地安全加固与功能闭环设计

日期：2026-07-10

状态：已由用户分节确认

## 1. 目标

对当前 StoryDream Electron/React/TypeScript 应用完成风险优先的本地闭环整改：

- 修复已确认的高危安全边界、凭证泄露、依赖漏洞和持久化可靠性问题。
- 为现有功能补齐运行时参数校验、资源上限、取消/超时和用户可见错误。
- 接通独立 HTML 视频六步流水线，产出可验证的本地 MP4。
- 降低全量 AppState 轮询、长提示词首屏加载和无界历史增长造成的长期成本。
- 改进 Windows 脚本、Python runtime、便携包和真实 Electron 烟测。

## 2. 范围

### 2.1 本轮实现

- Electron 主窗口、登录窗口、隐藏渲染窗口和 IPC 信任边界。
- provider 凭证加密、明文迁移、renderer 脱敏和浏览器 fallback 清理。
- sql.js 串行提交、原子替换、错误分类、关闭协调和恢复策略。
- viral worker 的平台 host、Cookie、媒体 URL、下载配额和进程清理。
- 公开网页/IMA 抓取的 SSRF、重定向、header 和响应体限制。
- sidecar/ffmpeg/Python 的超时、输出上限、取消和 Windows 进程树终止。
- 核心异步 UI 操作的统一错误反馈。
- HTML 视频专用六步执行器、checkpoint、预览、恢复、取消和出片。
- 状态增量推送、分页历史、归档/删除和延迟加载。
- npm/Python 依赖治理、Windows 脚本、便携包瘦身和发布检查。

### 2.2 明确不实现

- 真实商业登录、支付、云积分或服务端授权。
- 参考 Storybound 私有远端接口、授权绕过、密钥提取或积分规避。
- 没有公开契约的远端 MiniMax 克隆音色服务。
- 在没有代码签名证书时伪造“已签名”发布状态。

账户、激活和积分页面只表达本地工作区状态，不应呈现为真实商业鉴权或扣费结果。

## 3. 实施策略

采用用户确认的风险优先、分阶段 TDD：

1. 安全边界、Cookie、凭证和依赖漏洞。
2. 存储与进程运行可靠性。
3. 用户错误反馈和真实 Electron 烟测。
4. HTML 视频专用流水线。
5. 状态性能、历史治理和发布瘦身。

每个阶段先写能够复现当前缺陷的失败测试，再做最小根因修复；阶段结束运行相关测试和全量回归，不在同一补丁中混入无关重构。

## 4. 总体架构

保留现有 Electron、React、sql.js、runner 和 provider 适配器，不引入第二套应用框架。

```text
Renderer（不可信 UI）
  -> Preload 窄 API
  -> 可信 IPC 网关（sender + schema + resource limits）
  -> 应用服务
       -> CredentialVault
       -> FileDatabase
       -> 普通 Task Runner
       -> HtmlVideoRunner
       -> NetworkPolicy
       -> BoundedProcessRunner
```

### 4.1 主进程边界

- `electron/main.ts` 保留应用启动和服务装配职责，窗口策略、IPC 注册和专用运行器逐步抽到小模块。
- renderer 不直接获得密钥、任意文件读写、任意 URL 加载或任意进程执行能力。
- preload 只暴露业务动作；不能暴露通用 `invoke(channel, payload)`。
- 普通故事 runner 与 HTML 视频 runner 保持独立，二者共享 provider 和持久层契约，不共享错误的步骤状态机。

建议的模块边界：

- `electron/security.ts`：窗口、导航、外链、origin 和 sender 策略。
- `electron/ipc.ts`：可信 handler 注册、结果封装和错误脱敏。
- `electron/credential-vault.ts`：safeStorage、凭证迁移和运行配置合并。
- `src/shared/ipc-contract.ts`：Zod schema、输入上限和公开 DTO。
- `src/shared/network-policy.ts`：按用途的 URL、DNS、redirect、header 和 body 策略。
- `src/shared/process-runner.ts`：有界子进程与进程树取消。
- `src/shared/html-video-runner.ts`：可注入依赖、可单测的六步编排。
- `electron/html-video-runtime.ts`：BrowserWindow 渲染和主进程服务装配。

模块名可在实施时按现有目录约定微调，但职责不可重新混回 renderer。

## 5. 窗口与 IPC 安全

### 5.1 主窗口

- 生产环境只加载打包后的本地 renderer 文件。
- `VITE_DEV_SERVER_URL` 只在开发模式接受 `http://127.0.0.1`、`http://localhost` 或 IPv6 loopback，并限制预期端口。
- `will-navigate` 拒绝离开批准 origin；`setWindowOpenHandler` 默认拒绝。
- 合法外链经过 HTTPS/host 策略后交给 `shell.openExternal`，不在带 preload 的窗口中打开。
- 明确启用 context isolation、sandbox 和禁用 Node integration。
- renderer 增加与运行模式匹配的 CSP；生产环境不允许任意脚本、frame 或远端页面。

### 5.2 登录与 HTML 预览窗口

- 抖音登录窗口不带 preload，只允许抖音认证所需主域和批准跳转。
- HTML 预览/捕获窗口不带 preload、不开 Node，只加载任务目录内生成的本地 HTML 和资源。
- 隐藏窗口设置 ready、字体、图片、单帧和整场超时，并始终在 `finally` 中销毁。

### 5.3 IPC 网关

每个 handler 使用统一注册器：

1. 验证 sender WebContents 是当前主窗口。
2. 验证 sender URL 属于批准 renderer origin。
3. 用 Zod 解析 payload，而不是依赖 TypeScript 强转。
4. 校验枚举、整数、有限数、字符串长度、数组数量、路径和资源配额。
5. 把内部错误转换为脱敏的 `AppError`。

路径类 IPC 必须解析真实绝对路径，并验证其属于允许的应用数据、任务或用户明确选择的目录。

## 6. 凭证与配置

### 6.1 CredentialVault

- 主进程使用 Electron `safeStorage`；Windows 上由当前用户 DPAPI 保护。
- 磁盘文件为版本化的 `secrets.v1.json`，只含元数据和 base64 加密 blob。
- 凭证 ID 使用稳定 profile ID 和能力名，不能依赖数组索引。
- 覆盖 LLM、绘图、即梦、TTS、语音转写、IMA、viral vision 及所有 provider profile。
- 活动顶层配置从 profile 和 vault 运行时派生，避免新增明文副本。

### 6.2 Renderer 契约

- renderer 接收 `PublicAppConfig`，所有秘密字段为空。
- `secretStatus` 只说明某凭证是否已配置，不回传长度、首尾字符或密文。
- 保存请求由公开配置和显式 `secretChanges` 组成；未触碰的凭证不变，`null` 表示用户确认清除。
- 密钥输入为 password 控件，提供显示/隐藏和明确清除动作。
- provider 测试、模型列表和运行任务在主进程合并 vault 密钥；已保存秘密不再次经过 renderer。

### 6.3 旧数据迁移

迁移必须幂等且不生成明文备份：

1. 读取 SQLite 和旧 `config.json`，规范化所有凭证路径。
2. 原子写入并回读验证加密 vault。
3. 只有 vault 验证成功后，才把 SQLite 和 JSON 的秘密字段清空。
4. 写入迁移版本；启动时可安全重试未完成阶段。
5. safeStorage 不可用或写入失败时保留原数据，显示明确错误，不报告成功。

迁移完成后，复制数据目录到另一 Windows 用户或机器时普通配置/任务可用，但凭证需要重新录入。

### 6.4 浏览器 fallback

- localStorage 只保存剥离凭证后的公开状态。
- 浏览器预览中的新秘密最多保留在当前页面内存。
- 浏览器模式不声称能够执行真实主进程任务或安全保存凭证。

## 7. sql.js 持久化

`FileDatabase` 负责集中保证写入顺序和落盘完整性：

- 所有 mutation + persist 进入实例级串行提交队列。
- 导出数据写到同目录唯一临时文件，flush 后原子替换目标。
- 有界重试 Windows 防病毒/文件占用导致的暂时性替换失败。
- 最近一次已验证数据库可作为恢复副本；凭证迁移后副本同样不得含明文秘密。
- `open()` 只把 ENOENT 当作新库；SQLite 格式错误才隔离，权限、磁盘和其他 I/O 错误直接上报。
- `close()` 拒绝新写入并等待队列完成。
- Electron 退出流程先终止任务、等待 runner 清理、flush 数据库，再实际退出。

迁移保持向后兼容，不删除现有任务或模板数据。

## 8. 网络与 Cookie 策略

### 8.1 公开网页研究

- 仅允许 HTTP/HTTPS 公网 URL，不允许 URL 用户信息。
- DNS 解析后拒绝 loopback、私网、链路本地、组播和保留 IPv4/IPv6。
- 使用受控 dispatcher 固定已验证解析结果，降低 DNS rebinding 风险。
- 每次 redirect 重新执行 scheme、host、端口和 IP 校验；限制最大跳数。
- 按搜索页、文章页和 IMA 文档设置独立超时、并发和响应字节上限。
- 流式读取达到上限立即中止，不能在 `response.text()` 后才截断。

### 8.2 Provider URL

- 默认允许 HTTPS 和本机 loopback HTTP。
- 局域网私有地址只在用户显式启用本地模型网络访问时允许。
- 始终拒绝 file、data、gopher 等非 API scheme。

### 8.3 IMA

- IMA API 固定到批准 HTTPS host。
- IMA 返回的下载 URL仍按公开下载策略检查。
- 远端 header 使用 allowlist；Host、Cookie、Proxy-Authorization、Connection 等禁止转发。
- Authorization/签名 header 只发给原始目标 host，redirect 后不继承。

### 8.4 Viral worker

- TypeScript 和 Python 都用 URL parser 与精确 hostname/subdomain 匹配，不再做整串子字符串判断。
- 用户手选平台不能覆盖 URL 与平台 host 不一致。
- 短链的每个 redirect 都必须仍符合对应平台策略。
- 浏览器 Cookie 和 Netscape cookie 文件保留 domain、path、secure、expiry 属性。
- Playwright 只注入与当前平台页面匹配的 Cookie。
- 嗅探出的媒体/封面 URL 只允许批准平台 CDN；默认不携带登录 Cookie。
- 如确有 first-party API 需要 Cookie，只发送与精确目标匹配的最小 Cookie 集。
- 下载限制 content type、总字节、磁盘预算和超时，使用临时文件并清理失败产物。

## 9. 有界进程执行

Storybound sidecar、viral Python worker 和 ffmpeg 使用统一能力：

- 参数数组调用，不经过 shell 拼接。
- AbortSignal、绝对超时和 stdout/stderr 上限。
- Windows 取消或超时终止完整进程树。
- 只允许批准 executable 和工作目录。
- 错误文本在返回 UI 前清除 Cookie、API key、Authorization 和带 token 的 query。
- 退出码、超时、取消和无效 JSON 使用不同错误码。

## 10. 错误模型与 UI

主进程使用结构化 `AppError`：

```ts
interface AppErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  diagnosticId: string;
  field?: string;
}
```

- IPC 返回可序列化 result；preload 将失败恢复为规范化异常，保持 renderer 调用方式清晰。
- renderer 的异步命令通过统一 action 包装器管理 busy、成功、失败和取消。
- 错误在触发操作附近显示；后台任务同时更新 `task.errorMessage` 和任务事件。
- 取消不显示为失败。
- 自动重试只用于明确幂等的瞬时网络错误，并有次数和退避上限。
- 保存、删除和任务创建不自动重复。
- 原始堆栈只写本地诊断日志，并通过 diagnostic ID 与 UI 对应。

商业功能入口使用明确的本地状态或禁用状态，不返回假登录、假余额或假支付成功。

## 11. HTML 视频六步流水线

### 11.1 状态机

版本 2 状态与六个可见步骤一一对应：

| 可见步骤 | pipelineStep | currentStep |
| --- | --- | --- |
| 改写 + 分句 | `rewrite` | 0 |
| 场景规划 | `planning` | 1 |
| 素材 | `assets` | 2 |
| 配音 | `voice` | 3 |
| 动画预览 | `preview` | 4 |
| 出片 | `render` | 5 |

`done` 只表示终态，不能代替第 6 步。旧 `plan` snapshot 通过兼容解析升级。

### 11.2 六步职责

1. 有 LLM 时结构化改写和分句；无 LLM 时保留原文、只分句并明确记录 warning。
2. 生成标题、字幕、时长、版式、素材提示词和封面信息，并通过 schema 校验。
3. 复用当前绘图 provider 生成背景和可选前景；缺凭证或失败时停在本步骤。
4. 复用 TTS，生成场景音频并读取真实时长。
5. 生成仅引用任务本地资源的 HTML、composition、预览图和隔离预览窗口。
6. 串行捕获帧，调用现有 `compose_render` 合成场景、转场、封面、配音和 BGM，验证 MP4。

### 11.3 Checkpoint 与恢复

- 每步完成后原子写入版本化 checkpoint，并同步轻量摘要到 SQLite。
- checkpoint 包含输入签名、产物路径、大小、步骤状态和 warning，不内嵌大文件。
- 恢复前验证产物存在且满足基本格式/大小。
- 重跑某步只使该步和下游失效，不重复已验证上游调用。
- 取消、暂停和退出使用同一 AbortSignal；隐藏窗口和进程在 finally 清理。
- 同一任务只有一个 runner；高成本 HTML 捕获全局串行。

### 11.4 资源边界

集中常量限制输入长度、场景数、画布、FPS、单场/总时长、图片大小、总帧数、临时磁盘和 sidecar 时间。UI、IPC 和 runner 使用同一 schema，不能只在 UI 做限制。

成功后删除临时帧；失败只保留有大小和数量上限的诊断产物。

## 12. 状态与历史

### 12.1 窄状态 API

- `getBootstrapState`：公开配置、secretStatus、UI、任务摘要和必要小型目录。
- `listTasks` / `listViralAnalyses` / lab list：游标、limit 和过滤条件。
- `getTaskDetail`：单任务详情。
- `listTaskEvents`：按 taskId、afterSeq 和 limit 读取。
- 提示词正文、草稿模板和大型系统模板进入对应页面后加载。

### 12.2 增量事件

- 主进程推送 task patch、新 task event 和 viral patch，不再发送完整 AppState。
- renderer 按 ID/seq 合并。
- Electron 模式删除每秒全量轮询；仅保留低频窄校准作为断线恢复。
- 任务产物刷新改为目标任务的版本/事件驱动，必要时保留低频目标轮询。

### 12.3 历史治理

- 任务支持归档、恢复和永久删除。
- viral、图片实验室和配音实验室支持确认式删除。
- 运行中的记录不可永久删除。
- 永久删除关联事件和任务文件；路径必须验证在对应应用数据根目录内。
- 默认不自动清理用户历史。

### 12.4 前端加载

- 大型提示词语料和设置/模板视图拆为 lazy chunk。
- 首屏构建产物不再包含完整约 374 KB 系统提示词 corpus。
- 不以广泛 memo 代替数据契约修复。

## 13. 依赖与发布

### 13.1 npm

- 保留 `undici` 为真实 runtime dependency，但升级到修复已知 high advisory 的兼容版本。
- sql.js 与其他实际外部 runtime 模块保留 production dependency。
- React/Vite/TypeScript/测试/构建工具按实际打包形态归入 devDependencies。
- 以 `npm audit --omit=dev` 作为发行风险基线，同时检查完整 audit 并记录仅开发链残余。
- Windows npm script 通过仓库内 wrapper 使用 `npm_node_execpath`，不能硬编码 `I:\nodejs`。

### 13.2 Python runtime

- 使用精确版本和 hash lock，pip 采用 `--require-hashes`。
- Python embeddable zip、get-pip 和其他直接下载文件验证 SHA-256。
- runtime marker 记录 Python 版本、lockfile hash 和浏览器策略版本。
- 删除无消费者的 `faster-whisper` 及其模型/torch/ctranslate2 栈。
- 不再重复打包 Playwright Chromium；检测系统 Edge/Chrome，缺失时显示诊断，不静默假成功。
- 构建后执行 import smoke、`pip check` 和 OSV 清单检查。

### 13.3 便携包与签名

- `.gitignore` 增加 `__pycache__/`、`*.pyc`、`*.pyo`。
- 打包测试检查不包含缓存、明文 secrets、开发目录和已移除 runtime。
- 记录 zip 和 unpacked 体积，防止无意回归。
- electron-builder 支持 `CSC_LINK`/`CSC_KEY_PASSWORD` 等标准签名输入。
- 没有证书的本机构建仍标记为 unsigned residual risk；不能将其计为已签名。

## 14. 测试设计

### 14.1 单元测试

- 窗口 origin、navigation、openExternal 和 IPC sender 策略。
- 所有关键 Zod schema 的合法、边界和恶意输入。
- secret path inventory、脱敏、vault 序列化和错误清理。
- URL/IP/redirect/header 策略，覆盖 IPv4、IPv6、DNS rebinding 和特殊编码。
- viral 平台 host、Cookie domain/path/secure、媒体 CDN 和下载上限。
- AppError 序列化、redaction、取消和重试分类。
- HTML 六步状态、旧 snapshot 迁移、checkpoint 校验和下游失效。

### 14.2 集成测试

- 使用 mocked safeStorage 和临时目录迁移旧 SQLite/JSON，断言磁盘及 renderer DTO 无明文。
- 并发 mutation、替换失败、崩溃残留 temp、close flush 和 malformed/I/O 分类。
- 本地测试服务器模拟 redirect、超大响应、私网目标、header 泄露和取消。
- fake providers/renderer/sidecar 运行完整 HTML pipeline，覆盖失败、暂停、取消、恢复和重试。
- 历史分页、归档、恢复、永久删除及路径边界。

### 14.3 真实烟测

- 使用临时 userData 启动仓库真实 `electron/main.ts`，而不是自建无 preload 窗口。
- 验证 `window.storydream`、`app:get-state`、sender guard、窗口策略和 task delta。
- 运行低分辨率、低 FPS、短音频的真实 HTML 捕获与 sidecar 合成。
- 用 ffprobe 或等效检查确认 MP4 存在、非空、可读取且时长在容差内。
- 捕获主要视图截图，检查错误/loading、HTML 视频进度和历史操作未发生布局重叠。

### 14.4 最终验证

- renderer 与 Electron TypeScript 检查。
- 全量 Vitest。
- renderer/main/preload 构建和语法检查。
- 真实 Electron smoke 和真实 HTML 视频 smoke。
- Windows portable package 和内容/体积检查。
- `npm audit`、`npm audit --omit=dev`、`pip check`、OSV。
- 敏感信息、危险 Electron 设置、动态执行和缓存文件扫描。
- `git diff --check` 和最终差异审查。

生产依赖不得残留 high/critical 漏洞。没有上游修复的开发依赖问题必须记录依赖路径、影响和隔离理由，不能静默忽略。

## 15. 验收标准

- 恶意 viral URL 不能接收任何本机平台 Cookie。
- 任意 dev URL、导航或非主窗口 sender 不能获得特权 IPC。
- SQLite、config.json、localStorage 和 renderer state 不含 provider 明文密钥。
- 并发任务写入不会产生旧快照覆盖或截断数据库。
- 公开抓取不能访问私网或读取无界响应。
- 所有核心异步按钮失败时有稳定、脱敏、可见的中文错误。
- HTML 视频从创建到 MP4 完整执行，支持失败定位、取消、恢复和重试。
- renderer 不再每秒传输完整 AppState，历史具备分页和用户治理入口。
- runtime 依赖漏洞、Python 锁定、脚本入口和包内容达到上述验证标准。
- 外部代码签名证书等无法由仓库生成的条件单独列为残余风险。

## 16. 主要风险与控制

- 凭证迁移错误可能丢失密钥：采用写 vault、回读验证、再清明文的顺序，失败不擦除。
- 持久化重构影响面大：先用并发/故障注入测试锁定行为，再逐个 mutation 迁移到提交队列。
- IPC schema 可能破坏旧调用：先建立 channel inventory 和兼容 schema，再切 handler。
- 网络防护可能阻断本地模型：provider URL 使用独立策略并提供显式局域网开关。
- HTML 渲染资源消耗高：串行窗口、预检磁盘、硬上限、超时和 checkpoint。
- 状态 API 拆分可能造成 UI 过期：delta 带单调 seq/revision，并保留低频窄校准。
- Python 瘦身可能漏掉隐式消费者：删除前用源码、打包 import smoke 和真实侧车测试共同验证。
