import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, reject) => {
      socket.addEventListener('open', resolvePromise, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

const root = resolve(import.meta.dirname, '..');
const artifactRoot = resolve(root, '.artifacts', 'hotboard-content-ui');
const profileRoot = resolve(artifactRoot, 'edge-profile');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9338;
const appUrl = process.env.STORYDREAM_QA_URL || 'http://127.0.0.1:5173/';

if (!profileRoot.startsWith(`${artifactRoot}\\`)) throw new Error('QA profile escaped the artifact directory.');
await mkdir(artifactRoot, { recursive: true });
await rm(profileRoot, { recursive: true, force: true });

const edge = spawn(edgePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileRoot}`,
  appUrl,
], { stdio: 'ignore', windowsHide: true });

try {
  const pageTarget = await waitForTarget(port, appUrl);
  const cdp = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await waitForExpression(cdp, "document.readyState === 'complete' && Boolean(document.querySelector('[data-editorial-shell]'))");

    const results = [];
    for (const viewport of [{ width: 1440, height: 900, name: 'desktop' }, { width: 920, height: 720, name: 'compact' }]) {
      await setViewport(cdp, viewport);
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitForExpression(cdp, "document.readyState === 'complete' && Boolean(document.querySelector('[data-editorial-shell]'))");
      await navigate(cdp, '实时热榜', '[data-hot-board-workbench]');
      await waitForExpression(cdp, "document.querySelectorAll('.hot-board-network-row').length === 3");
      await clickByText(cdp, '.hot-board-network-row:first-child button', '正文');
      await waitForExpression(cdp, "Boolean(document.querySelector('.hot-board-source-reader [data-content-kind]'))");
      await waitForExpression(cdp, "document.querySelectorAll('.hot-board-reader-media').length === 2");
      await waitForExpression(cdp, "[...document.querySelectorAll('.hot-board-reader-media img')].every((image) => image.complete)");
      const hoverMetrics = await evaluate(cdp, `(() => {
        const button = document.querySelector('.hot-board-network-row:first-child .sd-icon-button');
        if (!button) return { found: false };
        const before = button.getBoundingClientRect().toJSON();
        for (let index = 0; index < 5; index += 1) {
          button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
          button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        }
        const after = button.getBoundingClientRect().toJSON();
        return {
          found: true,
          layoutShift: Math.max(Math.abs(before.left - after.left), Math.abs(before.top - after.top), Math.abs(before.width - after.width), Math.abs(before.height - after.height)),
          tooltipCount: document.querySelectorAll('[role="tooltip"]').length,
        };
      })()`);
      const gallery = await captureHotBoard(cdp, viewport);
      await evaluate(cdp, `document.querySelector('.hot-board-reader-media')?.click()`);
      await waitForExpression(cdp, "Boolean(document.querySelector('.hot-board-image-viewer'))");
      const viewer = await captureImageViewer(cdp, viewport);
      await evaluate(cdp, `document.querySelector('[aria-label="返回图文"]')?.click()`);
      results.push({ ...gallery, viewer, hoverMetrics });
    }

    await setViewport(cdp, { width: 1440, height: 900, name: 'handoff' });
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForExpression(cdp, "document.readyState === 'complete' && Boolean(document.querySelector('[data-editorial-shell]'))");
    await waitForExpression(cdp, "[...document.querySelectorAll('button')].some((button) => button.textContent?.includes('实时热榜'))");
    await navigate(cdp, '实时热榜', '[data-hot-board-workbench]');
    await waitForExpression(cdp, "document.querySelectorAll('.hot-board-network-row').length === 3");
    await clickByText(cdp, '.hot-board-network-row:first-child button', '去创作');
    await waitForExpression(cdp, "Boolean(document.querySelector('[data-new-task-workbench]'))");
    await waitForExpression(cdp, "document.querySelectorAll('.search-source-card input:checked').length === 1");
    const handoff = await captureHandoff(cdp);

    const report = { appUrl, results, handoff };
    await writeFile(resolve(artifactRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (results.some((result) => (
      result.horizontalOverflow > 1
      || result.clippedControls.length > 0
      || result.rowCount !== 3
      || result.inlineContentCount !== 0
      || !result.singleLineRows
      || result.expandedKind !== 'summary'
      || result.expandedLength < 60
      || result.mediaCount !== 2
      || result.galleryClipped
      || !result.viewer.visible
      || !result.viewer.hasImageOrFallback
      || !result.viewer.withinViewport
      || result.viewer.horizontalOverflow > 1
      || result.viewer.clippedControls.length > 0
      || !result.previewWarningVisible
      || !result.hoverMetrics.found
      || result.hoverMetrics.layoutShift > 0.5
      || result.hoverMetrics.tooltipCount > 0
    ))) process.exitCode = 1;
    if (!handoff.aiModeActive || handoff.selectedSourceCount !== 1 || !handoff.sourceTextVisible || handoff.horizontalOverflow > 1 || handoff.clippedControls.length > 0) process.exitCode = 1;
  } finally {
    cdp.close();
  }
} finally {
  edge.kill();
}

async function setViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function captureHotBoard(cdp, viewport) {
  const metrics = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-hot-board-workbench]');
    const rows = [...root.querySelectorAll('.hot-board-network-row')];
    const reader = document.querySelector('.hot-board-source-reader');
    const expanded = reader?.querySelector('[data-content-kind]');
    const gallery = reader?.querySelector('.hot-board-reader-gallery');
    const mediaCards = [...(gallery?.querySelectorAll('.hot-board-reader-media') || [])];
    const galleryRect = gallery?.getBoundingClientRect();
    return {
      rowCount: rows.length,
      inlineContentCount: rows.filter((row) => Boolean(row.querySelector('.hot-board-item-main > p, .hot-board-source-content'))).length,
      singleLineRows: rows.every((row) => row.getBoundingClientRect().height <= 58),
      expandedKind: expanded?.getAttribute('data-content-kind') || '',
      expandedLength: expanded?.querySelector('.hot-board-reader-copy')?.textContent?.trim().length || 0,
      mediaCount: mediaCards.length,
      failedMediaCount: mediaCards.filter((card) => card.getAttribute('data-load-state') === 'failed').length,
      galleryClipped: Boolean(galleryRect && mediaCards.some((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left < galleryRect.left - 1 || rect.right > galleryRect.right + 1;
      })),
      previewLabel: root.querySelector('.hot-board-live-state')?.textContent?.trim() || '',
      previewWarningVisible: root.textContent?.includes('不代表实时数据') || false,
      horizontalOverflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, root.scrollWidth - root.clientWidth),
      clippedControls: clippedControls(root),
    };

    function clippedControls(container) {
      return [...container.querySelectorAll('button, select, input, textarea')].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return false;
        if (rect.bottom <= 0 || rect.top >= innerHeight) return false;
        const viewportClipped = rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1;
        if (!viewportClipped) return false;
        for (let ancestor = element.parentElement; ancestor && ancestor !== container; ancestor = ancestor.parentElement) {
          const ancestorStyle = getComputedStyle(ancestor);
          if (['auto', 'scroll'].includes(ancestorStyle.overflowY) || ['auto', 'scroll'].includes(ancestorStyle.overflowX)) return false;
        }
        return true;
      }).map((element) => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName);
    }
  })()`);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = resolve(artifactRoot, `hotboard-content-${viewport.name}.png`);
  await writeFile(file, Buffer.from(screenshot.data, 'base64'));
  return { viewport: `${viewport.width}x${viewport.height}`, screenshot: file, ...metrics };
}

