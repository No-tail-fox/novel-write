# C-3 色彩标签筛查（2026-11-10）

目标：所有视频编码路径的成片都应带 `tv / bt709 / bt709 / iec61966-2-1`（或 Lemo bt709 模式的 trc `bt709`），即 `FINAL_FILM_COLOR_TAGS`。
测试：`tests/color-tag-screening.test.ts`（14 个用例，用随包 ffmpeg 7.1 实跑真实导出的参数构造函数 / 真实 sidecar 脚本；找不到 ffmpeg 时跳过）。

## 1. 根因（随包 imageio ffmpeg 7.1 实测）

| 写法 | `ffmpeg -i` 读出 | SPS VUI（range/pri/trc/matrix） |
|---|---|---|
| 只有输出参数 `-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc iec61966-2-1`，输入无标签 | `yuv420p(tv, bt709/unknown/unknown)` | 0 / 2 / 2 / 1 |
| 同上 + 滤镜链里 `setparams=…color_primaries=bt709:color_trc=iec61966-2-1` | `yuv420p(tv, bt709/bt709/iec61966-2-1)` | 0 / 1 / 13 / 1 |
| 输入本身带标签（解码出的帧带属性），经 fps/tpad/trim/concat/xfade 后重编码 | 保留 `tv, bt709/bt709/iec61966-2-1` | 0 / 1 / 13 / 1 |
| `-c copy`（concat demuxer、remix、响度规整） | 原样保留 | 原样 |

原因：range 与 matrix 走滤镜协商，所以输出参数能写进去；primaries/trc 取自帧属性，帧没带就是 unknown。
所以：只有当某次重编码的输入没有标签、且链里没有 setparams 时，才会丢 primaries/trc。

## 2. 编码路径清单（缩略图/抽帧不算）

“修前/修后”指输入无标签时的最坏情况；括号里是生产中真实输入（已打标签的场景段）的结果。

| # | 路径（文件:行） | 用途 | 方式 | 修前 | 修后 |
|---|---|---|---|---|---|
| 1 | `storybound-sidecar.ts:1729` `encode_render_scene` | HTML/导演/VOX/短视频/Lemo 采集场景段 | libx264 重编码，scale→limited BT.709 + setparams（在链中段）+ 色彩参数 | ✅ | ✅（未改） |
| 2 | `storybound-sidecar.ts:1891` 封面段（`SIDECAR_STILL_TO_BT709_FILTER`） | compose 封面 | 重编码，链尾 setparams | ✅ | ✅（未改） |
| 3 | `storybound-sidecar.ts:1475/1531` `_compose_with_hard_cuts`（≤8 段） | 硬切合成 | 重编码，concat 滤镜 + 色彩参数，无 setparams | ⚠ `tv, bt709/unknown/unknown`（✅） | ✅ 链尾加 `OUTPUT_COLOR_TAG_FILTER`（:1491） |
| 4 | `storybound-sidecar.ts:1496` `_compose_hard_cut_groups`（>8 段） | 分组硬切 | 每组重编码（同 #3 滤镜图）+ concat demuxer `-c:v copy`（:1526） | ⚠（✅） | ✅ 组内带标签，copy 保留 |
| 5 | `storybound-sidecar.ts:1361` `_compose_xfade_batch` | xfade 转场 | 重编码，无 setparams | ⚠（✅） | ✅ 链尾加标签（:1388） |
| 6 | `storybound-sidecar.ts:1558` `_compose_with_visual_transitions` | 溶解转场头几帧 | 重编码，无 setparams；其余段 copy | ⚠（✅） | ✅ 链尾加标签（:1590） |
| 7 | `storybound-sidecar.ts:1925` compose 总时长补齐（tpad） | 成片时长对齐 | 重编码 `-vf tpad` + 色彩参数 | ⚠（✅） | ✅ `tpad,…,OUTPUT_COLOR_TAG_FILTER` |
| 8 | `storybound-sidecar.ts:1285` `generate_remix_bgm` | 混 BGM | `-c:v copy` | 跟随输入 | 跟随输入（✅） |
| 9 | `storybound-sidecar.ts:1783` `normalize_composed_audio` | 两遍响度 | `-c:v copy`（:1818） | 跟随输入 | 跟随输入（✅） |
| 10 | `storybound-sidecar.ts:1147` `normalize_scene_video` | AI 场景视频/素材库视频规整（中间素材，之后在 Chromium 里播放并被重新采集） | libx264 crf18，无色彩参数 | 透传源标签（无标签源→无标签） | **未改**（见 §4） |
| 11 | `video-spec-executor-runtime.ts:72/187/201` 场景段 | 新架构 still/video 段 | 无损 x264，`toBt709Filter` 链尾 setparams + 色彩参数 | ✅ | ✅（未改） |
| 12 | `video-spec-executor-runtime.ts:237` `muxVideoSpecFilmArgs` | 新架构成片封装 | concat + libx264 crf18，`-vf setparams` + 色彩参数 | ✅ | ✅（未改） |
| 13 | `video-spec-executor-runtime.ts:115` 帧流编码（`spawnFrameEncoder`，参数同 #11） | CaptureHost 帧 | 同 #11 | ✅【未核实：需要真实 Electron 窗口，测试未跑】 | 未改 |
| 14 | `electron/lemo-upstream-video.ts:442` `buildMuxArgs`（默认 faithful） | Lemo 成片 mux.sh 移植 | libx264 slow crf19，`format=yuv420p`，无色彩参数 | 跟随输入：生产输入 ✅；原始 video.mjs 画面 → `yuvj420p(pc, bt470bg/unknown/unknown)` | 未改（vendor 忠实模式） |
| 15 | `buildMuxArgs` `color:'bt709'` | Lemo 可选 | pc→tv + BT.709 矩阵像素转换 + setparams trc bt709 | ✅ `tv, bt709/bt709/bt709` | 未改 |
| 16 | `vendor/lemo-upstream/core/render/video.mjs:48-49,67`（只读） | Lemo 原画 | mjpeg 管道 → x264 crf14，concat `-c copy` | `yuvj420p(pc, bt470bg/unknown/unknown)` | 不可改（vendor） |
| 17 | `vendor/pixelle-upstream/.../video.py` 多处（只读） | Pixelle 生成视频（中间素材 `generatedVideos`） | 重编码/copy | 未测【未核实】 | 不可改 |
| 18 | `src/shared/viral-reference-media.ts:188` | 爆款参考观察视频（只做分析） | x264 ultrafast crf28 | 无标签 | 未改（不是交付物） |
| 19 | `viral-media-worker.py`（下载合并 copy）、`editorial-qa-seed.ts:276`（QA 夹具）、`scripts/*` | 非交付 | — | — | 未改 |

