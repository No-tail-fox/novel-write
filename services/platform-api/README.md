# StoryDream 账号与积分服务

这是实际运行的 Fastify / PostgreSQL 服务，与桌面应用的本地 SQLite 完全分离。充值、授权、积分预留与结算以 PostgreSQL 为准。`apps/operator-console` 由 `/operator` 提供，独立 worker 从数据库领取任务。

## 本地运行

需要 Node.js 22+ 和 PostgreSQL 15+。在本目录执行 `npm ci`，从进程环境注入下列配置。项目不读取或保存用户的模型 key 文件。

| 环境变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | 当前环境的 PostgreSQL 连接串 |
| `PLATFORM_TOKEN_SECRET` | 至少 32 字符的随机会话签名与短时重试加密秘密 |
| `PLATFORM_PEPPER` | 独立的至少 32 字符随机验证码、激活码、刷新令牌摘要秘密 |
| `PLATFORM_HOST` / `PLATFORM_PORT` | 默认 `127.0.0.1:4318` |
| `PLATFORM_PUBLIC_URL` | 服务对外地址；生产必须 HTTPS |
| `PLATFORM_LICENSE_PRIVATE_KEY` | 服务端 Ed25519 PKCS8 PEM；不配置则无法签发设备租约 |
| `PLATFORM_LICENSE_KEY_ID` | 租约签名密钥版本 |
| `PLATFORM_ARTIFACT_DIRECTORY` | 私有持久化产物目录，API 与 worker 挂载同一受保护卷 |
| `PLATFORM_ARTIFACT_ORIGINS` | 允许下载上游媒体的 HTTPS origin，以逗号分隔 |
| `PLATFORM_UPDATE_PUBLIC_KEYS` | JSON `{keyId: Ed25519公钥PEM}`；只有公钥，发布私钥放独立 CI |
| `PLATFORM_UPDATE_ORIGINS` | 允许发布更新包的 HTTPS origin，以逗号分隔 |

开发环境：`npm run migrate` → `npm start`；另一进程执行 `npm run worker`。桌面进程设置 `STORYDREAM_PLATFORM_URL` 为该服务地址，并按桌面启动配置显式允许 loopback 开发地址。

生产环境先用独立迁移 owner 执行 `npm run migrate`。创建非 owner 的 `storydream_runtime` 登录角色后，由 owner 应用 `ops/runtime-role.sql`。API 和 worker 以 runtime 角色、`NODE_ENV=production` 启动，生产启动不会自动执行 DDL。每次增加迁移后重新应用角色授权文件。配置 PostgreSQL 备份、TLS、反向代理 body 限制、受保护的产物卷与保留策略。

## 明确隔离的开发数据

仅当 `PLATFORM_DEV_FIXTURES=1`、非生产环境且监听和公开 URL 都是 loopback 时，才允许开发短信、模型和支付辅助入口。设置 `PLATFORM_DEV_PHONE`（默认 `+8613800138000`），运行 `npm run fixture`，命令会输出开发登录信息和一次性开发激活码。首次给测试用户发行 1,000 测试积分；重复 seed 不再重复发行。

开发模型显式标注“本地开发测试”，不会调用付费渠道。音乐 fixture 生成两份真实 PCM WAV 测试文件，验证私有文件下载和单请求计费；它不是 AI 作曲。`[fixture:fail]` 和 `[fixture:unknown]` 可分别触发明确失败与提交结果未知。

开发充值不会自动到账。只有已登录的运营管理员能在开发后台确认指定测试订单，并产生审计及账本记录。生产配置不会注册这些路由，也不会给新用户赠送模拟余额或模拟授权。

## 接入真实通道

手机短信通过运营方自己的 HTTPS adapter 接入：`PLATFORM_OTP_URL` 与 `PLATFORM_OTP_TOKEN`。服务发送 `challengeId/target/purpose/code/expiresIn`，附 `Idempotency-Key`；adapter 必须持久化该标识、防重复发送，并只在正式短信供应商接受后返回成功。没有配置时登录请求返回 `OTP_UNAVAILABLE`。验证码最长五分钟、最多五次尝试，数据库记录目标、IP 和设备限流。

微信 Native 支付 adapter 已实现正式 v3 请求签名、平台证书验签、AES-GCM 回调解密、金额/币种/商户核对、主动查单与整单未消费退款。注入 `WECHAT_MERCHANT_ID`、`WECHAT_APP_ID`、`WECHAT_PRIVATE_KEY`、`WECHAT_CERT_SERIAL`、`WECHAT_API_V3_KEY`、`WECHAT_PLATFORM_CERTIFICATES`（序列号到平台公钥 PEM 的 JSON）和 `WECHAT_NOTIFY_URL`。证书轮换由运维配置更新；未知平台证书拒绝，不从未经验证的回调信任新证书。

