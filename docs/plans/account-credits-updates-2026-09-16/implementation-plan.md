# 实施顺序与验收

## 当前交付边界

这次完成设计与演示原型，并按要求完成“当前功能推送 → 独立分支”的隔离。不会把原型误标为已经可以收款的系统。生产服务、支付商户、发布证书和线上域名尚未接入。

检查点：`bdf1f71964bdd1e7d31e40810dd2402250496c4a`，已存在于 `origin/codex/shotcraft-motion-library`。新分支：`codex/account-credits-updates`。开发期间每个阶段独立提交，先预发布验收，完成真实端到端联调后再选择合并发布。

## 1. 分层与目录建议

服务端用 TypeScript + Fastify + PostgreSQL；首版模块化单体，网关作业使用 PostgreSQL outbox/队列和独立 worker，不一开始引入分布式微服务。媒体存储通过 S3 兼容适配层接入对象存储。后台复用 React 技术，但独立于桌面 renderer 发布。

以下是计划新增位置，当前未伪造这些实现已经存在：

```text
packages/commercial-contracts/    # Zod schema、金额单位、公开错误码
services/platform-api/            # 账号、设备、授权、订单、账本、报价
services/platform-worker/         # 模型提交、轮询、结算、支付补查
apps/operator-console/            # 模型/价格/订单/用户/发布管理
electron/account-service.ts      # 会话、登录、账号切换、状态同步
electron/auth-vault.ts           # 独立的登录凭据库
electron/license-service.ts      # 签名租约、设备状态、能力校验
electron/platform-model-client.ts # 平台模型调用与可恢复 job 绑定
electron/update-service.ts       # 签名检查、下载、安装前协调
src/shared/commercial-models.ts  # 平台/BYOK 来源与目录投影
src/features/account/            # 重建账号/钱包/授权/设备页面
src/features/settings/           # 现有七类多配置增加平台来源
```

本地 `CredentialVault` 当前只允许 provider SecretId，不能把 token 伪装成 API key 混入公开配置或扩展任意 secret id。独立 `auth-vault` 复用 safeStorage 加密与原子写入模式，配置导出/重置不包含或清除登录令牌，账号退出则只清理对应会话。

## 2. 阶段 A：身份、授权与设备

交付：手机验证码登录/注册、账号资料、刷新会话、设备注册/解绑、激活兑换、签名租约、账号状态同步。后台实现用户查询、兑换码批次与操作审计。

落点：替换 `src/features/account/AccountPage.tsx`、`ActivationPage.tsx` 的本地模拟操作；保留 route ID。`account:save` 只允许更新显示名称等用户可编辑字段，移除 balance/deviceId 写权限。`activation:save` 不再接受客户端提交 active/plan/expiresAt，改用兑换与服务端查询接口。更新 `src/shared/storydream-api.ts`、`ipc-contract.ts`、preload、main 和 browser fallback；浏览器预览只显示清楚的离线演示状态。

门禁：10 个并发激活请求只兑换一次；令牌刷新重放被拒；两台设备额度不因竞态变三台；时钟回拨不延长租约；退出/换账号不泄漏前账号权益。既有工作区没有登录仍能打开和导出本地作品。

## 3. 阶段 B：账本、报价与 Suno 第一条链路

先实现服务端钱包、费率版本、不可变报价、预留、结算、释放和流水查询，再接支付。开发环境通过有审计的 fixture 充值，生产客户端不存在“设置余额”入口。

Suno 先覆盖普通生成/查询/取回，随后用同样机制覆盖 lyrics/style、上传、翻唱、续写、分轨、人声克隆和强化上传；这些操作有不同计费条件，不能全部套用普通生成价。普通余额查询可作为免费服务探测；有可能超出免费额度的辅助接口不得当作免费连接测试。

桌面 `electron/music-profile-service.ts` 为平台来源创建 `platform-model-client`，自有 API 仍走原实现。每条本地记录保存 `accountId / source / platformJobId / quoteId / operationKey`，从开始到查询和下载都绑定原账号与路由，复用现有配置隔离思路。

门禁：余额 100、20 个并发请求各 100，只受理一个；重复点击/断网重发不多扣；worker 在提交前、提交后、结算前后崩溃均能恢复；上游 504 未知状态不重复收费提交；两首候选只收一次请求价；失败释放；取消和部分成功有独立测试；日志没有 key/token。

## 4. 阶段 C：真实充值和退款

首版接一个支付渠道，优先按商户资质选微信 Native 或支付宝预创建；第二渠道共享订单和账本逻辑。支付回调必须独立验签并原子入账，定时补查漏通知订单。后台展示支付平台订单与积分流水的对账差异。

充值套餐、积分换算、活动和退款规则配置在后台。上线前准备隐私政策、服务条款、退款说明与用户联络入口，并把这些规则显示在付款确认处。

门禁：真实沙箱的创建、支付、重复回调、回调先于前端响应、晚到支付、过期查询、退款成功/失败都闭环；错金额/商户/币种不入账；订单不能跨账号读取；退款与新消费竞争时不出现透支。正式小额验证由实施阶段明确选择测试账户和金额，当前设计阶段不发起支付。

