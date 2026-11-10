# VideoSpec / Timeline v1：统一数据模型（backlog O-2）

日期：2026-11-10。状态：**已实现数据模型与转换函数，尚未接入任何执行器**（接入属于 O-3）。

代码：`src/shared/video-spec.ts`；测试：`tests/video-spec.test.ts`。
依据：[底座设计 §6 L3、§8.2 AudioTimeline](2026-11-09-code-video-foundation.md)、[技术路线 P2-1](2026-11-10-technical-roadmap.md)、[决策记录](2026-11-10-decision-record.md) ADR-01 / ADR-03 / ADR-10 / ADR-15。

---

## 1. 定位

- 三条路线（`template` 模板 / `html` HTML 动画 / `creative` 创意动画）的分镜都写成同一个结构 `VideoSpec`，后续的执行器（O-3）、采集（E-2 CaptureHost）、音频与编码（E-3 AudioTimeline / Encoder）只读这一个模型。
- **只用于新项目**（ADR-03）。旧项目的数据类型（`HtmlVideoPipelineDataV2`、`PipelineArtifact`、`StoryboardScene` 等）一律不改；转换函数是只读的单向转换。
- 纯模块：不引入 Node / Electron，主进程、渲染进程和测试都能直接用。

## 2. 模型

```ts
VideoSpec = {
  specVersion: 1;                          // 不兼容变化必须升版本，并在 migrateVideoSpecInput 里写迁移
  route: 'template' | 'html' | 'creative';
  title?: string;
  canvas: {
    width, height;                         // 偶数像素（yuv420p），16–8192
    fps: 24 | 30;                          // ADR-15：创建时二选一后锁定
    color: { range: 'tv', primaries: 'bt709', matrix: 'bt709', transfer: 'iec61966-2-1' };  // ADR-10，默认值
  };
  style?: { styleId; packVersion? };
  durationFrames: number;                  // 总帧数 = 最后一个场景的结束帧
  scenes: Array<{
    id;                                    // [A-Za-z0-9_.:-]，唯一
    title?; sourceSceneId?;                // sourceSceneId 只用于追溯旧数据
    startFrame; durationFrames;            // 整数帧（时间线上的绝对位置）
    transitionIn?: { type: 'cut'|'fade'|'dissolve'|'wipeleft'|'wiperight'|'slideleft'|'slideright'; durationFrames };
    adapter:                               // 由哪种场景运行时负责出画面
      | { kind: 'hyperframes'; sceneTemplate?; compositionRef?; motion? }
      | { kind: 'lemo'; codeRef?; styleId? }
      | { kind: 'template'; templateId; params? }
      | { kind: 'video'; videoRef; trimStartFrame; fit: 'cover'|'contain'; muted: true }
      | { kind: 'still'; imageRef; motion? };
    sources: Array<{ role: 'background'|'foreground'|'image'|'video'|'audio'|'html'|'code'|'reference'; ref; slot? }>;
    narration?: { text; clipId? };          // clipId 指向 narration 音轨上的片段
    cues: Array<{ text; startFrame; endFrame; source?: 'tts'|'asr'|'estimated'|'manual'; confidence?;
                  words?: Array<{ text; startFrame; endFrame }> }>;   // 帧号相对场景开始
  }>;
  audio: {                                 // AudioTimeline
    sampleRate: 48000;
    tracks: Array<{
      id; kind: 'narration' | 'music' | 'sfx';
      gainDb; targetDb?;                   // targetDb 沿用现有 bgm_target_db 语义
      ducking?: { triggerTrackIds; reductionDb; attackMs; releaseMs };   // 侧链闪避
      clips: Array<{ id; ref; sceneId?; startFrame; durationFrames; sourceStartMs; gainDb; fadeInFrames; fadeOutFrames; loop }>;
    }>;
  };
  loudness: { normalize: true; integratedLufs: -14; truePeakDb: -1; lra: 11 };   // ADR-01，默认值取自 loudness.ts
  outputs: Array<{ kind: 'mp4'; burnCaptions; … } | { kind: 'srt' } | { kind: 'jianying-draft' } | { kind: 'cover' }>;
}
```

