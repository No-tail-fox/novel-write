# 创意动画 / 模板动画拆分 + Lemo 上游出片（2026-11-10）

承接 [2026-11-09-lemo-faithful-mode.md](2026-11-09-lemo-faithful-mode.md)。本次做了三件事：

1. 创意动画（Lemo）和模板动画（Remotion 模板）拆成两个独立的项目类型。
2. Lemo 第三代（authoringVersion 3）出片改为上游 `video.mjs` + `mux.sh` 的做法。
3. 用真实模型（文本、图片、配音）把三条路线（创意动画、HTML 动画、模板动画）各完整跑了一遍。

## 1. 路线拆分

| | 创意动画 | 模板动画 | HTML 动画 |
|---|---|---|---|
| 侧栏 / 新建入口 | 「创意动画 · Lemo · 66 种风格 + OPUSCAR 98」 | 「模板动画 · Remotion 模板 · 稳定批量」 | 不变 |
| 页面 | `editorial-collage` 视图，`route='lemo'` | `template-animation` 视图，`route='template'`，与创意动画同一个组件 | 不变 |
| 风格 | Lemo 66 种 + OPUSCAR 98（`o98-NN`），下拉共 165 项 | 已适配的 59 种 + 自动匹配，共 60 项，不含 OPUSCAR | — |
| 制作方式切换 | **已删除**：页面决定路线 | 同左 | — |

- **存储类型不变：**两类项目仍是 `taskType='editorial-collage'`，所以老项目、续跑和 authoringVersion 2/3 的恢复路径都不受影响。
- **路线判定唯一来源：**`src/shared/creative-animation/production-route.ts`。
  - `productionSettings.authoring.mode` 为 `ai-code` 或 `existing-assets` 时 → 创意动画。
  - 其余情况（`template`、没有 authoring、没有 productionSettings、JSON 无法解析）→ 模板动画。老项目因此自动归为模板动画。
  - 音乐 MV 永远走 Lemo，单独成类。
- **新建项目：**`createEditorialCollage` 新增 `productionRoute` 参数，创建时把路线写进 authoring。
- **路线锁定：**保存时如果路线发生变化，会抛出 `EDITORIAL_ROUTE_LOCKED` 并拒绝保存；同一路线内的其他设置（包括换风格）仍可修改。
- **列表与筛选：**
  - `tasks.production_route` 列由触发器 `tasks_production_route_insert_v1` / `_update_v1` 维护。
  - 打开数据库时，`ensureProductionRouteTriggers()` 会为旧库建立触发器并回填这一列。
  - 列表分类 `template-animation` 按 `production_route = 'template'` 过滤；任务摘要里带 `productionRoute` 字段。
- **跨路线打开：**如果某个项目属于另一条路线（例如摘要过期），页面会通过 `openEditorialProjectInView(view, taskId)` 把它交给对应页面，并保留打开请求。

### 1.1 实跑中发现并修复的打开问题

用用户真实 `data.db` 的**副本**验证时，从「项目 → 继续编辑」打开任何创意动画或模板动画项目，都会停在「无法打开 … 项目」。

**原因：**

- 打开请求的 effect 依赖了 `navigate`，而外壳每次渲染都会重新创建这个函数，于是同一个项目被重复打开。
- 第二次打开时，第一次还占着项目操作（busy），返回失败；第一次的结果又已经过期。结果两次都没有设置文档。
- 另外，`navigate()` 会清空 `requestedEditorialCollageTaskId`，所以跨路线转交时项目 id 会丢失。

**修复：**

- 每个请求只打开一次（`handledRequestRef`）。
- 回调改用 ref 读取。
- 转交改走 `openEditorialProjectInView`。
- 回归测试：`tests/production-route-split.test.ts`。

**修复后实测（真实库副本，共 38 个项目）：**

| 分类 | 数量 | 说明 |
|---|---|---|
| 编辑类项目 | 19 | lemo 11 / template 6 / 音乐 MV 2 |
| 「模板动画」筛选 | 6 | 均为没有 authoring 的老项目 |
| 「创意动画」筛选 | 11 | |

两类项目都能从项目页正常打开，并进入工作台（模板项目「白骑士精神」显示 61 个镜头）。

