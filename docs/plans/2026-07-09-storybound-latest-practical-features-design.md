# Storybound 最新实用功能移植设计

## 背景

用户已确认采用“方案 B：实用移植版”。本设计基于 2026-07-09 对 `E:\Storybound` 最新包的静态逆向结果：最新版入口为 `/assets/index-BFrn3lR6.js`，新增/确认了 `fixed_intro`、`outro_cta`、`lock_intro_sentences`、`product_info`、`material_person`、`draft_dir` 等任务字段，并新增 `BookSelectionPage`、`BenchmarkPage`、`PersonAssetsPage`、`step4-local-materials`、本地智能体 CLI 相关能力。

本批只移植本地可控、能提升工作流效率的功能。不复刻私有授权、积分扣费、远程对标监控 API、微信视频解密接口，也不提取或复用任何账号/密钥。

## 目标范围

1. 文案把控三件套：固定开头、固定结尾 CTA、锁定开头 N 句。
2. 人物素材库 + 真图分镜：管理人物照片，任务可选择本地人物素材作为分镜图片来源。
3. 选品助手本地壳：保存书籍/商品信息、卖点、关键词，并能把 `productInfo` 带入新任务或对标导入。
4. 对标监控本地导入版：不接私有 feed API，提供“粘贴对标文案/转录文本/链接备注 -> 创建任务”的入口，并保留与选品助手的 `productInfo` 联动。

## 非目标

- 不实现 `/v1/dajiala/feed-list`、`/v1/dajiala/feed-info`、`/v1/bugpk/parse`。
- 不实现 `wx_download_decrypt` 或微信视频无水印下载。
- 不实现服务端积分扣费、退款、兑换或远程账本。
- 不实现图生视频 `VideoPromptDialog` 的完整视频生成链路。
- 不在第一批实现本地智能体 CLI 文件协议；只在数据模型和任务创建边界为后续预留兼容字段。

## 架构

现有项目是 React + Vite + Electron + sql.js。设计沿用当前单体壳层和 `FileDatabase` 存储，不引入新框架。前端仍集中在 `src/main.tsx`，类型在 `src/shared/types.ts`，数据库迁移和任务持久化在 `src/shared/storage.ts`，流水线行为在 `src/shared/runner.ts`。

本批新增能力分为三层：

- 数据契约层：扩展 `Task` / `CreateTaskInput` 与 SQLite 字段，新增本地选品和人物素材类型。
- 页面层：新增 `book-selection`、`benchmark`、`person-assets` 三个 Shell 视图。
- Runner 层：Step 1 支持固定/锁定文案拼接，Step 4 支持 `materialSource = local` 时从人物素材库铺图。

## 数据设计

`tasks` 新增字段：

- `product_info TEXT`：JSON 字符串，保存书籍/商品名、作者、卖点、受众、关键词等。
- `material_person TEXT`：本地人物素材库名称。
- `draft_dir TEXT`：兼容最新版 Storybound 草稿目录字段，当前先持久化，不改变导出逻辑。
- `fixed_intro TEXT`：固定开头。
- `outro_cta TEXT`：固定结尾/CTA，支持 `{主角}` 占位符。
- `lock_intro_sentences INTEGER`：锁定预审后文本开头 N 句，限定 0-20。

新增 `book_selection` 表：

```sql
CREATE TABLE IF NOT EXISTS book_selection (
  theme TEXT NOT NULL,
  book_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (theme, book_id)
);
```

人物素材先不进 SQLite，按 Storybound 参考使用本地文件夹：

- `appDataDir/person-assets/<person>/`
- 支持 `.jpg`、`.jpeg`、`.png`、`.webp`
- 图片按文件名排序，分镜多于图片时循环复用。

## 文案控制数据流

新建任务页增加“文案把控”区域：

- 固定开头：可选，多行文本。
- 固定结尾 CTA：可选，多行文本，提示 `{主角}` 会替换为封面标题。
- 锁定开头句数：数字输入，0 表示不锁定，1-20 表示锁定预审后文本开头句。

Runner Step 1 行为：

