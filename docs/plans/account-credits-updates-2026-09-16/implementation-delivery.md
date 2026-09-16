# 账号、授权、积分与更新首发交付

日期：2026-09-16。实施分支：`codex/account-credits-implementation`，基于设计提交 `7c18c0ad889929b19ea9c1847f40b76e01f9d4dc`。本次已实现可本地联调的商业服务、桌面入口和运营后台。生产短信、收款、付费生成及版本发布尚未启用。

原 [implementation-plan.md](./implementation-plan.md) 是分阶段设计目标；本文件和 [implementation-progress.md](./implementation-progress.md) 记录实际首发范围。服务器的详细配置与操作方式见 [platform-api README](../../../services/platform-api/README.md)。

## 已交付能力

| 模块 | 本次行为 |
| --- | --- |
| 账号 | 手机验证码登录/注册适配、用户资料、设备签名、刷新与撤销会话；会话保存在独立的 OS 加密 vault 中 |
| 软件授权 | 激活码兑换、设备席位、解绑、Ed25519 签名租约；离线最多 72 小时并检查账号、设备与时钟回拨；离线不展示可消费钱包 |
| 钱包 | 服务端 PostgreSQL 是余额依据；整数金额、双分录账本、充值批次、报价冻结、预留/结算/释放、流水与重建对账 |
| 充值/退款 | 微信 Native v3 请求签名、平台证书验签、AES-GCM 通知解密与主动补查；二维码本地生成；首发仅整笔未消费、未预留订单可退款 |
| 平台音乐 | Suno 普通、自定义、Sounds；自定义歌词/纯音乐、排除风格、风格权重、怪异度、人声性别等参数进入报价快照；Max 冻结 2 倍费率，两候选按一单结算 |
| 音乐结果 | 报价确认、幂等提交、轮询/取消、候选列表、账号私有下载、大小和 SHA-256 校验、试听及用于音乐 MV |
| 模型偏好 | 文本、图片、视频、音乐、配音、转写、视觉七类均可保存多个配置并单独选择启用项；保存不自动启用；本机 BYOK 配置只引用已有 profile ID，不上传用户 key |
| 来源约束 | 明确区分平台积分和自有 API。已选平台的未迁移操作提示尚未接入，不静默使用用户 key；任务不能靠旧 profile ID 绕过选定来源 |
| 运营后台 | `/operator` 提供独立页面；支持/财务/管理员角色、审计、最近登录校验、商品/费率/模型/激活码管理、用户限制、支付退款核对、异常作业及签名版本管理 |
| E1 远程更新 | 获取签名完整包清单，检查可信来源、签名、版本、大小和哈希；下载前和打开文件夹前复查撤回；任务结束后手动升级 |

商业 IPC 仅暴露固定方法，renderer 无法指定任意鉴权地址、直接写余额/授权、修改价格或获取平台 key。浏览器预览在服务未配置时显示未配置状态，不生成模拟真实余额。

服务端具有 Suno、OpenAI 文本/图像/语音/转写/视觉及异步视频七类 adapter，但**桌面平台计费只接通音乐普通、自定义和 Sounds 三条生成入口**。其余六类原有创作管线尚未迁移平台报价与积分结算。Suno 翻唱、续写、分轨、克隆及歌词/风格等高级辅助功能保留已有 BYOK 能力，不能据此宣称已支持平台积分购买全部功能。

## 代码位置

| 位置 | 职责 |
| --- | --- |
| `src/shared/commercial-contract.ts`、`commercial-ipc.ts` | 公共类型与固定命令校验 |
| `electron/auth-vault.ts`、`commercial-service.ts` | 加密会话、固定服务请求、账号隔离、模型偏好与私有下载 |
| `electron/license-service.ts`、`platform-update-service.ts` | 离线租约与签名更新 |
| `electron/commercial-model-routing.ts` | 七类偏好及原有 BYOK 调用的来源约束 |
| `src/features/account/`、`src/features/settings/` | 账号/钱包/授权与模型/更新页面 |
| `src/features/labs/MusicLabPage.tsx`、`PlatformMusicControls.tsx` | 平台音乐报价及候选结果界面，与既有 BYOK 音乐功能并存 |
| `services/platform-api/` | Fastify API、PostgreSQL 迁移、账本、微信 adapter、运营权限与对账 |
| `services/platform-worker/` | 持久化作业领取、上游提交/查询、产物归档与结算 |
| `apps/operator-console/` | 独立运营页面 |
| `scripts/qa-commercial-stack.ts` | 隔离数据库的原生客户端/HTTP/worker 端到端验收 |
| `scripts/sign-commercial-release.ts` | 在独立发布环境生成签名 manifest |

worker 在外呼前保存提交状态，无法确认是否提交成功时进入 `submission_unknown`，重启后不自动再付费提交。已有上游任务按原 ID 查询；产物下载失败从原结果恢复。实际结算不会超过用户确认的不可变报价。

## 本地运行

服务端需要 Node.js 22+、PostgreSQL 15+。在 `services/platform-api` 安装依赖，然后从进程环境或部署的秘密管理系统注入配置，不将真实凭据写入仓库。