### 2.1 关键取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| 时间单位 | **整数帧是唯一事实源**，毫秒由 `msAt()` 推导，48 kHz 采样由 `sampleAt()` 推导 | 底座 I1：消除 round / ceil / floor 混用。24 / 30 fps 下每帧恰好 2000 / 1600 个采样，帧 ↔ 采样没有小数 |
| ms → 帧 | `frameAt(ms) = floor((ms·fps + 500) / 1000)`（0.5 进位） | 与现有 `allocateHtmlVideoSceneFrameCounts` 的 `floor(x + 0.5)` 一致；整数毫秒走纯整数运算 |
| 场景分帧 | `allocateFrameCounts`：边界 = frameAt(累计毫秒)，每段至少 1 帧 | 和 HTML 路线现有分帧函数算法相同（测试对拍）。O-3 接入时应让旧函数委托到这里，保持“全工程只有一个分帧函数” |
| cue 的时间基准 | **相对所属场景**的帧号 | 场景整体平移或重排时 cue 不用改；“cue 在场景内”可以直接校验。转换时先换成全局帧再减场景开始帧，保证和场景边界同一个时钟（每个场景最后一条字幕恰好结束在场景最后一帧） |
| 音频片段的时间基准 | 时间线上的**绝对帧号**；`sourceStartMs` 是源文件自己的毫秒时钟 | 混音按整条时间线一次渲染（E-3）；源文件不受项目 fps 约束 |
| 视频素材 | `muted: true` 是字面量 | 声音只来自 AudioTimeline，避免素材原声悄悄混进成片 |
| 封面片头（HTML 路线） | 建成一个独立的 `still` 场景 `cover` | 现有运行时把封面排在第一个场景之前（帧分配带 startOffset），显式成场景后时间线没有隐含偏移 |
| 兜底模板 | v1 **不强制**每个场景都有 fallback | 旧数据没有这个信息；由 G0 闸门（E-5）决定是否强制，届时升 v2 |
| 严格结构 | 所有对象都是 strict，未知字段报错 | 拼错字段名（如 `startMs`）立即暴露，而不是被静默丢弃 |

## 3. 不变式（`validateVideoSpec` 全部检查，每条都有测试）

1. `specVersion === 1`；版本号比程序新时提示“请升级应用”，而不是当成旧数据。
2. `fps ∈ {24, 30}`；宽高为偶数整数；色彩标签固定 tv / bt709 / iec61966-2-1；采样率 48000。
3. 所有帧号都是非负整数；场景和音频片段至少 1 帧。
4. 场景 id 唯一；`scenes` 按 `startFrame` 严格递增；第一个场景从第 0 帧开始。
5. **主轨无空隙**：每个场景的开始帧不晚于上一场景的结束帧。
6. **主轨不重叠，除非声明了转场**：重叠帧数 ≤ `transitionIn.durationFrames`，转场类型不能是 `cut` 或 0 帧，重叠不能覆盖任一场景的全部时长。没有重叠的转场（现有路线的做法：转场在渲染层完成，不改变时钟）也合法。
7. 转场时长不超过场景时长。
8. **总时长 = 最后一个场景的结束帧**。
9. **cue 在场景内**：`0 ≤ startFrame < endFrame ≤ 场景时长`；cue 按顺序且互不重叠；词级时间落在所属 cue 内。
10. `narration.clipId` 必须指向某条 narration 音轨上的片段。
11. 音轨 id 唯一；音频片段 id 在所有音轨间唯一；片段不能超出总时长；`sceneId` 必须存在；淡入 + 淡出 ≤ 片段时长；narration / music 轨内片段不重叠（sfx 允许叠放，需要叠旁白就拆成多条轨）。
12. 闪避触发轨道必须存在且不能是自己。
13. 输出类型不重复，且至少一个输出。

错误信息全部是中文，并带路径，例如：
`scenes[1].startFrame：场景 "b" 与上一场景 "a" 重叠 10 帧，但没有声明转场；主轨上的场景只有在转场时才能重叠`。
zod 自带的英文提示（未知字段、类型不对等）也会被翻成中文。`parseVideoSpec` / `createVideoSpec` 在不合法时抛 `AppError`，code 为 `VIDEO_SPEC_INVALID`，`issues` 字段带全部问题。

## 4. API

| 函数 | 作用 |
|---|---|
| `frameAt(ms, fps)` / `msAt(frame, fps)` / `sampleAt(frame, fps)` | 时间换算；`frameAt(msAt(n)) === n` 恒成立 |
| `allocateFrameCounts(durationsMs, fps)` | 累计时钟分帧 |
| `validateVideoSpec(x)` / `parseVideoSpec(x)` | 校验并补默认值（前者不抛异常） |
| `createVideoSpec({ route, canvas, scenes, audio?, … })` | 场景按顺序首尾相接，时长可给帧数或毫秒，自动算 `startFrame` 和总时长 |
| `videoSpecDurationMs(spec)` / `sceneAt(spec, frame)` / `sceneEndFrame(scene)` | 查询；转场重叠区内 `sceneAt` 返回正在转入的场景 |
| `videoSpecFromHtmlVideoState({ state, canvas, bgm?, cover? })` | HTML 路线状态 → VideoSpec |
| `videoSpecFromStoryboard({ scenes, subtitleCues, narration, images, videos, templateId?, bgm?, transition?, canvas })` | 模板路线分镜 → VideoSpec |
| `projectUsesVideoSpec(project)` / `withVideoSpecVersion(project)` | 新项目开关 |

### 4.1 转换规则

