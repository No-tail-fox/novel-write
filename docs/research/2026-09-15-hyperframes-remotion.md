# HyperFrames 升级与 Remotion 可用性验证

核验日期：2026-09-15。

## HyperFrames：已接入 0.8.40

`@hyperframes/core`、`@hyperframes/lint`、`@hyperframes/player` 从 0.7.83 同步升级并精确锁定为 npm 当天最新稳定版 0.8.40。构建继续打包官方本地运行时，生成和导出阶段使用新版。

实际桌面验证发现，0.8.40 Player 在 iframe 的 load 事件中重置 ready，而场景在 DOMContentLoaded 已发送 timeline。跨域任务媒体无法通过同源探测恢复 ready。因此在场景的媒体响应里加入加载后时间线通知，使用实际已注册 GSAP 时间线的时长和场景尺寸；不改写用户保存的 HTML，也兼容已有场景。后续上游修复后应移除此适配。

验证结果：

- `npm run build`：通过。
- 真实 Electron 可视编排，1320×860 和 1040×720：播放器 ready、运行时播放推进、暂停、定位到 0.6 秒、官方 lint、四个工具面板均通过；无横向溢出或运行时错误。保留了 Chromium 的 iframe sandbox 警告记录。
- `npm run smoke:html-video`：实际导出 1.5 秒、320×568 的 MP4，包含视频和音频；两张预览有效，临时帧已清理。
- 四组相关测试：239 通过，1 失败。失败为 `html-video-electron.test.ts` 中忙碌目录清理重试的原始错误对象身份断言；在 HEAD 版本运行时源码上也复现相同失败。
- `npm run typecheck`：升级前后均有两处相同错误：`browser-fallback.ts` 缺少 `updateHtmlVideoSceneStructure` / `updateMusicMvTask`，`storage.test.ts` 调用未实现的 `FileDatabase.updateMusicMvTask`。未宣称全仓检查通过。

证据：`.artifacts/hyperframes-upgrade/report.json`、同目录桌面和小窗口截图；日志位于 `.tmp/hf-*.log`。

复测桌面（PowerShell）：

```powershell
$env:STORYDREAM_QA_HYPERFRAMES_ONLY = '1'
$env:STORYDREAM_QA_OUTPUT_DIR = 'I:\opc\.artifacts\hyperframes-upgrade'
$env:STORYDREAM_QA_EVIDENCE_DIR = $env:STORYDREAM_QA_OUTPUT_DIR
npm exec -- tsx scripts/qa-html-video-ui.mjs
```

## Remotion：本地渲染可用，尚未接入产品页面

隔离安装并验证了 Remotion 4.0.524，搭配本项目相同的 React 19.2.6。使用官方 bundler + renderer、自有 React composition、独立 Chrome 实例完成本地渲染，无需云渲染或模型 API。

真实产物：`.artifacts/remotion-check/remotion-local-test.mp4`，720×1280，30 fps，60 帧，H.264 视频 + AAC 音频，188,901 字节。容器时长 2.048 秒（60 帧视频为 2 秒）。中文字体和动画画面已检查；实现和复跑脚本保存在该隔离目录的 `composition.tsx`、`render.mjs`。主项目未添加 Remotion 依赖。

适用方向：在 React 页面嵌入 `@remotion/player`，用自有视频模板接收标题、图片、配音、字幕等参数；在 Electron 的独立 Node 工作进程中运行 bundler/renderer，复用任务进度、取消和输出目录管理。生产接入还需验证安装包中的 Chromium/原生渲染二进制、资源路径、内存占用及取消后的清理。本次证明了开发环境的真实本地渲染，不等同于完成打包发布适配。

许可：Remotion 是源码可见的商业许可软件，不是 OSI 开源许可。个人、最多 3 人的组织及非商业评估等情形可免费使用；更大的商业组织需购买公司许可。官方 FAQ 允许自有模板参数化生成，也允许按用户需求生成 Remotion 代码；禁止以接收任意用户自带 Remotion 项目并单纯提供渲染为商业服务。正式产品接入应按实际团队规模与用途采用对应许可。

官方资料：

- [HyperFrames 官方仓库](https://github.com/heygen-com/hyperframes)
- [Remotion Player](https://www.remotion.dev/docs/player)
- [Remotion Renderer](https://www.remotion.dev/docs/renderer)
- [Node 服务端渲染](https://www.remotion.dev/docs/ssr)
- [Remotion LICENSE](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)
- [商业许可 FAQ](https://www.remotion.pro/faq)
