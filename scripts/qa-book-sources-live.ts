// Real anonymous source smoke check; also records responses for isolated UI QA.
import { discoverBooks } from '../src/shared/book-discovery';
import { mkdir, writeFile } from 'node:fs/promises';

const results = await Promise.all(['经营', '小狗钱钱'].map((query) => discoverBooks({ query, limit: 24 })));
await mkdir('.artifacts/book-sources', { recursive: true });
await writeFile('.artifacts/book-sources/live-results.json', JSON.stringify(results, null, 2), 'utf8');
console.log(JSON.stringify(results.map(({ query, sourceState, sources, items }) => ({ query, sourceState, sources, count: items.length })), null, 2));
if (results.some((result) => !result.items.length)) process.exitCode = 1;
