# Suno-API 创作、歌词与音乐编辑接口审阅

审阅日期：2026-09-16。依据供应商 `https://www.suno-api.io/docs/` 当日下载的 Markdown 文档；本分报告只做静态契约审阅，未发起收费生成。价格是文档默认价，实际以后台价格配置和请求模型为准。这里的 `suno-v6` 等是该供应商的对客模型别名，不据此认定为 Suno 官方版本名称。

## 共同接入规则

- 基础地址：`https://www.suno-api.io`；认证：`Authorization: Bearer <环境变量读取的密钥>`。JSON 接口用 `application/json`，multipart 上传不要手动写 Content-Type 边界。
- 当前文档列出普通模型 `suno-v6`、`suno-v6-wild`、`suno-v6-mini`，默认推荐 `suno-v6`。有的接口把 `model` 标为必填；统一显式传当前模型可以消除歧义。分轨不传歌曲生成模型。
- 强度、随机度和参考音频权重是 `0..1` 数字；`0` 是有效值，不能用 `value || default` 丢掉。布尔值必须是 JSON 布尔值。未配置的可选值省略，避免把空字符串、null 或 0 当作未传。
- 音乐生成按异步任务处理；正常情况下保存每个真实 `song_id`，调用 `POST /api/music/query`，请求的 `song_ids` 是英文逗号分隔字符串。`pending:` 占位 ID 不能用于该接口。
- 将 `pending`/`submitted`/`queued` 归为等待，`generating`/`processing` 归为处理中，`complete`/`completed` 归为完成，`error`/`failed` 归为失败。仍须保留供应商原始状态以便排错。`audio_url` 暂为空不代表失败；只有完成且获得有效音频地址才入正式素材库。
- 普通生成文档有直接歌曲数组返回；Remix/编辑文档常见 `{code,message,data:{clips:[...]}}`；强化上传用 `{success,message,data:{task...}}`。适配层需要按端点解包，不能只支持一种结构。
- `max_mode: true` 对支持的生成操作按 2 倍价格收费；`variety` 为 0–4 整数，默认 V6 档位为 1，不另收费。支持：create、custom、extend、upload-cover、generate-from-source、replace-section、add-instrumental、add-vocal、add-stem、mashup、sample、inspo。不要向 sounds、separate、WAV、裁剪/删减/淡入淡出/倒放/变速传入这两个参数，文档明确会返回 400。
- 优先级：P0=音乐创作首版核心；P1=第二阶段创作加工；P2=高级能力或待验证；L=优先用本地音频处理，不优先花钱调用云端。

