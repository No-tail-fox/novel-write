import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROUTE = process.env.STORYDREAM_ENTRY_ROUTE === 'vox' ? 'vox' : 'motion-comic';
const ROUTE_LABEL = ROUTE === 'vox' ? 'VOX 视频' : 'AI 漫剧';
const WORKBENCH_SELECTOR = ROUTE === 'vox' ? '[data-editorial-collage-workbench="true"]' : '[data-motion-comic-workbench="true"]';
const SIDEBAR_VIEW = ROUTE === 'vox' ? 'editorial-collage' : 'motion-comic';
const ARTIFACTS = join(ROOT, '.artifacts', `${ROUTE === 'vox' ? 'vox' : 'motion-comic'}-entry-audit-2026-08-18`);
const TEMP_ROOT = join(ROOT, '.codex-audit-temp');
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const USER_DATA = process.env.STORYDREAM_HISTORY_DATA_DIR || join(process.env.APPDATA || '', 'storydream', 'storydream');
const bundledModules = process.env.CODEX_BUNDLED_NODE_MODULES;
const require = bundledModules ? createRequire(join(bundledModules, 'package.json')) : createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require('playwright');
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    return require('playwright-core');
  }
})();

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
      // Electron publishes CDP after creating the renderer.
    }
    await new Promise((accept) => setTimeout(accept, 150));
  }
  throw new Error('Electron CDP endpoint did not become ready.');
}

async function waitForShell(page) {
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(300);
}

async function inspect(page) {
  return page.evaluate(() => ({
    route: document.querySelector('.app-shell')?.getAttribute('data-shell-view') || '',
    bodyText: document.body.innerText.slice(0, 3000),
    workbench: Boolean(document.querySelector('[data-editorial-collage-workbench="true"], [data-motion-comic-workbench="true"]')),
    createPanel: Boolean(document.querySelector('.director-create-panel')),
    routeError: document.querySelector('.route-error-state')?.textContent?.trim() || '',
    alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim()).filter(Boolean),
    root: document.querySelector('#root')?.innerHTML.slice(0, 1000) || '',
  }));
}

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(TEMP_ROOT, { recursive: true });
  const profile = join(TEMP_ROOT, `${ROUTE}-entry-${Date.now()}`);
  await mkdir(profile, { recursive: true });
  const report = { status: 'running', route: ROUTE, statusLabel: ROUTE_LABEL, copiedDatabase: [], runtimeErrors: [], networkErrors: [], projectAudit: [], snapshots: [] };
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
    page.on('console', (message) => {
      if (message.type() === 'error') report.runtimeErrors.push({ type: 'console', message: message.text() });
    });
    page.on('requestfailed', (request) => report.networkErrors.push({ url: request.url(), failure: request.failure()?.errorText || 'unknown' }));
    await waitForShell(page);
    report.projectAudit = await page.evaluate(async (taskType) => {
      const list = await window.storydream.listTasks({ taskType, limit: 100 });
      return Promise.all(list.items.map(async (summary) => {
        const detail = await window.storydream.getTaskDetail(summary.id);
        let parsed = null;
        let parseError = '';
        try {
          parsed = detail?.pipelineData ? JSON.parse(detail.pipelineData) : null;
        } catch (error) {
          parseError = String(error);
        }
        return {
          id: summary.id,
          title: summary.name,
          status: summary.status,
          dataLength: detail?.pipelineData?.length || 0,
          parseError,
          version: parsed?.version ?? null,
          workflowKind: parsed?.workflowKind ?? null,
          stage: parsed?.stage ?? null,
          episodes: Array.isArray(parsed?.episodes) ? parsed.episodes.length : null,
        };
      }));
    }, ROUTE === 'vox' ? 'editorial-collage' : 'motion-comic');
    report.snapshots.push({ name: 'initial', ...(await inspect(page)) });
    await page.screenshot({ path: join(ARTIFACTS, '01-initial.png') });

    const newTask = page.locator('[data-nav-view="new-task"]').first();
    if (await newTask.isVisible().catch(() => false)) {
      await newTask.click();
      await page.waitForTimeout(250);
    } else {
      const back = page.getByRole('button', { name: '返回工作流列表', exact: true }).first();
      const createBack = page.getByRole('button', { name: '返回首页', exact: true }).first();
      if (await back.isVisible().catch(() => false)) await back.click();
      else if (await createBack.isVisible().catch(() => false)) await createBack.click();
      await page.locator('.app-shell[data-shell-view="new-task"]').waitFor({ state: 'visible', timeout: 15_000 });
    }
    report.snapshots.push({ name: 'after-new-task', ...(await inspect(page)) });
    await page.screenshot({ path: join(ARTIFACTS, '02-new-task.png') });

    const quickLaunch = page.locator('.director-quick-launch').getByRole('button', { name: ROUTE_LABEL, exact: true });
    if (await quickLaunch.count() !== 1) throw new Error(`Expected one main ${ROUTE_LABEL} quick-launch button, found ${await quickLaunch.count()}.`);
    await quickLaunch.click();
    report.snapshots.push({ name: 'immediate-after-click', ...(await inspect(page)) });
    await page.screenshot({ path: join(ARTIFACTS, '03-immediate-after-click.png') });
    await page.locator(WORKBENCH_SELECTOR).waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(1500);
    report.snapshots.push({ name: 'ready-after-click', ...(await inspect(page)) });
    await page.screenshot({ path: join(ARTIFACTS, '04-ready-after-click.png') });
    report.status = report.runtimeErrors.length || report.networkErrors.length ? 'runtime-errors' : 'passed';

    await page.getByRole('button', { name: '返回工作流列表', exact: true }).first().click();
    await page.locator('.app-shell[data-shell-view="new-task"]').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator(`[data-nav-view="${SIDEBAR_VIEW}"]`).first().click();
    report.snapshots.push({ name: 'sidebar-immediate-after-click', ...(await inspect(page)) });
    await page.locator(WORKBENCH_SELECTOR).waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(1_000);
    report.snapshots.push({ name: 'sidebar-after-click', ...(await inspect(page)) });
    await page.screenshot({ path: join(ARTIFACTS, '05-sidebar-after-click.png') });
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