```powershell
npm ci
npm run migrate
npm start
```

另一个相同配置的进程运行 worker：

```powershell
npm run worker
```

开发 fixture 必须同时满足 `NODE_ENV` 不是 `production`、`PLATFORM_DEV_FIXTURES=1`、监听地址及公开地址均为 loopback。运行 `npm run fixture` 创建开发用户和一次性激活码；测试音乐生成两份 PCM WAV，不调用付费作曲。测试充值需要开发后台显式确认，不会自行到账。

桌面开发进程设置 `STORYDREAM_PLATFORM_URL=http://127.0.0.1:4318` 和 `STORYDREAM_PLATFORM_ALLOW_LOCAL=1`，再按项目原有方式启动。允许 HTTP 的开关仅对未打包的开发应用有效。生产打包应用必须使用 HTTPS 服务。

## 部署配置

| 进程 | 配置 | 用途 |
| --- | --- | --- |
| API/worker | `DATABASE_URL` | 当前环境的 PostgreSQL 连接串 |
| API/worker | `PLATFORM_TOKEN_SECRET`、`PLATFORM_PEPPER` | 两份独立的至少 32 字符随机秘密，用于会话/短时重试加密与摘要 |
| API/worker | `PLATFORM_HOST`、`PLATFORM_PORT`、`PLATFORM_PUBLIC_URL` | 监听及公开 HTTPS 地址 |
| API/worker | `PLATFORM_LICENSE_PRIVATE_KEY`、`PLATFORM_LICENSE_KEY_ID` | 服务端 Ed25519 租约签名私钥及版本 |
| API/worker | `PLATFORM_ARTIFACT_DIRECTORY`、`PLATFORM_ARTIFACT_ORIGINS` | API 与 worker 共用的私有持久卷，以及上游媒体 HTTPS 来源白名单 |
| API | `PLATFORM_OTP_URL`、`PLATFORM_OTP_TOKEN` | 运营方短信 adapter；须持久化幂等标识并确认供应商接受 |
| API/worker | `WECHAT_MERCHANT_ID`、`WECHAT_APP_ID`、`WECHAT_PRIVATE_KEY`、`WECHAT_CERT_SERIAL`、`WECHAT_API_V3_KEY`、`WECHAT_PLATFORM_CERTIFICATES`、`WECHAT_NOTIFY_URL` | 微信 v3 商户与可信平台证书配置；回调路径 `/v1/payments/wechat/webhook` |
| API/worker | 专用 `*_API_KEY` 或 `PLATFORM_PROVIDER_*_KEY` | 平台供应商 key，数据库仅保存环境变量名引用 |
| API | `PLATFORM_UPDATE_PUBLIC_KEYS`、`PLATFORM_UPDATE_ORIGINS` | 验证运营发布的 manifest；JSON 格式公钥表与逗号分隔的 HTTPS origin 白名单 |
| 桌面主进程 | `STORYDREAM_PLATFORM_URL` | 固定账号/积分服务地址 |
| 桌面主进程 | `STORYDREAM_LICENSE_PUBLIC_KEYS` | `{keyId: 公钥PEM}` JSON；校验离线租约 |
| 桌面主进程 | `STORYDREAM_UPDATE_PUBLIC_KEYS`、`STORYDREAM_UPDATE_ORIGINS` | 更新公钥表和可信下载来源；与服务器的对应配置一致 |
| 独立发布环境 | `STORYDREAM_RELEASE_PRIVATE_KEY` | 更新 manifest 的 Ed25519 私钥；只在受保护的 CI/发布进程存在 |

生产迁移使用独立 owner 角色。创建非 owner 的 `storydream_runtime` 登录角色后，由 owner 应用 `services/platform-api/ops/runtime-role.sql`；每次迁移后重新应用授权。API/worker 使用 runtime 角色及 `NODE_ENV=production`，生产启动不自行执行 DDL。

按环境独立配置数据库、短信、支付、供应商、租约签名和更新签名。服务端当前使用受保护的文件系统持久卷，尚未接 S3；多实例部署必须共享同一私有产物卷。上线部署还需配置 TLS、反向代理请求限制、数据库备份恢复及产物保留策略。

运营用户完成登录后，从受控服务器终端执行：

```powershell
npx tsx src/operator-cli.ts grant-role <用户UUID> <support|finance|admin>
```

后台敏感写操作要求最近 15 分钟内完成登录验证。企业 IdP/MFA 尚未集成，生产运营入口应结合企业身份和网络访问控制部署。

## 完整包签名与手动升级

E1 交付下载及验证完整包，然后打开所在文件夹供用户手动升级；它不执行远程脚本、安装器或自动覆盖程序。运行中的任务会阻止打开升级目录的流程。首次从没有更新入口的旧版迁移仍需自行取得完整新版。