**HTML 路线**（`HtmlVideoPipelineDataV2` 的 scenes / voices / assets / compositions / config）：
- 场景时长 = max(800 ms, 配音时长)，与现有 `buildRuntimeComposition` 相同；有封面时第一个场景至少 6 s（开场蒙太奇），封面默认 1.4 s。
- 适配器 `hyperframes`：`sceneTemplate`、`compositionRef`（来自 compositions 的 htmlPath）、`motion`（config.sceneMotion）。
- 素材：背景图；前景图沿用运行时的过滤规则（隐藏槽位、`foregroundHidden`、不透明“棋盘格”、抠图未通过的都排除）。
- 字幕：优先用配音自带的时间戳 cue（含词级时间）；没有时按字数比例把 `captions` 分摊到配音时长，来源标为 `estimated`。越出场景的时间戳钳到场景内。
- 转场：config.transitionType，固定 0.3 s，**不重叠**（与现有渲染一致）。
- BGM：music 轨铺满全片、循环，`targetDb = htmlVideoBgmTargetDb(bgmVolume)`；默认加闪避（旁白出现时压低 12 dB）。
- 缺少任何一个场景的有效配音时直接报 `VIDEO_SPEC_SOURCE_INCOMPLETE`，不猜时长（新架构“先配音后分镜”）。

**模板路线**（`StoryboardScene[]` + `SubtitleTrack.cues` + 旁白 / 图片 / 视频素材）：
- 场景时长取 `StoryboardScene.durationMs`（配音测时结果），按累计时钟分帧。
- 适配器：有视频素材 → `video`（`trimStartMs` 换成帧）；否则给了 `templateId` → `template`；否则 → `still`；什么素材都没有 → 报错。
- 字幕：`buildSubtitleTrack` 产生的全局毫秒 cue 按 `sceneId` 归到场景，再换成场景内帧号；没有字幕时用 `cap` 生成一条 estimated cue。
- 旁白片段长度取实测的旁白时长（`narrationDurationsMs`），缺省与场景等长。

**创意路线（Lemo）**：暂无转换函数。Lemo faithful 模式由上游 `video.mjs` 出片（底座 §13.5），VideoSpec 只在导入时间线 / 预览时需要，等 O-3 明确后再加。

## 5. 新项目开关（ADR-03）

- 新项目创建时调用 `withVideoSpecVersion(project)` 写入 `videoSpecVersion: 1`。
- `projectUsesVideoSpec(project)`：只有 `videoSpecVersion` 是正整数时为真；旧项目没有这个字段，恒为假（`0`、`'1'`、`null`、小数都为假）。
- 版本号比程序新的项目仍返回真（它确实是新架构项目），读取 spec 时由 `validateVideoSpec` 给出“请升级”的提示，而不是悄悄退回旧管线。
- **目前没有任何执行器调用这两个函数**，`Task` 类型也没有加字段；接入属于 O-3。

## 6. 下游怎么用

| 下游 | 读取的部分 | 说明 |
|---|---|---|
| **O-3 统一执行器** | `scenes[]`、`adapter`、`audio.tracks` | 每个场景是一个可并行、失败隔离的节点；`adapter.kind` 决定交给哪个运行时。“先配音后分镜”：配音节点产出 narration 片段的实测时长 → `createVideoSpec` 重新分帧 → 再开渲染节点。节点的 inputHash 可以只取该场景的子树，换 LLM 不影响已完成的配音和图片（I12） |
| **E-2 SceneRuntime + CaptureHost** | `canvas`、`scenes[].startFrame/durationFrames`、`cues` | 外壳的 `__sd.fps / width / height / durationFrames` 直接取自 spec；采集循环按整数帧 `seekFrame(n)`，不再从秒换算；字幕层按场景内帧号显示。`sceneAt(frame)` 用于预览定位 |
| **E-3 AudioTimeline + Encoder** | `audio`、`loudness`、`canvas.color`、`outputs` | 片段起点 = `sampleAt(startFrame)`（整数采样）；music 轨按 `ducking` 做 `sidechaincompress`；两遍 loudnorm 到 `loudness`（`normalize: false` 时保留原电平，例如 Music MV）；编码参数取 `canvas.color` 和 `outputs[mp4]` |
| **E-5 闸门 G0/G1** | 整个 spec | G0 = `validateVideoSpec`；G1 的阅读速度、每镜最短/最长等检查在 spec 之上追加，不改 schema |

## 7. 【未核实】

- HTML 路线封面片头：sidecar 合成时封面段与 `total_duration_s` 的关系（现有 `totalDurationS` 不含封面，而帧分配带了封面偏移）只按 `createHtmlVideoComposePayload` 的代码推断，未用真实导出核对。
- 现有转场（HTML 0.3 s、模板 dissolve）在 sidecar 里是否会让成片变短（xfade 重叠）未核实；VideoSpec 按“不改变时钟”建模。
- 默认闪避参数（−12 dB、50 ms / 300 ms）是新架构的设计默认值，没有经过听感验证；旧路线的 BGM 本来没有闪避。
- 模板路线 `template` 适配器的 `params`（caption、imageRef）只是占位，模板运行时真正需要的参数要等 O-3 / T1 模板接入时确定。