回调路径：`/v1/payments/wechat/webhook`。API 不相信支付页跳转或客户端的“已支付”。worker 补查待付订单和退款；未知结果保留原单，不新建重复支付或退款单。合法到账事件重复十次仍只有一笔发行流水。首版只开放整笔、未消费且未预留的充值退款，赠送部分一起撤回；退款异常保留冻结等待核对。

正式收款前仍需要真实商户、短信服务、证书、域名和真实沙箱联调。本次没有发短信、付费生成、扣款、退款或部署。

## 模型与计费

运营账号通过 `POST /v1/operator/models` 发布新的模型/费率版本。平台目录只返回每个公开模型 ID 的最新版本；客户端看不到上游 URL 或秘密引用。首版固定接口 adapter：

| 能力 | adapter | 接口与可用计量 |
| --- | --- | --- |
| 文本 | `openai-text` | Chat completions；request / token |
| 视觉 | `openai-vision` | Chat completions + 自有已验证图片；request / token |
| 图片 | `openai-image` | Images generations；request / image |
| 视频 | `async-video` | OpenAI Videos 创建、查询、下载；request / second |
| 音乐 | `suno` | Suno 普通 / 自定义 / Sounds 创建与原 song IDs 查询；request |
| 配音 | `openai-speech` | Audio speech；request / character |
| 转写 | `openai-transcription` | Audio transcriptions；request |

Suno Max 模式在报价时冻结 2 倍费率；两个候选是一单，按请求收一次费用。自定义歌词、排除风格、风格权重、怪异度、人声性别等已有生成参数都进入冻结快照。翻唱、续写、分轨和克隆等其他收费操作暂时继续使用原 BYOK 路径，平台发布接口会拒绝把这些操作伪装成 `music.generate`。

公开操作 ID 为 `<capability>.generate`。模型 key 只从服务端的专用 `*_API_KEY` 或 `PLATFORM_PROVIDER_*_KEY` 环境变量读取，数据库只存变量引用。配置缺失直接显示未配置，不回退到另一个来源。模型参数按服务端白名单校验；输入素材只能引用该用户完成上传、大小、真实格式与 SHA256 验证的 asset ID。

文本用量需要供应商 usage；按张计费仅计可靠交付的张数；固定请求价使用最少成功结果门槛。预留是不可透支上限，供应商超量由平台承担，不加扣已确认报价。首次外呼前持久化状态；提交后超时进入 `submission_unknown`，不会在 worker 重启后自动再提交。已有上游任务只轮询原 ID；产物下载失败从原结果恢复，不能重新生成。

## 运营与审计

用户先完成手机号登录；用受控服务器终端执行 `npx tsx src/operator-cli.ts grant-role <用户UUID> <support|finance|admin>` 授权。普通登录用户无法操作后台。支持、财务和管理员角色各自受限；写操作还要求最近 15 分钟内完成登录验证。正式上线仍应把运营入口放到企业身份/MFA 和网络访问控制后，当前未接企业 IdP。

后台支持：用户限制、商品版本、激活码生成、模型/费率发布、渠道启停、充值与退款查看、异常任务补偿、账本对账/投影恢复、签名版本发布/灰度/撤回。激活码只保留摘要，短时幂等响应加密保存。代码不提供直接设置真实余额或真实授权状态的客户端入口。

`POST /v1/operator/releases` 只接受由独立发布流程签过名的完整 manifest；后台不持有发布私钥。只能变更灰度/启停状态，客户端仍逐次校验签名、下载域名、哈希和撤回状态。此服务提供 E1 完整包发布，不执行任意远程脚本。

## 验证

`npm run typecheck`。`npm test` 始终跑纯密码学/adapter 测试；设置 `PLATFORM_TEST_DATABASE_URL` 后，还会在指定 PostgreSQL 实例内创建随机命名的临时数据库，执行真实事务/并发测试并删除这个测试数据库，不修改原数据库。

覆盖：20 并发超额预留、重复提交/幂等冲突、激活码单次兑换和设备席位竞争、刷新重放撤销、支付重复与错误金额、退款冻结与生成竞争、账本不可变和平衡约束、模型 Max 计价、两首一单、跨账号私有产物访问、worker 未知提交恢复、七类 adapter 固定路径，以及生产环境关闭开发入口。
