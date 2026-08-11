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
const artifactRoot = resolve(root, '.artifacts', 'benchmark-selection-ui');
const profileRoot = resolve(artifactRoot, 'edge-profile');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9337;
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
    await seedWorkspace(cdp);
    await waitForExpression(cdp, "document.readyState === 'complete' && Boolean(document.querySelector('[data-editorial-shell]'))");

    const results = [];
    for (const viewport of [{ width: 1440, height: 900, name: 'desktop' }, { width: 1080, height: 720, name: 'compact' }]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitForExpression(cdp, "document.readyState === 'complete' && Boolean(document.querySelector('[data-editorial-shell]'))");

      await navigate(cdp, '对标监控', '[data-local-lab-workbench="benchmark"]');
      results.push(await captureView(cdp, viewport, 'benchmark', '[data-local-lab-workbench="benchmark"]'));

      await navigate(cdp, '选品助手', '[data-local-lab-workbench="book-selection"]');
      results.push(await captureView(cdp, viewport, 'selection', '[data-local-lab-workbench="book-selection"]'));
    }

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate(cdp, '选品助手', '[data-local-lab-workbench="book-selection"]');
    await clickByText(cdp, '.selection-inspector-tabs button', '证据');
    await clickByText(cdp, '.selection-evidence-item button', '查看来源');
    await waitForExpression(cdp, "Boolean(document.querySelector('[data-local-lab-workbench=\"benchmark\"]'))");
    const evidenceReturn = await evaluate(cdp, `(() => {
      const active = document.querySelector('.benchmark-post-row.active');
      return { activeTitle: active?.querySelector('.benchmark-post-copy strong')?.textContent?.trim() || '', matched: active?.textContent?.includes('三分钟讲透苏东坡') || false };
    })()`);

    const report = { appUrl, results, evidenceReturn };
    await writeFile(resolve(artifactRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (results.some((result) => result.horizontalOverflow > 1 || result.clippedControls.length > 0 || result.paneOverlap)) process.exitCode = 1;
    if (results.filter((result) => result.view === 'benchmark').some((result) => result.coverImageCount === 0 || result.brokenCoverCount > 0 || result.fallbackCoverCount === 0)) process.exitCode = 1;
    if (!evidenceReturn.matched) process.exitCode = 1;
  } finally {
    cdp.close();
  }
} finally {
  edge.kill();
}

async function seedWorkspace(cdp) {
  const now = Date.now();
  const groups = [{
    id: 'group-history',
    name: '人文历史矩阵',
    track: '图书带货',
    tags: ['历史', '人物故事'],
    notes: '观察同一选题在三平台的叙事差异。',
    refreshPolicy: 'manual',
    accounts: [
      { id: 'group-history:douyin', platform: 'douyin', url: 'https://www.douyin.com/user/MS4wLjABAAAAQA', displayName: '历史研习社', syncState: 'manual-only', lastSyncedAt: null, errorMessage: '' },
      { id: 'group-history:wechat-channels', platform: 'wechat-channels', url: 'https://channels.weixin.qq.com/profile/history', displayName: '人物志', syncState: 'manual-only', lastSyncedAt: null, errorMessage: '' },
      { id: 'group-history:bilibili', platform: 'bilibili', url: 'https://space.bilibili.com/123456', displayName: '人文档案馆', syncState: 'manual-only', lastSyncedAt: null, errorMessage: '' },
    ],
    createdAt: now - 86400000,
    updatedAt: now,
  }];
  const posts = [
    benchmarkPost('post-douyin', 'douyin', '三分钟讲透苏东坡为何一生豁达', '历史研习社', 'https://www.douyin.com/video/7511111111111111111', ['苏东坡', '人物故事'], { plays: 128000, likes: 15600, comments: 932, favorites: 4100, shares: 2700 }, now, 88),
    benchmarkPost('post-bilibili', 'bilibili', '苏轼被贬黄州后，究竟写了什么', '人文档案馆', 'https://www.bilibili.com/video/BV1QA411c7mD', ['苏东坡', '宋史'], { plays: 96000, likes: 8200, comments: 611, favorites: 5300, shares: 1200, coins: 3900, danmaku: 760 }, now - 3600000, 84),
    benchmarkPost('post-wechat', 'wechat-channels', '真正的豁达，是看清生活后仍然热爱', '人物志', 'https://channels.weixin.qq.com/s/history-story', ['苏东坡', '人生智慧'], { likes: 6300, comments: 448, shares: 1800 }, now - 7200000, 76),
    benchmarkPost('post-douyin-2', 'douyin', '王阳明龙场悟道的关键一夜', '历史研习社', 'https://www.douyin.com/video/7522222222222222222', ['王阳明', '人物故事'], { plays: 72000, likes: 7500, comments: 405, favorites: 1900, shares: 880 }, now - 10800000, 71),
  ];
  const selections = [
    selection('图书带货', 'benchmark-post-douyin', '苏东坡传', 86, 'planned', posts[0], now),
    selection('图书带货', 'benchmark-post-bilibili', '苏轼十讲', 81, 'watching', posts[1], now - 3600000),
    selection('人物故事', 'manual-wangyangming', '知行合一王阳明', 73, 'candidate', posts[3], now - 7200000),
  ];
  const expression = `(() => {
    localStorage.setItem('storydream-benchmark-groups', ${JSON.stringify(JSON.stringify(groups))});
    localStorage.setItem('storydream-benchmark-posts', ${JSON.stringify(JSON.stringify(posts))});
    localStorage.setItem('storybound-book-selections', ${JSON.stringify(JSON.stringify(selections))});
    sessionStorage.clear();
    location.reload();
  })()`;
  await cdp.send('Runtime.evaluate', { expression });
}

