# 采集基准：帧格式（BGRA 管道 vs JPEG q95）与默认 fps（24 / 30）

> backlog E-6 · 对应《代码视频底座》（2026-11-09-code-video-foundation.md）§12 决策 1、决策 3（ADR-16）与 §13.2 / §13.3。
> 原始数据：[2026-11-10-capture-benchmark.json](./2026-11-10-capture-benchmark.json)（由脚本生成，未手改）。
> 复现：`node node_modules/tsx/dist/cli.mjs scripts/bench-capture.ts --seconds 4 --repeat 3 --out docs/design/2026-11-10-capture-benchmark.json`

<!-- capture-benchmark-decision: {"format":"bgra","fps":30} -->

## 结论

| 决策 | 结果 | 一句话理由 |
| --- | --- | --- |
| 默认帧格式（ADR-16） | **`bgra`**（原始 BGRA 经 ffmpeg stdin） | 1080p 上 JPEG q95 端到端**不更快**（JPEG÷BGRA 速度比中位 0.887，即中位慢 11.3%，四组里最好也慢 1.9%），还多一次有损编解码、成片反而更大；BGRA 内存在预算内。 |
| 默认 fps（§12 决策 1） | **30**（仍由用户建项目时在 24 / 30 二选一并锁定） | 单帧成本与 fps 无关，30 fps 的总耗时≈帧数比 1.25× 减去固定开销；实测同时长 30/24 总耗时比中位 1.177（≤ 1.35 门槛）。30 与 HF 默认、主流平台一致。 |

已落地：`electron/capture-host.ts` 新增 `export const DEFAULT_CAPTURE_FORMAT: CaptureFrameFormat = 'bgra'`（只供新架构使用，现有路线不读）。`src/shared/video-spec.ts` 未改动。
`tests/capture-benchmark.test.ts` 锁定：上面的决策标记 = 用当前规则从 JSON 重新计算的结果 = `DEFAULT_CAPTURE_FORMAT`。

决策规则写在 `src/shared/capture-benchmark.ts` 的 `decideCaptureDefaults`：JPEG 只有在**每组**端到端都快 ≥ 10% 且成片 SSIM ≥ 0.99、PSNR ≥ 40 dB 时才成为默认；BGRA 峰值内存超过 3072 MB 而 JPEG 不超时也改用 JPEG；否则 BGRA。30/24 同时长总耗时比 ≤ 1.35 默认 30，否则 24。

## 测试方法

- **真实链路**：esbuild 打包的 `CaptureHost` + `createElectronCaptureWindowFactory()`（offscreen、sandbox、私有 partition），在 `node_modules/electron`（Electron 41.7.0 / Chrome 146）子进程里运行；GPU 加速**开启**（与 `electron/main.ts` 一致，只固定 DPR=1）。
- **场景**（1920×1080，每段 4 秒）：
  - `css`：generic-css 适配器，图文数据动画——渐变背景位移、`filter: blur(40px)` 光斑、大标题文字阴影、3 张带阴影半透明卡片、12 根柱状图、SVG 描边、60 个发光粒子、滚动字幕。
  - `lemo`：Lemo 页面契约（`READY` / `DUR` / `render(t)`），canvas 2D：渐变背景 + 400 个粒子 + 6 道旋转弧 + 标题；场景代码经 `wrapSceneCode` 进入确定性作用域。
- **case**：每个场景 × {bgra, jpeg} ×（只采集 @30 / 采集+编码 @30 / 采集+编码 @24），共 12 个 case，每个重复 3 次、交错执行，取中位数；正式测量前每个场景先跑一次 10 帧预热（丢弃）；每个 case 前主进程 GC 并静置 1.5 s。
- **编码参数**：与现有 HTML 场景段导出（storybound-sidecar，浏览器采集帧 → mp4）的视频部分一致：同一条 `scale … bt709 … format=yuv420p,setparams=…` 色彩链、`-pix_fmt yuv420p`、bt709 / tv 标记、`-r fps -fps_mode cfr -c:v libx264 -threads 2`，未指定 preset / crf（即 x264 默认 medium / crf 23）；去掉了音频和补帧部分。输入参数用 `ffmpegFrameInputArgs`（bgra → `rawvideo`；jpeg → `image2pipe mjpeg`），帧经 `createWritableFrameSink` 写 stdin（带背压）。
- **画质**：`frame` = 同一帧的原始 BGRA 与 JPEG q95 在 RGB（gbrp）空间比较（第 0 / 60 / 119 帧，中位）；`final` = 两条路径的 30 fps 成片（yuv420p）逐帧比较，以 BGRA 路径成片为参考。
- **内存**：Electron 全部进程 `getAppMetrics()` workingSet 之和，每 100 ms 采样取峰值；ffmpeg 取 `-benchmark` 的 `maxrss`；“合计”是两者峰值相加（上界，二者峰值未必同时出现）。
- **机器**：i7-11800H（8C/16T）、15.8 GB 内存、RTX 3060 Laptop、Windows 11 22631；ffmpeg 7.1（vendor/python imageio_ffmpeg）。

