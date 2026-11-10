# O-6：better-sqlite3 评估（2026-11-10）

## 结论

**暂不迁移，继续用 sql.js。** 在 72 MB 的真实库副本上，每次提交约 114 ms，用户感知不到。迁移到 better-sqlite3 要引入原生模块，Electron 41 构建和打包都要跟着变，风险和维护成本明显高于收益。

更划算的做法是先把 `tasks.pipeline_data` 和 `tasks.input_text` 这类大字段移出库：它们占了全库字节的 82%，每次提交都在跟着整库重写。

以下任一情况出现时，重新评估迁移：

| 触发条件 | 阈值 |
|---|---|
| 单次提交耗时（`bench-sqljs` 的 `perCommitMs`） | > 300 ms |
| 库文件大小 | > 200 MB |
| 制作期间每分钟提交次数 × 单次提交耗时 | > 3 s / 分钟（主进程忙于写库） |
| 写库导致的 UI 卡顿或心跳超时 | 出现过 1 次就要处理 |

## 实测数据

- 测试对象：`.artifacts/real-route-qa/legacy-db-copy/userData/storydream/data.db`，即 2026-11-10 真实路线 QA 用的旧库副本，只读加载。
- 测试命令：`node node_modules/tsx/dist/cli.mjs scripts/bench-sqljs.ts <data.db> --rounds 5`
- 测试机器：I 盘，Node 20.19.5，sql.js（WASM）。

| 项 | 数值 |
|---|---|
| 文件大小 | 71.8 MB |
| 加载到内存 | 4.4 ms |
| `db.export()`（取中位数） | 20.4 ms |
| 临时文件写入 + 重命名（取中位数） | 72.7 ms |
| **单次提交**（export ×2 + 写入，与 `storage.ts` 的 `enqueueCommit` 一致） | **113.6 ms** |
| 提交时的临时内存 | 约 3 × 72 MB（库本身、回滚副本、新导出） |

占用最大的表和列：

| 表.列 | 字节 | 单行最大 |
|---|---|---|
| `tasks.pipeline_data` | 42.6 MB | 2.77 MB |
| `tasks.input_text` | 16.3 MB | 1.25 MB |
| `motion_comic_script_candidates.data` | 2.3 MB | 45 KB |
| `hotboard_snapshots.data_json` | 1.7 MB | 91 KB |
| `prompt_templates.data_json` | 1.3 MB | 59 KB |

`tasks` 表只有 38 行，却占了 59 MB。

## 两种方案对比

| | sql.js（现状） | better-sqlite3 |
|---|---|---|
| 写入方式 | 每次提交都整库导出、整库重写（原子替换） | WAL 增量写，单次提交约 1 ms 量级【未核实，未在本机测】 |
| 崩溃安全 | 依靠临时文件 + 重命名；损坏库隔离后从 temp 恢复（O-4） | SQLite 自带日志 |
| 原生依赖 | 无（WASM） | 有：要按 Electron 41 的 ABI 编译或下载预编译包；打包要加 `asarUnpack`。是否有 Electron 41 预编译包【未核实】 |
| 构建环境 | 无要求 | 没有预编译包时需要 MSVC 和 node-gyp；I 盘空间紧张（§13.3） |
| 迁移成本 | 无 | `storage.ts` 有 5300 行同步 `db.exec`/`db.run` 调用，接口大体兼容，但回滚逻辑（`new SQL.Database(previous)`）要改成事务，测试也要换 |
| 测试 | vitest 直接跑 | vitest 在 Node ABI 下跑，Electron 下要再编译一份 |

## 建议的下一步（按收益排序）

1. **把大字段移出**（延续 O-1 的思路）：`pipeline_data` 中只有在制作时才需要的大块，比如脚本草稿、历史快照，改为写到项目目录下的 JSON 文件，库里只保留摘要和指针。预计库能缩小 70% 以上，单次提交降到约 30 ms【估算】。
2. 定期用 `bench-sqljs` 测一次真实库，看上面的触发阈值。
3. 触发阈值后，再单独开迁移任务。届时先确认 Electron 41 的预编译包，并在干净 Windows 上做安装验收（P-3 的检查脚本要加上 `better_sqlite3.node`）。

## 未核实

- 制作期间的实际提交频率（`task_events` 2352 行，心跳是否每次都提交）。
- better-sqlite3 在本机的提交耗时，以及 Electron 41 预编译包是否可用。