另外：`html-video-frame-stream.ts` 的 `encodeHtmlFrames` 走 #1；`capture-host.ts:120` 只构造输入参数；`audio-timeline-renderer.ts` 与 `services/pixelle-worker/media_runtime.py` 只处理音频；`generate_story` / `generate_music_mv` 只写剪映草稿，不编码。

**合计：19 条（14 条仓库内可改 + 5 条 vendor/非交付）。** 有 5 条在“输入无标签”时会丢 primaries/trc（#3–#7，同一种写法），都已修。生产里的输入其实都是 #1/#2 打过标签的段，所以修前实测成片同样通过；这次修复是防御性的，把“靠输入带标签”改成“每次重编码自己打标签”。

### 修复方式

- 新常量 `SIDECAR_OUTPUT_COLOR_TAG_FILTER = 'setparams=color_primaries=bt709:color_trc=iec61966-2-1'`（`storybound-sidecar.ts:372`），同时注入 Python 的 `OUTPUT_COLOR_TAG_FILTER`（:400），加在 #3/#5/#6/#7 视频链末尾。
- 只给 primaries/trc 打标签，range/matrix 不打：这两个已由输出参数经滤镜协商写入。如果输入是 pc / BT.601，ffmpeg 会做真实转换，而不是只改标签。
- codec、crf、preset 都没改。测试证明加不加这个滤镜，解码出的像素 md5 完全相同。

## 3. 证据（命令与结果）

```powershell
$ff = "I:\opc\vendor\python\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
& $ff -hide_banner -i out.mp4                                                    # 流信息（无 ffprobe）
& $ff -i out.mp4 -map 0:v:0 -c copy -bsf:v trace_headers -frames:v 1 -f null -   # SPS VUI 字段
node node_modules/vitest/vitest.mjs run tests/color-tag-screening.test.ts         # 14/14 通过
```

测试覆盖（每条都同时断言 `parseFfmpegInfo` 读出的标签、SPS VUI 码值，以及 `evaluateFinalFilmGate` 的 `FINAL_GATE_COLOR` 行）：

- 根因复现：只有参数时 → `ARGS_ONLY` / VUI 2/2，gate 给 warn；加 setparams 或加尾部标签 → pass，像素不变。
- 真实 `runStoryboundMediaSidecar`：
  - `encode_render_scene`：tags 正确，mp4 `colr nclx` 为 1/13/1/full=0。
  - `compose_render` 三种合成（hard cut / xfade / dissolve），都带封面、时长补齐、BGM remix copy 和响度 copy：全部 pass。
  - >8 段分组：pass。
- 未打标签输入下，修后与修前（把常量替换成 `null`）对比：hard cut / xfade / dissolve / tpad 修后 pass，修前是 `tv, bt709/unknown/unknown`，像素 md5 一致。
- `normalize_scene_video`：输入有标签则保留，输入无标签则不打标签（透传）。
- video-spec：`renderStillSceneSegment`、`renderVideoSceneSegment`（无标签视频输入）、`muxVideoSpecFilm`：全部 pass。
- Lemo：见 §5。

## 4. 有意未改

- **`normalize_scene_video`（#10）**：这是中间素材，之后在 Chromium 里播放，再经 #1 重新采集，成片标签由 #1 决定。源视频（AI 生成/用户素材）真实的矩阵和范围未知，统一盖成 bt709 可能谎报，所以保持透传。
- **viral 观察视频（#18）**：只用于分析。
- **vendor（#16/#17）**：只读。