function coverForPlatform(platform) {
  const palette = {
    douyin: ['#e5484d', '#ffd7d9'],
    'wechat-channels': ['#1f9d67', '#d4f7e4'],
    bilibili: ['#00a6d8', '#d7f5ff'],
  }[platform] || ['#4b5563', '#e5e7eb'];
  const label = { douyin: '抖音', 'wechat-channels': '视频号', bilibili: 'B站' }[platform] || '封面';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640"><rect width="480" height="640" fill="${palette[1]}"/><rect x="28" y="28" width="424" height="584" rx="18" fill="${palette[0]}"/><circle cx="240" cy="236" r="86" fill="rgba(255,255,255,.22)"/><path d="M132 430h216" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity=".9"/><text x="240" y="530" fill="#fff" font-size="46" font-family="Arial, sans-serif" text-anchor="middle" font-weight="700">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
function benchmarkPost(id, platform, title, author, sourceUrl, tags, values, updatedAt, score) {
  const metrics = {};
  for (const key of ['plays', 'likes', 'comments', 'favorites', 'shares', 'coins', 'danmaku']) {
    metrics[key] = key in values ? { value: values[key] } : { value: null, reason: '平台未提供或本次导入未填写' };
  }
  return {
    id,
    groupId: 'group-history',
    platform,
    sourceUrl,
    title,
    author,
    accountUrl: '',
    coverUrl: id === 'post-wechat' ? 'data:image/png;base64,broken' : coverForPlatform(platform),
    publishedAt: updatedAt - 7200000,
    durationSeconds: 86,
    transcript: `以${title}为主题，从冲突切入，解释人物选择与今天的现实意义。`,
    tags,
    metrics,
    snapshots: [
      { capturedAt: updatedAt - 3600000, metrics: scaleMetrics(metrics, 0.62) },
      { capturedAt: updatedAt, metrics },
    ],
    isFavorite: score >= 80,
    workflowStatus: score >= 80 ? 'shortlisted' : 'new',
    note: score >= 80 ? '标题冲突明确，收藏与转发信号值得复用。' : '',
    createdAt: updatedAt - 3600000,
    updatedAt,
  };
}

function scaleMetrics(metrics, scale) {
  return Object.fromEntries(Object.entries(metrics).map(([key, metric]) => [key, metric.value === null ? metric : { value: Math.round(metric.value * scale) }]));
}

function selection(theme, bookId, name, total, status, post, updatedAt) {
  return {
    theme,
    bookId,
    updatedAt,
    data: {
      name,
      category: '人物传记',
      keyword: post.tags.join('、'),
      sellPoint: '用人物低谷与关键选择建立情绪共鸣，再回到可执行的人生启发。',
      audience: '对历史人物与个人成长感兴趣的 25-45 岁读者',
      selectionStatus: status,
      opportunityScore: { demand: total + 3, gap: total - 2, fit: total, conversion: total - 5, executionEase: 78, total, confidence: total >= 80 ? 'medium' : 'low', confirmed: total >= 85 },
      evidence: [{ postId: post.id, platform: post.platform, title: post.title, sourceUrl: post.sourceUrl, burstScore: total, note: '深互动比例高，且同主题具备跨平台复现迹象。' }],
      riskNote: '人物引语与历史细节发布前需二次核验。',
      creativeBrief: '',
    },
  };
}

async function navigate(cdp, label, selector) {
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

async function captureView(cdp, viewport, view, selector) {
  await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  const geometry = await evaluate(cdp, `(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    const paneSelectors = ${JSON.stringify(view === 'benchmark' ? ['.benchmark-group-rail', '.benchmark-results-panel', '.benchmark-inspector'] : ['.selection-main-panel', '.selection-inspector'])};
    const panes = paneSelectors.map((paneSelector) => {
      const element = root.querySelector(paneSelector);
      const rect = element?.getBoundingClientRect();
      return rect ? { selector: paneSelector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    }).filter(Boolean);
    const coverImages = [...root.querySelectorAll('.benchmark-cover img')];
    const visibleControls = [...root.querySelectorAll('button, select, input, textarea')].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
    const clippedControls = visibleControls.filter((element) => {
      const rect = element.getBoundingClientRect();
      const viewportClipped = rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1;
      if (!viewportClipped) return false;
      for (let ancestor = element.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (['auto', 'scroll'].includes(style.overflowY) || ['auto', 'scroll'].includes(style.overflowX)) return false;
      }
      return true;
    }).map((element) => ({ text: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 32) || element.tagName, rect: element.getBoundingClientRect().toJSON() }));
    const paneOverlap = panes.some((pane, index) => panes.slice(index + 1).some((other) => pane.left < other.right - 1 && pane.right > other.left + 1 && pane.top < other.bottom - 1 && pane.bottom > other.top + 1));
    return {
      title: document.querySelector('.page-header h1')?.textContent?.trim() || '',
      rootRect: root.getBoundingClientRect().toJSON(),
      panes,
      paneOverlap,
      horizontalOverflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, root.scrollWidth - root.clientWidth),
      clippedControls,
      coverImageCount: coverImages.length,
      brokenCoverCount: coverImages.filter((image) => !image.complete || image.naturalWidth <= 0).length,
      fallbackCoverCount: root.querySelectorAll('.benchmark-cover[data-cover-state="fallback"]').length,
    };
  })()`);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = resolve(artifactRoot, `${view}-${viewport.name}.png`);
  await writeFile(file, Buffer.from(screenshot.data, 'base64'));
  return { view, viewport: `${viewport.width}x${viewport.height}`, screenshot: file, ...geometry };
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