- 若 `lockIntroSentences > 0`，从 Step 0 预审文本中切出开头 N 句作为 locked intro。AI 只改写剩余文本。
- 若锁定模式下同时提供 `fixedIntro`，则用 `fixedIntro` 替代自动切出的 locked intro。
- 若非锁定模式下提供 `fixedIntro`，AI 不处理固定开头，最终结果前置拼接。
- `outroCta` 在最终正文尾部拼接，并在有封面标题时替换 `{主角}`。
- 播客/双人对话形态先忽略固定开头/结尾，避免破坏 `[A]/[B]` 或 Host turn 结构。

## 人物素材 / 真图分镜数据流

新增“人物素材库”页面：

- 列出人物文件夹、图片数量、最近更新时间。
- 创建、重命名、删除人物。
- 导入图片文件，打开人物文件夹，预览图片。
- 第一批不做拖拽重排，使用文件名排序；后续可加重命名排序。

新建任务页增加素材来源：

- AI 绘图：现有流程。
- 本地人物素材：选择人物；创建任务时写入 `materialSource = local`、`materialPerson = <name>`。

Runner Step 4 行为：

- `materialSource !== local`：保留现有 AI 生图。
- `materialSource === local`：跳过 AI 生图 provider，读取 `person-assets/<materialPerson>`，把图片裁切为任务比例后写到 `taskDir/images/<sceneId>.png`。
- 写入 `04-local-meta.json`，包含 `version`、`person`、`origins`，便于任务详情和后续裁剪功能识别来源。

## 选品助手本地壳

新增“选品助手”页面：

- 以主题分组保存书籍/商品卡片。
- 卡片字段：书名、作者、品类、关键词、卖点、目标受众、人物/年代、价格、链接、备注、封面/素材文件夹。
- 支持新增、编辑、收藏、删除。
- “带入新建任务”：写入 `sessionStorage.book_product_info`，跳转新建任务，自动启用带货保留。
- “去对标导入”：写入 `sessionStorage.book_product_info` 和 `benchmark_search`，跳转本地对标导入页。

第一批不自动抓 Dangdang/Douban，只预留“外部链接/备注”字段，避免不稳定抓取和反爬问题。

## 对标监控本地导入版

新增“对标导入”页面，替代完整远程监控：

- 粘贴对标文案或转录文本。
- 可填写来源链接、账号名、标题、关键词。
- 若有 `book_product_info`，页面显示当前商品信息。
- “用此文案创建任务”：创建普通 story 任务，输入文本为粘贴内容，携带 `productInfo`，并自动启用 `keepPromotion`。

这让用户能走完整“选品 -> 对标文案 -> 二改任务”的实用链路，同时规避私有 API 和解密逻辑。

## 错误处理

- 锁定句数输入超出范围时归一化到 0-20。
- `materialSource = local` 但 `materialPerson` 缺失或人物没有图片时，任务在 Step 4 失败并给出中文错误。
- 单张图片裁切失败时尝试原样复制；全部失败才终止 Step 4。
- 选品 JSON 解析失败时跳过坏记录，不影响页面加载。
- 浏览器预览环境不执行真实本地文件导入/打开目录，只显示空态或提示。

## 测试策略

- `tests/storage.test.ts`：锁定新增 task 字段、`book_selection` 表、create/read roundtrip。
- `tests/runner.test.ts`：覆盖固定开头/结尾拼接、锁定开头只改写剩余文本、本地素材缺失时报错。
- `tests/product-shell-ui.test.ts`：导航入口、中文页面标题、新建任务页文案把控和素材来源控件。
- 可选新增 `tests/local-materials.test.ts`：用临时目录和 mock 图片验证铺图 metadata，不依赖真实 AI provider。

## 验收标准

- 新建任务能保存并读取 `productInfo`、`materialPerson`、`fixedIntro`、`outroCta`、`lockIntroSentences`。
- 固定开头/结尾在最终 `01-rewritten-copy.md` 中按预期出现，AI 不改写固定文本。
- 本地人物素材任务在 Step 4 生成 `images/<sceneId>.png` 和 `04-local-meta.json`。
- 选品助手可以保存商品卡片，并一键带入新建任务或对标导入。
- 对标导入可以用粘贴文本创建带货二改任务。
- `npm run typecheck`、目标 Vitest、最终 `npm test` 通过。
