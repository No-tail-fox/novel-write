# StoryDream 授权与更新运维

生产服务：`https://154.219.120.162:443`。完整管理网站已于 2026-10-29 部署上线，入口为 `https://154.219.120.162/admin/`，包含公告、更新发布、授权码、设备和操作记录。13 项隔离 TLS 集成测试在本机和服务器通过；外网严格 CA 校验、版本签名、管理员登录、五个模块读取、桌面与手机页面及退出登录均通过。生产授权、设备和版本数据保留，没有创建测试公告、授权或版本。服务使用独立用户 `storydream-license`，开机启动，异常退出自动重启。浏览器必须信任服务端 CA；若另设公开信任的管理域名，不得直接替换桌面客户端依赖的现有 CA 和签名密钥。

2026-10-24 已发布 `1.0.2`，发布序号为 `2`。本机安装包为 `.artifacts/license-release/StoryDream-Setup-1.0.2.exe`，大小 `542244813` 字节，SHA-256 为 `5f156e8a33b66bc6b553e6303b1e291f276e1209d18fa3508e6943a6ba6faa21`。`1.0.1` 因安装向导被隐藏已撤回，`1.0.2` 已修正。后续版本从 `1.0.3` 递增。

> 差分更新说明（2026-10-30）：服务端及管理网站已部署差分接口和可选 `.exe.blockmap` 上传。完整私有备份、15 项服务器测试、生产签名、旧清单兼容和 Range 校验均已完成。桌面生产版仍为 `1.0.2`，`1.0.3` 正在打包和隔离安装验收，尚未发布。生产信任身份与既有授权数据保留。具体操作、首轮全量升级要求和上线顺序见 [差分更新发布说明](../../docs/plans/differential-updates/rollout.zh-CN.md)。

## 发放激活码

```bash
ssh root@154.219.120.162
storydream-license issue --days 365 --max-devices 1 --label customer-reference
```

输出的 `code` 是激活码，`licenseId` 是授权编号。激活码只显示一次，请保存在自己的安全记录中。365 天从首次激活开始计算；解绑、换机不会重新计时。把激活码填入新版软件的“设置 → 软件授权”。

## 查询、锁定与换机

```bash
storydream-license licenses
storydream-license devices
storydream-license lock-device DEVICE_SHA256 --reason operator-reference
storydream-license unlock-device DEVICE_SHA256
storydream-license release-device DEVICE_SHA256
storydream-license revoke-license LICENSE_UUID
storydream-license restore-license LICENSE_UUID
storydream-license audit
```

将 `DEVICE_SHA256` 换成软件显示的设备编号或 `devices` 中的 `device_id`；将 `LICENSE_UUID` 换成 `licenses` 中的 `id`。锁定针对机器，撤销针对整个授权。换机前执行 `release-device` 释放旧机器名额，用户也可以在软件中解绑本机。

联网时每 120 秒验证一次，用户手动“验证授权”可立即获取最新状态。断网只允许使用剩余联网凭证，最长 10 分钟；重新启动软件必须联网验证。锁定、撤销或到期会阻止后续生成；已提交任务可能继续完成，本地作品、编辑、渲染、导出和结果取回仍可使用。

机器绑定使用 Windows MachineGuid 的哈希值和系统加密的设备私钥。重装系统、丢失系统加密凭据后可能需要管理员释放旧设备。旧版可执行文件无法被追溯加上授权限制，需要分发新版安装包。

## 发布后续版本

同步递增 `package.json` 和 `package-lock.json` 根版本号，保留 `config/license-public.json` 的生产信任配置，重新构建并生成 NSIS 安装包。版本必须严格递增，例如下一版为 `1.0.3`。使用独立输出目录可以保留已有发布文件：

```powershell
pwsh -NoProfile -File scripts/build.ps1
node scripts/check-license-config.mjs
node node_modules/electron-builder/cli.js --win nsis --x64 --publish=never --config.directories.output=.artifacts/license-release
```

在 Windows 上验证安装包后，将其上传到服务器私有暂存目录，再发布：

```bash
install -d -m 700 -o storydream-license -g storydream-license /var/lib/storydream-license/incoming
# 从本机通过 scp/SFTP 上传安装包到上述目录。
chown storydream-license:storydream-license /var/lib/storydream-license/incoming/StoryDream-Setup-1.0.3.exe
chmod 600 /var/lib/storydream-license/incoming/StoryDream-Setup-1.0.3.exe
storydream-license publish --file /var/lib/storydream-license/incoming/StoryDream-Setup-1.0.3.exe --version 1.0.3 --minimum-version 0.0.0 --notes '版本更新说明'
```

客户端启动时、每小时和手动检查时获取签名清单，下载后校验完整文件大小和 SHA-256。用户确认安装且没有运行中任务后，软件退出并启动安装器。`--minimum-version` 可要求旧版本升级后才能继续生成，发布前应确认新版本可正常安装。

```bash
storydream-license withdraw 1.0.3
```

撤回会停止该版的发现和下载。恢复时发布更高版本，不回退版本号。Windows 发布者证书尚未配置，系统可能显示未知发布者；应用自身的更新签名和哈希校验已经实现。

## 发布问题公告

版本发布会自动生成“更新公告”，公告正文取 `--notes`（最多显示 2000 个 UTF-16 字符）。服务问题、维护通知可单独发布；命令输出的 UUID 用于之后撤回。客户端启动后、每小时及用户打开左上角公告入口时会获取并验证签名公告。