## 5. 阶段 D：其余六类模型与统一默认配置

增加平台目录版本、参数白名单、预算及路由适配。每类支持多个目录项与多个自有 API，保存和测试继续不改变启用项。

| 现有调用位置 | 需要接入的能力 |
|---|---|
| `src/shared/llm-provider.ts`、`task-runtime-providers.ts` | 文本/分镜/改写，报价绑定输出上限与 usage |
| `src/shared/media-providers.ts`、`image-lab.ts` | 生成/编辑图片与候选，TTS 和克隆音色 |
| `src/shared/video-provider.ts`、`video-routing.ts` | 视频时长、分辨率、异步查询和预算 |
| `src/shared/viral-runtime.ts`、`viral-reference-providers.ts` | 语音识别、视觉分析及参考视频分段 |
| Electron 中各实验室、HTML 视频、VOX、导演工作台的 provider 注入点 | 统一 source 路由，不能遗漏旁路生成入口 |

接入时让能力适配器选择 `platform / byok`；业务 runner 继续处理自己的流程。不要在 renderer 或 runner 里各自实现一套扣费；服务器是唯一预留与结算入口。

门禁：对全部收费操作建立目录清单，覆盖任务级/单镜重做/实验室/辅助调用。每个入口显示来源、费用单位和 task budget；cache 命中和下载已有结果不重复扣费。禁止静默跨 source 降级。更新目录时不重写用户保存的模型选择。

## 6. 阶段 E：安全更新与发布后台

E1 为首发必需的签名完整包、更新检查、下载和手动升级，与 A/B/C 并行完成；首发验收组合为 A + B + C + E1 + F，不需要等六类平台模型全部接入。E2 为 NSIS 自动更新、自动安装协调与成熟灰度发布，在 D 之后扩展。以下基础签名、数据备份和兼容性要求对 E1/E2 都适用。

现有 `package.json` 与 `scripts/package-win.ps1` 仅产出 Windows portable ZIP，先补版本统一来源、签名完整包、可验证 release manifest 和检查/下载页面，再加入签名 NSIS + updater。迁移保留 app data、作品、凭据库和备份；安装包与用户数据目录分离。

首次从不含 updater 的旧便携版进入新系统需要用户安装完整新版，不能依靠不存在的自动更新入口。签名证书和对象存储完成后才启用自动下载/安装选项。

门禁：错误签名、错误哈希、旧 manifest 重放、降级包、非发布域名、路径穿越均拒绝；render/ffmpeg 活动期间只下载不安装；下载断点续传；磁盘不足保留旧版本；安装失败可恢复；DB 新旧兼容测试；灰度撤回停止新安装。

## 7. 阶段 F：上线前演练

环境分离：local/test/staging/production 的账号、支付、供应商 key、数据库和发布签名分别配置。测试模式不可通过客户端输入打开生产充值和管理员接口。私有渠道既有凭据不能写进容器镜像或 repo。

上线检查包括：账本重算对账、退款补偿、供应商余额告警、冻结超时工单、数据库备份恢复、设备解绑、管理员 MFA/RBAC、接口限流、媒体保留期限和下载权限。至少用两个真实设备、两个账号、一个真实支付沙箱完整跑一次。

成功指标：重复收费为零；已支付未到账可查可补；钱包投影可由账本重建；崩溃后原 job 可恢复；灰度升级不会丢作品；已有自有 API 配置无需重新录入。

## 8. 自动化测试建议

- PostgreSQL 真实事务集成测试，不用内存 mock 证明并发余额安全。
- Webhook 验签 fixture 与支付沙箱契约测试，不把回调模拟成功当作支付已上线。
- 模型 adapter 契约测试覆盖 submitted/unknown/pending/partial/completed/failed。
- Electron IPC 测试证明 renderer 不能写 balance、entitlement、price、provider key、任意安装 URL。
- 原有音乐 19 文件/七类配置回归保留；新增更新/账本/账号测试按阶段维护。
- Playwright 在深浅主题 1440 和 1040 宽度验证登录、充值、预留、退款、授权失效与升级等待状态。

## 9. 决策清单

下列项目影响上线，但不阻碍当前设计和本地开发：

| 决策 | 推荐起点 | 何时需要确定 |
|---|---|---|
| 收款主体 / 商户 | 现有合规微信或支付宝商户 | 阶段 C 接真实沙箱之前 |
| 域名 / 服务器 / 数据区域 | 一个 API 域名、一个下载域名、托管 PostgreSQL | 阶段 A 预发布部署前 |
| 登录通道 | 手机验证码，后续微信扫码 | 阶段 A 外部发送前 |
| 授权商品与设备数 | 个人授权，默认两台设备，非自动续费 | 真实发售前 |
| 积分换算 / 模型零售价 | 100 积分/元仅作为草案 | 费率发布前 |
| Windows 代码签名 | 正式证书 + 受保护签名流水线 | 首发 E1 正式下载前 |

这些均作为后台配置和 adapter 决策保留，不以硬编码假定用户已经选定供应商。
