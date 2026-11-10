import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterAll, describe, expect, it } from 'vitest';
import { benchSqlJs } from '../scripts/bench-sqljs';

const root = mkdtempSync(join(tmpdir(), 'bench-sqljs-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('sql.js persistence benchmark (O-6)', () => {
  it('measures commit cost and finds the largest columns on a synthetic database', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE tasks (id TEXT PRIMARY KEY, pipeline_data TEXT, title TEXT)');
    db.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
    for (let index = 0; index < 4; index += 1) db.run('INSERT INTO tasks VALUES (?, ?, ?)', [`t${index}`, 'x'.repeat(50_000), `任务${index}`]);
    db.run('INSERT INTO notes (body) VALUES (?)', ['short']);
    const file = join(root, 'data.db');
    writeFileSync(file, db.export());
    db.close();
    const before = readFileSync(file);

    const result = await benchSqlJs(file, { rounds: 2, scratchDir: join(root, 'scratch') });
    expect(result.fileBytes).toBe(before.length);
    expect(result.perCommitMs).toBeGreaterThanOrEqual(result.writeMs);
    expect(result.tables[0]).toMatchObject({ name: 'tasks', rows: 4 });
    expect(result.largestColumns[0]).toMatchObject({ table: 'tasks', column: 'pipeline_data', bytes: 200_000, maxRowBytes: 50_000 });
    expect(readFileSync(file).equals(before)).toBe(true); // input is never modified
  });

  it('records the decision and re-evaluation thresholds', () => {
    const doc = readFileSync('docs/design/2026-11-10-sqlite-evaluation.md', 'utf8');
    expect(doc).toContain('暂不迁移，继续用 sql.js');
    expect(doc).toContain('scripts/bench-sqljs.ts');
    expect(doc).toMatch(/> 300 ms/u);
  });
});
