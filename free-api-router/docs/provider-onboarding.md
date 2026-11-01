# Provider Onboarding Checklist

Updated: 2026-09-27

This file records public entry points, integration status, and environment-variable names only. It does not record email addresses, passwords, API keys, or verification codes.

## Callable providers

After completing each provider's own registration, email verification, and API-key creation, store the key in the named Windows user environment variable and run `npm run check`.

| Provider | Signup | OpenAI endpoint | Anthropic endpoint | Environment variable | Status |
| --- | --- | --- | --- | --- | --- |
| AgentRouter | https://agentrouter.org/register?aff=szt3 | https://agentrouter.org/v1 | https://agentrouter.org | `AGENTROUTER_API_KEY` | Configured; Anthropic probe passed, OpenAI probe previously returned 401 |
| DoCode | https://ai.docode.life/register?aff=zMRe | https://docode.cc/v1 | https://docode.cc | `DOCODE_API_KEY` | Pending account |
| JustDoWork | https://api.justwoker.icu/sign-up?aff=VTrz | https://api.justwoker.icu/v1 | https://api.justwoker.icu | `JUSTDOWORK_API_KEY` | Pending account; directory says GitHub login is supported |
| FlushAPI | https://flushapi.fun/sign-up?aff=WBF3 | https://flushapi.fun/v1 | https://flushapi.fun | `FLUSHAPI_API_KEY` | Pending account; directory says GitHub login is supported |
| KKtoken AI | https://kktoken.cc/sign-up?aff=MzG9 | https://kktoken.cc/v1 | https://kktoken.cc | `KKTOKEN_API_KEY` | Pending account |
| GoRouter | https://gorouter.app/sign-up?aff=PZDx | https://gorouter.app/v1 | https://gorouter.app | `GOROUTER_API_KEY` | Pending account; no live snapshot in the current directory |
| TaBiAI | https://tabitoken.com/sign-up?aff=EQIT | https://tabitoken.com/v1 | https://tabitoken.com | `TABITOKEN_API_KEY` | Pending account; no live snapshot in the current directory |
| AnyRouter | https://anyrouter.top/register?aff=Z24N | https://anyrouter.top/v1 | https://anyrouter.top | `ANYROUTER_API_KEY` | Pending account |
| CheapCodex | https://api.cheapcodex.online/register?aff=U7SSQZSDB36S | https://api.cheapcodex.online/v1 | https://api.cheapcodex.online | `CHEAPCODEX_API_KEY` | Pending account |

## Discovery-only entries

These entries currently have no OpenAI or Anthropic endpoint in the synchronized catalog and should not be added to the router pool until their dashboards expose a compatible API:

| Provider | Entry point | Directory note |
| --- | --- | --- |
| Mirasim | https://mirasim.ai/r/go-kx9cd5 | Go plan service |
| Matrix | https://matrix.mzsjai.com/login?redirect=%2Fapp%2Fgrowth%3FinviteCode%3DMXMRFO52KD2_ | Unified API gateway/app store; verify API support in the dashboard |
| RawChat | https://new.sharedchat.cc/list/#/register?i=MaVP1 | Daily quota pool; no standard API endpoint in the catalog |
| NOFX | https://nofx.one/zh-CN/sign-in?ref=J369GHY4 | Task-based points site; passwordless login |

## Recommended order

1. Start with DoCode, FlushAPI, AnyRouter, and CheapCodex because all four expose both protocol families.
2. Then try KKtoken, GoRouter, TaBiAI, and JustDoWork; inspect model availability and remaining quota before keeping them in the pool.
3. Create one key per provider. Never reuse a key between providers and never put keys in `providers.json`, source code, logs, or chat messages.
4. After each key is stored, run `npm run check`; only healthy providers should be used for routing.

PowerShell example (replace the placeholder locally; this command does not write to the project):

```powershell
[Environment]::SetEnvironmentVariable('DOCODE_API_KEY', '<provider key>', 'User')
npm run check
```

## Account information

Email addresses, passwords, and verification codes are used only by the provider's own signup/login flow and are not stored in this project. A shared password does not mean that sessions can be reused across providers; when GitHub login is available, prefer it and create a separate API key in the provider dashboard.