## 5. Lemo

### 实际生产链路

`video.mjs` 原画（pc/bt470bg）作为导演场景的 `videoPath`（`preserveSourcePicture`）→ 在 Chromium 里播放并采集 → sidecar #1 重编码，打上标签 → compose（#3–#9）→ `finalizeLemoUpstreamFilm` 默认 faithful mux（#14）。

实测（测试 “production faithful mux”）：faithful mux 不加任何色彩参数，标签跟随输入，所以生产 Lemo 成片是 `tv, bt709/bt709/iec61966-2-1`，`FINAL_GATE_COLOR` 应为 pass。
因此 backlog E-5 里“真实 Lemo 成片预计出 FINAL_GATE_COLOR 警告”在当前链路下**不成立**。（`tests/final-film-gate-runner.test.ts:135` 的 Lemo 用例里出现的 warn，是因为夹具本身只用输出参数编码，已经是 `tv, bt709/unknown/unknown`，mux 只是原样保留。）真实 Lemo 工程端到端【未核实】。

只有把 `video.mjs` 原画**直接**交给 mux（上游独立流程，本仓库不走这条）时，结果才是 `yuvj420p(pc, bt470bg/unknown/unknown)`。这时 gate 给的是 **fail**（range/matrix 不符），不只是缺 primaries/trc 的 warn。

### 选项

| 方案 | 结果 | 像素 | 与 faithful 兼容 |
|---|---|---|---|
| A. 不动（当前） | 生产链路 ✅；原画直 mux 时 pc/bt470bg/unknown | 不变 | 是 |
| B. `color:'bt709'`（已有） | `tv, bt709/bt709/bt709`，gate pass | pc→tv + 601→709 真实转换 | 否（偏离 mux.sh 默认） |
| C. 后置仅元数据：`-c copy -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=13`（新增 `retagLemoFilmColorMetadata`，默认预设 `LEMO_FAITHFUL_COLOR_RETAG`） | 原画直 mux → `pc, bt470bg/bt709/iec61966-2-1`，gate 仍 fail（range/matrix 是真实值） | 码流切片、音频包逐一 framemd5 相同；解码像素 md5 相同 | 是：只改 SPS VUI |
| D. 题面原样 `h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1` | 随包 ffmpeg 可执行；读出 `yuvj420p(pc, bt709)`，range 仍 pc，gate 仍 fail | 不变，但**谎报矩阵**：BT.601 样本按 709 解码会偏色 | 机械上兼容，语义上不建议 |
| D'. 再加 `video_full_range_flag=0` | 读出 `tv, bt709` 可过 gate | 不变，但范围也谎报：全范围样本按 limited 解码，黑白被拉出范围、对比度错误 | 不建议 |

注：h264_metadata 只改 SPS；mp4 muxer 在 copy 时不会写 `colr` 盒（测试断言为 null），所以不会出现容器和码流矛盾。

**建议**：保持 A（生产链路已通过）。如果以后要交付“原画直 mux”的成片，并且必须过 gate，用 B（真实转换，需产品接受偏离 faithful）。C 只作为想补齐“诚实的 primaries/trc”时的显式 opt-in，默认不接入 `finalizeLemoUpstreamFilm`。D/D' 不要用。

新增 API（`electron/lemo-upstream-video.ts:635-685`，默认不调用）：`LEMO_FAITHFUL_COLOR_RETAG`、`buildH264ColorMetadataFilter(tags)`、`buildLemoColorRetagArgs(in, out, tags?)`、`retagLemoFilmColorMetadata(path, { ffmpegPath, tags?, signal?, timeoutMs? })`（同目录临时文件 + 原子改名，失败清理）。

## 6. FINAL_GATE_COLOR 复核

- `src/shared/final-film-gate.ts:155` 的 `colorCheck` 读 `video.colorRange / colorSpace / colorPrimaries / colorTransfer`，与 `FINAL_FILM_COLOR_TAGS`（:21）比对：不符给 fail，缺失给 warn。
- `parseFfmpegInfo`（:272）能处理两种写法：三值相同时 ffmpeg 只打印一个 token（如 `tv, bt709`），以及 `a/b/c` 三段写法。它还把 `yuvj420p(pc, …)` 正确读成 pc。
- 测试在上述所有输出上直接调用 `parseFfmpegInfo` + `evaluateFinalFilmGate`：修复后的路径全部 pass；根因样例给 warn；Lemo 原画给 fail。字段读取正确，无需改动。

## 7. 【未核实】

- `spawnFrameEncoder`（CaptureHost 帧流）与 Electron 实机导出：需要真实窗口，测试只用了等价参数。
- 真实 Lemo 工程端到端（`prepareLemoUpstreamPicture` → 导演渲染 → `finalizeLemoUpstreamFilm`）的 `quality-gate.json`：链路是逐段实测拼起来的，没有跑完整工程。
- Pixelle vendor 编码（#17）的输出标签：中间素材，未测。
- 打包版 ffmpeg 是否与 vendor 内的 7.1 相同：行为依赖 ffmpeg 版本。
