# Suno-API 音乐创作能力与 StoryDream 接入分析

核对时间：2026-09-16。对象为用户提供的 [suno-api.io 创作平台](https://www.suno-api.io/create/)。

## 结论

**可以融入，推荐新增「素材 → 音乐创作」，生成的歌曲、纯配乐、音效存入本地素材库，再供音乐 MV、普通视频、VOX、漫剧和 HTML 动画使用。** 现有音乐 MV 页面承担的是导入歌曲后的画面与字幕制作，新增作曲服务需要独立 Provider、持久任务和音乐资产模型。

这家网站自称第三方 Suno 服务，与 Suno 官方无隶属关系。报告中的 `suno-v6` 等名称是该供应商公开的模型标识，不代表本次独立验证了底层模型身份。已审阅其当前文档导航列出的 45 份文档，并核对项目代码。完整端点列表见 [api-inventory.md](./api-inventory.md)，生成及编辑参数详见 [creative-api-details.md](./creative-api-details.md)。

调研阶段完成了渠道登记，未提交收费生成，也未测试实际音质、生成耗时或真实扣费。随后已按用户要求实现软件内「音乐创作」工作台，当前功能范围和验证记录见 [实施进度](../../plans/music-lab-2026-09-16/progress.md)。下文的阶段建议保留为调研时的评估。

人声克隆、媒体文件、MIDI 与授权书参数另见 [voice-media-details.md](./voice-media-details.md)。

## 已登记与实测

| 项目 | 结果 |
| --- | --- |
| 服务 Base URL | `https://www.suno-api.io` |
| 凭据 | Windows 用户环境变量 `SUNO_API_KEY`，位于 `HKCU\Environment`；无明文写入项目 |
| 认证 | `Authorization: Bearer <key>` |
| 免费余额查询 | `GET /api/user/balance` 成功，可用余额 **30.00 元** |
| 免费模型查询 | `GET /v1/models` 成功，普通生成为 `suno-v6` / `suno-v6-wild` / `suno-v6-mini` |
| 内部路由名 | 同时返回 `suno_music` / `suno_lyrics`，不作为普通歌曲模型选项 |
| 免费授权资格查询 | `GET /api/music/authorization/context`：累计充值 30 元，身份未绑定；个人需 200 元、企业需 500 元，当前均不满足 |
| 长期记录 | 用户级 AGENTS、paid-api-channels 渠道表、价格表、Suno 参考文档、自查脚本已包含该渠道 |

余额和资格均为当日快照。后续直接从环境读取密钥，不需要用户重复提供。正式产品使用主进程凭据保险库或从用户环境安全加载，前端只显示配置状态。

## 全部功能如何融入素材创作

以下价格均是供应商当前文档报价，具体扣费以请求模型和后台配置为准。

| 功能组 | 公开 API 与主要能力 | StoryDream 对应价值 | 建议 |
| --- | --- | --- | --- |
| 描述生成 | `POST /api/music/create`，一句话生成歌词、旋律、编曲、演唱；`instrumental=true` 生成纯音乐 | 给视频生成 BGM、主题歌、品牌旋律 | 首期 |
| 专业创作 | `POST /api/music/create/custom`，歌词、标题、风格、排除风格、男女声、风格权重、随机度 | 用户自写歌词或已有文案转歌曲 | 首期 |
| 音效与循环 | `POST /api/music/sounds`，单次音效、短采样、循环，支持 `bpm`、`key` | 转场音、鼓点、环境声和循环配乐 | 首期 |
| 歌词生成与管理 | `POST /api/lyrics/generate`；`/api/lyrics/projects/create`、`flush`、`list`；`/api/lyrics/lyricists` | 写词、改词、歌词版本、复用歌词项目 | 首期先做生成/本地编辑，云歌词项目随后 |
| 提示词辅助 | `POST /api/music/boost-style`、`/api/prompts/suggestions`、`/api/prompts/library` | 曲风扩写、创作灵感、提示词收藏 | 按需调用，注意免费额度 |
| 上传源音频 | `POST /api/music/upload-source`，文件、URL 或 Base64 转为源 clip | 本地旋律、清唱或配乐进入后续编辑 | 第二期 |
| 翻唱/改编 | `POST /api/music/upload-cover`、`generate-from-source` | 同一素材更换曲风、编曲或人声 | 第二期；cover 是翻唱，不是封面图 |
| 续写 | `POST /api/music/extend`，从指定时间接续创作 | 延长片尾、增加一段音乐 | 第二期；不要假设结果一定自动拼接成完整曲 |
| 局部重写 | `POST /api/music/replace-section`，指定区间及新歌词/风格 | 保留满意部分，只改副歌或某一段 | 第二期，非破坏性版本 |
| 加伴奏/人声/乐器 | `POST /api/music/add-instrumental`、`add-vocal`、`add-stem` | 清唱配伴奏、给纯配乐加演唱、补充乐器 | 第二期 |
| 融合/采样/灵感 | `POST /api/music/mashup`、`sample`、`inspo` | 两曲融合、选段变奏、多曲参考创作 | 后续高级创作 |
| 基础音频编辑 | `POST /api/music/crop`、`remove-section`、`fade`、`reverse`、`speed` | 保留区间、删段、淡化、倒放、变速 | API 收费；优先利用本地音频处理 |
| 分轨 | `POST /api/music/separate`，two / twelve；`vocal-removal` 为免费 two 快捷拆分 | 人声与配乐独立使用、分乐器素材 | 第二期；两个入口计费不同 |
| 分轨管理 | `POST /api/music/stem-delete`，软隐藏，不删除底层文件 | 减少远端分轨列表杂项 | 按用户操作同步，不能当文件回收 |
| 逐词歌词 | `POST /api/lyrics/timeline`，词、起止秒数、置信度 | MV 字幕准确对齐演唱、导出 LRC/SRT | 优先与 MV 打通 |
| WAV / MIDI | `POST /api/music/wav`；`download-file` 的 `kind=midi` | WAV 用于后期；MIDI 用于 DAW 二次编曲 | WAV 优先，MIDI 作为分轨附属导出 |
| 媒体与试听 | `download-url`、`download-file`、`download-all`、`generation-stream-url`（POST）；`download`（GET） | 生成中试听、单文件/ZIP、本地素材转存 | 首期需下载及试听，流式试听可后补 |
| Free2 | `POST /api/music/free2`，自己的歌曲 ID / Suno 链接取文件 | 导入已有自有歌曲 | 可选；名字含 Free 但实际收费 |
| 任务与历史 | `POST /api/music/query`；`GET /api/music/songs`、`/songs/:song_id` | 任务恢复、远端曲库、历史参数复用 | 首期 |
| 人声克隆 | `/api/voice/clone/*`，源录音、验证文本、二次录音、状态检查、删除 | 可重复使用的歌手声音 | 后续；可用性检查不可省略 |
| 指定人声作曲 | `POST /api/music/generate-with-voice`；GET 同路径 `/results` | 保持歌手声音连续性 | 克隆功能之后接入 |
| 强化上传 | POST/GET `/api/music/enhanced-upload`，GET `/:id`、POST `/:id/cancel` | 把上传音频经过供应商增强后用于再创作 | 后置，成本高且增强含义不够明确 |
| 授权书 | `/api/music/authorization/*`：资格、身份、歌曲、证书、PDF | 音乐素材保存供应商授权凭据 | 展示资格与凭据状态，签发按用户操作 |

## 费用与控制参数

| 动作 | 文档价格 | 关键说明 |
| --- | --- | --- |
| 普通/专业生成 | ¥0.60 / 次 | 通常 2 首；按当前余额理论约 50 次、100 首候选，不代表保证成功数 |
| 普通生成 Max Mode | ¥1.20 / 次 | 开启后价格翻倍，不作为默认 |
| 音效/循环 | ¥0.60 / 次 | 返回数量以接口为准 |
| 续写、翻唱、替换、加伴奏/人声/轨、融合、采样、灵感 | 通常 ¥0.60 / 次 | 请求模型及后台配置决定；适用操作的 Max Mode 翻倍 |
| 裁剪、删段、淡化、倒放、变速 | 通常 ¥0.60 / 次 | 本地能完成的基础编辑不需要购买生成请求 |
| separate two / twelve | ¥0.60 / ¥3.00 每次 | 不保证结果只有 2 / 12 条，多版本会增加数量 |
| vocal-removal 两轨快捷拆分 | 免费 | 当前文档独立标免费，尚未用真实歌曲验证 |
| 指定已克隆人声生成 | ¥1.20 / 次 | Max Mode 为 ¥2.40 |
| 公开人声克隆 | 手动二次录音验证流程免费 | 人声校验、状态、删除也免费 |
| 网页端自动克隆 | ¥20 / 次 | 属于 Create UI 登录态接口，不是已确认的公开 API Key 能力 |
| 强化上传 | ¥10 / 次 | 失败或允许阶段取消退款；80 MB 上限，仅 multipart 文件 |
| Free2 下载 | ¥0.20 / 成功首 | 单次最多 10 首，自己的歌曲；普通下载接口免费 |
| 歌词、风格增强、灵感、资源/歌词项目列表等 | 免费额度内免费，超额 ¥0.10 / 次 | 文档写每用户 10 次/分钟、300 次/天；不要把列表接口当作无限免费查询 |
| 余额、状态、历史、时间轴歌词、普通媒体/WAV/MIDI、上传源音频、授权书 | 免费 | 仍可能有资源状态、所有权或资格前提 |

普通生成使用 `suno-v6` 默认即可；Wild / Mini 不应凭名称推断价格差异或质量保证。`variety` 是 0–4 的整数；`style_weight` / `weirdness_constraint` 是 0–1 小数。`max_mode` / `variety` 不支持 sounds、separate、基础编辑等接口。

**整曲生成没有文档化的目标秒数或 BPM 硬约束参数。** 提示词可表达期望，但产品不能保证“一次精准生成 30 秒”。应在本地测量时长，再裁剪、循环或淡出；sounds 的 bpm/key 控制也不意味着普通歌曲有同样参数。

## 现有项目的具体接入点

| 当前代码 | 核实的能力 / 缺口 | 接入方式 |
| --- | --- | --- |
| `src/app/navigation.ts:58` | 素材区域已有图片、配音、视频工具 | 加 `music-lab`，与配音分开 |
| `src/features/music-mv/MusicMvPage.tsx:75` | 从本地导入主歌曲；创建任务依赖 `musicMv.audioPath` | 生成歌曲落盘后提供「用于音乐 MV」 |
| `src/shared/types.ts:799` | MusicMvSettings 没有作曲参数、供应商歌曲 ID | MV 保持消费音乐资产，生成参数存专门实体 |
| `electron/managed-bgm.ts:49` | 受管音频导入；MP3/WAV/M4A/AAC/OGG/FLAC，256 MB 上限 | 通过已有受管导入登记为 BGM，保存真实路径 |
| `src/shared/types.ts:307` | BgmItem 可供现有视频任务选择 | 提供「加入配乐库」，关联生成 Track |
| `src/shared/production-workflow.ts:20` | 音频资产已有供应商、模型、版本、任务、授权、时长 | 复用来源与版本字段，不只存 URL |
| `src/shared/production-audio.ts:13` | 已有 music 轨、裁切、增益、淡化 | VOX/漫剧等直接消费本地音乐 |
| `src/shared/runner.ts:1927` | 接受 LRC 行时间戳；否则按全曲平均分配 | timeline 逐词转换分句时间，改善现有字幕同步 |
| `src/shared/config-secrets.ts:3` | 目前没有音乐 SecretId | 新增 `music/{providerId}/apiKey`，在主进程使用 |
| `src/shared/video-lab-runtime.ts:20` | 有素材生成→轮询→下载流程，但不宜直接照搬恢复逻辑 | 音乐建立可恢复的持久任务调度 |

两个与接入直接相关的现有行为需要处理：MV 导入主歌曲时还会选它作为辅助 BGM（`MusicMvPage.tsx:79`），应分清主歌曲与配乐，避免重复叠放；歌词解析目前按分镜数截断（`runner.ts:1931`），应把完整字幕和画面分镜数量解耦。没有时间戳时的平均分配不等于真实演唱或节拍分析。

## 数据与异步任务设计

建议分离三类实体：

1. `MusicGenerationJob`：本地 ID、动作、Provider、模型、完整请求参数、预估费用、请求指纹、远端 song IDs / client_request_id、每个结果状态、错误、提交/查询时间。只有服务明确返回才记录实际费用，不把报价当实扣。
2. `MusicTrack`：一个候选结果一条，保存远端 ID、父曲/编辑关系、标题、风格、完整歌词、逐词时间轴、时长、本地 MP3/WAV、封面、分轨列表、授权凭据状态。原曲与新版本不覆盖。
3. `MusicVoice`（后期）：voice_task_id、voice_id、最后检查时间、is_available、名称、最近成功时间；不承诺永久有效。

建议工作流：编辑创作要求 → 费用预览 → 提交并立即保存远端标识 → 后台轮询所有候选 → 试听 → 下载并验证本地文件 → 入库 → 用于视频。生成任务完成与下载成功分开记录，下载失败只重试下载，不再次生成。

普通作曲：`POST /api/music/create` 或 `/custom` 后，使用 `POST /api/music/query`，推荐 `song_ids` 为英文逗号分隔字符串。保留两首及其独立状态，允许一首先完成；不要照抄最简示例找到第一个 audio_url 就结束全部任务。

指定人声：`generate-with-voice` 固定返回异步占位结果；先按 `client_request_id` 调用专用 `/results`，得到真实 song_id 后才使用普通 query/下载。`pending:` 不是歌曲 ID。此接口有明确 `Idempotency-Key` 支持，不能假设普通生成也有同样保证。

恢复与限流：主进程持久化任务，重启后恢复查询；轮询超时标为待恢复，不自动再次付费提交。通用文档写 10 请求/秒、100 请求/分钟、5 个生成并发，可先采用批量查询、5 秒起步并随时间退避，尊重 `retry_after`。取消本地等待不代表取消云端任务或退款；只有强化上传文档明确给出特定阶段取消能力。

## 已发现的接口限制与文档差异

- **业务响应混用格式**：裸数组、`data` 包装、`success` 与 `code`；歌曲详情失败有 HTTP 200 + success=false，不能只检查 HTTP。
- **完成判断**：pending/submitted/processing 时 URL 为空正常，playable 只用于试听；最终完成、媒体准备与本地下载必须区分。
- **查历史不完整**：普通歌曲历史不含上传源、强化上传中间记录和分轨子结果；需要本地保存，不能把列表同步当完整备份。
- **参数留存不完整**：历史详情可能缺高级参数并返回 null；本地保存请求原文，不能猜测旧值。
- **声音与分轨数量不固定**：vocal-removal 通常两版本各有人声/伴奏共四条；twelve 结果也以返回为准。
- **MIDI 是已有分轨音符导出**：不是文本到 MIDI；固定 120 BPM/480 PPQ 是文件时间轴设置，不是测得原曲 BPM，FX 轨可能导出空音符文件。
- **下载地址不是永久素材路径**：用鉴权下载或托管地址及时落盘。Free2 不可作为免费下载失败后的自动收费兜底。
- **人声生命周期与网页边界**：公开流程需按服务返回文本完成真人验证；20 元自动验证仅登录态入口。voice_id 可失效，生成前 check。
- **基础编辑与精确时长**：服务端基础编辑收费，优先本地完成；crop 文档存在首次无可查询 ID 却要求稍后查询的恢复缺口，启用前需小样核验。
- **普通幂等、全曲拼接、回调**：当前推荐公开文档未给出通用可靠承诺；不要发明 merge/webhook 接口或复用旧路径 `/api/generate`、`/api/clip`。
- **旧模型行为文档不一致**：README 称旧模型不再接受，models 页称旧名称会映射 v6。新请求仅使用当前三个名称即可，不依赖兼容细节。
- **商用授权不是所有歌曲自动具备**：当前账号未满足签发门槛，身份绑定会锁定；每首歌只能成功签一份，具体生成类型是否可选由接口返回。有效期、适用范围以实际条款/PDF 为准，不能从接口存在推导永久授权。

## 推荐实施顺序与验收

**第一期：音乐创作素材闭环。** Provider 配置与余额、描述/专业/纯音乐/音效、持久任务、两首候选试听、MP3/WAV 下载、加入配乐库、用于 MV、时间轴歌词。目标是从一句创作要求得到可复用的本地音乐资产。

**第二期：歌曲编辑与版本。** 上传、翻唱、续写、替换片段、加人声/伴奏/乐器、免费两轨及付费多轨、版本来源图；基础裁剪和淡化由本地完成。

**第三期：声音身份与项目协同。** 完整手动克隆、可用性检查、指定歌手生成、授权凭据；根据 VOX/漫剧/HTML 动画情绪和时长生成配乐。真实拍点检测属于额外音频分析能力，不应假设供应商已返回。

正式接入验收应覆盖：应用重启后继续轮询；双候选一成一败；HTTP 200 业务失败；临时 URL 失效后重新取址；下载失败不重复计费；MV 主曲不叠加为 BGM；完整歌词不过早截断；时间轴与本地测得音频时长一致。真实生成需单独提交可计费小样，先验证 ¥0.60 的普通生成闭环，再逐项开放高级操作。

## 一手来源

- [供应商首页：第三方身份与价格](https://www.suno-api.io/)
- [当前公开接口总览](https://www.suno-api.io/docs/current-overview.md)
- [普通模型列表与兼容行为](https://www.suno-api.io/docs/models.md)
- [专业作曲参数](https://www.suno-api.io/docs/current-music-create-custom.md)
- [短音效、循环、BPM、调式](https://www.suno-api.io/docs/current-music-sounds.md)
- [歌曲状态、历史与参数](https://www.suno-api.io/docs/current-music-query.md)
- [逐词时间轴](https://www.suno-api.io/docs/current-lyrics-timeline.md)
- [克隆与指定人声、幂等、占位任务](https://www.suno-api.io/docs/current-voice-clone.md)
- [免费人声去除](https://www.suno-api.io/docs/current-music-vocal-removal.md)
- [分轨](https://www.suno-api.io/docs/current-music-separate.md)
- [MIDI](https://www.suno-api.io/docs/current-music-midi.md)
- [媒体下载](https://www.suno-api.io/docs/current-music-media-download.md)
- [商用授权书](https://www.suno-api.io/docs/current-music-authorization.md)
- [通用限流](https://www.suno-api.io/docs/authentication.md)
