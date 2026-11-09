# StoryDream 代码生成视频底座设计（详细版）

日期：2026-11-09。状态：**设计稿，未改代码。**

依据：
- 本仓库只读审计（渲染/采集/混流、LLM 层/编排/存储两份审计）；
- [代码生成视频生态调研](../research/2026-11-09-code-to-video-landscape.md)；
- HyperFrames 官方文档：[determinism](https://hyperframes.heygen.com/concepts/determinism.md)、[frame adapters](https://hyperframes.heygen.com/concepts/frame-adapters.md)、[engine](https://hyperframes.heygen.com/packages/engine.md)；
- Remotion [Prompt-to-Motion-Graphics 模板](https://www.remotion.dev/docs/ai/ai-saas-template.md)。

文中 `文件:行号` 指当前工作区代码。

---

## 0. 结论

1. **底座不是“再写一个引擎”，而是把现有零件收拢成 6 层，每层只有一个实现、一个契约。** 渲染采集主循环其实已经共用一套（`electron/html-video-renderer.ts`），但还有：
   - 6 套 seek 垫片；
   - 4 处采集循环；
   - round / ceil / floor 三种帧取整混用；
   - 24 / 30 两种 fps 混用；
   - 4 种时长容差；
   - LLM 层 13 处会“搞错”的缺陷：截断检测丢失、JSON 子对象误收、没有空闲超时、发送后仍重试、本地错误被当成 unknown、整文档检查点、换模型丢弃全部付费结果等。
2. **“不搞错”靠三件事，而不是靠提示词**：
   - **唯一事实源**：整数帧时钟、48k 采样时钟、回执先于解析；
   - **硬闸门**：每一步都有确定性校验和错误码，不通过就不往下走，也不会悄悄放行；
   - **契约测试**：同一套测试跑三个引擎；故障注入测试覆盖所有中转站异常；黄金帧测试守住升级。
3. **统一运行时协议直接采用 HyperFrames 的公开协议（`window.__hf = { duration, seek(time) }`），再加上 StoryDream 的扩展**。Remotion 和 Lemo 都写成适配器挂到这个协议上。这样：
   - 默认用 Electron `capturePage` 采集；
   - 以后想换成 `@hyperframes/engine` 的 beginFrame 原子采集，三个引擎都能直接用。
4. **迁移按“绞杀者”方式分步进行**，不一次推翻：先换 LLM 层和回执（能直接消除大部分实测失败），再统一采集和协议，然后统一混流，最后上新的分镜数据和执行器。旧引擎只读兼容。

---

## 1. 现状盘点：哪些能留，哪些必须换

### 1.1 渲染 / 采集 / 混流

| 现状 | 证据 | 处理 |
|---|---|---|
| 三个引擎导出都走 `renderHtmlVideo`：离屏隐藏窗口 + file:// + 每帧 seek + 两次 rAF + capturePage → JPEG → Python sidecar FFmpeg | `html-video-renderer.ts:354-366,225-232` | **保留主干**，升级成 CaptureHost |
| 就绪判定：字体 / 图片 / 视频 trim | `html-video-scene-ready.ts:8-48` | 保留 |
| seek 后等媒体 seeked 和两次 rAF | `html-video-frame-seek.ts:5-30` | 保留，但改用公开 API |
| 帧流：背压 32 帧、先写 .tmp 再原子 rename | `html-video-frame-stream.ts:27-47` | 保留 |
| GPU 崩溃后重建窗口续采 | `html-video-capture-recovery.ts` | 保留 |
| 累计 round 分配整数帧 | `html-video.ts:91-110`；sidecar 里有镜像实现 `:1432-1443` | 保留，作为**唯一**分帧函数 |
| seek 垫片 6 套 | `html-video.ts:1116`、`director-render.ts:1325`（用 performance.now 播放）、`short-video-render.ts:108`、`runtime.tsx:57`、`lemo-native-runtime.ts:65`、upstream 直接调 render | **收拢**成 1 个协议、3 个适配器 |
| 采集循环 4 处 | `renderHtmlVideo`、`reviewHtmlAnimationFrames`、`capturePreview`、`lemo-upstream-renderer.ts` | **收拢**成 1 个 CaptureHost |
| 帧取整混用 | round（`html-video.ts:99`）、ceil（`runtime.tsx:40`、upstream`:39`）、floor（`runtime.tsx:48`） | 全部改成整数帧，不再从秒换算 |
| fps 混用 | 渲染 24（`html-video-runtime.ts:35`）、预览 33ms 步进 1/30 秒（`html-video.ts:1171`）、upstream 30 | 项目级唯一 fps |
| 隔离弱 | 主循环只靠页面 CSP，且 HF 的 CSP 允许 `file:`；默认 session，没有网络白名单；Storybound 预览 iframe 没加 sandbox | 照搬 upstream 的做法：私有 partition、白名单、拒绝权限 |
| 没有确定性虚拟化 | 全仓库没有 Date / random / rAF shim；HF runtime 内部有 9 处 `Date.now` | 注入确定性 shim |
| 依赖 HF 私有 API | `__player.renderSeek`、`__hfWaitForSeekCompletion`；0.8.40 的握手补丁 `html-video-runtime.ts:996-1024` | 升级 0.9.26 时改用公开协议 |
| 多次重编码 | 硬切、转场、封面、补时长各重编一次；封面 scale 没指定矩阵（可能变成 BT.601） | 改为“一次编码 + concat copy” |
| 音频 44.1k / 48k 混用，BGM 没有闪避，响度 −16 | sidecar `:1587-1644,1259-1279,1753-1782` | 整条时间线在 48k 下渲成一条音轨 |
| 时长容差 4 种 | `director-render.ts:850`、`html-video-runtime.ts:2574`、`short-video-renderer.ts:31`、`main.ts:3336` | 统一为“1 帧 + AAC 首帧延迟” |

### 1.2 LLM 层

| 缺陷 | 证据 | 后果 |
|---|---|---|
| Chat 流删掉了 `stream_options`，永远拿不到 usage 和 reasoning_tokens | `llm-provider.ts:581` | 无法判断推理 token 是否吃掉了输出预算 |
| openai / responses 的 JSON 走非流式，结果丢掉 finishReason 和 usage；解析失败时不带原文 | `:563,:160-175,:356-358` | 截断无法识别；付费回复被标成 unknown，原文丢失 |
| `parseLlmJsonContent` 在每个 `{` / `[` 位置都尝试解析 | `:1255-1262` | 外层被截断时，可能把内层子对象当成结果“成功”返回 |
| `max_tokens` 和 `max_completion_tokens` 同时发送；65536 超过部分模型上限 | `:578,:555-557,:636` | 中转返回 400 |
| 没有一等的推理控制；thinking 不校验 budget < max_tokens | `:599-601,:617-620` | 推理 token 挤掉代码输出 |
| 只有总超时，没有空闲超时 | `network-policy.ts:264-281` | CF 类中转约 100 秒就返回 524，上游可能仍在计费 |
| network-policy 读完整个 body 才回调 chunk | `network-policy.ts:323` | 名义上是流式，实际不是 |
| Text 非流式对任何异常都重试，包括发送后超时 | `:463-468,:512` | **重复计费** |
| 错误分类靠正则匹配消息文字 | `llm-provider-error.ts:2-4` | 容易分错 |
| 有回执，但只在解析成功后写；`result.json` 存两份完整文档 | `lemo-plan-receipt.ts:10-28`；`main.ts:3215-3223`（910 个文件，共 1.45GB） | 失败时没有回执；磁盘膨胀 |
| **最正确的现成模式**：`submitted.json`（独占创建）→ `response.json` → 再解析 | `lemo-upstream-agent.ts:206-237` | **推广到所有调用** |
| 可保留：`LlmTextStream`、`llm-multimodal`（三种协议都支持 ≤24 张图）、generation-authorization、`request-ledger` 的思路 | — | 保留 |

### 1.3 编排与存储

| 缺陷 | 证据 |
|---|---|
| 每个项目只有一个串行执行者，每次取第一个就绪节点 | `vox-production-service.ts:34,289` |
| 任一节点失败，整个 run 失败并停止 | `:340-355` |
| 认领节点和完成节点都会保存整份文档 | `:295-296,317-318` |
| unknown 判定过宽，ZodError 等本地错误也算 unknown | `:341`；`vox-production-runtime.ts:163` |
| runtimeIdentity 包含所有服务商，换 LLM 会作废已付费的图片和配音；三处判断不一致 | `main.ts:3253`；service `:86,:195,:229` |
| 取消只能在节点之间生效，在途请求无法中止 | `:29,:212-216` |
| sql.js 每次提交都整库导出两次并 fsync；每次保存跑 3 遍完整 zod | `storage.ts:909-949,2732-2772` |
| **数据库损坏时改名为 .malformed，然后静默新建空库** | `storage.ts:879-894` |

---

## 2. 底座分层总览

```
L6 生成层（不属于底座，建在底座之上）：T1 模板 / T2 场景代码 / T3 Agent
──────────────────────────────────────────────────────────────────────────────
L5 校验闸门 Gates      G0 分镜 → G1 时间轴 → G2 静态代码 → G3 引擎 lint → G4 预跑帧 → G5 成片帧 → G6 媒体
L4 场景运行时          SceneRuntime 协议（__hf 超集）+ 3 个适配器 + 确定性 shim + 代码脚手架
L3 VideoSpec/Timeline  唯一数据模型：整数帧、48k 采样、词级 cue、风格引用
L2 任务编排            节点表 + 资源池并行 + 错误分类 + 回执 + 预算 + 取消
L1 模型调用            ModelProfile + call()：流式、空闲超时、截断检测、推理控制、回执优先
L0 存储与产物          磁盘按 run/节点/尝试存放 + 内容寻址；DB 只存索引；可靠写入
横切：CaptureHost（采集）、AudioTimeline（音频）、Encoder（编码与合成）——L4/L5 共用
```

**依赖方向**：上层只能调用下层。L4、L5 完全不知道当前用的是什么模型；L1 完全不知道当前用的是哪个引擎。

---

## 3. L0 存储与产物

### 3.1 目录结构
```
<userData>/runs/<runId>/
  run.json                         # 只存元数据和版本，不存大字段
  nodes/<nodeId>/<attempt>/
    intent.json                    # 发送前独占创建（wx）：请求摘要、幂等键、profile、预算
    partial.txt                    # 流式边收边追加，崩溃后可查
    receipt.json                   # 服务商回复的原文 + 规范化的 finishReason + usage，**解析之前就写**
    artifact.*                     # 解析和校验通过的产物（代码 / 图片 / 音频 / 帧）
    error.json                     # 错误分类码、信息、可否重试
<userData>/cas/sha256/<ab>/<hash>  # 内容寻址：场景代码、图片、音频；按引用计数清理
```
- **DB 只存索引**：run 表、节点表（状态、哈希、指针）。像 `creativeFilms.source` / `compiled` / `attempts` 这类大字段，全部移到磁盘。
- `result.json` 不再存 `{before, after}` 两份完整文档，只存节点自己的产物指针。

### 3.2 写入可靠性
- 所有文件：写 `.tmp` → fsync → rename（复用 `encodeHtmlFrames` 的原子写法）。
- **去掉“损坏 → 改名 → 新建空库”**：改为损坏时进入只读恢复模式，提示用户并保留原文件，绝不静默清空。
- 加跨进程文件锁（锁文件 + PID）。现在只有 Electron 单实例锁，防不住脚本或旧版程序直接写库。
- 中期：大字段移出后，sql.js 整库写盘的压力会大幅下降（data.db 现在 70MB）；再评估是否换成 better-sqlite3 + WAL（需要为 Electron 41 重新编译原生模块，有一定风险，作为独立任务）。

---

## 4. L1 模型调用层

### 4.1 ModelProfile（能力档案）
```ts
type ModelProfile = {
  id: string; protocol: 'chat' | 'responses' | 'messages';
  baseUrl: string; model: string;
  limits: {
    contextTokens: number;
    maxOutputTokens: number;                 // 硬上限，请求值不得超过
    tokenField: 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens';  // 只发一个
  };
  reasoning: {
    kind: 'none' | 'effort' | 'anthropic-budget' | 'gemini-budget';
    // 每个角色的默认推理强度；代码角色默认 low 或关闭
    perRole: Record<'plan' | 'code' | 'repair' | 'critic', 'off' | 'low' | 'medium' | 'high'>;
  };
  features: {
    streaming: boolean; streamUsage: boolean;        // 是否接受 stream_options.include_usage
    jsonSchema: boolean; jsonObject: boolean; tools: boolean;
    vision: boolean; maxImages: number;
  };
  transport: {
    firstByteTimeoutMs: number;               // 例如 90s
    idleTimeoutMs: number;                    // 块间空闲，例如 45s（小于 CF 的约 100s）
    totalTimeoutMs: number;                   // 只作兜底，例如 20min
  };
  source: 'builtin' | 'probe' | 'user'; probedAt?: string;
};
```
- **来源**：内置常见模型的默认值 → 一次低成本探测（短流式请求，检查 usage、推理字段、JSON 模式、看图）→ 用户可以覆盖。
- **角色路由**：`roles: { plan, code, repair, critic } → profileId`，未配置的角色用默认模型。

### 4.2 统一调用 `call()`
```ts
call(profile, role, request: {
  messages; images?; output: { kind: 'text' | 'json'; schema?: ZodSchema; endMarker?: string };
  maxOutputTokens?; idempotencyKey: string; budget: Budget; signal: AbortSignal;
}): Promise<CallResult>
```
执行顺序（**顺序本身就是防错机制**）：
1. **预检**：
   - 请求的 maxOutputTokens 取 `min(请求值, profile 上限)`；
   - 推理预算按角色映射：effort → `reasoning_effort` / `reasoning.effort`；anthropic → `thinking.budget_tokens`，并强制 `budget + 预期正文 < max_tokens`，不满足就关闭 thinking；
   - token 字段只发一个；
   - 预算不够直接拒绝，不发送。
2. **独占写 `intent.json`**。如果文件已存在，说明之前发过：不得自动重发，先查回执。
3. **一律流式发送**，JSON 也走流式：
   - Chat 带 `stream_options.include_usage`（profile 不支持时降级）；
   - 首字节超时、块间空闲超时、总超时分别计时；
   - 每收到一块就追加写 `partial.txt`；
   - `network-policy` 改为真正的增量回调，不再读完整个 body。
4. **写 `receipt.json`**：原文、规范化的 `finishReason`（`stop | length | content_filter | tool | error | unknown`）、usage（输入 / 输出 / 推理 / 缓存）。
5. **截断判定**，满足任一条件即为 `TRUNCATED`：
   - `finishReason=length`；
   - 缺少 endMarker；
   - 代码括号或 JSON 不闭合；
   - 推理 token ≥ 90% 而正文为空或很短。

   截断时**不进入修复**，交给上层拆小或调整预算。
6. **严格解析**：只接受“去掉代码围栏后的完整内容”。**禁止在任意 `{` 位置扫描子对象**（修掉 `:1255` 的问题）。
7. **schema 校验**：失败时可以免费重放回执，而不是重新付费请求。

### 4.3 错误分类（取代正则判断）
| 码 | 含义 | 节点状态 | 自动重试 |
|---|---|---|---|
| `NOT_SUBMITTED` | 连接没建立、DNS 失败、预检拒绝 | failed | ✅（指数退避，最多 2 次） |
| `PROVIDER_REJECTED` | 收到 HTTP 4xx，或 429 / 5xx 且明确没有生成内容 | failed | 429/503 可以退避重试；400/401/403 不重试 |
| `TRANSPORT_UNKNOWN` | 已发送，但没收到完整回复（socket 断开、524、空闲超时） | **unknown** | ❌。需人工确认，或查回执和服务商账单 |
| `TRUNCATED` | 收到回复但被截断 | failed（带原因） | ❌。上层拆小或调预算后，作为新请求重做 |
| `CONTENT_FILTERED` | 被内容审核拦截 | failed | ❌。上层改写后重做 |
| `LOCAL_VALIDATION` | 回执完好，但解析或校验失败 | failed | 重放回执免费；修复走 L6 |
| `LOCAL_INFRA` | 本地磁盘、渲染器等出错 | failed | ✅ |

**铁律：只有 `TRANSPORT_UNKNOWN` 能进入 unknown。服务商已经返回之后发生的任何本地异常，一律 failed，并且产物先落盘。**

---

## 5. L2 任务编排

### 5.1 节点表（DB 单行增量更新）
```sql
run_nodes(run_id, node_id, kind, status, attempt, input_hash, idempotency_key,
          pool, deps_json, error_code, artifact_ref, cost_estimate, cost_actual,
          updated_at, PRIMARY KEY(run_id, node_id))
```
- `idempotency_key = sha256(runId, nodeId, inputHash, attempt)`，写入 intent，用于去重。
- `inputHash` 只包含**影响该节点产物的输入**。LLM 节点的输入包含 profile 哈希；图片和配音节点不包含 LLM 档案。**换模型只会作废 LLM 节点**，修掉 `main.ts:3253`。

### 5.2 状态机
```
pending → ready → submitting → submitted → completed
                     │             ├→ failed(code)
                     │             └→ unknown（只能来自 TRANSPORT_UNKNOWN）
                     └→ failed(NOT_SUBMITTED)
重启时：submitting → 检查 intent / receipt：有回执则补完；没有 intent 则回到 ready；有 intent 没回执则 unknown
```

### 5.3 调度
- **资源池**：`llm`（默认 3）、`image`（按服务商并发）、`tts`（4）、`render`（1–2 个窗口）、`local`（CPU 核数）。
- **失败只阻塞下游**：同级的其它场景继续执行。
- **降级边**：场景代码节点失败后自动接上模板节点。
- **AbortSignal 贯穿**：从调度器一直传到 fetch 和采集，取消时在途请求立即中止（发送后中止的记为 unknown）。
- **预算**：
  - 启动前展示估算（节点数 × 单价）；
  - 运行中累计实际花费（usage × 单价）；
  - 达到上限暂停，不是失败。
- **样板优先**：先跑 1 个样板场景的全链路，用户确认后再批量执行。

---

## 6. L3 VideoSpec / Timeline（唯一数据模型）

```ts
type VideoSpecV1 = {
  version: 1;
  canvas: { width: number; height: number; fps: { num: number; den: number } };  // 创建时锁定
  audio: { sampleRate: 48000; loudnessTarget: -14 | -16 };
  style: { styleId: string; packVersion: string };                                // 唯一风格来源
  scenes: Array<{
    id: string;
    startFrame: number; durationFrames: number;       // 只用整数帧
    narration: { text: string; clipRef?: string; startSample?: number; words?: Array<{ w: string; startMs: number; endMs: number }> };
    intent: string; layout?: { anchors?: string[] };
    engine: 'hyperframes' | 'remotion' | 'lemo';
    tier: 'template' | 'code' | 'agent';
    template?: { id: string; params: unknown };
    code?: { ref: string; status: 'draft' | 'gated' | 'failed' };
    fallbackTemplate: { id: string; params: unknown };  // 每个场景都必须有兜底
  }>;
  music?: { ref: string; gainDb: number; ducking: boolean };
};
```

**时间轴的生成规则（音频优先）**：
1. 结构规划得到场景和旁白文本（清掉 Markdown，标题行不进旁白）。
2. 对每个场景做 TTS，用 ffprobe 测出 `durationSamples`；如果有词级时间（TTS 自带或 STT 对齐）就一起记录。
3. `durationFrames = ceil((旁白样本数 + 前后留白) × fps / 48000)`，并钳在每镜的最小和最大值之间。超过最大值就**在付费渲染之前**拆分场景。
4. `startFrame` 依次累加。全局只用 `allocateFrameCounts`（即现有的 `html-video.ts:91-110`）这一个分帧函数。
5. 词级 cue 只在这里换算一次，从 ms 换成帧号，之后所有地方都只用帧号。

**schema**：zod 定义、带版本号、提供迁移函数；从旧的 editorial-collage 文档单向转换过来。

---

## 7. L4 场景运行时

### 7.1 SceneRuntime 协议 v1（HyperFrames 公开协议的超集）
```ts
// 页面中由宿主外壳提供，生成的代码碰不到
window.__hf = { duration: number /* 秒 */, seek(time: number): Promise<void> | void };  // 兼容 @hyperframes/engine
window.__sd = {
  version: 1,
  fps: { num, den }, width, height, durationFrames,
  ready(): Promise<void>,                       // 字体、图片、视频全部就绪
  seekFrame(n: number): Promise<{ frame: number }>,   // 必须回传同一个 n，宿主核对后才截图
  texts?(n: number): Array<{ text: string; box: [x, y, w, h]; size: number }>,   // 用于版面和阅读检查
  events?(): Array<{ frame: number; kind: string }>,                              // 声音事件（可选）
};
```
**适配器契约**（直接采用 HF FrameAdapter 的规则）：
- 帧数有限且非负；
- 任意顺序 seek，结果相同；
- 同一帧重复 seek，结果相同；
- 不使用挂钟和未设种子的随机数；
- 截图之前所有异步工作都已完成；
- `destroy` 释放资源。

### 7.2 三个适配器
| 适配器 | 实现 |
|---|---|
| **HyperFrames 0.9** | 使用 HF 公开的 `__hf.seek` 或 `createGSAPFrameAdapter`，不再依赖私有的 `__player.renderSeek` / `__hfWaitForSeekCompletion`；删掉 0.8.40 的握手补丁；字幕同步并入 seekFrame |
| **Remotion 4.0.542** | 页内 Player，`seekFrame(n)` 直接 `seekTo(n)`（整数帧，**不再从秒换算**），然后 `flushSync` + 两次 rAF + `fonts.ready` + `image.decode`；保留现有的 TS 白名单编译（`vox-animation-runtime.ts:9-45`） |
| **Lemo** | `seekFrame(n)` 调用 `render(n * den / num)`；保留 canvas save/restore 守卫和绘字追踪；`TEXTS` 映射到 `texts(n)`；READY / DUR 由外壳检查，同时满足 `__hf.duration` |

### 7.3 确定性 shim（外壳在任何用户脚本之前注入）
- `Date.now` / `performance.now` / `new Date()` 返回**当前帧时间**（按项目起点换算）。
- `Math.random` 改为按场景 ID 设种子的 PRNG（例如 mulberry32）。
- `requestAnimationFrame` / `setTimeout` / `setInterval`：在 seekFrame 内由宿主统一冲刷，不挂在真实时钟上。
- `fetch` / `XMLHttpRequest` / `WebSocket` 一律拒绝；资源只能通过 `sd-asset://` 预加载。
- 风险：HF runtime 内部有 9 处 `Date.now`，shim 可能影响它的就绪判断。**处理方式**：shim 只作用于“场景代码作用域”（用户脚本先包一层作用域再执行，或者 HF runtime 先拿到原生引用），用契约测试验证。

### 7.4 代码脚手架（模型写什么、宿主包什么）
| 引擎 | 模型输出（只写这一部分） | 宿主包装 |
|---|---|---|
| HyperFrames | JSON：`{ html: 片段, css: 作用域样式, timeline: "function (tl, ctx) { ... }" }` | 生成完整 composition，`gsap.timeline({ paused: true })` 注册到 `__timelines`，注入主题 token、字幕层、外壳协议 |
| Remotion | `export default function Scene({ ctx }) { ... }` 的函数体，只能用注入的 `useCurrentFrame / interpolate / spring / Img / AbsoluteFill / theme` | Babel 即时编译（参考 Remotion 官方模板）+ 白名单 AST + 外壳 |
| Lemo | `scene(ctx, t)` 的函数体，只能调用风格引擎包的 API（`ctx.engine.*`） | 外壳提供 canvas、引擎包、协议 |

所有输出末尾都必须有 `// END_SCENE`，缺失即判为截断。单个场景输出控制在 150–250 行以内。

---

## 8. 横切：CaptureHost / AudioTimeline / Encoder

### 8.1 CaptureHost（唯一的采集实现，取代 4 处循环）
- **窗口**：offscreen、`backgroundThrottling:false`、`sandbox`、`contextIsolation`、`nodeIntegration:false`；**每次渲染使用私有 partition**；`webRequest` 只放行 `sd-render://` 和 `sd-asset://`；拒绝所有权限请求（照搬 `lemo-upstream-renderer.ts:76-85`）。
- **加载**：自定义协议 `sd-render://<runId>/<sceneId>/`，不再用 `file://`。CSP 可以去掉 `file:`，只允许 self 和 nonce 脚本。
- **尺寸**：固定 DPR=1（`webContents.setZoomFactor(1)`，窗口按画布尺寸创建），采到的尺寸必须严格等于画布。现在的做法是悄悄缩放（`html-video-renderer.ts:387-407`），改为不一致就报错，或者显式记录。
- **帧循环**：`await __sd.ready()` → 对每一帧执行 `{ frame } = await __sd.seekFrame(n)`，断言 `frame === n` → `capturePage` → 校验尺寸 → 推入帧流（背压 32）。
- **并行**：去掉全局锁，按场景或帧区间开 N 个窗口（默认 2，按内存调整）。确定性保证了分段之间可以拼接。
- **恢复**：沿用 `withHtmlGraphicsRecovery`，从最后确认的帧继续采。
- **共用**：G4 预跑（3 帧）、G5 抽帧审查、预览缩略图都调用同一个 CaptureHost，只是帧列表不同。
- **可选后端**：同一套协议之后可以切换到 `@hyperframes/engine`（chrome-headless-shell + beginFrame 原子截帧）。

### 8.2 AudioTimeline（整条时间线一次性渲染）
- 全程使用 48kHz float 采样。旁白片段按 `startSample` 放置；BGM 根据旁白包络做侧链闪避（ducking）；音效按 events 放置。
- 两遍 loudnorm 到 `loudnessTarget`（默认 −14 LUFS，真峰值 −1.5 dBTP），输出一条 WAV，最后**只编码一次 AAC**。
- 所有时间都用采样数表示，和帧号换算时使用有理数 `frame × 48000 × den / num`，不使用浮点秒。

### 8.3 Encoder（只编码一次）
- **方案**：每个场景片段用相同参数编码（libx264、crf 18、preset medium、yuv420p、`-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709`、固定 GOP、cfr），然后用 concat demuxer 加 `-c copy` 拼接。
- **转场**放在渲染层完成（在 DOM 或 canvas 里交叉淡化，采集时就已经是转场后的画面），**不用 ffmpeg xfade**，因此不需要重编码。封面也按同一条 RGB→YUV 路径编码。
- **最后合成**：视频直接复制，音频用 AAC，加 `+faststart`。可以同时输出 SRT 字幕文件；字幕默认仍然在 DOM 里烧录。
- **帧格式**：成片采集建议改为 PNG 或原始 BGRA 管道，评估性能后再定（现在是 JPEG q92 再经 x264，等于两次有损压缩）；预览和审查继续用 JPEG。

---

## 9. L5 校验闸门（每道都是确定性的，都有错误码）

| 闸门 | 检查内容 | 失败处理 |
|---|---|---|
| **G0 分镜** | zod 校验；每个场景都有兜底模板；styleId 存在；旁白不含 Markdown | 阻止生成，在界面上标出问题 |
| **G1 时间轴** | 每个场景帧数在最小和最大之间；旁白样本数不超过场景时长；总时长在档位范围内；阅读速度（中文 ≤ 4.5 字/秒 + 1.5 秒） | 付费渲染前自动拆分或提示压缩 |
| **G2 静态代码** | 结束标记、语法 AST；禁止 import / `Date` / `random` / 网络 / `eval` / 越权 DOM；必须有导出；长度上限 | 判为截断 → 拆小；违规 → 局部修复 |
| **G3 引擎 lint** | HF 用 `@hyperframes/lint`；Remotion 编译；Lemo 用 `validateLemoFile` | 局部修复（只发报错行附近的代码） |
| **G4 预跑** | CaptureHost 采第 0 帧、中间帧、最后一帧：无运行时异常、非空非黑、`texts()` 都在安全区内、字号 ≥ 短边 / 45、文字不重叠、`seekFrame` 两次结果哈希相同（确定性抽检） | 局部修复，最多 3 次 → 降级为模板 |
| **G5 成片帧** | 全片抽帧拼联系表：黑场、冻结帧、字幕和 cue 对位；可选 VLM 评审（6×6 锚点给出修改建议），最多 1–2 轮 | 只重做出问题的场景 |
| **G6 媒体** | ffprobe：时长误差 ≤ 1 帧 + AAC 首帧延迟、帧率、分辨率、色彩标签、音频 48k、实测响度在目标 ±1 LU 内、非静音 | 阻止导出，给出错误码 |

**原则**：模型（VLM）只给建议，**放行与否只看确定性闸门**。

---

## 10. “不搞错”的保障体系

### 10.1 不变式清单（每条都要有测试）
| # | 不变式 | 现有测试 | 需要新增 |
|---|---|---|---|
| I1 | 全局只有一个整数帧时钟；全工程只有一个分帧函数 | html-video-frame-clock | 在 Remotion 和 Lemo 适配器上跑同一组用例 |
| I2 | `seekFrame(n)` 回传 n；任意顺序、重复 seek 结果哈希相同 | frame-seek（部分） | **适配器契约测试**（三个引擎通用） |
| I3 | 截图前已就绪（字体、图片、视频） | scene-ready | — |
| I4 | 帧连续、不跳号，有背压，崩溃续采不重帧 | frame-stream、capture-recovery | — |
| I5 | 场景代码里没有挂钟、随机数和网络 | — | shim 测试 + G2 静态规则测试 |
| I6 | 采集尺寸等于画布，DPR=1 | — | 新增 |
| I7 | 全链路 tv / bt709 色彩标签，封面也一样 | color-range（只覆盖单场景） | 多场景、封面、合成路径 |
| I8 | 音频 48k，响度达标，片段按采样对位 | storybound-audio-clips / music-sync | 响度和采样率一致性 |
| I9 | 成片时长误差 ≤ 1 帧 + AAC 首帧延迟 | — | 新增 |
| I10 | 回执先于解析；服务商返回后的本地错误不会进入 unknown | — | **故障注入测试** |
| I11 | 发送之后不会自动重发 | — | 故障注入测试 |
| I12 | 换 LLM 档案不会作废图片和配音节点 | — | 编排测试 |
| I13 | 数据库损坏不会被静默清空 | — | 存储测试 |

### 10.2 适配器契约测试
每个引擎准备 3 个夹具场景（静态文字、GSAP 或 spring 动画、canvas 粒子），跑同一套测试：
- duration 正确；
- `ready` 能完成；
- 随机顺序 seek 后像素哈希一致；
- `texts()` 坐标正确；
- 注入 shim 后 `Date.now` 返回帧时间。

**升级 HyperFrames、Remotion、three.js 时必须全部通过。**

### 10.3 黄金帧测试
每个引擎各取 1 个夹具，渲染出 2 秒视频后取帧，做感知哈希（允许 1–2 位差异）。同时检查 ffprobe 结果（色彩、帧数、时长、响度）。用来发现升级后的意外变化。

### 10.4 故障注入（本地模拟中转站）
在本机起一个假服务，按场景返回下面这些情况，断言每种都能落到正确的错误码和节点状态：
- 100 秒后返回 524；
- 流式传输中途断开 socket；
- 只有推理、正文为空，且 `finish=length`；
- `finish=length` 并且 JSON 被截断；
- 返回 200 但没有图片，或者只回一段文字；
- JSON 包在代码围栏里；
- JSON 外面多了一段文字；
- 429 带 retry-after；
- 400 提示 max_tokens 过大；
- 返回慢于空闲超时；
- 重复的 intent。

### 10.5 编排的性质测试
随机注入各类失败，断言下面几点始终成立：
- 已付费的请求从不会被自动重发；
- 回执从不丢失；
- 同级场景继续执行；
- 预算从不超支；
- 取消之后没有残留的在途请求。

### 10.6 真实回归集（人工触发，有预算）
准备 30 个固定题目，按 3 个模型 × 3 个引擎组合运行，记录单场景通过率、整片完成率、修复次数、token、耗时和费用。每次换模型、改提示词或升级依赖都跑一遍。

---

## 11. 迁移顺序（绞杀者模式，每一步都能单独上线）

| 步骤 | 内容 | 立刻带来的效果 | 风险控制 |
|---|---|---|---|
| **S0** | 快照分支；修好 6 项失败测试；依赖升级到最新（先不改行为） | 基线 | 全部测试必须通过 |
| **S1** | L1 `call()` + ModelProfile + 回执 + 错误分类，先替换现有 Lemo、VOX、plan 的调用 | 截断被正确识别；不再重复计费；不再出现“本地错误变 unknown”；中转 524 有空闲超时兜底 | 故障注入测试 |
| **S2** | L0 磁盘产物 + 去掉“损坏 → 空库” + 去掉整文档 `result.json` | 磁盘不再膨胀（现在 1.45GB），数据库更安全 | 存储测试 |
| **S3** | SceneRuntime 协议 + CaptureHost，先接在 `renderHtmlVideo` 下面，逐个替换 6 套垫片；HF 0.9 改用公开 seek | 预览和导出一致；有确定性保证；隔离加强 | 适配器契约测试 + 黄金帧测试 |
| **S4** | AudioTimeline + Encoder 一次编码 | 色彩一致、音质更好、导出更快 | 不变式 I7–I9 |
| **S5** | L3 VideoSpec + L2 新执行器（只用于新项目）+ G0–G6 | 场景并行；失败互相隔离；先配音后分镜 | 编排性质测试 |
| **S6** | 在底座上搭 L6：T1 模板 → T2 场景代码 → T3 Agent | 不同模型都能出片 | 真实回归集 |

旧项目继续走旧路径（只读兼容）。新项目走新管线。新管线稳定两个版本后，再删除旧代码。

---

## 12. 待确认的设计决策
1. **项目 fps**：统一用 30（HF 和社交平台的主流），还是保持 24（Lemo 和现有渲染）？建议创建项目时让用户在 24 和 30 里二选一，默认 30，之后锁定。
2. **默认响度**：−14 LUFS（主流短视频平台、Lemo）还是 −16（现有）？建议 −14。
3. **成片采集的帧格式**：PNG 或原始 BGRA（无损，较慢）还是 JPEG q95（较快）？建议先用基准测试决定。
4. **存储**：先把大字段移出，在 sql.js 上继续用；better-sqlite3 作为独立任务评估。
5. **确定性 shim 的作用范围**：只作用于场景代码，还是整个页面（会影响 HF runtime）？建议只作用于场景代码，用契约测试验证。

---

## 13. 可行性核对（2026-11-09 实测，取代上文与之冲突的表述）

### 13.1 已核实可行
| 项 | 证据 | 结论 |
|---|---|---|
| HF 0.9.26 继续兼容现有导入 | `@hyperframes/core@0.9.26` 的 exports 里仍有 `./compiler/html-document` 和 `./runtime/protocol`（exports 从 66 个增加到 105 个） | ✅ 升级不会改坏导入 |
| HF 的 seek 接口 | 0.9.26 的 runtime IIFE 里仍有 `renderSeek`（7 处）和 `__hfWaitForSeekCompletion`（3 处），和 0.8.40 一样 | ✅ 风险比 §1 说的低；但 0.8.40 的握手补丁仍要回归验证 |
| HF 的页面协议 | `@hyperframes/engine@0.9.26` 的 types.d.ts 定义了 `interface HfProtocol { duration; seek(time, options?): void; media?; transitions?; clipWindow? }`，注释写着“任何想被渲染成视频的页面都要暴露 window.__hf” | ✅ 外壳实现 `__hf` 后，以后可以直接换用 engine。**更正**：`__hf.seek` 是 engine 一侧的页面契约，不是 HF 创作 runtime 自带的。HF 场景的适配器继续使用 `__player.renderSeek` + `__hfWaitForSeekCompletion`，由外壳把它包装成 `__hf` / `__sd` |
| 升级体积 | core 4.0MB、player 0.5MB、lint 0.7MB、parsers 0.8MB、studio-server 0.6MB（0.9 新增的依赖） | ✅ 约 10MB |
| FFmpeg 能力 | 内置 `imageio_ffmpeg` 的 ffmpeg 7.1 essentials（gyan），带 `sidechaincompress`、`loudnorm`、`ebur128`、`zscale`、`colorspace`、`xfade`、`acrossfade`，以及 libx264、h264_nvenc / qsv / amf | ✅ §8 的闪避、响度、色彩、硬件编码都不需要换二进制 |
| 色彩修正有现成参数 | engine 导出 `SDR_CAPTURE_TO_BT709_FILTER = scale=in_color_matrix=bt601:in_range=pc…,format=gbrp,scale=out_color_matrix=bt709:out_range=tv…,setparams=…bt709…range=tv` | ✅ 可以直接照用（Apache-2.0，需署名） |
| 许可 | HyperFrames：仓库和 npm 包都是 Apache-2.0；Remotion：用户确认 ≤3 人，免费 | ✅ |

### 13.2 实测问题（证明底座确实需要）
| 项 | 实测结果 |
|---|---|
| 成片色彩 | 最近 3 支导出（10-29 两支、08-06 一支）都是 `yuvj420p(pc, bt470bg)`，也就是**全范围加 BT.601 标签**。和 §1 里“场景段写了 tv/bt709”的说法不一致，**最终文件实际是错的**，在播放器和平台上会出现发灰或偏色 |
| 成片响度 | 两支分别是 −17.2 LUFS 和 **−26.4 LUFS**（真峰值 −10 dBTP），相差 9 LU；−26 在短视频平台上明显偏小声 |
| 音频采样率 | 都是 44.1kHz |
| 渲染速度 | 一个 12 秒、1080p24 的场景（288 帧），从写出 scene HTML（02:13:44）到出 mp4（02:14:53）共 69 秒，**约 4.2 帧/秒，是实时的 5.75 倍**。60 秒成片串行约 5–6 分钟 |
| HF runtime 自己使用挂钟 | 0.9.26 的 runtime 里有 `performance.now` 23 处（0.8.40 只有 1 处）、`Date.now` 13 处 | ⇒ **确定性 shim 只能作用于场景代码作用域**；全局替换会破坏 HF 内部的就绪和媒体时钟（落实决策 5） |

### 13.3 不可行或需要修改的点
| 原设计 | 问题 | 修改 |
|---|---|---|
| 成片帧改为 PNG 落盘 | 1080p 的 PNG 每帧约 2–3MB，60 秒×24fps 约 3–4GB；C 盘只剩 4.0GB | **不落盘**：原始 BGRA 通过管道直接送进 ffmpeg stdin（每秒 24 帧约 200MB/s，内存带宽足够）；或者保留 JPEG q95。决策 3 改为“管道或 JPEG，二选一，用基准测试决定” |
| 默认就上 beginFrame（`@hyperframes/engine` / `producer`） | 这两个包依赖 puppeteer，要额外下载约 150–300MB 的 Chrome | 继续推迟，先用 Electron capturePage |
| 直接升级依赖 | **I 盘只剩 0.7GB**（之前是 7.2GB），重装 node_modules 会失败 | S0 之前先清理：`result.json` 快照约 1.45GB（在 C 盘，先确认可删范围）、包管理器缓存、构建产物；或者把仓库挪到空间更大的盘 |
| 生成代码默认用 GSAP | GSAP 3.13 以后改为 Webflow “Standard no charge” 许可，**禁止用于“让用户免写代码就能做视觉动画、与 Webflow 竞争”的工具**。现在打包的 3.12.5 适用旧的 GreenSock 标准许可（向多个终端用户收费的产品，原本要求 Business 会员）。StoryDream 处在灰色地带 | **待法务确认**。缓解办法：生成的场景代码改用 HF 同样支持的 WAAPI / CSS 动画 / Anime.js（MIT）；只在宿主内部模板里保留 GSAP，或者干脆移除 |

### 13.4 尚未核实（需要小额真实请求或回归集才能确定）
- 中转站（moeapi / hetune）是否接受 `stream_options.include_usage` 和 `reasoning_effort` / thinking，是否会在 100 秒左右断开：需要用“模型测试”做一次探测，每个档案约几分钱。
- 各模型在 T2 场景代码上的一次通过率和修复后通过率：文献数据（TEA：o3-mini 93.8%、Claude 3.5 Sonnet 2.1%）是旧模型、旧框架，**不能直接套用**，必须用回归集实测。
- 多开采集窗口的加速比：受 GPU 和内存限制，预计 2 个窗口约 1.6–1.8 倍，待测。

### 13.5 三条路线的定位（2026-11-09 补充，取代 §7.2 里关于 Lemo 的表述）
- **Lemo = 创意动画，整片由导演型 agent 完成**：走 [Lemo faithful 模式](2026-11-09-lemo-faithful-mode.md)，成片由上游自己的 `video.mjs` + `mux.sh` 输出。Lemo 适配器只用于应用内预览和旧项目兼容，不参与成片采集。底座给它提供的是 L0 存储、L1 网关和账本、G6 复检、导入时间线。
- **HyperFrames = HTML 动画，按场景编排**：走 L4 + CaptureHost + Encoder 全套底座，是 T2“多模型场景代码”的主力。
- **Remotion = 模板和数据驱动的动画（React 组件 + props）**：走 L4 + CaptureHost，是 T1 模板和兜底镜头的主力。现在它挂在“创意动画 → Vox 分层动画”下面，建议移到独立入口，或者作为各条路线共用的模板兜底。