async function captureImageViewer(cdp, viewport) {
  const metrics = await evaluate(cdp, `(() => {
    const viewer = document.querySelector('.hot-board-image-viewer');
    const dialog = viewer?.closest('[role="dialog"]');
    const rect = viewer?.getBoundingClientRect();
    return {
      visible: Boolean(viewer && rect && rect.width > 0 && rect.height > 0),
      hasImageOrFallback: Boolean(viewer?.querySelector('img, .hot-board-image-viewer-fallback')),
      withinViewport: Boolean(rect && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1),
      horizontalOverflow: dialog ? Math.max(dialog.scrollWidth - dialog.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth) : 0,
      clippedControls: dialog ? clippedControls(dialog) : [],
    };

    function clippedControls(container) {
      return [...container.querySelectorAll('button')].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return false;
        const viewportClipped = rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1;
        if (!viewportClipped) return false;
        for (let ancestor = element.parentElement; ancestor && ancestor !== container; ancestor = ancestor.parentElement) {
          const ancestorStyle = getComputedStyle(ancestor);
          if (['auto', 'scroll'].includes(ancestorStyle.overflowY) || ['auto', 'scroll'].includes(ancestorStyle.overflowX)) return false;
        }
        return true;
      }).map((element) => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName);
    }
  })()`);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = resolve(artifactRoot, `hotboard-image-viewer-${viewport.name}.png`);
  await writeFile(file, Buffer.from(screenshot.data, 'base64'));
  return { screenshot: file, ...metrics };
}

async function captureHandoff(cdp) {
  const metrics = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-new-task-workbench]');
    const selectedCards = [...root.querySelectorAll('.search-source-card')].filter((card) => card.querySelector('input:checked'));
    const aiButton = [...root.querySelectorAll('.new-task-source-actions button')].find((button) => button.textContent?.includes('AI 创作'));
    return {
      aiModeActive: aiButton?.classList.contains('active') || false,
      selectedSourceCount: selectedCards.length,
      sourceTextVisible: selectedCards[0]?.textContent?.includes('讨论集中在三个变化') || false,
      sourceUrlVisible: selectedCards[0]?.textContent?.includes('example.com/storydream-preview/ai-storyboard') || false,
      handoffMessage: [...root.querySelectorAll('.test-result')].map((item) => item.textContent?.trim()).filter(Boolean),
      horizontalOverflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, root.scrollWidth - root.clientWidth),
      clippedControls: [...root.querySelectorAll('button, select, input, textarea')].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return false;
        if (rect.bottom <= 0 || rect.top >= innerHeight) return false;
        const viewportClipped = rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1;
        if (!viewportClipped) return false;
        for (let ancestor = element.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
          const ancestorStyle = getComputedStyle(ancestor);
          if (['auto', 'scroll'].includes(ancestorStyle.overflowY) || ['auto', 'scroll'].includes(ancestorStyle.overflowX)) return false;
        }
        return true;
      }).map((element) => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName),
    };
  })()`);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = resolve(artifactRoot, 'hotboard-handoff-desktop.png');
  await writeFile(file, Buffer.from(screenshot.data, 'base64'));
  return { screenshot: file, ...metrics };
}

async function navigate(cdp, label, selector) {
  await waitForExpression(cdp, `[...document.querySelectorAll('button')].some((item) => item.textContent?.includes(${JSON.stringify(label)}))`);
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(${JSON.stringify(label)}));
    if (!button) throw new Error('Navigation button not found: ${label}');
    button.click();
    return true;
  })()`);
  await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
}

async function clickByText(cdp, selector, label) {
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent?.includes(${JSON.stringify(label)}));
    if (!button) throw new Error('Button not found: ${label}');
    button.click();
    return true;
  })()`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(cdp, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function waitForTarget(debugPort, targetUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === 'page' && item.url.startsWith(targetUrl));
      if (target) return target;
    } catch {
      // Edge is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error('Timed out waiting for the Edge debug target.');
}