**已知、与本次无关的问题：**该老模板项目的镜头动效预览报错「操作失败，请重试」。原因是旧的 AI 动效代码在预览 iframe 里重复调用 `CSS.registerProperty`（InvalidModificationError）。`DirectorMotionPreview` 本次没有改动。

## 2. Lemo 第三代出片：上游 `video.mjs` + `mux.sh`

- **画面：**原样运行上游 `core/render/video.mjs`。
  - 运行的是 `cache/lemo-upstream-render/render-root/<key>` 下经过 sha256 校验的暂存副本；`vendor/lemo-upstream` 本身不改。
  - 由捆绑的 Playwright driver node 执行，使用 playwright-core 1.63 和 chromium_headless_shell-1243。
  - 画面按 fps 24 逐帧截图，每 3 个 worker 一组生成 x264 分段，最后用 concat 拼接。
- **成片：**`mux.sh` 移植为 TypeScript（`finalizeLemoUpstreamFilm`）。
  - 音频：两遍 loudnorm（`I=-14:TP=-1.2:LRA=11`），音频比画面短时用静音补齐。
  - 画面：先加 `fps`，再按风格加颗粒（`noise=c0s=<grain>:allf=t`）。
  - 编码：x264 `-preset slow -crf 19`，AAC 256k，`+faststart`。
  - 音乐 MV 保留原曲响度，不做重新混流。
- **错误前缀：**
  - 环境问题：`LEMO_UPSTREAM_RENDER_ENV:`。
  - 渲染失败：`LEMO_UPSTREAM_RENDER_FAILED:`（附 stderr 末尾几行）。
  - 混流：`LEMO_UPSTREAM_MUX_FAILED:`。
  - 导出：`LEMO_EXPORT_*`。

### 2.1 Windows 适配（全部在上游文件之外）

| # | 上游假设 | Windows 上的做法 |
|---|---|---|
| 1 | 系统 `node` / `npx playwright` | 用 `vendor/python` 里 Playwright 自带的 driver node 运行 `video.mjs` |
| 2 | `setup.sh deps` 在线安装 three / playwright-core | 离线暂存 render root：上游文件 + `node_modules/three` + playwright-core（链接/复制），并做 sha256 校验 |
| 3 | `PATH` 上有 `ffmpeg` | 把 imageio-ffmpeg 自带的二进制别名为 `ffmpeg.exe`，放进 `cache/.../ffmpeg-bin/<size-mtime>` 并加到 `PATH` 最前面 |
| 4 | 有 `ffprobe` | 没有捆绑 ffprobe，改为解析 `ffmpeg -i` 的 stderr（`parseFfmpegProbe`） |
| 5 | `mux.sh` 是 bash 脚本 | 移植为 TS，滤镜和参数逐项对齐，并有单测锁定 |
| 6 | 进程被杀后，`video.mjs` 会自己清理锁文件和 `.<name>_segs-*` 目录 | Windows 上 SIGKILL 不会触发 exit 钩子，所以宿主用 `taskkill /T` 杀掉整棵进程树，再删除锁文件和分段目录 |
| 7 | 宿主环境变量 | 剔除 `NODE_OPTIONS`、`ELECTRON_RUN_AS_NODE`、`PLAYWRIGHT_*`、`RENDER_SLOT*`，避免影响所选的 node 和浏览器 |
| 8 | **`--out` 所在目录路径不长**（实跑时发现） | `video.mjs` 用 `fs.mkdtempSync` 在 `--out` 旁边建分段目录。任务导出目录超过 260 字符时，libuv 的 mkdtemp 在 Windows 上会报 ENOENT（即使系统已开启 LongPathsEnabled，ffmpeg 正常而 node 依然失败）。现在让 `video.mjs` 输出到较短的 `cacheDir/out/v-XXXX/`，完成后再移动到导出目录（`scratchDir`）。集成测试用超过 260 字符的输出目录覆盖了这个情况 |

## 3. 真实模型实跑（2026-11-10）

**运行环境：**

- 隔离的 userData 位于 `.artifacts/real-route-qa/run-20261110-102155`。
- 复制了用户的 config、secrets 和 license，用户本身的 `data.db` 和 `config.json` 都没有改动。
- 通过 CDP 驱动 `window.storydream`。

**运行条件：**

