# StoryDream 设备身份与授权绑定 v3 设计

状态：设计提案，未实现、未部署。用户要求暂停上线并重新设计身份识别。现有 v2（MachineGuid + SMBIOS UUID）代码保留为未发布试验，不作为最终设备身份设计直接上线。本文件不授权执行线上客户解绑或发布。

## 1. 决策与目标

采用“服务器设备记录 + 密钥持有证明 + 独立授权绑定 + 辅助硬件证据”。设备 ID 不再等于硬件哈希。第一阶段复用 Ed25519/DPAPI；第二阶段在原生能力与服务端证明验证通过后接入 TPM。

目标：

- 两位客户的硬件值完全相同，也不能因一个人的解绑、锁定影响另一人的记录。
- 同一有效凭据升级、重启不消耗新名额；普通卸载默认保留凭据。
- 凭据丢失有明确恢复入口，不把“重装”“换授权”“凭据被克隆”合并成同一个错误。
- 删除凭据不会恢复已停用的授权、增加授权名额或自动替换其他人的有效绑定。
- 同一逻辑设备最多一个有效授权绑定，保留目前产品的一机一授权规则；可明确执行换码事务。
- 不承诺在无受信硬件证明、没有账户身份的情况下，永久识别所有重装/克隆/篡改客户端。

重要边界：设备 ID 随机化不等于永久物理机器封禁。软件密钥删除后，服务器可能无法证明新请求就是以前被锁定的物理机。强限制应作用于授权/客户主体，并采用受控恢复；对“换新授权也不能使用同一物理电脑”的要求，需要另外定义经过 TPM 证明的封禁策略。不能一边允许低可信软件降级，一边声称不可绕过物理机封禁。

## 2. 四个概念分离

| 概念 | 建议字段 | 用途与唯一性 |
| --- | --- | --- |
| 设备记录 | deviceRecordId | 服务器安全随机生成，数据库主键；用户看到的设备编号来自它；不由硬件导出 |
| 设备凭据 | credentialId / publicKey / keyHash / algorithm | 证明请求者持有对应私钥；正常注册同一活动公钥映射同一记录 |
| 授权绑定 | bindingId / licenseId / deviceRecordId / revision | 表示某设备占用哪个授权的一个名额；后台只操作准确的绑定 |
| 硬件证据 | type / source / valueDigest / quality / observedAt | 作为重装候选、冲突提示和风险线索；索引非唯一，不决定所有权 |

一个设备记录可保留多条历史凭据，但第一阶段仅一个活动凭据。密钥轮换或恢复增加 credentialEpoch，旧凭据留存撤销记录。一个设备可有多个历史绑定，但只能一个活动绑定。名字仅作显示，不参与认证。

## 3. 身份采集与可信等级

### 第一阶段

复用应用现有 Ed25519 密钥、签名验证和 Windows DPAPI 存储。密钥及设备 ID 存在专用凭据存储中，普通缓存清理不得触碰；卸载可默认保留，主动清理前提示需要重新激活或恢复。升级不重建私钥，不因某个硬件探测超时重建身份。

硬件信号按类型分别记录，不再拼接为严格匹配的一串身份：

1. Windows SystemIdentification.GetSystemIdForPublisher 的值及 Source，先完成 Electron/NSIS 实机原型验证。
2. SMBIOS System UUID、有效系统/主板序列号，作为辅助证据；空值、全零、全 F、厂商占位符明确标为不可用。
3. MachineGuid 仅保留为弱证据与旧协议迁移线索。

不默认采集 MAC、IP、CPU 型号或所有磁盘信息来制造“更精确”的感觉。IP 用于短期异常访问判断，不作设备所有权证明。任何单个采集失败不影响已有有效密钥的常规授权；记录质量下降，必要时限制自动恢复。

GetSystemIdForPublisher 是标识 API，不是服务器可验证的 TPM 密钥证明。微软说明它依次尝试 TPM、UEFI、注册表，必须检查 Source；注册表来源跨全新 Windows 安装不稳定。对无包身份 Win32 程序，它也不是天然的 StoryDream 独占标识；在本地加产品域分隔后摘要上报，避免使用原始通用值。[S1][S2]

