# Free API Router

这是一个本地固定入口的 API 路由器。客户端只需要记住一个地址：

```text
http://127.0.0.1:8787/v1
```

它支持 `POST /v1/chat/completions`（OpenAI 兼容）和 `POST /v1/messages`（Anthropic 兼容）。每次请求会根据协议、模型和冷却状态选择上游；上游返回网络错误、限流或服务端错误时，路由器会自动切换到下一个已配置站点。上游 Key 只从环境变量读取，不写入目录、日志或接口响应。

## 初始化

在 `free-api-router` 目录执行：

```powershell
Copy-Item config/providers.example.json config/providers.json
npm run sync
```

然后把你自己在各站后台创建的 Key 写入当前 PowerShell 会话。例如：

```powershell
$env:AGENTROUTER_API_KEY = "你自己的站点 Key"
$env:FLUSHAPI_API_KEY = "你自己的站点 Key"
node src/server.mjs
```

只设置一个 Key 也可以使用；设置多个 Key 后才会形成故障切换池。`providers.json` 只保存 `apiKeyEnv` 名称，禁止把 Key 明文写进去。

## 使用

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod http://127.0.0.1:8787/v1/models
```

OpenAI SDK 的配置是：

```text
Base URL: http://127.0.0.1:8787/v1
API Key: 任意非空字符串（本地路由器不校验这一层）
```

Anthropic 客户端使用：

```text
ANTHROPIC_BASE_URL=http://127.0.0.1:8787
ANTHROPIC_AUTH_TOKEN=任意非空字符串
```

## 自动维护

`npm run sync` 会读取两个来源：

- GitHub [panxunying/ai-coding-welfare](https://github.com/panxunying/ai-coding-welfare) 的 `data/sites.json` 与 `data/live.json`，用于可调用端点、协议、模型和在线快照。
- [白嫖 BaiPiao 公益目录](https://baipiao.org/charity/)，用于补充更广的发现入口。

服务启动后默认每 6 小时同步一次。`GET /v1/catalog` 可以查看当前目录，`GET /v1/providers` 只返回已配置上游的公开元数据。白嫖目录中的注册链接、邀请链接和登录入口不会被当作 API 自动调用；需要用户自行注册并创建 Key 后，在 `providers.json` 中启用对应的 GitHub 目录站点。

## 检查上游

```powershell
npm run check
```

检查会用已配置 Key 获取 `/v1/models`，并对一个模型发送最小实际请求；仅两步通过才标记为 `OK`。请求可能消耗少量免费额度。检查结果写入 `data/health.json`。`data/` 和真实配置默认已加入 `.gitignore`。

## 开户与接入清单

站点注册链接、协议端点、环境变量名和当前接入状态见 [docs/provider-onboarding.md](docs/provider-onboarding.md)。这份清单不会保存邮箱、密码或 API Key。

## 约束

公益站不承诺 SLA，模型清单和域名可能变化。路由器只负责在你授权使用的账号和 Key 之间切换，不自动注册账号、不采集共享凭据、不绕过登录或限流。来源页面写明的额度、邀请条件和使用限制仍以服务商当前页面为准。
