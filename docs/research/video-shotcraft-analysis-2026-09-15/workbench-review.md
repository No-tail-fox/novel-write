# Video ShotCraft Workbench 源码审查

审查日期：2026-09-15。源码：`I:/opc/.tmp/video-shotcraft-analysis-src`，提交 `5e71af35`。仅审查现有代码；未修改产品源码、未启动导出、未安装剪映草稿。主代理另行验证依赖安装与构建。

## 结论

Workbench 是一个已经有实用编辑能力的本地 Remotion 后期工具：React 19 + Zustand 管理多轨时间线，Remotion Player 实时预览，Vite dev server 启动 Remotion CLI 导出 MP4。可借鉴它的「卡片组件 + 属性 schema + 工程清单」设计；不宜直接把当前工作台当作跨平台、项目资产自包含、可靠保存的通用视频编辑器。

它的核心价值是编辑代理生成的 Remotion 工程，前提是作者主动写好 `src/workbench.ts` 清单；没有从任意 TSX 或 MP4 自动还原编辑工程的实现。素材文件仍依赖本机链接目录，JSON 本身不是可迁移的完整工程包。

## 架构与真实能力

| 层 | 已实现 | 关键源码 |
|---|---|---|
| 工程模型 | Project → Track → Clip，统一按帧记录；clip 有 cardId、start、duration、inOffset、speed、props、图层变换 | `workbench/src/types.ts:3` |
| 卡片协议 | React component + 简单字段 schema + 原始 fps/时长/画布；原生字卡、媒体卡、背景、项目单元卡、demo 汇总注册 | `workbench/src/cards/types.ts:38`、`registry.ts:17` |
| 成片接入 | 外部 `WORKBENCH` 清单引用真正的 React 组件；按 shot/transition/caption/overlay 分轨，音频贪心分道 | `cards/projectCards.ts:5`、`projectImport.ts:53` |
| 编辑器 | 拖移、左右裁剪、跨轨、轨道排序、隐藏、分割、复制、单 clip 属性、吸附；50 份 undo/redo 快照 | `timeline/ClipView.tsx:44`、`timeline/Timeline.tsx:53`、`store.ts:125` |
| 预览 | 同一个 MainComposition 供 Player 与 CLI 使用；轨道逆序合成；普通动效按 Freeze 映射源帧，媒体使用 trimBefore/playbackRate | `preview/Composition.tsx:14` |
| 保存 | 单一 localStorage 存档，800 ms 防抖；导出/导入纯 JSON | `store.ts:13`、`store.ts:326`、`App.tsx:157` |
| 导出 | POST 当前 project → props 临时文件 → rsync 解引用素材 → Remotion CLI → `exports/*.mp4`；内存 job + 每秒轮询 | `vite.config.ts:49`、`App.tsx:52` |
| 校验 | 原片与清单导入结果可各渲相同帧做像素比较；默认只采样 4 帧 | `scripts/parity.mjs:21`、`scripts/parity.mjs:79` |

schema 是属性面板描述，不是完整运行时工程校验器。只有单卡 Studio composition 由 `zodFromCard` 建 Zod schema，主工程 Main 没有 schema（`src/remotion/Root.tsx:26`、`:65`）。

当前没有项目列表/项目文件数据库、关键帧曲线编辑、多选/编组、素材重定位打包、音频波形、字幕识别、协作或独立生产渲染服务的实现。demo 卡的 schema 为空，不能直接修改其文案或主题（`cards/demoCards.ts:20`）；作者需要先改组件，把常量提升为 props。拖动变速只改 speed，不自动改变 clip 占用时长（`panels/Inspector.tsx:235`）。

## 已确认的工程缺陷与边界

### 1. Windows 无法按现有脚本获得完整开箱即用链路

- 仓库跟踪 `workbench/demosrc` 为 symlink；本机 `core.symlinks=false` 的 checkout 中它实际是一个 8 字节文本文件，内容 `../demos`。`gen-index.mjs:52`、`:89` 直接把它当目录递归读取。
- 即使手工修复链接，`gen-index.mjs:71` 用 `path.relative()` 得到 Windows 反斜杠路径；`:72` 只按 `/` 拆分，`:99` 原样写入 JS import 字符串。Windows 路径会生成错误的分类与模块路径，需统一为 POSIX 分隔符。
- 导出硬依赖 `rsync`（`vite.config.ts:101`），然后直接执行 `node_modules/.bin/remotion`（`:114`），没有 Windows shim / Node 入口适配。
- `scripts/open.mjs:82` 直接 `spawnSync("npm")`；`:99` 在 Windows 永远认定旧 server 不属于脚本，所以无法自动重启已经运行的自家 server。
- 「显示文件」只在 darwin 调用 Finder，其他平台却仍返回 `{ok:true}`（`vite.config.ts:153`）。

