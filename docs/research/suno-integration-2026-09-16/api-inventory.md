# Suno-API 当前公开接口目录

核对：2026-09-16。此表按供应商 current-overview.md 的推荐接口原文整理；语义与计费差异见 report.md。Base URL 为 https://www.suno-api.io。

下表含每个方法和路径，MIDI 为 download-file 的特定 kind，并非独立路径；“媒体地址 / 试听流”一行含两个端点。未计入网站登录态内部接口。

| 能力 | 方法 | 路径 | 计费提示 | 文档 |
|---|---|---|---|---|
| 账户余额查询 | GET | `/api/user/balance` | 免费 | [查看](https://www.suno-api.io/docs/current-user-balance.md) |
| 灵感模式生成 | POST | `/api/music/create` | 收费，当前默认 0.6 元/次 | [查看](https://www.suno-api.io/docs/current-music-create.md) |
| 专业模式生成 | POST | `/api/music/create/custom` | 收费，支持声音性别、风格参考度和随机度 | [查看](https://www.suno-api.io/docs/current-music-create-custom.md) |
| 音色/声音生成 | POST | `/api/music/sounds` | 收费，当前默认 0.6 元/次 | [查看](https://www.suno-api.io/docs/current-music-sounds.md) |
| 歌词生成 | POST | `/api/lyrics/generate` | 免费额度内免费（每分钟10次、每天300次），超出后 0.1 元/次 | [查看](https://www.suno-api.io/docs/current-lyrics-generate.md) |
| 歌词项目创建 | POST | `/api/lyrics/projects/create` | 免费额度内免费（每分钟10次、每天300次），超出后 0.1 元/次 | [查看](https://www.suno-api.io/docs/current-lyrics-projects-create.md) |
| 歌词项目保存 | POST | `/api/lyrics/projects/flush` | 免费额度内免费（每分钟10次、每天300次），超出后 0.1 元/次 | [查看](https://www.suno-api.io/docs/current-lyrics-projects-flush.md) |
| 歌词项目列表 | POST | `/api/lyrics/projects/list` | 免费额度内免费（每分钟10次、每天300次），超出后 0.1 元/次 | [查看](https://www.suno-api.io/docs/current-lyrics-projects-list.md) |
| 歌词作者列表 | POST | `/api/lyrics/lyricists` | 免费额度内免费（每分钟10次、每天300次），超出后 0.1 元/次 | [查看](https://www.suno-api.io/docs/current-lyrics-lyricists.md) |
| 人声克隆 | POST | `/api/voice/clone/validate` | 免费 | [查看](https://www.suno-api.io/docs/current-voice-clone.md) |
| 查询人声克隆任务 | GET | `/api/voice/clone/tasks/:voice_task_id` | 免费 | [查看](https://www.suno-api.io/docs/current-voice-clone.md) |
| 重新生成人声验证文本 | POST | `/api/voice/clone/tasks/:voice_task_id/regenerate` | 免费 | [查看](https://www.suno-api.io/docs/current-voice-clone.md) |
| 提交验证音频并创建人声 | POST | `/api/voice/clone/tasks/:voice_task_id/generate` | 按人声克隆规则计费 | [查看](https://www.suno-api.io/docs/current-voice-clone.md) |
| 检查克隆人声可用状态 | POST | `/api/voice/clone/tasks/:voice_task_id/check` | 免费 | [查看](https://www.suno-api.io/docs/current-voice-clone.md) |
| 删除克隆人声 | DELETE | `/api/voice/clone/voices/:voice_task_id` | 免费 | [查看](https://www.suno-api.io/docs/current-voice-clone.md) |
| 指定人声生成 | POST | `/api/music/generate-with-voice` | 收费，1.2 元/次；Max Mode 2.4 元/次 | [查看](https://www.suno-api.io/docs/current-voice-clone.md) |
| 查询指定人声生成结果 | GET | `/api/music/generate-with-voice/results` | 免费 | [查看](https://www.suno-api.io/docs/current-voice-clone.md) |
| 风格增强 | POST | `/api/music/boost-style` | 免费额度内免费（每分钟10次、每天300次），超出后 0.1 元/次 | [查看](https://www.suno-api.io/docs/current-music-boost-style.md) |
| 灵感提示词 | POST | `/api/prompts/suggestions` | 免费额度内免费（每分钟10次、每天300次），超出后 0.1 元/次 | [查看](https://www.suno-api.io/docs/current-prompts-suggestions.md) |
| Prompt/Style 资源列表 | POST | `/api/prompts/library` | 免费额度内免费（每分钟10次、每天300次），超出后 0.1 元/次 | [查看](https://www.suno-api.io/docs/current-prompts-library.md) |
| 上传源音频 | POST | `/api/music/upload-source` | 免费 | [查看](https://www.suno-api.io/docs/current-music-upload-source.md) |
| 提交强化上传 | POST | `/api/music/enhanced-upload` | 收费，10 元/次 | [查看](https://www.suno-api.io/docs/current-music-enhanced-upload.md) |
| 查询强化上传任务列表 | GET | `/api/music/enhanced-upload` | 免费 | [查看](https://www.suno-api.io/docs/current-music-enhanced-upload.md) |
| 查询单个强化上传任务 | GET | `/api/music/enhanced-upload/:id` | 免费 | [查看](https://www.suno-api.io/docs/current-music-enhanced-upload.md) |
| 取消强化上传任务 | POST | `/api/music/enhanced-upload/:id/cancel` | 免费；仅允许阶段可取消并退款 | [查看](https://www.suno-api.io/docs/current-music-enhanced-upload.md) |
| 上传后翻唱 | POST | `/api/music/upload-cover` | 收费，当前默认 0.6 元/次 | [查看](https://www.suno-api.io/docs/current-music-upload-cover.md) |
| 基于源 clip 翻唱 | POST | `/api/music/generate-from-source` | 收费，当前默认 0.6 元/次 | [查看](https://www.suno-api.io/docs/current-music-generate-from-source.md) |
| 续写 | POST | `/api/music/extend` | 收费，当前默认 0.6 元/次 | [查看](https://www.suno-api.io/docs/current-music-extend.md) |
| 替换段落 | POST | `/api/music/replace-section` | 收费，当前默认 0.6 元/次 | [查看](https://www.suno-api.io/docs/current-music-replace-section.md) |
| 增加伴奏 | POST | `/api/music/add-instrumental` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-add-instrumental.md) |
| 增加人声 | POST | `/api/music/add-vocal` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-add-vocal.md) |
| 加轨 | POST | `/api/music/add-stem` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-add-stem.md) |
| 融合 | POST | `/api/music/mashup` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-mashup.md) |
| 采样 | POST | `/api/music/sample` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-sample.md) |
| 灵感 | POST | `/api/music/inspo` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-inspo.md) |
| 裁剪 | POST | `/api/music/crop` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-crop.md) |
| 删减 | POST | `/api/music/remove-section` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-remove-section.md) |
| 淡入/淡出 | POST | `/api/music/fade` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-fade.md) |
| 倒放 | POST | `/api/music/reverse` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-reverse.md) |
| 变速 | POST | `/api/music/speed` | 收费，按请求模型计费 | [查看](https://www.suno-api.io/docs/current-music-speed.md) |
| 人声/伴奏分离 | POST | `/api/music/separate` | 收费，`two` 默认 0.6 元/次；`twelve` 默认 3.0 元/次 | [查看](https://www.suno-api.io/docs/current-music-separate.md) |
| 人声去除 | POST | `/api/music/vocal-removal` | 免费 | [查看](https://www.suno-api.io/docs/current-music-vocal-removal.md) |
| 分轨删除 | POST | `/api/music/stem-delete` | 免费 | [查看](https://www.suno-api.io/docs/current-music-stem-delete.md) |
| WAV 生成/获取 | POST | `/api/music/wav` | 免费 | [查看](https://www.suno-api.io/docs/current-music-wav.md) |
| MIDI 获取 | POST | `/api/music/download-file`（`kind=midi`） | 免费 | [查看](https://www.suno-api.io/docs/current-music-midi.md) |
| 媒体地址 / 试听流 | POST | `/api/music/download-url`、`/api/music/generation-stream-url` | 免费 | [查看](https://www.suno-api.io/docs/current-music-media-download.md) |
| 歌曲文件下载 | POST | `/api/music/download-file` | 免费 | [查看](https://www.suno-api.io/docs/current-music-media-download.md) |
| 歌曲资源打包下载 | POST | `/api/music/download-all` | 免费 | [查看](https://www.suno-api.io/docs/current-music-media-download.md) |
| 稳定下载地址 | GET | `/api/music/download` | 免费 | [查看](https://www.suno-api.io/docs/current-music-media-download.md) |
| Free2 下载 | POST | `/api/music/free2` | 收费，0.2 元/首（按成功首数） | [查看](https://www.suno-api.io/docs/current-music-free2.md) |
| 指定歌曲状态查询 | POST | `/api/music/query` | 免费 | [查看](https://www.suno-api.io/docs/current-music-query.md) |
| 账号歌曲历史 | GET | `/api/music/songs` | 免费 | [查看](https://www.suno-api.io/docs/current-music-query.md) |
| 歌曲生成参数 | GET | `/api/music/songs/:song_id` | 免费 | [查看](https://www.suno-api.io/docs/current-music-query.md) |
| 时间轴歌词 | POST | `/api/lyrics/timeline` | 免费 | [查看](https://www.suno-api.io/docs/current-lyrics-timeline.md) |
| 授权资格与身份 | GET | `/api/music/authorization/context` | 免费 | [查看](https://www.suno-api.io/docs/current-music-authorization.md) |
| 绑定授权身份 | POST | `/api/music/authorization/identity` | 免费；身份确认后不可修改 | [查看](https://www.suno-api.io/docs/current-music-authorization.md) |
| 查询可授权歌曲 | GET | `/api/music/authorization/songs` | 免费；需完成授权身份绑定 | [查看](https://www.suno-api.io/docs/current-music-authorization.md) |
| 生成音乐商用授权书 | POST | `/api/music/authorization/certificates` | 免费；需满足授权资格 | [查看](https://www.suno-api.io/docs/current-music-authorization.md) |
| 查询授权书历史 | GET | `/api/music/authorization/certificates` | 免费 | [查看](https://www.suno-api.io/docs/current-music-authorization.md) |
| 查询授权书详情 | GET | `/api/music/authorization/certificates/:id` | 免费 | [查看](https://www.suno-api.io/docs/current-music-authorization.md) |
| 下载授权书 PDF | GET | `/api/music/authorization/certificates/:id/download` | 免费 | [查看](https://www.suno-api.io/docs/current-music-authorization.md) |
## 补充与修正

- GET `/v1/models`：免费，已实测；仅普通生成选择 suno-v6 / suno-v6-wild / suno-v6-mini。
- 公开人声克隆 generate 的专页明确手动验证流程免费；总览的“按规则计费”不可直接解读为 20 元。
- 20 元自动克隆为 Create UI 登录态入口 `/api/create-ui/voice/clone-long-term`、`/api/create-ui/voice/tasks/:voice_task_id/auto-generate-verify`，不纳入已确认的 API Key 接口。
- 以下模型与价格均为该供应商口径，未逐项实测；免费余额、模型和资格接口已经验证。

来源：https://www.suno-api.io/docs/current-overview.md