- 配置里的 `claude-sonnet-5-5` 在 moeapi 当前 key 分组下返回 404 `model_not_found`，`gemini-3.1-pro-high` 返回 503。因此隔离配置改用 **`gemini-3.1-pro-preview`**。
- 火山 TTS 的网络链路不稳定（Clash fake-ip；直连真实 IP 失败），多次出现 `ECONNRESET`。
- vllmproxy 生图偶尔返回 Cloudflare 524。

**三条路线的结果：**

| 路线 | 题材 / 风格 | 成片 | 时长 | 视频 | 音频 | 响度（ebur128） |
|---|---|---|---|---|---|---|
| 创意动画 | 城市海绵 / **OPUSCAR 98 `o98-30` 氰版工程蓝图**，16:9，4 镜头 | `deliverables/creative-o98-30-blueprint.mp4` | 16.08 s | h264 1920×1080 24 fps | AAC 48 kHz 256k | **−14.0 LUFS，峰值 −1.2 dBFS**（与 mux.sh 目标一致） |
| 模板动画 | 同题材 / 工程简报板（`briefing-board`），4 镜头 | `deliverables/template-briefing-board.mp4` | 15.46 s | h264 1920×1080 24 fps | AAC 44.1 kHz | −20.7 LUFS，峰值 −6.7 dBFS（模板链路的既有混音，不经过 mux.sh） |
| HTML 动画 | 同题材，4 场景 | `deliverables/html-video.mp4` | 19.96 s | h264 1280×720 24 fps | AAC 44.1 kHz | −20.9 LUFS，峰值 −6.9 dBFS |

- 三条路线都抽帧做了人工查看，联系表在 `deliverables/*-contact.png`。
- 创意动画的产物里，Agent 按上游流程自己写了 `STYLE.md` 和 `TREATMENT.md`，以及 `scenes.js`、`drafting.js`、`paper.js`。

**付费调用（按请求计；对 unknown 节点的重试可能重复计费）：**

| 路线 | 文本模型 | 生图 | 配音 |
|---|---|---|---|
| 创意动画 | 40 次 Agent 轮次请求（38 次成功；`upstream-turn:1` 先后用 claude-sonnet-5-5 得到 404、用 gemini-3.1-pro-high 得到 503，各计 1 次） | 0（Lemo 用代码绘制） | 6 次（4 次成功，2 次 ECONNRESET 结果未知后重试） |
| 模板动画 | 1 次（`plan`） | 9 次（8 次成功，1 次 524 结果未知后重试） | 7 次（4 次成功，3 次结果未知后重试） |
| HTML 动画 | 至少 2 次（`rewrite`、`planning`）【按步骤产物计，未核实是否有内部重试】 | 11 次（`provider-images/*.response.json`） | 第 6 次执行配音步骤才成功；前 5 次失败，每次至少 1 次请求，确切数量被 `HTML_VIDEO_VOICE_FAILED` 掩盖 |
| 连接测试 | 4 次 `testLlmConfig` + 1 次 `/v1/models` | — | — |

**实跑过程中的问题及处理：**

- 创意动画最初失败在 render 节点，原因是 §2.1 第 8 项（MAX_PATH）。修复并重新构建后，用 `resume` 从 render 节点续跑成功；Agent 的 38 轮结果没有重新生成。这同时验证了 v3 的续跑路径。
- 模板动画在 `image:shot-2` 遇到 524，对该节点执行一次 `retry-unknown` 后完成。
- HTML 动画的配音步骤多次失败，`retryTask` 后从配音步骤续跑完成（前面的素材都复用了）。另外发现 HTML 运行器会把底层网络错误统一归一成「HTML video voice step failed.」，不便于排查（HTML 路线本次按约定没有改动，记为后续项）。

## 4. 验证

- **tsc：**`tsconfig.json`、`tsconfig.electron.json`、`tsconfig.scripts.json` 全部通过。
- **相关测试：**15 个文件，438 个用例中 435 个通过。剩下 3 个失败在基线 `8b70b05` 上同样失败：`html-video` 的 2 个 capture contract 用例和 `product-shell-ui` 的 1 个，都不是本次引入的。
- **全量对比：**与基线相比没有新增失败；基线中的 10 个失败已被修复。
- **上游渲染集成测试：**`tests/lemo-upstream-video.integration.test.ts` 用真实 vendored runtime 渲染 1 秒样片、完成混流、测试取消时清理整棵进程树，并覆盖超过 260 字符的输出目录。