来源：[总览](https://www.suno-api.io/docs/current-overview.md)、[模型](https://www.suno-api.io/docs/models.md)、[查询](https://www.suno-api.io/docs/current-music-query.md)、[默认价格](https://www.suno-api.io/docs/README.md)。

## 从零作曲与声音素材

| 能力与方法 / 路径 | 必填参数与关键选项 | 返回、费用与优先级 |
|---|---|---|
| 一句话作曲 `POST /api/music/create` | 必填 `description`（中英文）；可选 `model`、`instrumental=false`、`wait_completion=false`、`max_mode`、`variety` | 直接歌曲数组，通常 2 首；默认 ¥0.6/次，Max ¥1.2；P0。用于剧情、场景、情绪描述直接生成配乐 |
| 专业作曲 `POST /api/music/create/custom` | 必填 `style_tags`；可选 `lyrics`、`song_title`、`model`、`instrumental`、`negative_tags`、`vocal_gender`、`style_weight`、`weirdness_constraint`、`wait_completion`、Max/Variety | 通常 2 首；默认 ¥0.6/次，Max ¥1.2；P0。歌词、曲风与纯音乐切换是主入口，高级项折叠 |
| 短声音 / 循环 `POST /api/music/sounds` | 必填 `description`；可选 `model`、`title`、`type=one_shot`、`loop=false`、`bpm`、`key` | 歌曲数组；默认 ¥0.6/次；P1。适合转场、环境音、鼓点循环；不要宣传文档未说明的精确时长参数 |

专业模式约束：`vocal_gender` 仅 `m/f/male/female`，后两者被规范为 `m/f`；`instrumental=true` 不向上游发送人声性别。`style_weight` 和 `weirdness_constraint` 必须是 0–1 数字，非法类型或越界 HTTP 400。高级字段兼容 camelCase，但同时传入时 snake_case 优先；新实现统一 snake_case。

声音素材约束：`bpm` 必须大于 0，否则 400 `invalid_sound_bpm`；`key` 接受音名 C–B、可选升降号和调式，如 `C Major`、`C#m`、`Bb`，空或 `any` 表示不限；非法值 400 `invalid_sound_key`。`type` 只给出 `one_shot` 示例，没有完整枚举；不要自行扩展 loop 之外的选项。

来源：[一句话作曲](https://www.suno-api.io/docs/current-music-create.md)、[专业模式](https://www.suno-api.io/docs/current-music-create-custom.md)、[声音素材](https://www.suno-api.io/docs/current-music-sounds.md)。

## 歌词、曲风与灵感辅助

除时间轴歌词外，下表均属于 helper 计费：文档写每用户每分钟 10 次、每天 300 次以内免费，超出后仍执行并按 ¥0.1/次收费；响应头 `X-Suno-Helper-Free: false`、`X-Suno-Helper-Over-Limit: minute|day` 可识别超额。文档未清晰说明这些接口是否共用同一个额度桶，产品预算应保守按共享处理；避免为了自动刷新而高频调用列表接口。

| 能力与方法 / 路径 | 必填 / 关键输入 | 输出与落地建议 |
|---|---|---|
| 歌词生成 `POST /api/lyrics/generate` | 必填 `model`、`instruction`；可选 `style`、`title`、`selected`、`context_before`、`context_after`、`mode=apply_user_request`、`references=[]`、`num_variants`、`lyricist_id`、`metadata`、`lyrics_project_id` | `edited_lyrics` 为可写入编辑器的完整歌词；`lyrics_id`/`lyrics_request_id` 可能为空且不是 song_id；P0/P1，支持主题写歌和选中段落改写 |
| 歌词作者 `POST /api/lyrics/lyricists` | 必填 `model`；`limit=100`，范围 1–100 | 返回作者列表，`id` 可传 `lyricist_id`；P2，字段以实际返回为准 |
| 创建歌词项目 `POST /api/lyrics/projects/create` | 必填 `model`、`title`；可选完整 `lyrics` | 传 lyrics 时同一账号内直接保存；不传则再 flush；P2，优先让本地项目成为主存储 |
| 保存歌词项目 `POST /api/lyrics/projects/flush` | 必填 `model`、`project_id`、完整 `lyrics` | 上游通常只返回 `updated_at` 等更新字段；完整内容须从 list 取；P2 |
| 歌词项目列表 `POST /api/lyrics/projects/list` | 必填 `model`；`limit=50`，范围 1–100；`sort=updated_at` | 文档称分页读取但未列 cursor/page，只能按公开字段接入；P2 |
| 风格增强 `POST /api/music/boost-style` | 必填 `model`；可选 `originalTags`（别名 `original_tags`）或 `style`、`lyrics`、`user_guidance`、`instrumental=false` | `upsampledStyle` 写回风格；中文请求在未声明语言时自动补中文要求，实际值见 `appliedOriginalTags`/`appliedUserGuidance`；P1 |
| 随机灵感 `POST /api/prompts/suggestions` | 必填 `model` | `prompts[]`、`lyrics_prompts[]`、`tags[]`、`is_pending_personalization`；风格卡片用 tags；P1 |
| Prompt/Style 资源 `POST /api/prompts/library` | 必填 `model`；`per_page=100`，范围 1–100 | 当前账号已保存资源，具体结构以实际响应为准；P2，缓存而非每次打开均刷新 |
| 时间轴歌词 `POST /api/lyrics/timeline` | 必填真实 `song_id`；可选 `model` | 免费，直接逐词时间轴数组；P1，可用于歌词同步预览、字幕与剪辑对齐 |

歌词语言必须在 `instruction` 里明确，比如“请用简体中文写歌词”；文档没有独立 `language` 参数。`metadata.lyrics_model` 默认 `default`，`metadata.enable_thinking` 默认 false。`instruction` 兼容旧 `theme/prompt`，新实现统一 instruction。`mode`、references 元素、num_variants 上限没有完整定义，不应将未验证的任意值暴露给用户。

来源：[歌词生成](https://www.suno-api.io/docs/current-lyrics-generate.md)、[作者列表](https://www.suno-api.io/docs/current-lyrics-lyricists.md)、[创建项目](https://www.suno-api.io/docs/current-lyrics-projects-create.md)、[保存项目](https://www.suno-api.io/docs/current-lyrics-projects-flush.md)、[项目列表](https://www.suno-api.io/docs/current-lyrics-projects-list.md)、[风格增强](https://www.suno-api.io/docs/current-music-boost-style.md)、[随机灵感](https://www.suno-api.io/docs/current-prompts-suggestions.md)、[资源列表](https://www.suno-api.io/docs/current-prompts-library.md)、[时间轴歌词](https://www.suno-api.io/docs/current-lyrics-timeline.md)。

## 素材上传与翻唱

| 能力与方法 / 路径 | 必填 / 关键输入 | 返回、费用与优先级 |
|---|---|---|
| 上传源音频 `POST /api/music/upload-source` | JSON：`file_url` 或 `file_base64`，可选 `file_name`、`model=suno-v6`、`upload_type=file_upload`；也有 multipart `file` 示例 | 直接 `{clip_id,status,title,audio_url,...}`，不生成歌曲；免费；P0/P1，统一为后续 Remix 建立源 clip |
| 上传并翻唱 `POST /api/music/upload-cover` | JSON：源 `file_url/file_base64`；可选 `file_name`、`model`、`prompt`、`style`、`title`、`negativeTags`、`instrumental=false`、`waitAudio=false`、`cover_start_s/cover_end_s`、`audio_weight`、Max/Variety | `data.upload.clip_id` 与 `data.clips[]`；默认 ¥0.6/次，Max ¥1.2；P1。这里 cover 是翻唱，绝非封面图片 |
| 复用源 clip 翻唱 `POST /api/music/generate-from-source` | 必填真实 `sourceClipId`；可选 `sourceAudioUrl/sourceTitle`、`model`、`prompt`、`customMode=true`、`style/title`、`negativeTags`、`instrumental`、`waitAudio`、`vocalGender`、`lyricsMode`、`weirdnessConstraint/styleWeight/audio_weight`、Max/Variety | `data.clips[]` 和可选 `source_update`；默认 ¥0.6/次，Max ¥1.2；P1。已有素材直接换风格/歌词，避免重复上传 |

翻唱约束：

- 上传翻唱片段单位秒，可小数，开始必须小于结束且不超出源音频时长；省略两者使用整段。`audio_weight` 为 0–1，只有有效源音频时携带。
- 复用 clip 的 `customMode=true` 时 prompt 填新歌词，style/title 应同时提供；false 时 prompt 填创作描述。虽然表格写可选，条件约束仍需本地验证。
- `weirdnessConstraint/styleWeight/audio_weight` 均 0–1。文档对 `vocalGender/lyricsMode` 没给完整枚举，不应直接套用其他端点的未经确认枚举。
- `sourceClipId` 可取免费上传返回的 clip_id、真实 song_id，或强化上传完成后的 song_id，不能用 task_id、client_request_id 或 pending 占位值。服务端可能利用源 URL 重新上传以处理账号不一致问题，因而建议保存并携带源音频 URL。
- 上传文档将 file_url/file_base64 都标“可选”，但必须存在某一种有效音频来源；普通上传未说明最大文件、支持格式、时长限制，不能把强化上传的 80 MB 限制推及普通上传。

来源：[源音频上传](https://www.suno-api.io/docs/current-music-upload-source.md)、[上传后翻唱](https://www.suno-api.io/docs/current-music-upload-cover.md)、[源 clip 翻唱](https://www.suno-api.io/docs/current-music-generate-from-source.md)。

### 强化上传独立工作流

| 方法 / 路径 | 契约 |
|---|---|
| `POST /api/music/enhanced-upload` | 仅 multipart；必填 `file`，最大 80 MB；可选 `title` 默认文件名去后缀。不支持 JSON URL/base64；¥10/次预扣，失败或允许阶段取消自动退回 |
| `GET /api/music/enhanced-upload/:id` | 以数字 task_id 查询；返回 `data.task` |
| `GET /api/music/enhanced-upload` | 仅当前用户强化上传任务；`p=1`、`page_size` 最大 100 |
| `POST /api/music/enhanced-upload/:id/cancel` | 只有任务和后台 workflow 均 queued 才能取消；leasing/running/processing/完成均不可取消 |

提交返回 task_id、占位 song_id、client_request_id、预扣额度和 billing_source；处理中有 progress.stage/percent/label。上游渲染完成后还要准备 CN2 音频资源，因此 `processing`、98% 和空 audio_url 可以是正常等待。只有正式 `completed` 时真实 song_id 和有效 audio_url 才可复用；`/api/forbidden` 不是可播放资源。强化上传后翻唱必须用相同 API Key，把完成 task.song_id/audio_url/title 分别映射为 sourceClipId/sourceAudioUrl/sourceTitle。

建议 P2：成本远高于普通生成，必须独立展示“强化上传 ¥10/次”，不要在普通“导入音频”后自动触发。需要单独的任务类型和查询策略，不能混入普通 song_id 轮询。

来源：[强化上传](https://www.suno-api.io/docs/current-music-enhanced-upload.md)。

## 续写、局部重生成与 Remix

以下操作默认异步；通常返回 `data.clips[]`，保存每条真实 song_id 并轮询。标“按模型”项目的详细端点页没有固定价格，但 README 给出的当前默认价是 ¥0.6/次；Max Mode 为 2 倍。增加伴奏、人声、音轨、融合、采样、灵感通常返回 2 个候选。不要把“通常 2 条”硬编码为一定有 2 条。

| 方法 / 路径 | 必填参数与关键约束 | 其他输入 / 适合场景 / 优先级 |
|---|---|---|
| `POST /api/music/extend` | `audioId`、`prompt`、`continueAt`（秒）；model 默认 suno-v6 | `style/negativeTags/title/sourceAudioUrl/sourceFileName/waitAudio`；¥0.6/次；P1，从片段继续写音乐。详细文档未明确拼接全曲契约，不应将返回片段直接假定为完整拼接版 |
| `POST /api/music/replace-section` | `audioId`、`startSeconds`、`endSeconds`、`infillLyrics`；开始 < 结束、区间在原时长内，可小数 | `contextLyrics/contextWindowLyrics/style/title/negativeTags/requestedAt`；requestedAt 是 Unix 秒，通常省略；返回还可能有 replaceTask/clipId/source_update；¥0.6/次；P1，改一句歌词或重写局部 |
| `POST /api/music/add-instrumental` | `model`、`source_clip_id`，来源须真实、已完成、当前 Key 可访问 | `lyrics/style_tags/song_title/negative_tags`、`audio_weight=1`（0–1）、`duration` 整数 1–480 秒、`wait_completion=false`；按模型；P1，给人声素材重新编曲、补伴奏 |
| `POST /api/music/add-vocal` | `model`、`source_clip_id`，来源须真实、已完成、当前 Key 可访问 | `lyrics/style_tags/song_title/negative_tags/instrumental=false/wait_completion=false`；按模型；P1，为器乐补写/重写人声；不是性别偏好，也不是声音克隆 |
| `POST /api/music/add-stem` | `model`、`source_clip_id`、`stem_control_tags`；指令非空单行、最多 120 字符，不能包含换行或 tab，如 `add Drums` | `lyrics/style_tags/song_title/negative_tags/wait_completion`；按模型；P2，按乐器增添音轨；不要与拆分现有音轨混淆 |
| `POST /api/music/mashup` | `model`、`mashup_clip_ids`；恰好 2 个不重复真实 song_id，顺序保留，均完成且当前 Key 可访问 | `lyrics/style_tags/song_title/negative_tags/instrumental/wait_completion`；按模型；P2，融合两首作品 |
| `POST /api/music/sample` | `model`、`source_clip_id`、`mode=chop`、`start_seconds>=0`、`end_seconds>start_seconds` | `lyrics/style_tags/song_title/wait_completion`；按模型；P2，截取素材再生成新歌。`as-is/as_is/asis/blend` 明确 400，不提交任务 |
| `POST /api/music/inspo` | `model`、`playlist_clip_ids`；至少 1 个、不能重复、来源均完成且当前 Key 可访问 | `lyrics/style_tags/song_title/negative_tags/instrumental/wait_completion`；按模型；P2，多首素材作为灵感。Create UI 最多 2 首，API 文档允许多个但没说明最大数量 |

来源：[续写](https://www.suno-api.io/docs/current-music-extend.md)、[替换片段](https://www.suno-api.io/docs/current-music-replace-section.md)、[增加伴奏](https://www.suno-api.io/docs/current-music-add-instrumental.md)、[增加人声](https://www.suno-api.io/docs/current-music-add-vocal.md)、[加轨](https://www.suno-api.io/docs/current-music-add-stem.md)、[融合](https://www.suno-api.io/docs/current-music-mashup.md)、[采样](https://www.suno-api.io/docs/current-music-sample.md)、[灵感](https://www.suno-api.io/docs/current-music-inspo.md)。

## Studio 基础剪辑

这五个接口均为收费、按模型计费；README 当前列默认 ¥0.6/次。均要求 `model`、真实且已完成并属于当前 Key 可访问的 `source_clip_id`，可选 `song_title`，通常异步返回 1 个新 clip，状态 processing。全部不接受 Max Mode / Variety。

| 方法 / 路径 | 特有必填 / 可选参数 | 优先级建议 |
|---|---|---|
| `POST /api/music/crop` | `crop_start_s>=0`、`crop_end_s>crop_start_s`；区间必须在原时长内，保留该区间 | L。用现有本地 ffmpeg 裁剪更便宜、可控 |
| `POST /api/music/remove-section` | 字段仍叫 `crop_start_s/crop_end_s`，同样区间约束，但删除区间并合并其余部分 | L。时间轴非破坏编辑或本地拼接 |
| `POST /api/music/fade` | `direction=in|out`，一次只支持一个方向；`duration_seconds>0` | L。淡入+淡出若走供应商需两次请求，应本地处理 |
| `POST /api/music/reverse` | 无额外必填；通常与源时长一致 | L |
| `POST /api/music/speed` | `speed_multiplier>0`，最多 4 位小数，超限计费前 400；可选 `keep_pitch=false` | L。优先本地变速与保调，目标时长约=原时长/倍数 |

裁剪文档写“首次响应中可能暂时没有可查询的 song_id，稍等后再次查询”，却没有给出此时应使用的任务标识或专用查询接口。这是接入缺口；不要无 ID 就重复 POST，可能重复扣费。待供应商补齐恢复契约后再开放云端剪辑。

来源：[裁剪](https://www.suno-api.io/docs/current-music-crop.md)、[删减](https://www.suno-api.io/docs/current-music-remove-section.md)、[淡入淡出](https://www.suno-api.io/docs/current-music-fade.md)、[倒放](https://www.suno-api.io/docs/current-music-reverse.md)、[变速](https://www.suno-api.io/docs/current-music-speed.md)。

## 分轨及其素材组织

`POST /api/music/separate` 必填 `song_id` 和 `stem_mode=two|twelve`；可选 `source_audio_url`、`source_file_name`、`source_title`。不需要 model。外部素材先通过免费 upload-source 得到源 clip。

- two 文档默认 ¥0.6/次，通常人声与伴奏 2 条；twelve 默认 ¥3/次，轨道数以实际返回为准，不能硬编码 12 条。
- 返回 `data.clips[]`，每轨都有独立 song_id。使用 `POST /api/music/query` 查询，下载围绕每轨 song_id 进行。查询可能给 `stem_from_id`，应保留来源关系。
- 旧版 `success/task_id/vocals_url/instrumental_url` 单对象契约已过时。
- 注意：同站总览与分轨文档同时说明 `POST /api/music/vocal-removal` 是免费的两轨快捷能力。首版人声/伴奏分离应优先验证免费快捷端点，再决定何时使用收费 separate two。具体免费端点契约由下载/媒体分报告覆盖。
- 建议 P1：素材库采用“源作品 → 变体 → 子音轨”的关联模型，多轨下载分别入库，避免把一项分轨任务当作一个音频文件。

来源：[人声/伴奏分离](https://www.suno-api.io/docs/current-music-separate.md)、[总览的免费两轨说明](https://www.suno-api.io/docs/current-overview.md)。

## 文档差异、缺口与实现决策

1. **模型表述有歧义**：总览称旧模型已下线且不能用于新建请求；models.md 又称旧模型请求会自动映射 suno-v6、不返回不可用错误。新实现只允许当前三个供应商别名，不依赖隐式降级。
2. **完成判据不一致**：总览要求状态完成后用音频地址；create 的 Node/Electron 示例写出现 audio_url 即完成。应遵循状态与有效地址共同满足的严格判据，提前试听单独区分，不把流式地址入正式素材库。
3. **部分编辑没有恢复句柄**：crop 承认初次可能无 song_id，但未给出可恢复 query key。付费写请求不可盲目自动重试；生成提交阶段需保存本地 operationId、原始返回和供应商 request ID（如有），把不确定状态显示为待确认。
4. **价格不能统一成“所有 0.6 元”**：基础默认价来自 README，详细端点又以模型和后台配置为准；强化上传 ¥10、多轨 ¥3、Max 2 倍、helper 超额 ¥0.1 都独立。产品应显示预估和实际账单差异。
5. **原曲权限与身份不同**：API Key 所属主账号的历史可以跨该主账号多个 Key 查询，但不包括其他用户/子站。很多 Remix 要求源歌曲可访问；上传、强化上传和分轨子结果不在普通 songs 历史中，必须本地持久化元数据。
6. **非统一字段命名**：extend 用 audioId/continueAt，replace 用 startSeconds，cover 用 sourceClipId，Studio 用 source_clip_id/crop_start_s；不要让 UI 请求直接透传，须有明确的端点字段映射。
7. **源上传及 helper 细节未给全**：普通上传的格式/时长/体积，声音 type 枚举，灵感最大来源数，歌词 mode/references/num_variants 和列表分页缺具体约束。只上线已明示的参数，后续用最小付费测试校验。
8. **供应商历史不能代替本地工程**：song 详情承认高级参数可能未保留、部分字段返回 null；应在提交时本地记录完整脱敏请求、模型、来源 ID、来源本地路径、价格估计、多个候选与下载后的文件哈希。

建议首版范围为一句话/专业作曲、纯音乐、歌词编辑、异步恢复、候选试听与下载入库。第二阶段加入源音频翻唱、续写、局部替换、补人声/伴奏、分轨。高级融合/采样/加轨/强化上传做独立进阶功能；裁剪、拼接、淡入淡出、倒放、变速沿用本地音频引擎。