在独立发布环境完成 Windows 代码签名与打包，再准备元数据。元数据包含 `version`、`platform`、`arch`、`channel`、`publishedAt`、`releaseNotes`、`url`、`minAppVersion`、`keyId`；`url` 必须为可信 HTTPS 完整包地址。脚本从完整包计算 `size` 与 `sha256`，无需手填。

```powershell
npx tsx scripts/sign-commercial-release.ts <完整包路径> <metadata.json> <manifest.json>
```

脚本从 `STORYDREAM_RELEASE_PRIVATE_KEY` 读取 Ed25519 PKCS8 PEM，只创建一个新的 manifest，不上传包也不发布版本。对应公钥分别配置到服务端 `PLATFORM_UPDATE_PUBLIC_KEYS` 和桌面 `STORYDREAM_UPDATE_PUBLIC_KEYS`，二者按相同 `keyId` 查找；**这两个进程都不需要更新签名私钥**。租约签名使用另外一套 license 配置，不与更新签名混用。

上传完整包后，由有权限的运营员通过后台或 `POST /v1/operator/releases` 注册已签名 manifest，并设置启停/灰度。服务端与客户端分别验证；客户端拒绝未知公钥、错误签名、旧版本重放、降级、非可信来源、大小/哈希错误和已撤回版本。当前下载中断后重新下载，未实现断点续传。手动升级前需要用户备份项目并退出软件；尚无自动迁移回滚或自动安装器。

## 验证记录

| 层级 | 结果 | 主要覆盖 |
| --- | --- | --- |
| API/worker 与 PostgreSQL | 27 项通过，0 跳过 | 20 请求竞争同一余额、激活/席位竞态、刷新重放、幂等、不可变账本、微信密码学、退款冻结、未知提交恢复与七类 adapter |
| 桌面/renderer 回归 | 13 文件共 246 项验收通过 | IPC 边界、账户/租约、模型路由、状态隔离、音乐与配置回归；初跑 2 项 preload 顺序失败修复后，对应 2 文件复跑 71 项通过 |
| 原生客户端 → HTTP → PostgreSQL → worker | 7 组检查通过 | 登录/兑换、保存不启用、纯音乐参数、Max 计价、重复提交、两候选一单、私有下载、失败释放、10 次重复支付通知、退款与账本重建 |
| 浏览器 UI | 35 项检查，0 错误 | 1440/1040 宽度、深浅主题、主要商业页面 |
| Electron UI | 错误列表为空 | 独立用户数据目录、真实 safeStorage、登录/激活/钱包、音乐偏好、报价/提交/下载/试听及更新未配置状态 |
| 支付二维码 | 20 项专门测试及 14 项界面检查通过 | Native 地址白名单、危险地址拒绝、本地 SVG、金额、到期及已结算订单隐藏；界面检查无错误及外部请求 |

桌面单元回归总数包含支付二维码测试，不将其重复相加。最终 renderer/Electron 类型检查与构建通过；模型路由、桌面服务、支付二维码三个相关文件再验 123 项通过。发布签名脚本使用临时 Ed25519 密钥完成 smoke，覆盖 CLI 签名、客户端 manifest 校验、产物字节校验、运行中任务保护和已有文件防覆盖，全程无网络请求。

实现提交 `0bd252fd9da0ec51eeffad7af79733f500844d6b` 已推送到 `origin/codex/account-credits-implementation`，并通过远程分支引用核验。交付文档与本地预览兼容修正作为后续提交保存在同一分支。

复验服务端：在 `services/platform-api` 设置 `PLATFORM_TEST_DATABASE_URL` 后执行 `npm run typecheck` 和 `npm test`。测试会在实例中创建/清理随机测试数据库，需要相应的创建数据库权限，应使用隔离实例。

复验整链路：在仓库根目录设置 `STORYDREAM_TEST_DATABASE_URL` 为 loopback 测试实例后执行：

```powershell
npx tsx scripts/qa-commercial-stack.ts
```

此脚本使用测试密钥和 fixture，不发真实短信、支付或模型请求。HTTP 端到端使用独立测试加密器，Electron UI 验收另行覆盖正式 `safeStorage` 路径。

## 上线前与后续阶段

- 配置真实短信服务、微信商户及证书、供应商账号、API/下载域名；完成真实沙箱与小额生产联调。当前密码学和 fixture 验收不能替代真实通道验收。
- 确认正式授权商品、设备额度、充值套餐、积分换算、模型零售价和退款规则。设计中的示例价格和开发 fixture 不是已批准的销售价格。
- 完成服务条款、隐私及退款说明、用户联络入口、备份恢复演练与账本对账流程。
- 集成企业 MFA/IdP、S3 对象存储、正式 Windows Authenticode 签名流水线；当前仓库不会自动产生这些外部资质或设施。
- 逐条迁移文本、图像、视频、配音、转写、视觉桌面平台计费，以及 Suno 高级操作；每条都需报价、参数白名单、任务预算及独立结算验证。
- E2 再实现 NSIS 自动更新/安装、断点续传、自动备份与升级回滚，完成安装失败和旧数据兼容演练。

本次没有部署服务、提交真实支付、发出短信、使用付费模型生成或发布正式更新包。