证据不作 UNIQUE 约束，不跨客户自动合并。原始值不写普通日志，优先在本地以产品域分隔摘要后上报，服务端再以专用、版本化 HMAC 密钥形成检索摘要。摘要仍是可关联标识，不宣称匿名；不复用激活码 pepper，明确保留/删除策略。

### 第二阶段

定义 CredentialSigner 接口（publicKey、algorithm、sign），使软件 Ed25519 与 Windows 原生 TPM 签名实现可替换。TPM 分支选择平台实际支持的算法，不能假定现有 Ed25519 私钥可以直接转成 TPM 密钥。

可信等级由服务器确认：software / hardware_unattested / hardware_attested。客户端报告“密钥在 TPM”只能进入未证明等级。只有服务端验证可信证明链、一次性挑战、证明与公钥绑定后，才标记 hardware_attested。[S3]

不把 Windows 企业 CA 文档当作现有 Linux/Python 服务可直接启用的开关。需单独实现或接入证明验证，验证物理 TPM 与支持的 vTPM 场景；未完成前不宣称防克隆。已登记强凭据失效时不得悄悄降级成软件凭据，要进入恢复流程。

## 4. 数据模型建议

保留 licenses、发布、公告和签名身份，新增 v3 表（列名可在实现时细化）：

- device_records(id, label, state, credential_epoch, created_at, updated_at)
- device_credentials(id, device_id, algorithm, public_key, key_hash, trust_level, status, created_at, revoked_at)
- license_bindings(id, license_id, device_id, state, revision, bound_at, released_at, last_seen)
- device_evidence(device_id, type, source, digest_version, value_digest, quality, first_seen, last_seen)
- recovery_requests(id, target_binding_id, target_revision, proposed_key_hash, state, expires_at, approved_by, completed_at)
- legacy_binding_map(protocol, legacy_device_id, legacy_key_hash, legacy_license_id, device_id, binding_id)
- auth_challenges(id, purpose, subject_hash, expires_at, consumed_at)
- mutation_receipts(request_id, request_hash, result_reference, expires_at)

关键约束：活动凭据公钥唯一；活动绑定 device_id 唯一；license_id 下活动绑定数不得超过 max_devices。所有注册/迁移/恢复/换码均在写事务内复核授权状态、名额、记录 revision，不能先查询后在另一事务里占位。客户端重试同 requestId 必须同请求摘要；不得重复启动期限、增加名额或更换密钥。

后台 API 使用 bindingId + expectedRevision，不再接受仅凭硬件哈希执行“解绑某客户”。设备锁定使用 deviceRecordId + expectedRevision；授权停用使用 licenseId。强物理机封禁不是这个接口的隐含副作用。保留所有状态变更审计，列出目标授权/设备记录/操作者，但不记录完整激活码或私钥。

## 5. 请求与租约

