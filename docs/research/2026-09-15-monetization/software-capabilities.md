# 当前软件的可复用能力

核对日期：2026-09-15。基于仓库实现与近期验证记录；本次调研未调用付费模型生成新样片，不能据此证明任意客户订单都能稳定交付。

|能力|当前证据|能承担的商业环节|需要另补或另验|
|---|---|---|---|
|普通视频流水线|src/shared/runner.ts、task-runtime-providers.ts|文案审查/改写、封面信息、分镜、生图、配音、字幕、草稿|题材事实、人工作品质量与真实账号效果|
|剪映草稿|src/shared/draft.ts、jianying-bridge.ts；近期横竖屏模板验证记录|让客户继续编辑；图书/商品内容批量生产|近期模板仅验证writer与桥接参数，真实剪映端打开、播放、导出要实测|
|VOX、AI漫剧|electron/main.ts调用renderDirectorVideo，electron/director-renderer.ts|解释型视频、分镜与角色资产、试片/供片|成片一致性、复杂动作、长片总成本、客户或发行规格|
|HTML动画|src/shared/html-video-runner.ts、electron/html-video-renderer.ts|知识讲解、工具演示包装、图文信息动画|无需为教程提到Remotion就改技术栈；用当前路径验收所需效果即可|
|图/音/视频生成|src/app/navigation.ts、route-registry.ts；生成工作台近期QA|封面、场景图、旁白、视频片段|实际所选模型与参数是否适合任务；商品保真、人物与声音使用权|
|热点、对标、爆款拆解|src/features/viral/ViralAnalyzerPage.tsx；benchmark-monitoring.ts|选题、结构拆解、建立参考素材|视频号本地批量输入不等于现有抖音/快手/B站链接分析入口；近期数据和有效转化需核对|
|图书选品|src/shared/book-discovery.ts、BookSelectionPage.tsx|书目与卖点整理、候选机会评分|来源是当当公开书目，评论不是销量；未证实视频号可带SKU、佣金、库存、结算同步|
|模板、队列、历史|src/app/navigation.ts、src/shared/runner.ts|复用成熟版式、减少重复配置与失败重做|订单与客户管理、发布后效果回流属于新增业务数据|
|图文/文章|docs/design/content-studio/README.md|已有可交互原型，能验证流程|未接生产路由、数据库、模型或平台发布；不能算正式功能|
|PPT/文档交付|工作区已有PPT/文档产物及独立工具技能|可在软件之外先完成原创课件/专业资料与客户小样|StoryDream没有已核实的原生可编辑PPTX生产闭环|
|软件收费、自动发布和交易|账户页面注明模拟余额/本地授权；未发现经营闭环证据|暂不能作为已上线商业能力|真实授权/计费、售后、平台账号发布、商品订单/佣金结算需独立实现或外部人工完成|

最近项目日志还记录了若干既有类型接口缺口。优先在真实素材上验收一条完整交付，再承诺客户规模和时效；本次未修改或测试产品源码。
