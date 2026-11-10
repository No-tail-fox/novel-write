#!/usr/bin/env node
/**
 * P-3: offline install-layout check.
 *
 * Verifies that a packaged `resources` directory (electron-builder `release/win-unpacked/resources`, or
 * the installed `C:\Program Files\StoryDream\resources`) contains every runtime the routes resolve at
 * run time: bundled Python + Playwright driver + matching headless Chromium + imageio ffmpeg (Lemo
 * upstream renderer), the vendored Lemo/Pixelle trees, three for the staged render root, and the
 * licence files. `--dev` checks the same layout in the repo (vendor/…, node_modules/three).
 *
 * It does not replace a clean-machine install run (P-3 manual acceptance); it catches packaging
 * regressions before shipping. Exit code 0 = all required checks pass.
 *
 * Usage: node scripts/check-install-layout.mjs [<resourcesDir>] [--dev] [--json]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isDir = path => { try { return statSync(path).isDirectory(); } catch { return false; } };
const isFile = path => { try { return statSync(path).isFile(); } catch { return false; } };
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

/** Map logical components to paths for a packaged resources dir or the dev repo. */
export function installLayout(root, { dev = false } = {}) {
  const base = resolve(root);
  return dev
    ? { python: join(base, 'vendor', 'python'), lemo: join(base, 'vendor', 'lemo-upstream'), pixelle: join(base, 'vendor', 'pixelle-upstream'), pixelleWorker: join(base, 'services', 'pixelle-worker'), three: join(base, 'node_modules', 'three'), notices: join(base, 'THIRD_PARTY_NOTICES.md'), licenses: join(base, 'THIRD_PARTY_LICENSES'), app: null }
    : { python: join(base, 'python'), lemo: join(base, 'lemo-upstream'), pixelle: join(base, 'pixelle-upstream'), pixelleWorker: join(base, 'pixelle-worker'), three: join(base, 'lemo-upstream-deps', 'three'), notices: join(base, 'THIRD_PARTY_NOTICES.md'), licenses: join(base, 'THIRD_PARTY_LICENSES'), app: base };
}

/**
 * @param {string} root resources dir (packaged) or repo root (dev)
 * @param {{ dev?: boolean, platform?: string }} [options]
 * @returns {{ passed: boolean, checks: Array<{ id: string, status: 'pass'|'fail'|'warn', detail: string }> }}
 */