使用明确的 /v3/license/* 端点及 schemaVersion:3，不给旧版严格租约 schema 偷加字段。能力协商在可信 TLS 下进行，能力说明可独立签名；不更换现有 CA 和服务签名密钥。服务不支持时提示协议不支持，不退回旧编号抢占绑定。

注册/恢复：服务签发随机短期挑战，绑定操作类型、新公钥摘要、目标绑定（如有）及有效期；客户端签名完整上下文。消费挑战与最终写入同一事务，防重放。挑战是防重放与公钥持有证明，不是客户身份授权。

刷新：设备 ID + credentialId + 绑定 ID + 时间戳 + nonce + 请求路径/正文签名。服务验证凭据状态、epoch、授权、绑定、封禁和 nonce；不得因硬件证据匹配跳过验签。

租约签名载荷包含 licenseId、deviceRecordId、credentialId、keyHash、credentialEpoch、bindingId、bindingRevision、issuedAt、validUntil、expiresAt，离线宽限为明确可选策略。建议新默认在线租约仍不超过 10 分钟，沿用两分钟刷新。现有已签发离线租约无法靠服务器数据库修改立即失效，恢复提示必须如实说明最大延迟；需要更严格互斥时关闭离线宽限并要求关键请求在线确认。

网络超时、TLS 校验、协议不支持、签名无效、名额已满、设备锁定、恢复待处理分开报错。诊断号应在客户端关联到脱敏底层错误，不能只有一个“请检查网络”的包装信息。

## 6. 业务流程

### 新激活

1. 生成/读取设备密钥，读取可用硬件证据。新设备暂时无服务器记录 ID。
2. 输入有效激活码，完成挑战签名。验证激活码、设备限制与密钥持有证明。
3. 若密钥已有活动记录，返回/复用该记录；不能重复注册占名额。若其绑定另一授权，转明确“更换授权”操作。
4. 若新密钥且目标授权有空位，创建独立设备记录和绑定。其他客户硬件证据相同只标记冲突，不泄露其身份，不抢占/解绑其记录。
5. 目标授权没有空位时，提供恢复/换机入口，不能自动踢下最早或离线设备。

### 普通重装或重启

凭据保留：恢复同一服务器记录并验证，不占新名额。不能因为磁盘、网卡、系统 ID 变化直接废弃仍然有效的设备密钥；证据变更记录并按策略要求额外确认。

### 凭据丢失/Windows 重装

1. 新密钥提交恢复申请，硬件证据仅用于候选提示；客户端不能据此获得其他客户的设备列表。
2. 有空闲名额可选择普通新激活；旧名额不自动回收。已满或希望保留原设备记录则进入恢复。
3. 现阶段没有经过验证的客户账户体系，默认由管理员核对客户授权归属并批准。单凭有效激活码或硬件相似，不足以静默取代一个活动绑定。
4. 批准绑定准确的目标 bindingId/revision 和新 keyHash，短期、一次性、可撤销；新密钥仍须完成挑战签名。
5. 事务内撤销旧凭据、提升 epoch/revision、绑定新密钥，原到期时间和名额不变。若目标已变化、被锁定、授权停用或到期，拒绝并重新核对；恢复不得隐含解锁。
6. 相同请求响应丢失可查询/重试；成功才原子保存客户端新凭据状态。不能把未验证的服务响应写成有效授权。

### 换激活码

客户端已有有效设备凭据时，用户明确确认更换。服务先验证新码、空位及旧绑定 revision，再在一个事务内释放旧绑定并绑定新授权；失败保留旧绑定，不先解绑再试新码。旧授权有效期不重置；新授权按自己的首次激活规则计时。涉及已锁定设备须管理员明确处理。

### 同硬件信息的两位客户

客户 A 与 B 各自公钥、设备记录、授权绑定独立。即使所有辅助属性相同，解绑/锁定 A 只影响 A 的记录。首次注册后若两端实际持有同一复制的软件私钥，则服务器不能仅靠签名区分；需要受控密钥拆分/恢复，不能宣称随机 ID 自动解决完整克隆。

### 完整克隆与同时使用

第一阶段提供可疑同时使用检测，异常时提示核验，不基于 IP 自动封禁。单纯签名私钥已被克隆时，双方都能通过签名，必须承认这一边界。

后续可增加服务器会话 epoch/单活动会话：新会话须显式接管，重复进程/同会话刷新需幂等，旧会话下次在线验证失效。这只能约束在线会话，不能证明物理机唯一或立刻撤回有效离线租约。更高等级由 TPM 证明与受控恢复解决，不能靠多个硬件字符串达到同等保证。

## 7. 旧版兼容与当前事故恢复

- 不把现有 devices 表按 device_id 直接去重或全量重算编号；按现有授权 + 旧编号 + key_hash 建立映射。已释放历史记录不自动恢复。
- 升级客户端保留原密钥，通过受信新协议证明旧绑定所有权后迁移成服务器记录。原绑定时间、授权起止、名额、更新序号及回退保护保留。
- 两台同旧编号、不同私钥时，当前有效绑定的持钥方可迁移；已被释放的一方用自己的有效授权重新激活或经恢复流程处理。不能猜测两人所持凭据归属。
- 若私钥也相同，自动迁移不能拆成两位用户；进入冲突恢复，分别验证授权后生成新密钥。
- 新旧端点必须共用一个规范化授权/名额状态，旧适配器只查映射；不能维护互不知情的 v1 与 v3 名额池。无法做到时不能宣称兼容上线。
- 已迁移的旧 ID/key 请求拒绝，防止旧客户端再次占位。未迁移旧客户端按旧协议暂时保留；后台对未解析的冲突记录禁止泛化整编号操作。
- 旧 blocked_devices 若映射唯一，可保守迁移到对应记录；若一个硬件编号涉及多个客户，列为未解析旧封禁，由管理员裁定。此类已知锁定的恢复必须人工处理，不能自动解锁，也不能把它永久扩散到所有相似设备。
- 本地已有 v2 实验凭据需单独识别并通过原密钥映射迁移；不把“协议不支持”误报为网络错误，也不让客户删除凭据试错。

本次事故应先核对两位客户各自授权及持钥情况，再安排配套升级。当前旧编号上的现行绑定与已释放绑定保持原状，设计阶段不操作生产。

## 8. 分阶段落地与验收

### 第一阶段：解决误合并、误解绑和重装恢复

新增规范化设备/凭据/绑定表、精确后台操作、v3 软件密钥验证、管理员恢复流程、原子换码、旧协议适配与明确错误分类。硬件证据缺失可使用低可信注册；不能阻止已有凭据正常刷新。不把 SystemIdentification/TPM 原型研究作为修复绑定数据模型的前置依赖。

### 第二阶段：增强设备证明

验证 Windows 原生采集与稳定性，接入 CredentialSigner 原生实现、TPM 证明验证、证书链与挑战处理。通过设备覆盖测试后逐步开启，产品明确哪些授权允许 software 降级。硬件来源 ID 与硬件密钥证明分别记录。

### 必须通过的测试

- 两台所有硬件字段相同但不同密钥/不同授权：各自可激活，A 解绑/锁定不影响 B。
- 单授权一个名额，并发激活/恢复/换码不超卖；失败不丢旧绑定，不重置有效期。
- 同密钥重试、服务提交后响应丢失、客户端写盘失败可恢复，无重复设备或名额。
- 清理缓存、升级、普通卸载重装保留授权；删除凭据不自动获得恢复权限或绕过授权停用。
- 错误授权、管理员批准过期、重复使用批准、目标 revision 改变、新公钥不符全部拒绝。
- 完整克隆软件凭据不伪装成可完全识别：展示冲突边界并验证管理员拆分流程。
- 旧客户迁移、旧客户端回退、v2 实验凭据、旧封禁歧义、旧租约未过期均有覆盖。
- 后台陈旧页面不操作新绑定；普通解绑与整授权停用/设备锁定名称、范围明确。
- 断网、证书错误、服务不支持协议、签名错误分别有正确提示和脱敏诊断。
- 原生采集对普通用户权限、NSIS 安装、不同 Windows 用户、TPM 关闭/清除、换主板、系统重装、VM 克隆分别实测；未经验证不承诺覆盖。

发布前：用脱敏数据库副本演练迁移和回滚，检查授权总数/活动名额/有效期与签名配置不变；服务端与管理网站先上线，验证能力与旧版兼容后再发客户端。维护期间禁止旧 CLI 写入；不要仅回滚代码而忽略 schema。不要先发要求新协议的客户端，让客户遇到当前的“服务尚未支持”错误。

## 9. 资料依据

以下链接为技术依据，业务流程、阶段划分与恢复策略为本项目设计建议。

- [S1] Microsoft：GetSystemIdForPublisher，TPM/UEFI/Registry 来源及稳定性边界。https://learn.microsoft.com/en-us/uwp/api/windows.system.profile.systemidentification.getsystemidforpublisher
- [S2] Microsoft：SystemIdentification class，未打包 Win32 程序的标识作用域。https://learn.microsoft.com/en-us/uwp/api/windows.system.profile.systemidentification
- [S3] Microsoft：TPM Key Attestation，客户端声称使用 TPM 不足以证明硬件保护。https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/component-updates/tpm-key-attestation
- [S5] Microsoft：CryptProtectData，DPAPI 保护范围及漫游用户例外。https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata
- [S6] Microsoft：Windows Autopilot motherboard replacement，硬件变化与重复身份的实际恢复边界。https://learn.microsoft.com/en-us/autopilot/autopilot-motherboard-replacement