## 数据（中位数，3 次）

### 只采集（sink 丢弃帧，30 fps，120 帧）

| case | 稳态采集 fps | 端到端 fps | 每帧大小 | Electron 峰值 |
| --- | --- | --- | --- | --- |
| css · bgra | 21.57 | 20.33 | 8100 KB | 558 MB |
| css · jpeg | 15.40 | 14.92 | 237 KB | 538 MB |
| lemo · bgra | 21.79 | 20.92 | 8100 KB | 561 MB |
| lemo · jpeg | 15.81 | 15.21 | 242 KB | 532 MB |

`capturePage` + `toBitmap` 每帧约 46 ms；`toJPEG(95)` 在主进程里**多花约 18–19 ms/帧**（1/15.4 − 1/21.6）。JPEG 省下的是管道带宽（每帧 8.1 MB → 0.24 MB），但 30 fps 下 BGRA 也只有约 237 MB/s，本机管道远未饱和（BGRA 的 sink 等待中位只有 0.3–0.5 s/段）。

### 采集 + libx264（端到端含建窗、加载、ready、编码器排空）

| case | 帧数 | 稳态采集 fps | 端到端 fps | 总耗时 | sink 等待 | 编码器排空 | Electron 峰值 | ffmpeg maxrss | 合计峰值 | 成片 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| css · bgra · 30 | 120 | 16.27 | 10.92 | 10992 ms | 493 ms | 3178 ms | 579 MB | 522 MB | 1100 MB | 1005 KB |
| css · jpeg · 30 | 120 | 13.85 | 10.71 | 11201 ms | 820 ms | 2111 ms | 569 MB | 536 MB | 1106 MB | 1200 KB |
| css · bgra · 24 | 96 | 18.60 | 12.54 | 7653 ms | 309 ms | 2199 ms | 578 MB | 497 MB | 1075 MB | 935 KB |
| css · jpeg · 24 | 96 | 14.17 | 10.04 | 9562 ms | 602 ms | 2493 ms | 562 MB | 532 MB | 1094 MB | 1104 KB |
| lemo · bgra · 30 | 120 | 19.20 | 13.89 | 8642 ms | 307 ms | 2133 ms | 544 MB | 494 MB | 1038 MB | 1643 KB |
| lemo · jpeg · 30 | 120 | 14.47 | 10.33 | 11618 ms | 378 ms | 3051 ms | 561 MB | 517 MB | 1078 MB | 1746 KB |
| lemo · bgra · 24 | 96 | 15.37 | 10.03 | 9569 ms | 360 ms | 2830 ms | 554 MB | 506 MB | 1059 MB | 1543 KB |
| lemo · jpeg · 24 | 96 | 14.41 | 9.77 | 9830 ms | 379 ms | 2663 ms | 532 MB | 517 MB | 1049 MB | 1643 KB |

- **JPEG ÷ BGRA 端到端速度比**：css@30 0.981、css@24 0.801、lemo@30 0.744、lemo@24 0.974；**中位 0.887**，没有一组 JPEG 更快。
- **成片大小**：JPEG 路径反而大 6–19%（JPEG 块效应/噪声让 x264 多花码率）。
- **瓶颈是编码而不是采集**：采集 16–19 fps，而 x264 medium + `-threads 2` 的 1080p 编码跟不上，stdin 关闭后还要排空 2–3 s。端到端 10–14 fps，即 4 秒成片约 8.6–11.6 秒（≈ 2.2–2.9× 实时）；对比 §13.2 旧链路 1080p24 约 4.2 fps（5.75× 实时），新 CaptureHost 链路约快 2.4–3.3 倍。
- **内存**：BGRA 与 JPEG 几乎一样（合计 1.04–1.11 GB 上界）；ffmpeg 约 0.5 GB 主要是 x264 lookahead，与输入格式无关。

### 画质（JPEG q95 路径 vs BGRA 路径）

| 场景 | 阶段 | SSIM（All） | SSIM Y | PSNR 平均 | PSNR 最差 |
| --- | --- | --- | --- | --- | --- |
| css | 单帧（RGB） | 0.990121 | — | 42.80 dB | 41.51 dB |
| css | 成片（yuv420p） | 0.993701 | 0.994508 | 43.85 dB | 27.67 dB |
| lemo | 单帧（RGB） | 0.977644 | — | 38.44 dB | 38.10 dB |
| lemo | 成片（yuv420p） | 0.994878 | 0.995354 | 44.88 dB | 44.27 dB |