结论是原作者主要验证了类 Unix / macOS 工作流。Windows 的具体 build 结果由主代理记录；本报告不把源码静态判断描述为已完成整机实测。

### 2. 项目切换会覆盖上一项目的自动存档

`store.ts:13` 为所有项目使用同一个 `shotcraft-workbench-project-v1`。切换来源时 `loadInitial()` 只把上一个项目压入当前会话的 undo 栈，再立即自动保存新项目（`:33`、`:346`）。undo 栈没有持久化。

复现路径：编辑 A → 打开 B → 刷新或关闭 → 再打开 A。由于保存的数据已是 B，A 会从清单重新生成，A 的编辑只能依靠之前手工导出的 JSON 恢复。它提供的是一个工作槽位，不能据此宣称有完整多项目保存。

### 3. 合法 JSON 不等于合法工程；导入缺少结构校验与恢复边界

`App.tsx:169` 只确认 `p.tracks` 是数组就接受工程；自动加载采用相同弱校验（`store.ts:19`）。例如 `{"tracks":[null]}` 会通过校验，但 `projectEndFrame()` 在 `types.ts:53` 解引用 `t.clips`，导致运行时异常。fps、尺寸、clip 数值、props、cardId 和 ID 唯一性均不验证。

未知卡片在渲染时静默 `return null`（`preview/Composition.tsx:29`），因此打开另一工程导出的 JSON 时可能丢镜头而没有明确告警。JSON 只有卡 ID / 参数 / 文件路径，没有打包卡片代码或素材（`types.ts:3`、`App.tsx:157`）。

### 4. 分割会改变原画面：durationProp 被重新解释为左段时长

分割实现本身正确续接源时间：右段 `inOffset = old.inOffset + local * speed`（`store.ts:280`）。但左段 duration 被缩短（`:287`），而渲染总会把 `inOffset + duration * speed` 注入卡片的 durationProp（`preview/Composition.tsx:35`）。

原生字幕使用 duration 的最后 8 帧淡出（`cards/inkpress/caption-strip.tsx:31`、`:66`）。把 60 帧字幕在第 30 帧分割后，左段会提前在 22–30 帧淡出，右段却从原来的 30 帧恢复完整可见。它不是一般剪辑软件所期望的「只切开，不改变内容」。字卡有同类问题（`inkpress/title-card.tsx:48`、`:127`）。

已做只读逻辑探针：直接转译并运行原 `store.ts` 的 `splitClip`，60f 在 30f 分割，左段注入 duration=30；按组件的原公式，第 29 帧不透明度从 1 变成 0.125。未声称做过像素渲染验证。

修复方向：把素材原始时间范围与 clip 可见范围分开；分割维持原始动画 duration，只有显式「调整动画时长」才改 durationProp。

### 5. 导入器不能完整保存清单时长语义

`ProjectData` 没有显式 total/end，导出 Main 的时长由最晚 clip 结束计算（`types.ts:34`、`remotion/Root.tsx:34`）。清单里的 total 只用于截断单元，因此原片最后有空白停留时会被导出裁掉；parity 用的 ProjImported composition 却强制使用 MANIFEST.total（`Root.tsx:48`），无法发现真实 Main 导出被截短的问题。

此外，导入器把任何 duration 最少变成 2 帧（`projectImport.ts:26`、`:65`）。一帧闪切会被延长；在 total 处或之后的 cue 仍可能被塞入 2 帧，反而延长最终导出。shots 为空时，`unitTrack("shot")!` 实际得到 null 并放进 tracks（`:81`），非空断言不提供运行时保护。

已做只读逻辑探针，实际运行导入函数：total=300、唯一 shot 长 100 时 importedEnd=100；1 帧 shot 被导入为 2 帧；空 shots 的 tracks 为 `[null]`。

### 6. 导出进程错误处理不完整，服务可因普通错误退出

`vite.config.ts:101` 与 `:115` 的子进程仅监听 close，没有 error 监听。缺少 rsync、CLI 不可执行等 spawn 错误会触发 Node 未处理 error，可能直接终止 Vite，而不是给前端一个失败任务。

JSON 解析的 try/catch 在 `:59` 到 `:65` 结束；随后 `project.name` 直接 `.replace()`（`:71`）。`{"project":{"name":1}}` 这样的请求会在异步 request end 回调中抛出未捕获异常。磁盘 mkdir/write/rm 等失败同样没有统一兜底。

