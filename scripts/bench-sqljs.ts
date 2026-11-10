/**
 * O-6: measure what the current sql.js persistence costs on a real-sized database, so the
 * better-sqlite3 decision rests on numbers. Read-only on the input: the file is loaded into memory;
 * the atomic-write cost is measured against a scratch file that is deleted afterwards.
 *
 *   tsx scripts/bench-sqljs.ts <data.db> [--rounds 5] [--scratch <dir>]
 *
 * Prints JSON: load/export/write timings, per-commit cost (storage.ts exports twice and rewrites the
 * whole file on every commit), table sizes and the largest text columns.
 */
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import initSqlJs from 'sql.js';

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
const ms = (value: number) => Math.round(value * 10) / 10;

export interface SqlJsBenchResult {
  fileBytes: number;
  loadMs: number;
  exportMs: number;
  writeMs: number;
  /** storage.ts enqueueCommit: export (rollback copy) + mutation + export + atomic write. */
  perCommitMs: number;
  tables: Array<{ name: string; rows: number; bytes: number }>;
  largestColumns: Array<{ table: string; column: string; bytes: number; maxRowBytes: number }>;
}

export async function benchSqlJs(file: string, options: { rounds?: number; scratchDir?: string } = {}): Promise<SqlJsBenchResult> {
  const rounds = Math.max(1, options.rounds ?? 5);
  const SQL = await initSqlJs();
  const bytes = readFileSync(file);
  const loadStart = performance.now();
  const db = new SQL.Database(bytes);
  const loadMs = performance.now() - loadStart;
  const exports: number[] = [];
  let last: Uint8Array = new Uint8Array();
  for (let index = 0; index < rounds; index += 1) {
    const start = performance.now();
    last = db.export();
    exports.push(performance.now() - start);
  }
  const scratchDir = resolve(options.scratchDir ?? join('.tmp', 'bench-sqljs'));
  mkdirSync(scratchDir, { recursive: true });
  const scratch = join(scratchDir, `bench-${process.pid}.db`);
  const writes: number[] = [];
  try {
    for (let index = 0; index < rounds; index += 1) {
      const start = performance.now();
      writeFileSync(`${scratch}.tmp`, last);
      renameSync(`${scratch}.tmp`, scratch); // same as atomicWriteDatabase: temp file + rename
      writes.push(performance.now() - start);
    }
  } finally {
    for (const path of [scratch, `${scratch}.tmp`]) { try { unlinkSync(path); } catch { /* absent */ } }
  }
  const tableNames = (db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values ?? []).map(row => String(row[0]));
  const tables: SqlJsBenchResult['tables'] = [];
  const columns: SqlJsBenchResult['largestColumns'] = [];
  for (const name of tableNames) {
    const quoted = `"${name.replace(/"/gu, '""')}"`;
    const rows = Number(db.exec(`SELECT count(*) FROM ${quoted}`)[0]?.values[0]?.[0] ?? 0);
    const info = db.exec(`PRAGMA table_info(${quoted})`)[0]?.values ?? [];
    let tableBytes = 0;
    for (const column of info) {
      const col = `"${String(column[1]).replace(/"/gu, '""')}"`;
      const [sum, max] = db.exec(`SELECT coalesce(sum(length(CAST(${col} AS BLOB))),0), coalesce(max(length(CAST(${col} AS BLOB))),0) FROM ${quoted}`)[0]?.values[0] ?? [0, 0];
      tableBytes += Number(sum);
      columns.push({ table: name, column: String(column[1]), bytes: Number(sum), maxRowBytes: Number(max) });
    }
    tables.push({ name, rows, bytes: tableBytes });
  }
  db.close();
  const exportMs = median(exports);
  const writeMs = median(writes);
  return {
    fileBytes: statSync(file).size,
    loadMs: ms(loadMs),
    exportMs: ms(exportMs),
    writeMs: ms(writeMs),
    perCommitMs: ms(exportMs * 2 + writeMs),
    tables: tables.sort((a, b) => b.bytes - a.bytes),
    largestColumns: columns.sort((a, b) => b.bytes - a.bytes).slice(0, 8),
  };
}

async function main(argv: string[]) {
  const file = argv.find(arg => !arg.startsWith('--'));
  if (!file) { console.error('用法：bench-sqljs.ts <data.db 副本> [--rounds 5] [--scratch 目录]'); return 2; }
  const option = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const result = await benchSqlJs(file, { rounds: Number(option('--rounds') ?? 5), scratchDir: option('--scratch') });
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && /bench-sqljs\.ts$/u.test(process.argv[1])) void main(process.argv.slice(2)).then(code => { process.exitCode = code; });