export function checkInstallLayout(root, options = {}) {
  const windows = (options.platform ?? process.platform) === 'win32';
  const layout = installLayout(root, options);
  const checks = [];
  const add = (id, ok, detail, severity = 'fail') => checks.push({ id, status: ok ? 'pass' : severity, detail });

  // Bundled Python runtime (Lemo upstream renderer, Pixelle worker).
  const pythonExe = join(layout.python, windows ? 'python.exe' : join('bin', 'python3'));
  add('python', isFile(pythonExe), isFile(pythonExe) ? `Python 运行时：${pythonExe}` : `缺少随应用打包的 Python：${pythonExe}`);
  const sitePackages = windows ? join(layout.python, 'Lib', 'site-packages') : join(layout.python, 'lib', 'site-packages');
  const driver = join(sitePackages, 'playwright', 'driver');
  const driverNode = join(driver, windows ? 'node.exe' : 'node');
  add('playwright-node', isFile(driverNode), isFile(driverNode) ? 'Playwright 自带 Node 存在' : `缺少 Playwright 自带 Node：${driverNode}`);
  const corePackage = readJson(join(driver, 'package', 'package.json'));
  const browsers = readJson(join(driver, 'package', 'browsers.json'));
  add('playwright-core', corePackage?.name === 'playwright-core' && isFile(join(driver, 'package', 'index.mjs')), corePackage ? `playwright-core ${corePackage.version ?? '?'}` : `playwright-core 缺失或损坏：${join(driver, 'package')}`);
  const shell = browsers?.browsers?.find(item => item.name === 'chromium-headless-shell');
  const shellDir = shell ? join(layout.python, 'playwright-browsers', `chromium_headless_shell-${shell.revision}`) : '';
  add('headless-chromium', Boolean(shell) && isDir(shellDir), shell ? (isDir(shellDir) ? `无头 Chromium ${shell.revision}` : `缺少与 playwright-core 匹配的无头 Chromium：${shellDir}`) : 'browsers.json 中没有 chromium-headless-shell');
  const ffmpegDir = join(sitePackages, 'imageio_ffmpeg', 'binaries');
  const ffmpeg = isDir(ffmpegDir) ? readdirSync(ffmpegDir).filter(name => /^ffmpeg/iu.test(name) && (!windows || /\.exe$/iu.test(name))).sort().pop() : undefined;
  add('ffmpeg', Boolean(ffmpeg), ffmpeg ? `ffmpeg：${ffmpeg}（运行时会在缓存目录建 ffmpeg.exe 别名）` : `缺少随应用打包的 ffmpeg：${ffmpegDir}`);

  // Vendored upstream trees, pinned by their manifests.
  const lemoManifest = readJson(join(layout.lemo, 'storydream-upstream.json'));
  add('lemo-upstream', Boolean(lemoManifest?.revision) && isFile(join(layout.lemo, 'core', 'render', 'video.mjs')), lemoManifest?.revision ? `Lemo 上游 ${String(lemoManifest.revision).slice(0, 12)}` : `Lemo 上游树缺失或缺少 storydream-upstream.json：${layout.lemo}`);
  add('three', isFile(join(layout.three, 'package.json')) && isDir(join(layout.three, 'build')), isDir(join(layout.three, 'build')) ? 'three（渲染根暂存用）存在' : `缺少 three：${layout.three}`);
  add('pixelle-upstream', isDir(layout.pixelle), isDir(layout.pixelle) ? 'Pixelle 上游存在' : `缺少 Pixelle 上游：${layout.pixelle}`, 'warn');
  add('pixelle-worker', isDir(layout.pixelleWorker), isDir(layout.pixelleWorker) ? 'Pixelle worker 存在' : `缺少 Pixelle worker：${layout.pixelleWorker}`, 'warn');

  // Licences (P-6).
  add('notices', isFile(layout.notices), isFile(layout.notices) ? 'THIRD_PARTY_NOTICES.md 存在' : `缺少 THIRD_PARTY_NOTICES.md：${layout.notices}`);
  add('licenses', isDir(layout.licenses), isDir(layout.licenses) ? 'THIRD_PARTY_LICENSES 存在' : `缺少 THIRD_PARTY_LICENSES：${layout.licenses}`);
  if (layout.app) {
    const asar = join(layout.app, 'app.asar');
    const unpacked = join(layout.app, 'app');
    add('app-bundle', isFile(asar) || isDir(unpacked), isFile(asar) ? 'app.asar 存在' : isDir(unpacked) ? 'app 目录存在' : `缺少 app.asar：${asar}`);
  }
  return { passed: checks.every(check => check.status !== 'fail'), checks };
}

function main(argv) {
  const dev = argv.includes('--dev');
  const json = argv.includes('--json');
  const positional = argv.filter(arg => !arg.startsWith('--'));
  const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const root = positional[0] ?? (dev ? repo : join(repo, 'release', 'win-unpacked', 'resources'));
  if (!existsSync(root)) {
    console.error(`[install-layout] 目录不存在：${root}（先运行打包，或使用 --dev 检查仓库布局）`);
    return 2;
  }
  const result = checkInstallLayout(root, { dev });
  if (json) console.log(JSON.stringify(result, null, 2));
  else for (const check of result.checks) console.log(`[${check.status}] ${check.id}: ${check.detail}`);
  console.log(result.passed ? '[install-layout] 通过' : '[install-layout] 未通过');
  return result.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
