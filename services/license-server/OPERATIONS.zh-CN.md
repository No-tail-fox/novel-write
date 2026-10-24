# StoryDream 授权与更新运维

生产服务：`https://154.219.120.162:443`。管理入口为 SSH，账号和密码不写入项目文件。服务使用独立用户 `storydream-license`，开机启动，异常退出自动重启。

2026-10-24 已发布 `1.0.2`，发布序号为 `2`。本机安装包为 `.artifacts/license-release/StoryDream-Setup-1.0.2.exe`，大小 `542244813` 字节，SHA-256 为 `5f156e8a33b66bc6b553e6303b1e291f276e1209d18fa3508e6943a6ba6faa21`。`1.0.1` 因安装向导被隐藏已撤回，`1.0.2` 已修正。后续版本从 `1.0.3` 递增。

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

## 服务与备份

```bash
systemctl status storydream-license --no-pager
journalctl -u storydream-license -n 50 --no-pager
storydream-license backup /var/lib/storydream-license/backup.sqlite3
openssl x509 -in /var/lib/storydream-license/tls.pem -noout -enddate
```

SQLite 备份不包含完整恢复所需的密钥。完整备份需要短暂停止此服务，归档整个 `/var/lib/storydream-license` 到目录之外的私有文件，权限设为 0600，并在成功或失败后恢复服务。应将完整备份另存到加密的异地存储；服务器本机备份不能防止整机丢失。不得把私钥、完整备份或 `secrets.json` 放进代码仓库和公开下载目录。

2026-10-24 已完成首份完整备份：`/root/storydream-license-backups/storydream-license-20261023T175858Z.tar`（文件名为 UTC 时间）。其中包含完整私有状态、发布文件、服务代码和虚拟环境、systemd 单元及管理命令。大小 `2200791040` 字节，权限 `0600`，SHA-256 为 `f83ee78b988e9963ce95ef3fcf004374374fa1aff50643eb3a544e833cb0e942`。备份后服务重启、外网 HTTPS 和版本清单签名检查通过。目前尚未配置加密异地备份。

服务器证书有效期一年，到期前至少 30 天执行以下命令，并从客户端验证连接：

```bash
storydream-license renew-tls
systemctl restart storydream-license
```

不得重新初始化生产状态或删除 CA、签名密钥。更换 IP、CA 或签名密钥需要提前安排客户端信任配置升级。详细恢复流程见同目录 `README.md`。
