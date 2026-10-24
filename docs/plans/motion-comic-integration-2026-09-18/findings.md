# 发现

- 调研证据见 docs/research/motion-comic-github-2026-09-18/。
- 现有 JsonLlm 支持 OpenAI、Responses、Anthropic；新编剧服务复用应用配置。
- 现有 director:generate-shot-video 仅接受 VOX，漫剧 schema 缺 selected video asset；渲染需贯通。
- 当前远程 provider 只在完成时返回 remoteTaskId，需增加提交回调及恢复查询，防止恢复动作重新付费。
- UI 沿用项目 storydream-ui 的 Fluent 包装组件、Lucide、语义 token 与导演台。
- 视觉复核发现原 48 张“浅色”截图只切换了根节点 `data-theme`，Fluent Provider 仍为深色，导致输入框错误呈现为黑底；这是 QA 状态失真，不是产品主题实现缺陷。QA 已改为通过持久化主题接口同步应用状态，并同时断言根主题与 `data-storydream-theme`。
- 修正主题切换后重跑 60 张 Electron 截图：浅色表单、资产补录、配音和导出工作区均使用正确浅色控件，1536×1024 与 1040×720 未见重叠、裁切或横向溢出。