```bash
storydream-license announce --title '服务维护通知' --body '维护时间与受影响功能说明'
storydream-license announcements
storydream-license withdraw-announcement ANNOUNCEMENT_UUID
```

撤回问题公告后，下一次客户端检查时不再下发该公告。更新公告随对应版本一同撤回；客户端最多接收最近 8 条有效公告。

## 网站管理员

管理员独立初始密码已在部署时设置并验证，不写入项目文档。需修改时，通过 SSH 为服务账户交互式设置密码。密码不会回显，也不会写入命令参数或项目文件；服务端只保存 PBKDF2 哈希。密码至少 14 个字符。

```bash
sudo storydream-license set-admin-password
```

网站密码与 SSH 密码分开，不要重复使用。修改密码后重启 `storydream-license` 服务，使已有网站会话失效。然后在已信任服务端私有 CA 的浏览器打开 `https://154.219.120.162/admin/`。登录会话使用 Secure、HttpOnly、SameSite=Strict cookie，并在 8 小时后过期；登录接口有速率限制，管理写操作校验同源。当前是单管理员后台，尚不提供多管理员角色分权。

### 公告

查看现有公告、发布问题或维护公告、撤回公告。版本更新公告由发布版本自动生成，不能单独撤回，需到“版本更新”撤回对应版本。

客户端启动、每小时及打开左上角公告弹窗时拉取并校验签名消息；当前采用轮询，不是实时长连接推送。左上角公告入口需要安装含该功能的桌面版本，仅更新网站不会修改已经安装的旧版软件。

### 版本更新

选择 Windows `.exe` 安装包（最大 4 GiB），填写递增版本号、最低可用版本和更新说明，确认后上传、校验并发布。更新说明同步生成更新公告。最低可用版本默认 `0.0.0`，提高此值会要求低版本客户端升级，须先验证安装包。

发布过程中不要关闭网页；失败时查看提示后重试。上传暂存文件不公开下载；中断文件清理，超过 24 小时的遗留上传在下一次上传时清理。一次只允许一个上传或发布操作，磁盘需留出暂存和发布副本空间。文件头与哈希校验不能代替病毒扫描、安装验收或 Windows 发布者签名。

撤回版本会同时撤回更新公告并停止该版下载，不会自动回退或降级客户端。修复后发布更高版本。

### 授权码

可签发授权码、设置有效天数与设备上限、搜索授权、停用、恢复及续期。完整授权码仅签发时显示一次，请保存至安全记录。未激活授权续期只增加可用天数，仍从首次激活计时；已激活授权从当前到期时间和当前时间中较晚者开始延长。续期不会自动恢复已停用授权。

### 设备

可搜索设备及客户备注、查看绑定状态、锁定、解锁、解绑换机。锁定设备不会删除授权，解锁也不会恢复已停用的授权。操作在客户端下一次授权校验时生效，离线机器不会瞬时收到锁定指令。

### 操作记录

查看和搜索授权、设备、公告及版本操作。授权、设备、版本和操作记录每页 50 条；客户授权列表不返回完整授权码或摘要密钥，设备列表不返回设备公钥。

## 服务与备份

```bash
systemctl status storydream-license --no-pager
journalctl -u storydream-license -n 50 --no-pager
storydream-license backup /var/lib/storydream-license/backup.sqlite3
openssl x509 -in /var/lib/storydream-license/tls.pem -noout -enddate
```

SQLite 备份不包含完整恢复所需的密钥。完整备份需要短暂停止此服务，归档整个 `/var/lib/storydream-license` 到目录之外的私有文件，权限设为 0600，并在成功或失败后恢复服务。应将完整备份另存到加密的异地存储；服务器本机备份不能防止整机丢失。不得把私钥、完整备份或 `secrets.json` 放进代码仓库和公开下载目录。

2026-10-24 已完成首份完整备份：`/root/storydream-license-backups/storydream-license-20261023T175858Z.tar`（文件名为 UTC 时间）。其中包含完整私有状态、发布文件、服务代码和虚拟环境、systemd 单元及管理命令。大小 `2200791040` 字节，权限 `0600`，SHA-256 为 `f83ee78b988e9963ce95ef3fcf004374374fa1aff50643eb3a544e833cb0e942`。备份后服务重启、外网 HTTPS 和版本清单签名检查通过。目前尚未配置加密异地备份。

管理后台部署前另有完整备份：`/root/storydream-license-backups/storydream-management-20261029T121218Z.tar`，对应北京时间 2026-10-29 20:12:18。大小 `2200832000` 字节，权限 `0600`，SHA-256 为 `c21137ca4ebc0c13c982bc00a1d8351447b35b662a946d6ae6f9b4f4f37db9ae`。该备份早于网站密码初始化，恢复旧备份后需重新设置网站密码。部署包 SHA-256 为 `eea05f95e72399b69fe26f8e209fe124ada48ed54d4de51cbe952147e4f175e4`。部署未修改 CA、签名身份、SSH、云安全组或现有端口 80 服务。本机浏览器验收使用隔离测试环境，未修改 Windows 证书信任库。

服务器证书有效期一年，到期前至少 30 天执行以下命令，并从客户端验证连接：

```bash
storydream-license renew-tls
systemctl restart storydream-license
```

不得重新初始化生产状态或删除 CA、签名密钥。更换 IP、CA 或签名密钥需要提前安排客户端信任配置升级。详细恢复流程见同目录 `README.md`。
