# Findings

- 本地已有 Storybound 学习记录：storybound_gap_findings.md、storybound_e_reverse_audit_2026-06-24.md、docs/plans/2026-07-30-storybound-runtime-parity.md。
- 已观察行为：试用用尽仍可查看/继续旧任务；模型调用前检查余额；账号/激活分入口；更新 check/apply 分离。
- 当前软件账号、激活、余额仍是本地模拟，需要服务端可信账本，不能以桌面 SQLite 作为扣费依据。
- 基线工作区有大量本地 PPT、临时脚本和测试产物，仅提交软件代码、相关测试与开发记录。

## 仓库确认

- 当前基线是 Electron + React + sql.js，本地 `account:save` / `activation:save` 允许写模拟状态；生产需要收窄为资料更新/兑换命令。
- `electron/credential-vault.ts` 限定 provider SecretId；登录凭据应使用独立 auth vault，复用加密方式而非混入 API 配置。
- `scripts/package-win.ps1` 只生成 portable ZIP，现阶段没有可直接启用的正式自动更新机制；计划先签名完整包，再 NSIS updater。
- 原有 `video-routing.ts` 已有模型能力/白名单/预算概念，需扩展来源和积分预算，避免生成端另做计费逻辑。
- `music-profile-service.ts` 已按配置与地址隔离任务，平台 job 增加账号与报价绑定可延续其隔离方式。

## 已完成设计

- 三种独立状态：账号身份、软件权益、积分钱包。
- 平台模型服务端密钥；BYOK 保留现有七类多配置与启用行为，旧用户不静默迁移扣费。
- 预报价、原子预留、服务端结算；支付、重试、取消和退款都以业务唯一键/不可变账本约束。
- 模型目录与软件更新分离，更新中不强杀生成/渲染，DB 恢复与软件回退一起设计。
- 所有商业数字均为明确标记的建议，真实上线依赖支付商户、生产域名、签名和正式费率。
