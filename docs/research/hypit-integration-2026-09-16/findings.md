# Findings

- 上游是面向 AI coding agent 的视频编排系统，公开入口宣称复刻视频并生成变体；需要继续区分 agent 作者工作与程序自动功能。
- 许可证是修改版 Apache-2.0。内部自用/代客户制作和成片商业使用允许；收费分发包含 Hypit 的产品、第三方托管服务、多租户服务涉及商业授权。
- 本项目现有爆款链路已含下载、等距抽帧、转写、视觉拆解、再创作文案和生产任务入口。重点比较语义时间轴与可复刻工程数据。
- Hypit CLI 没有自动视频→SVML 的完整分析接口；视频理解与工程作者工作由 coding agent 承担。
- SVML 中的 Script 段落/Selection/Moment 可投射到声音对齐后的时间，中文显式支持 zh。
- 跨 Build 复用需显式 Candidate/satisfy；pricing 提供请求和费率资料，不计算总价。
- 建议先独立实现证据蓝图并桥接我们分镜，Hypit 作为可选执行后端；不整体并入112个packages及其Studio/存储/Worker。
