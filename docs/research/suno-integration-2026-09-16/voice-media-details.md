# 人声、媒体下载与授权接口补充

核对日期：2026-09-16。以下来自供应商当前公开文档，未执行付费任务。完整方法/路径见 [api-inventory.md](./api-inventory.md)，项目方案见 [report.md](./report.md)。

## 人声克隆与作曲

| 接口 | 关键输入与输出 |
| --- | --- |
| POST `/api/voice/clone/validate` | `voice_url` / `file_base64` 二选一，`vocal_start_s`、`vocal_end_s`；返回 voice_task_id；可填名称、描述、风格、语言和源音频时长 |
| GET `/api/voice/clone/tasks/:voice_task_id` | 获取 validate_info 验证文本、voice_id、is_available 和状态 |
| POST `/api/voice/clone/tasks/:voice_task_id/regenerate` | 重新生成验证文本 |
| POST `/api/voice/clone/tasks/:voice_task_id/generate` | 用户按文本朗读，再提交 `verify_url` / `file_base64` 验证录音 |
| POST `/api/voice/clone/tasks/:voice_task_id/check` | 检查人声是否可用于生成 |
| DELETE `/api/voice/clone/voices/:voice_task_id` | 删除克隆人声 |
| POST `/api/music/generate-with-voice` | 必填 `voice_task_id`、`prompt`；`customMode=true` 时 prompt 为完整歌词，并需 style/title；可选模型、权重、sourceClipId 等 |
| GET `/api/music/generate-with-voice/results` | 以 `client_request_id` 查询 processing/completed/partial/failed/not_found，解析真实歌曲 ID |

公开手动验证的克隆流程免费；指定人声作曲 ¥1.20/次，Max ¥2.40。文档只说源人声要满足最短长度，没有公布具体秒数。voice_id 可能失效，每次生成前 check。`instrumental` 和 `waitAudio` 在指定人声接口不改变行为：它固定为人声歌曲、异步占位任务。

指定人声接口明确支持 `Idempotency-Key`（最长 128 字符），按用户、Token、端点、Key 和请求体去重；失败 Key 会维持失败，不能把“换 Key 重试”作为默认自动策略。普通生成端点没有同样明确的保证。

`sourceClipId` 必须是当前用户可访问、已完成、有音频的真实歌曲，不能靠 sourceAudioUrl 绕过所有权。仅保存 `pending:*` 不足以下载：先通过 results 取得真实 ID。

网页的 `/api/create-ui/voice/clone-long-term` 和 `/api/create-ui/voice/tasks/:voice_task_id/auto-generate-verify` 各 ¥20，依赖登录态，不计入已确认可用的公开 API Key 功能。`validate-internal` 仅受控测试/排障。

来源：[人声克隆与指定人声](https://www.suno-api.io/docs/current-voice-clone.md)。

## 媒体与分轨

| 接口 | 关键输入与行为 |
| --- | --- |
| POST `/api/music/download-url` | song_id、kind，可选 refresh；返回托管资源 url 和下载 nav_url |
| POST `/api/music/download-file` | song_id、kind；返回文件二进制，不是统一 JSON |
| POST `/api/music/download-all` | 单 song_id 或 song_ids，最多 50 首，返回 ZIP |
| GET `/api/music/download` | song_id、kind；稳定鉴权入口，不表示底层 URL 永久有效 |
| POST `/api/music/generation-stream-url` | 单首或 song_ids，最多 24 首；返回临时试听 URL 或逐项错误 |
| POST `/api/music/wav` | model、audioId，可选 maxAttempts=24、intervalSeconds=5；data.wavUrl；资源未准备可能 409 |
| POST `/api/music/vocal-removal` | model、source_clip_id，固定 two；免费；通常两版本各人声/伴奏共 4 条 |
| POST `/api/music/stem-delete` | 单/批 song_ids≤100，或 stem_batch_id、stem_mode 等选择条件；只软隐藏，不删除文件 |
| POST `/api/music/free2` | song_id 或 song_ids≤10，可传自有 Suno 链接；files 必填，mp3/wav/lyrics/metadata；¥0.20/成功首 |

普通媒体 kind 包括 song/mp3、wav、video/mp4、midi、cover/image、lyrics、timestamped_lyrics/lrc。指定人声专页示例的 `audio` 与媒体专页不一致，实现优先采用媒体专页规范。

除 Free2，以上下载/管理接口按文档免费。生成中 URL 不进入正式素材库；完整音频下载后测量时长、保存本地路径。WAV 服务默认最多内部等待约 120 秒，客户端超时需要匹配；409 只恢复下载，不再次生成。

分轨产物用 POST query 查询，普通 songs 历史和 GET 详情不一定包含这些子轨。按源曲、版本与轨道类型组织，不硬编码数量或依赖标题就能无歧义配对。

MIDI 通过 download-file 的 `kind=midi` 获取，song_id 必须是已分轨的轨道 ID。它把上游音符数据转为真实 SMF format 1；固定 480 PPQ、120 BPM 是导出时间轴，不能当原曲 BPM。FX 轨可能没有音符，MIDI 不含音色、效果器或混音设置。

来源：[媒体下载](https://www.suno-api.io/docs/current-music-media-download.md)、[WAV](https://www.suno-api.io/docs/current-music-wav.md)、[MIDI](https://www.suno-api.io/docs/current-music-midi.md)、[免费两轨](https://www.suno-api.io/docs/current-music-vocal-removal.md)、[隐藏分轨](https://www.suno-api.io/docs/current-music-stem-delete.md)、[Free2](https://www.suno-api.io/docs/current-music-free2.md)。

## 供应商商用授权书

所有相关接口文档标免费，但有资格与歌曲条件。

1. GET `/api/music/authorization/context` 返回实时充值门槛及 identity.exists；本次实测累计充值 30 元，个人门槛 200、企业 500，均不满足。
2. POST `/api/music/authorization/identity` 绑定个人/企业资料，需 `confirm_locked=true`；身份确认后不可自行修改，不能由程序代填或后台自动确认。
3. GET `/api/music/authorization/songs` 支持分页、搜索和 selectable/authorized/unavailable 状态筛选；是否可授权以 `authorization.selectable` 为准。
4. POST `/api/music/authorization/certificates` 传真实 `song_ids` 与 `confirm_risk_terms=true`，每首歌只能成功签发一份，PDF 失败不占资格。
5. GET `/api/music/authorization/certificates`、`/:id`、`/:id/download` 查询历史、详情、鉴权下载 PDF，只有 issued 可下载。

凭据可保存证书号、状态、PDF 校验值、歌曲快照和本地 PDF；当前文档没有规定申请截止天数或永久授权，实际授权范围与期限以签发条款为准。本轮只查询资格，未绑定身份或签发证书。

来源：[商用授权书](https://www.suno-api.io/docs/current-music-authorization.md)。
