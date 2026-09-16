# 账号、激活、积分与更新设计

用户顺序：现有功能先上传远程仓库，然后新建独立分支设计这一套功能。

1. [完成] 基线提交 bdf1f71964bdd1e7d31e40810dd2402250496c4a 已推送 origin/codex/shotcraft-motion-library，远程哈希一致。渲染端和 Electron 类型检查及构建通过。
2. [完成] 从确认后的检查点创建 codex/account-credits-updates 分支。
3. [完成] 基于本地 Storybound 既有学习资料与现有代码，完成产品流程、服务端架构、模型计费、账号授权、支付和更新协议设计。
4. [完成] 完成六页面本地原型、服务端协议与分阶段开发计划。专用类型检查通过；131 项交互与布局断言通过，深浅主题和两种桌面尺寸截图已保存；设计成果仅提交在独立分支。

当前只做完整设计与原型；真实支付、部署和商业规则需要在实施时接入用户选择的服务商。使用明确标记的设计示例，不改真实账号、余额或生成任务。

现有基线：codex/shotcraft-motion-library，origin 跟踪分支相同；远程 origin=GitHub、gitee=Gitee。推送按现有 origin 上游执行，不擅自合并 main。

检查结果：browser-fallback 两个 API、storage MV 更新方法、main ratio 类型均已补齐；前端/Electron 类型检查和构建通过。部分旧 UI/VOX 断言差异详见基线报告，不冒称全仓测试全部通过。