JPEG q95 本身是“看不出来”级别的损失（成片 SSIM ≥ 0.9937、平均 PSNR ≥ 43.8 dB，过了 0.99 / 40 dB 门槛），但 css 成片最差的一帧只有 27.67 dB（大面积渐变 + 模糊光斑在 4:2:0 + JPEG 双重量化后差异放大），lemo 的细粒子单帧只有 38.4 dB。画质不是否决 JPEG 的原因，速度才是；但它说明 JPEG 没有任何“免费”的地方。

### 24 vs 30 fps

同时长（4 s）下 30 fps / 24 fps 的总耗时比：css·bgra 1.436、css·jpeg 1.171、lemo·bgra 0.903、lemo·jpeg 1.182；**中位 1.177**。
理论值：采集与编码都按帧计费，单帧成本与 fps 无关（上表 24 / 30 的稳态采集 fps 相近），所以总耗时 ≈ 固定开销（建窗+加载+ready ≈ 0.3–0.5 s，编码器排空 2–3 s）+ 1.25 × 帧相关部分，应落在 1.1–1.25。单次测量的离散度很大（0.90–1.44，见下方“噪声”），中位数与理论一致。选 30 的代价约为多 18–25% 渲染时间，换来和 HF/平台默认一致的流畅度；24 fps 仍保留为用户可选项（电影感、长片省时）。

## 本次基准顺带发现并修复的问题：CaptureHost 逐帧内存泄漏

第一次试跑时，Electron 主进程 working set 每个 case 涨约 240 MB、12 个短 case 后到 3.3 GB 且 GC 后不回落——差点把决策规则推向“BGRA 超内存 → JPEG”。定位：

- `captureScene` 里每个窗口操作都 `Promise.race([操作, 超时, stopped])`，`stopped` 是整个采集期间都不结算的 Promise。每次 race 都在它上面挂一个反应，反应持有 race 的结果（截图对象、8 MB 位图）。
- 窗口的 `onPageError` / `onCrash` 监听器闭包引用整个 `captureScene` 作用域，而 Electron 的内存 partition（`session.fromPartition`）**没有销毁 API**、随应用存活，其 `webRequest` 回调又引用这些监听器——所以采集结束后这些帧也永远不会被回收。
- 修复（`electron/capture-host.ts`）：去掉长期 `stopped` Promise，改为每个操作登记自己的 reject、结束时注销；`electron/capture-host-electron.ts` 的 `destroy()` 同时清掉监听器数组、`webRequest` / 权限回调、`will-download` 监听，并清空 partition 缓存与存储。
- 回归测试：`tests/capture-host.test.ts` 的 “does not retain captured images after each frame” 用 `WeakRef` + 手动 GC 验证 30 帧采完后截图都可回收；已确认该测试在修复前的提交版本上失败、修复后通过。
- 修复后：每个 case 前的 Electron 基线稳定在 308–329 MB，全部 case 结束 GC 后只剩 Browser 130 MB / GPU 176 MB / Utility 49 MB 三个进程（无残留渲染进程）。
- 另用独立探针（直接 `BrowserWindow.capturePage`，240 帧，含每 30 帧换窗口 + 新 partition）确认 Electron 自身没有可见泄漏（Browser 进程 91 MB → 118–123 MB 后持平）。

## 噪声与局限【未核实】

- 单台机器、一次运行（3 次重复）。同一 case 的总耗时最多相差约 40%（如 lemo·bgra·30：7876–13103 ms），主要来自 x264 编码器排空时间与后台负载；24/30 比值的单组数值不可靠，只看中位。
- `lemo` 夹具是 canvas 2D，不是上游 three.js / WebGL 场景；真实 HyperFrames / 上游 Lemo 页面未测。GPU 重的 WebGL 页面上 `capturePage` 回读成本可能不同。
- 编码参数取 HTML 场景段的现状（x264 默认 medium / crf 23、`-threads 2`）。成片导出若改为 `-preset medium -crf 18`（storybound 另一段）或放开线程数，编码瓶颈会变化；JPEG 与 BGRA 的相对结论不受影响（两边编码器相同），但端到端 fps 会变。
- 只测了单窗口串行；多窗口并行采集（§13.2 提到的方向）下，BGRA 的管道带宽（每路 ~240 MB/s）与内存会线性叠加，届时需复测。
- ffmpeg `-benchmark` 的 utime 在 Windows 上波动很大（同 case 2.3–15 s），未作为决策依据。
- 内存“合计峰值”是 Electron 与 ffmpeg 各自峰值之和，是上界。
- 与 §13.2 旧链路（4.2 fps）的对比不是同一场景、同一段长度，“快 2.4–3.3 倍”只是量级参考。
- 内存门槛 3072 MB、速度门槛 10%、fps 比门槛 1.35 是本文设定的工程门槛，不是外部标准。
