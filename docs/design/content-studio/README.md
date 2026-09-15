# 图文与文章创作设计

本目录为 StoryDream 创作模块的独立可交互设计原型，使用项目现有 React / Fluent 包装组件、Lucide 图标和主题令牌。生产路由、数据库与用户项目未接入此原型。

- `index.html`：可直接在浏览器打开的单文件原型。
- `ContentStudio.tsx`、`content-studio.css`：可复用的界面源文件。
- `build.mjs`：使用当前项目的 esbuild 生成单文件原型。
- `design.md`：产品流程、平台差异、AI 与存储契约、实现范围。

运行 `node docs/design/content-studio/build.mjs` 重新构建。

原型可以编辑示例内容、增加与排序图文页面、切换独立平台版本、预览、保存到当前浏览器、导出 Markdown / HTML。示例文案明确标注为示例；不调用模型、生成图片或发布到平台。
