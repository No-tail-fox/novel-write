/** Import a pinned, byte-identical upstream tree. Never runs upstream setup scripts. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'vendor/lemo-upstream');
const revision = 'f17136060781a0068a7951245a3aa7835a7230de';
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/import-lemo-upstream.mjs <local-upstream-checkout> | --verify');
const sha256 = data => createHash('sha256').update(data).digest('hex');
if (source === '--verify') {
  const manifest = JSON.parse(await readFile(resolve(target, 'storydream-upstream.json'), 'utf8'));
  if (manifest.revision !== revision) throw new Error('Unexpected upstream revision');
  for (const file of manifest.files) {
    if (sha256(await readFile(resolve(target, file.path))) !== file.sha256) throw new Error(`Upstream modified: ${file.path}`);
  }
  console.log(`Verified ${manifest.files.length} original files at ${revision}`);
} else {
  if (await stat(target).catch(() => null)) throw new Error('Target already exists. Use --verify; do not overwrite local changes.');
  const git = args => {
    const result = spawnSync('git', ['-C', resolve(source), ...args], { maxBuffer: 384 * 1024 * 1024, windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.toString());
    return result.stdout;
  };
  const files = git(['ls-tree', '-rz', '--full-tree', revision]).toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    if (!match || match[3].split('/').some(part => !part || part === '.' || part === '..') || match[3].includes('\\')) throw new Error(`Unsupported tree entry: ${row}`);
    return { mode: match[1], blob: match[2], path: match[3] };
  });
  const ids = [...new Set(files.map(file => file.blob))];
  const batch = spawnSync('git', ['-C', resolve(source), 'cat-file', '--batch'], {
    input: ids.join('\n') + '\n', maxBuffer: 384 * 1024 * 1024, windowsHide: true,
  });
  if (batch.error || batch.status !== 0) throw new Error(batch.error?.message || batch.stderr.toString());
  const blobs = new Map(); let offset = 0;
  for (const id of ids) {
    const end = batch.stdout.indexOf(10, offset);
    const [oid, type, size] = batch.stdout.subarray(offset, end).toString().split(' ');
    if (oid !== id || type !== 'blob' || !/^\d+$/.test(size)) throw new Error('Invalid git batch response');
    const data = batch.stdout.subarray(end + 1, end + 1 + Number(size));
    if (createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex') !== id) throw new Error(`Invalid blob: ${id}`);
    blobs.set(id, data); offset = end + 2 + Number(size);
  }
  let bytes = 0;
  for (const file of files) {
    const data = blobs.get(file.blob), destination = resolve(target, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data, { flag: 'wx' });
    file.sha256 = sha256(data); file.bytes = data.length; bytes += data.length;
  }
  const manifest = {
    schemaVersion: 1, repository: 'https://github.com/lemomo-ai/lemo-opuscar', revision,
    sourcePolicy: 'Complete tracked source tree, unchanged. Dependencies and untracked downloads are not part of the Git tree.',
    licensing: { codeAndDocs: 'MIT', demoVideosAndStills: 'CC-BY-4.0, credit LemoLab and repository; identify changes', thirdParty: 'Per-demo CREDITS apply. See README.zh-CN.md for the three excluded voice recordings.' },
    bytes, files,
  };
  await writeFile(resolve(target, 'storydream-upstream.json'), JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.log(`Imported ${files.length} files (${bytes} bytes), revision ${revision}`);
}
