# 本次实施契约

共享类型：`src/shared/commercial-contract.ts`。桌面公开入口统一为 `StoryDreamApi.commercial: CommercialApi`。渲染层不获得 token、平台 key 或任意 authenticated fetch。

## 服务端路由

所有路径前缀 `/v1`，JSON 直接返回对应共享类型。失败为 `{ error: { code, message } }`。写接口接受 `Idempotency-Key`。

- GET `/public/config` → `{ environment, paymentAvailable, catalog: CatalogModel[] }`
- POST `/auth/challenges` body `{ phone }` → AuthChallenge
- POST `/auth/verify` body `{ challengeId, code, device: { installationId, publicKey, name }, deviceProof? }` → `{ accessToken, refreshToken, userId, expiresAt }`
- POST `/auth/refresh` body `{ refreshToken, deviceProof? }` → 同上；POST `/auth/logout` 撤销会话
- GET `/me/snapshot` → `{ user, wallet, license, devices }`；PATCH `/me` body `{ displayName }` → PlatformUser
- POST `/licenses/redeem` body `{ code }` → PlatformLicense；DELETE `/me/devices/:id/binding`
- GET `/wallet/transactions` → LedgerEntry[]
- GET `/recharge/products` → RechargeProduct[]；POST `/recharge/orders` body `{ productId, version }` → RechargeOrder
- GET `/recharge/orders/:id`；POST `/recharge/orders/:id/refunds` → RechargeOrder
- POST `/quotes` QuoteInput → PlatformQuote；POST `/jobs` body `{ quoteId, operationId }` → PlatformJob
- GET `/jobs` → PlatformJob[]；GET `/jobs/:id`；POST `/jobs/:id/cancel`
- GET `/artifacts/:id` → 受保护的文件流（校验 userId）；主进程落本地后只返回本地 path
- GET `/updates/check?version=...&platform=win32&arch=x64&channel=stable` → UpdateManifest 或 null

所有积分/金额都是整数十进制字符串。服务端不包含本机 profiles；主进程将加密账号会话、每账号的本机 profiles 与服务端快照合成 CommercialSnapshot。服务地址由 `STORYDREAM_PLATFORM_URL` 环境变量/发布配置注入，生产必须 HTTPS，开发仅允许 loopback HTTP。

## 主进程工厂

`createCommercialService({ dataDir, baseUrl, appVersion, safeStorage, fetchImpl?, getActiveTaskCount?, openPath?, updatePublicKeys?, allowedDownloadOrigins? }): CommercialApi`，类型由实际实现导出。所有令牌存独立加密 auth-vault；accountEpoch 防止切换账号污染旧请求。更新实现 E1（校验完整包并打开文件夹进行手动升级），无证书/清单/白名单时拒绝下载，不伪造签名成功。

BYOK profile 只保存本地现有 profile ID，绝不上传用户 key。没有明确平台选择的现有用户继续使用原自有 API。