前端轮询没有 catch、超时、失败计数、取消或重连：服务消失/任务 404 时 `App.tsx:54`–`:59` 不会退出 running 状态。页面刷新后也没有恢复正在进行任务的入口。

### 7. `.tsx` 清单被识别但不会真的接入

`scripts/open.mjs:75` 和 `scripts/gen-index.mjs:229` 都接受 `workbench.tsx`。但 `vite.config.ts:15`、`remotion.config.ts:10`、`scripts/parity.mjs:24` 只检查 `workbench.ts`。工程只提供 `.tsx` 时，UI 元数据会认为有清单，实际 import 却落到 stub 或 parity 拒绝运行。

## 需要保留限定的风险

- **导出 API 不应直接当生产服务暴露。** 自定义中间件没有认证、Origin 校验、请求体限制、任务超时与持久化；仅靠 dev server 的默认绑定和外围策略。未验证浏览器跨源攻击可行性，也不把它说成已证实远程代码执行。路径 safeName 与 spawn 参数数组降低了直接 shell 注入风险。
- **并发锁存在竞态。** `vite.config.ts:51` 在开始接收请求体时检查 jobs；真正注册任务在 `:84`。两个请求都在 body 未结束时通过检查，可启动两个导出，并共享 `.render-public`。任务 ID 也只有 Date.now() 毫秒级字符串，输出名只有秒级时间戳。
- **导入源码属于可信代码执行。** `@proj/workbench` 是 TS 模块引用真正 React 组件（`projectCards.ts:5`），并不是被沙箱隔离的数据格式。build/generation 过程还会用 `new Function` 执行仓库的 translations.js（`gen-index.mjs:124`）。这适合本机可信作者工程，接用户上传工程需重设边界。
- **时间映射并非通用定格引擎。** `TimeRemap` 只钳制最低 0，没有钳制卡片尾帧（`preview/Composition.tsx:17`）；速度 1/裁入 0 时直接透传。它依赖每张卡自己正确处理超时帧。部分 demo 用持续取模/周期函数，不能推断「延长一定尾帧定格」。此外源码已明确承认 Freeze 不改变 useVideoConfig().fps，跨 fps 的 spring 节奏会偏（`cards/types.ts:93`）。
- **复合媒体镜头不适用统一 Freeze。** 只有 kind=audio/video 的原生媒体卡走原生媒体时间通道，ManifestUnit 没有 kind 字段，projectCards 也不推断组件是否包含 Audio/Video。成片组件内若带媒体，变速/分割之后的音频语义需逐组件验证。
- **预览检查覆盖面有限。** parity 默认 150/240/470/1000 四帧；RGB 像素比较不验证音频，少于 0.1% 像素差视为一致（`parity.mjs:95`）。不能把它的成功解释为全片逐帧无损，更不能证明编辑操作无损。

## 剪映导出的准确解释

Workbench 顶栏的「导出成片」只导出 MP4 和普通 JSON，没有直接导出剪映草稿的按钮/转换器。

仓库另有 `jianying-export` Python 链路。`aifl_promo.py:1`–`:5` 明确是 AiflPromo 专用示例；SHOTS/CAPTIONS/SFX 从模板手工复制（`:41`），先渲无字幕底片，再按时间切成可重排视频段（`:126`），字幕变成原生文字，音频独立轨道。镜头内部 TSX 动画仍然烘焙在视频底片里，不是原生可编辑图形。

Mac 安装模块有文件改名、媒体打包、注册表备份和失败回滚；Windows 模块也有路径边界验证、媒体打包和安装回滚。这些是有价值的工程细节。但 Windows 顶部明确标记未在真机验证（`windows_draft.py:3`）；Mac 还依赖从老明文草稿读取本机 platform 指纹（`mac_draft.py:78`），因此不能把这部分宣传为统一跨版本的即插即用导出 API。

## 建议采用顺序

1. 先借鉴卡片目录、CardDef/PropField 和 WorkbenchManifest，复用有参数的 React 镜头；不要先搬完整工作台。
2. 接入前补运行时工程 schema、版本迁移、缺失卡/素材检测、逐项目保存与资源清单。
3. Windows 落地先处理链接/路径分隔符/命令入口，把 rsync 改为跨平台文件复制，并统一导出错误处理。
4. 把 sourceDuration、可见 duration、时间映射、分割与伸缩的语义写清楚，给分割连续性、跨 fps、媒体裁入补必要回归验证。
5. 若产品化，再将渲染移到独立作业服务：任务持久化、取消、超时、日志、产物定位、资源上限；保留浏览器预览与 CLI 共享同一合成组件的优点。
