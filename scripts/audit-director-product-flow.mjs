import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACTS = join(ROOT, '.artifacts', 'director-product-flow-audit-2026-08-18', 'current');
const TEMP_ROOT = join(ROOT, '.codex-audit-temp');
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const USER_DATA = process.env.STORYDREAM_HISTORY_DATA_DIR || join(process.env.APPDATA || '', 'storydream', 'storydream');
const bundledModules = process.env.CODEX_BUNDLED_NODE_MODULES;
const require = bundledModules ? createRequire(join(bundledModules, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright');

async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) => server.listen(0, '127.0.0.1', accept).once('error', reject));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((accept) => server.close(accept));
  return port;
}

async function copyDatabase(profile) {
  const targetDir = join(profile, 'storydream');
  await mkdir(targetDir, { recursive: true });
  const copied = [];
  for (const name of ['data.db', 'data.db-wal', 'data.db-shm']) {
    const source = join(USER_DATA, name);
    try {
      const info = await stat(source);
      await copyFile(source, join(targetDir, name));
      copied.push({ name, bytes: info.size });
    } catch (error) {
      if (name === 'data.db') throw error;
    }
  }
  return copied;
}

async function waitForCdp(port, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron exited before CDP was ready: ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // Electron publishes the endpoint after its first renderer is ready.
    }
    await new Promise((accept) => setTimeout(accept, 150));
  }
  throw new Error('Electron CDP endpoint did not become ready.');
}

async function capture(page, name, report) {
  await page.waitForTimeout(200);
  const path = join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path });
  const snapshot = await page.evaluate(() => ({
    route: document.querySelector('.app-shell')?.getAttribute('data-shell-view') || '',
    title: document.querySelector('.director-create-heading h2, .director-topbar-project strong, h1')?.textContent?.trim() || '',
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map((node) => node.textContent?.trim().slice(0, 240) || ''),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim()).filter(Boolean),
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  }));
  report.captures.push({ name, path, snapshot });
  return path;
}

async function openFromHome(page, route) {
  const targetView = route === 'vox' ? 'editorial-collage' : 'motion-comic';
  const targetLabel = route === 'vox' ? 'VOX 视频' : 'AI 漫剧';
  const workbench = route === 'vox' ? '[data-editorial-collage-workbench="true"]' : '[data-motion-comic-workbench="true"]';
  if (await documentView(page) !== 'new-task') {
    const back = page.getByRole('button', { name: '返回工作流列表', exact: true }).first();
    if (await back.isVisible().catch(() => false)) await back.click();
    else await page.locator('[data-nav-view="new-task"]').first().click();
    await page.locator('.app-shell[data-shell-view="new-task"]').waitFor({ state: 'visible', timeout: 15_000 });
  }
  const quickLaunch = page.locator('.director-quick-launch').getByRole('button', { name: targetLabel, exact: true });
  await quickLaunch.click();
  await page.locator(`.app-shell[data-shell-view="${targetView}"]`).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator(workbench).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.director-desk-grid').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(900);
}

function documentView(page) {
  return page.locator('.app-shell').getAttribute('data-shell-view');
}

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(TEMP_ROOT, { recursive: true });
  const profile = join(TEMP_ROOT, `director-product-flow-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const report = { status: 'running', copiedDatabase: [], runtimeErrors: [], captures: [] };
  let child;
  let browser;
  try {
    report.copiedDatabase = await copyDatabase(profile);
    const port = await freePort();
    const environment = { ...process.env, NODE_ENV: 'production' };
    delete environment.VITE_DEV_SERVER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    child = spawn(ELECTRON, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', `--user-data-dir=${profile}`, ROOT], { cwd: ROOT, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const endpoint = await waitForCdp(port, child);
    browser = await chromium.connectOverCDP(endpoint);
    const page = browser.contexts()[0].pages()[0];
    page.on('pageerror', (error) => report.runtimeErrors.push({ type: 'pageerror', message: String(error) }));
    page.on('console', (message) => { if (message.type() === 'error') report.runtimeErrors.push({ type: 'console', message: message.text() }); });
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('[data-nav-view="new-task"]').first().click();
    await page.locator('.app-shell[data-shell-view="new-task"]').waitFor({ state: 'visible', timeout: 15_000 });
    await capture(page, '01-home-entry', report);

    await openFromHome(page, 'vox');
    await page.getByRole('button', { name: '新建 VOX 项目', exact: true }).click();
    await page.locator('.director-create-panel').waitFor({ state: 'visible', timeout: 10_000 });
    await capture(page, '02-vox-create-empty', report);
    await page.getByLabel('项目标题', { exact: true }).fill('拉萨旧城的一封信');
    await page.getByLabel('原始文案', { exact: true }).fill('清晨的拉萨旧城被第一束阳光唤醒。沿着石板路前行，镜头依次揭示人物、地点、证据与结论，形成一条可以直接生成和审片的三十秒叙事。');
    await page.getByLabel('画幅', { exact: true }).selectOption('9:16');
    await capture(page, '03-vox-create-filled', report);

    await page.getByRole('button', { name: '返回首页', exact: true }).click();
    await page.locator('.app-shell[data-shell-view="new-task"]').waitFor({ state: 'visible', timeout: 15_000 });
    await openFromHome(page, 'vox');
    await page.getByRole('button', { name: '项目设置', exact: true }).click();
    await page.locator('.app-shell[data-shell-view="settings"]').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(500);
    await capture(page, '04-vox-model-settings', report);

    await page.locator('[data-nav-view="motion-comic"]').first().click();
    await page.locator('.director-desk-grid').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: '新建 AI 漫剧项目', exact: true }).click();
    await page.locator('.director-create-panel').waitFor({ state: 'visible', timeout: 10_000 });
    await capture(page, '05-ai-comic-create-empty', report);
    await page.getByLabel('系列名称', { exact: true }).fill('雨夜来信');
    await page.getByLabel('核心设定', { exact: true }).fill('女记者在雨夜收到一封来自十年前的信，每一集追查一个被刻意抹去的线索。');
    await page.getByLabel('首集标题', { exact: true }).fill('消失的寄件人');
    await page.getByLabel('画幅', { exact: true }).selectOption('16:9');
    await capture(page, '06-ai-comic-create-filled', report);

    await page.getByRole('button', { name: '返回首页', exact: true }).click();
    await page.locator('.app-shell[data-shell-view="new-task"]').waitFor({ state: 'visible', timeout: 15_000 });
    await openFromHome(page, 'motion-comic');
    await page.getByRole('button', { name: '项目设置', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10_000 });
    await capture(page, '07-ai-comic-series-settings', report);
    await page.getByRole('button', { name: '模型设置', exact: true }).click();
    await page.locator('.app-shell[data-shell-view="settings"]').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(500);
    await capture(page, '08-ai-comic-model-settings', report);
    await page.locator('.settings-tab').filter({ hasText: 'AI 绘图' }).click();
    await page.locator('.settings-heading h2').filter({ hasText: 'AI 绘图' }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(300);
    await capture(page, '09-image-provider-settings', report);

    report.status = report.runtimeErrors.length ? 'runtime-errors' : 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = `${error?.name || 'Error'}: ${error?.message || error}`;
    throw error;
  } finally {
    await writeFile(join(ARTIFACTS, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await browser?.close().catch(() => undefined);
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((accept) => child.once('exit', accept));
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { await rm(profile, { recursive: true, force: true }); break; } catch { if (attempt === 3) throw new Error(`Failed to remove temporary profile ${profile}`); await new Promise((accept) => setTimeout(accept, 250 * (attempt + 1))); }
    }
  }
}

await main();
