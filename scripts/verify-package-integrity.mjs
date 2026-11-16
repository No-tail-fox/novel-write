import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const [mode, manifestArg, unpackedArg] = process.argv.slice(2);
const fail = (message) => { throw new Error(`[package-integrity] ${message}`); };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const config = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const required = ['dist-renderer/index.html', 'dist-electron/electron/main.js', 'dist-electron/electron/preload.js', 'dist-electron/electron/AGENT_SEARCH_LICENSE.txt', 'dist-electron/electron/agent-search-mcp-server.cjs'];
const resourceFiles = ['python/python.exe', 'pi-agent-worker/dist/worker.mjs', 'pi-agent-worker/package.json'];
function regularFile(path) {
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size === 0) fail(`Missing or empty file: ${path}`);
}
function snapshot() {
  const files = {};
  function walk(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail(`Linked build input is unsafe for packaging: ${path}. Use a real directory without deleting the link target.`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name));
    } else if (stat.isFile()) {
      const name = relative(root, path).replaceAll('\\', '/');
      files[name] = hash(readFileSync(path));
    }
  }
  for (const name of ['dist-renderer', 'dist-electron']) {
    if (!existsSync(join(root, name))) fail(`Missing build directory: ${name}`);
    walk(join(root, name));
  }
  for (const name of required) regularFile(join(root, name));
  files['package.json'] = hash(readFileSync(join(root, 'package.json')));
  for (const item of config.build.extraResources ?? []) {
    if (typeof item !== 'object' || !item.from || !item.to) fail('Unsupported extraResources entry; update integrity validation.');
    if (!existsSync(join(root, item.from))) fail(`Missing extraResources source: ${item.from}`);
  }
  for (const name of ['vendor/python/python.exe', 'services/pi-agent-worker/dist/worker.mjs']) regularFile(join(root, name));
  return { version: config.version, files, resources: config.build.extraResources };
}
if (!manifestArg || !['before', 'after'].includes(mode)) fail('Usage: node scripts/verify-package-integrity.mjs before|after MANIFEST [UNPACKED_DIR]');
const manifestPath = resolve(manifestArg);
if (mode === 'before') {
  const manifest = snapshot();
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[package-integrity] Recorded ${Object.keys(manifest.files).length} build-file hashes; build directories contain no links.`);
} else {
  if (!unpackedArg) fail('UNPACKED_DIR is required for after verification.');
  const expected = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const current = snapshot();
  for (const name of new Set([...Object.keys(expected.files), ...Object.keys(current.files)])) {
    if (expected.files[name] !== current.files[name]) fail(`Build inputs changed during packaging: ${name}. Do not distribute this build; rebuild from stable inputs.`);
  }
  const unpacked = resolve(unpackedArg);
  const archive = join(unpacked, 'resources', 'app.asar');
  regularFile(join(unpacked, 'StoryDream.exe'));
  regularFile(archive);
  let verifiedFiles = 0;
  for (const [name, digest] of Object.entries(expected.files)) {
    // electron-builder intentionally rewrites package.json metadata.
    if (name === 'package.json') continue;
    // Type declarations are intentionally excluded by electron-builder's defaults.
    // They remain in the input snapshot so concurrent builds are still detected.
    if (name.endsWith('.d.ts')) continue;
    let bytes;
    // ASAR's Windows lookup needs native separators, notably for dot-directories.
    try { bytes = asar.extractFile(archive, join(...name.split('/'))); }
    catch (error) { fail(`Packaged file missing/unreadable: ${name}: ${error.message}`); }
    if (hash(bytes) !== digest) fail(`Packaged file differs from verified input: ${name}`);
    verifiedFiles++;
  }
  const packagedConfig = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  if (packagedConfig.version !== expected.version || packagedConfig.main !== (config.build.extraMetadata?.main ?? config.main)) fail('Packaged version/main does not match the build configuration.');
  for (const item of expected.resources) {
    const dest = join(unpacked, 'resources', item.to);
    if (!existsSync(dest)) fail(`Packaged extraResources destination missing: ${item.to}`);
    if (lstatSync(dest).isDirectory() && readdirSync(dest).length === 0) fail(`Packaged resource directory is empty: ${item.to}`);
    if (lstatSync(dest).isFile()) regularFile(dest);
  }
  for (const name of resourceFiles) regularFile(join(unpacked, 'resources', name));
  console.log(`[package-integrity] PASS: ${verifiedFiles} built files match app.asar; entry points, version and configured resource destinations verified.`);
}
