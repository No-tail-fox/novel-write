import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = 'https://my.feishu.cn/wiki/HOU4wE5KxinYxGkKN31cqqlAnTd';
const DEFAULT_OUT_DIR = 'data/coze-workflows/feishu-sources';
const DEFAULT_MANIFEST = 'data/coze-workflows/feishu-sources-manifest.json';
const DEFAULT_CHROME_PORT = 9336;

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function fetchFeishuCozeWorkflows(options = {}) {
  const pageUrl = options.url || DEFAULT_URL;
  const outDir = resolve(options.outDir || DEFAULT_OUT_DIR);
  const manifestPath = resolve(options.manifestPath || DEFAULT_MANIFEST);
  const chromePath = options.chromePath || findDefaultChromePath();
  const chromePort = Number(options.chromePort || DEFAULT_CHROME_PORT);
  const userDataDir = resolve(options.userDataDir || 'tmp/chrome-feishu-coze-fetch-profile');
  const recordSeeds = await loadRecordSeeds(options.recordSeeds, options.recordSeedPaths);

  await mkdir(outDir, { recursive: true });
  await mkdir(dirname(manifestPath), { recursive: true });

  let html = '';
  let cookieHeader = '';
  let pageTitle = '';
  let runtimeSources = [];

  if (options.htmlPath) {
    html = await readFile(options.htmlPath, 'utf8');
  }

  if (!html || !options.cookieHeader) {
    const session = await loadFeishuPageSession({ pageUrl, chromePath, chromePort, userDataDir, keepProfile: options.keepProfile, recordSeeds });
    html ||= session.html;
    cookieHeader = options.cookieHeader || session.cookieHeader;
    pageTitle = session.pageTitle;
    runtimeSources = session.runtimeSources || [];
  } else {
    cookieHeader = options.cookieHeader;
  }

  const sources = mergeFeishuWorkflowSources(extractFeishuWorkflowSourcesFromHtml(html), runtimeSources);
  if (!sources.length) {
    throw new Error('No Feishu .txt workflow attachment sources were found in the page HTML.');
  }

  const downloaded = [];
  const failures = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const filename = sanitizeWorkflowFilename(source.name, index + 1, source.recordId || source.token);
    const outputPath = resolve(outDir, filename);
    try {
      const body = await downloadFeishuFile(source.token, {
        cookieHeader,
        pageUrl,
        host: options.downloadHost || 'internal-api-drive-stream.feishu.cn',
      });
      await writeFile(outputPath, body);
      downloaded.push({
        ...source,
        index: index + 1,
        outputPath,
        bytes: body.byteLength,
      });
      if (options.verbose) {
        console.log(`[${index + 1}/${sources.length}] downloaded ${source.name}`);
      }
    } catch (error) {
      failures.push({
        ...source,
        index: index + 1,
        outputPath,
        error: error instanceof Error ? error.message : String(error),
      });
      if (options.verbose) {
        console.error(`[${index + 1}/${sources.length}] failed ${source.name}: ${failures.at(-1).error}`);
      }
    }
  }

  let bundlePath = '';
  let bundleError = '';
  if (options.bundlePath && downloaded.length) {
    const args = ['scripts/convert-coze-workflows.mjs', '--out', resolve(options.bundlePath)];
    if (options.installDbPath) {
      args.push('--install-db', resolve(options.installDbPath));
    }
    args.push(outDir);
    bundlePath = resolve(options.bundlePath);
    try {
      await runNodeScript(args);
    } catch (error) {
      bundleError = error instanceof Error ? error.message : String(error);
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceUrl: pageUrl,
    pageTitle,
    expectedCount: sources.length,
    downloadedCount: downloaded.length,
    failedCount: failures.length,
    outDir,
    bundlePath: bundlePath || null,
    bundleError: bundleError || null,
    installedDbPath: options.installDbPath ? resolve(options.installDbPath) : null,
    sources,
    downloaded,
    failures,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  if (bundleError) {
    const error = new Error(bundleError);
    error.manifestPath = manifestPath;
    throw error;
  }
  return { ...manifest, manifestPath };
}

export function extractFeishuWorkflowSourcesFromHtml(html) {
  const blockRegex =
    /"([^"]+)":\{"id":"\1","version":\d+,"data":\{"type":"file"(?:(?!"[A-Za-z0-9_]+":\{"id":)[\s\S])*?"file":\{"token":"([^"]+)","mimeType":"([^"]+)","size":(\d+),"name":"([^"]+)"/g;
  const sources = [];
  const seenTokens = new Set();
  let match;
  while ((match = blockRegex.exec(html))) {
    const [, recordId, token, mimeType, rawSize, rawName] = match;
    const name = decodeJsonString(rawName);
    if (!/\.txt$/i.test(name)) continue;
    if (seenTokens.has(token)) continue;
    seenTokens.add(token);
    sources.push({
      recordId,
      token,
      mimeType: decodeJsonString(mimeType),
      size: Number(rawSize),
      name,
    });
  }
  return sources;
}

export function extractFeishuRecordSeedsFromHtml(html) {
  const seeds = [];
  const seen = new Set();
  const add = (recordId) => {
    if (!recordId || seen.has(recordId)) return;
    seen.add(recordId);
    seeds.push(recordId);
  };

  const recordKeyRegex = /"([A-Za-z0-9]{15,})":\{"id":"\1"/g;
  let match;
  while ((match = recordKeyRegex.exec(html))) {
    add(match[1]);
  }

  const childrenRegex = /"children":\[(.*?)\]/g;
  while ((match = childrenRegex.exec(html))) {
    const childRegex = /"([A-Za-z0-9]{15,})"/g;
    let childMatch;
    while ((childMatch = childRegex.exec(match[1]))) {
      add(childMatch[1]);
    }
  }

  return seeds;
}

export function mergeFeishuWorkflowSources(...sourceLists) {
  const sources = [];
  const seenRecordIds = new Set();
  const seenTokens = new Set();
  for (const sourceList of sourceLists) {
    for (const source of sourceList || []) {
      if (!source?.token || !source?.name || !/\.txt$/i.test(source.name)) continue;
      if (source.recordId && seenRecordIds.has(source.recordId)) continue;
      if (seenTokens.has(source.token)) continue;
      sources.push(source);
      if (source.recordId) seenRecordIds.add(source.recordId);
      seenTokens.add(source.token);
    }
  }
  return sources;
}

export function extractFeishuTxtRecordSeedsFromAuditManifest(manifestText) {
  const manifest = JSON.parse(manifestText);
  const seeds = [];
  const seen = new Set();
  for (const attachment of manifest.attachments || []) {
    const recordId = typeof attachment?.recordId === 'string' ? attachment.recordId.trim() : '';
    if (!recordId || seen.has(recordId)) continue;
    const type = typeof attachment.type === 'string' ? attachment.type.toLowerCase() : '';
    const name = typeof attachment.name === 'string' ? attachment.name : '';
    if (type !== 'txt' && !/\.txt$/i.test(name)) continue;
    seen.add(recordId);
    seeds.push(recordId);
  }
  return seeds;
}

export function sanitizeWorkflowFilename(name, index, stablePrefix = '') {
  const safeName = basename(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || `workflow-${index}.txt`;
  const withExtension = /\.txt$/i.test(safeName) ? safeName : `${safeName}.txt`;
  const safePrefix = String(stablePrefix || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return `${safePrefix || String(index).padStart(3, '0')}-${withExtension}`;
}

async function downloadFeishuFile(token, options) {
  const url = `https://${options.host}/space/api/box/stream/download/all/${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    headers: {
      cookie: options.cookieHeader,
      referer: options.pageUrl,
      'user-agent': 'Mozilla/5.0 Chrome/137.0.0.0 Safari/537.36',
    },
  });
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`Feishu download failed (${response.status}): ${body.slice(0, 300).toString('utf8')}`);
  }
  const preview = body.slice(0, 120).toString('utf8');
  if (!preview.includes('coze-workflow-clipboard-data') && !preview.trimStart().startsWith('{')) {
    throw new Error(`Downloaded file does not look like a Coze workflow source: ${preview}`);
  }
  return body;
}

async function loadFeishuPageSession(options) {
  const chromePath = options.chromePath;
  const chromePort = options.chromePort;
  const userDataDir = options.userDataDir;
  if (!chromePath) {
    throw new Error('Chrome was not found. Pass --chrome-path "C:\\Path\\to\\chrome.exe".');
  }

  if (!options.keepProfile) {
    await rm(userDataDir, { recursive: true, force: true });
  }
  await mkdir(userDataDir, { recursive: true });

  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-default-apps',
    '--disable-popup-blocking',
    '--window-size=1450,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitForChrome(chromePort);
    const target = await createTarget(chromePort, 'about:blank');
    const page = new CdpPage(target.webSocketDebuggerUrl);
    await page.open();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    let documentRequestId = '';
    page.onEvent = (message) => {
      if (message.method !== 'Network.responseReceived') return;
      const response = message.params?.response;
      if (message.params?.type === 'Document' && response?.url?.includes('/wiki/')) {
        documentRequestId = message.params.requestId;
      }
    };
    await page.send('Network.enable', { maxTotalBufferSize: 1024 * 1024 * 200, maxResourceBufferSize: 1024 * 1024 * 50 });
    await page.send('Page.navigate', { url: options.pageUrl });
    await page.waitFor(() => document.body && document.body.innerText.includes('法叔AI-Coze模板库'), 30000);
    await page.waitForTimeout(5000);
    const pageState = await page.evaluate(() => ({
      title: document.title,
      html: document.documentElement.outerHTML,
    }));
    let responseHtml = '';
    if (documentRequestId) {
      const responseBody = await page.send('Network.getResponseBody', { requestId: documentRequestId });
      responseHtml = responseBody.base64Encoded ? Buffer.from(responseBody.body, 'base64').toString('utf8') : responseBody.body;
    }
    const htmlRecordSeeds = extractFeishuRecordSeedsFromHtml(responseHtml || pageState.html);
    const scrolledRuntimeSources = await page.evaluate(
      collectRuntimeWorkflowSourcesFromPage,
      { recordSeeds: options.recordSeeds || [] },
    );
    const seededRuntimeSources = await page.evaluate(
      collectRuntimeWorkflowSourcesFromPage,
      { recordSeeds: [...new Set([...(options.recordSeeds || []), ...htmlRecordSeeds])], scrollRounds: 0 },
    );
    const runtimeSources = mergeFeishuWorkflowSources(scrolledRuntimeSources, seededRuntimeSources);
    const cookies = await page.send('Network.getAllCookies');
    const cookieHeader = cookies.cookies
      .filter((cookie) => /(^|\.)feishu\.cn$/i.test(cookie.domain))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    page.close();
    return {
      html: responseHtml || pageState.html,
      pageTitle: pageState.title,
      cookieHeader,
      runtimeSources,
    };
  } finally {
    chrome.kill();
  }
}

function collectRuntimeWorkflowSourcesFromPage(input = []) {
  const options = Array.isArray(input) ? { recordSeeds: input } : input || {};
  const recordSeeds = Array.isArray(options.recordSeeds) ? options.recordSeeds : [];
  const scrollRounds = Number.isFinite(options.scrollRounds) ? options.scrollRounds : 180;

  function getReactFiber(el) {
    const key = Object.getOwnPropertyNames(el).find((name) => (
      name.startsWith('__reactInternalInstance') ||
      name.startsWith('__reactFiber') ||
      name.startsWith('__reactContainere')
    ));
    return key ? el[key] : null;
  }

  function readFileFromRecord(record) {
    if (!record || typeof record !== 'object') return null;
    try {
      const file = typeof record.get === 'function' ? record.get('file') : record.file || record.snapshot?.file;
      const type = typeof record.get === 'function' ? record.get('type') : record.type || record.snapshot?.type;
      if (type && type !== 'file') return null;
      if (!file?.token || !file?.name || !/\.txt$/i.test(file.name)) return null;
      return {
        recordId: record.id || record.recordId || record.snapshot?.id || '',
        token: file.token,
        mimeType: file.mimeType || file.mime_type || '',
        size: Number(file.size || 0),
        name: file.name,
      };
    } catch {
      return null;
    }
  }

  function inspectProps(props) {
    const candidates = [
      props?.struct?.record,
      props?.record,
      props?.model?.struct?.record,
      props?.model?.record,
      props?.recordModel?.record,
      props?.block?.record,
    ];
    for (const candidate of candidates) {
      const source = readFileFromRecord(candidate);
      if (source) return source;
    }
    return null;
  }

  function inspectFiberTree(rootFiber) {
    const seen = new Set();
    const stack = [rootFiber];
    while (stack.length) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const source = inspectProps(fiber.pendingProps) || inspectProps(fiber.memoizedProps);
      if (source) return source;
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.return) stack.push(fiber.return);
      if (fiber.alternate) stack.push(fiber.alternate);
      if (fiber.firstEffect) stack.push(fiber.firstEffect);
      if (fiber.lastEffect) stack.push(fiber.lastEffect);
    }
    return null;
  }

  function findBlockManagerFromFiber(rootFiber) {
    const seen = new Set();
    const stack = [rootFiber];
    while (stack.length) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const propGroups = [fiber.pendingProps, fiber.memoizedProps].filter(Boolean);
      for (const props of propGroups) {
        const manager =
          props.blockManager ||
          props.recursionProps?.blockManager ||
          props.recursionProps?.selectionAPI?.blockManager ||
          props.recursionProps?.selectionAPI?._sel?.store?.blockManager ||
          props.model?.blockManager;
        if (manager) return manager;
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.return) stack.push(fiber.return);
      if (fiber.alternate) stack.push(fiber.alternate);
      if (fiber.firstEffect) stack.push(fiber.firstEffect);
      if (fiber.lastEffect) stack.push(fiber.lastEffect);
    }
    return null;
  }

  function findBlockManager() {
    const candidates = [
      ...document.querySelectorAll('.block.docx-file-block[data-record-id]'),
      ...document.querySelectorAll('[class*="docx"]'),
      document.querySelector('#root'),
      document.body,
    ].filter(Boolean);
    for (const candidate of candidates) {
      const manager = findBlockManagerFromFiber(getReactFiber(candidate));
      if (manager) return manager;
    }
    return null;
  }

  function addSource(seen, sources, source) {
    if (!source) return;
    const key = source.recordId || source.token;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(source);
  }

  async function extractSeedSources(seen, sources) {
    const manager = findBlockManager();
    if (!manager) return false;
    if (typeof manager.fetchRecordBatch === 'function' && recordSeeds?.length) {
      try {
        await manager.fetchRecordBatch(recordSeeds);
      } catch {
        // Fall back to whatever is already hydrated in the client cache.
      }
    }
    for (const recordId of recordSeeds || []) {
      try {
        let record = typeof manager.getRecord === 'function' ? manager.getRecord(recordId) : null;
        let source = readFileFromRecord(record);
        if (!source && recordSeeds.length <= 100 && typeof manager.fetchRecord === 'function') {
          await manager.fetchRecord(recordId);
          record = typeof manager.getRecord === 'function' ? manager.getRecord(recordId) : record;
          source = readFileFromRecord(record);
        }
        if (!source) continue;
        source.recordId ||= recordId;
        addSource(seen, sources, source);
      } catch {
        // Some Feishu records are lazily unavailable; the scrolling fallback below still samples mounted cards.
      }
    }
    return true;
  }

  function extractCurrentSources(seen, sources) {
    for (const block of document.querySelectorAll('.block.docx-file-block[data-record-id]')) {
      const fiber = getReactFiber(block);
      const source = inspectFiberTree(fiber);
      if (!source) continue;
      source.recordId ||= block.getAttribute('data-record-id') || '';
      addSource(seen, sources, source);
    }
  }

  function getScrollables() {
    return [...document.querySelectorAll('*')]
      .filter((el) => el.scrollHeight > el.clientHeight + 200)
      .sort((a, b) => b.scrollHeight - a.scrollHeight);
  }

  async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  return (async () => {
    const sources = [];
    const seen = new Set();
    await extractSeedSources(seen, sources);
    for (let round = 0; round < scrollRounds; round += 1) {
      extractCurrentSources(seen, sources);
      await extractSeedSources(seen, sources);
      const scrollables = getScrollables();
      const container =
        document.querySelector('.bear-web-x-container.catalogue-opened.docx-in-wiki.width-transition') ||
        scrollables.find((el) => /bear-web-x-container|docx/i.test(el.className?.toString?.() || '')) ||
        scrollables[0] ||
        document.scrollingElement;
      if (container) container.scrollTop += 700;
      for (const el of scrollables.slice(0, 6)) el.scrollTop += 700;
      window.scrollBy(0, 700);
      await sleep(140);
      extractCurrentSources(seen, sources);
    }

    extractCurrentSources(seen, sources);
    await extractSeedSources(seen, sources);
    return sources;
  })();
}

async function loadRecordSeeds(recordSeeds = [], recordSeedPaths = []) {
  const seeds = [];
  const seen = new Set();
  const add = (seed) => {
    const recordId = typeof seed === 'string' ? seed.trim() : '';
    if (!recordId || seen.has(recordId)) return;
    seen.add(recordId);
    seeds.push(recordId);
  };
  for (const seed of recordSeeds || []) add(seed);
  for (const seedPath of recordSeedPaths || []) {
    const text = await readFile(resolve(seedPath), 'utf8');
    if (/\.json$/i.test(seedPath)) {
      try {
        for (const seed of extractFeishuTxtRecordSeedsFromAuditManifest(text)) add(seed);
        continue;
      } catch {
        // Fall through to line-based parsing for plain JSON arrays or ad hoc seed files.
      }
    }
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const seed of parsed) add(seed);
        continue;
      }
    } catch {
      // Plain line-based seed files are supported below.
    }
    for (const line of text.split(/\r?\n/)) add(line);
  }
  return seeds;
}

class CdpPage {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.callbacks = new Map();
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.callbacks.has(message.id)) {
        const { resolve, reject } = this.callbacks.get(message.id);
        this.callbacks.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else if (message.method) {
        this.onEvent?.(message);
      }
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => this.callbacks.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(fn, arg) {
    const expression = `(${fn.toString()})(${JSON.stringify(arg)})`;
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
    }
    return result.result.value;
  }

  async waitFor(fn, timeout = 30000) {
    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await this.evaluate(fn);
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await this.waitForTimeout(300);
    }
    if (lastError) throw lastError;
    throw new Error('Timed out waiting for Feishu page content.');
  }

  async scrollThroughDocument() {
    await this.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const getScrollables = () => [...document.querySelectorAll('*')]
        .filter((el) => el.scrollHeight > el.clientHeight + 200)
        .sort((a, b) => b.scrollHeight - a.scrollHeight);
      let previousSignature = '';
      let stableRounds = 0;
      for (let round = 0; round < 180 && stableRounds < 8; round += 1) {
        const scrollables = getScrollables();
        const container =
          document.querySelector('.bear-web-x-container.catalogue-opened.docx-in-wiki.width-transition') ||
          scrollables.find((el) => /bear-web-x-container|docx/i.test(el.className?.toString?.() || '')) ||
          scrollables[0] ||
          document.scrollingElement;
        if (container) container.scrollTop += 850;
        for (const el of scrollables.slice(0, 6)) el.scrollTop += 850;
        window.scrollBy(0, 850);
        await sleep(140);
        const currentSignature = [
          document.querySelectorAll('.block.docx-file-block[data-record-id]').length,
          container?.scrollTop || window.scrollY,
          container?.scrollHeight || document.scrollingElement?.scrollHeight || 0,
        ].join(':');
        if (currentSignature === previousSignature) stableRounds += 1;
        else stableRounds = 0;
        previousSignature = currentSignature;
      }
    });
  }

  waitForTimeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  close() {
    this.ws.close();
  }
}

async function waitForChrome(port) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Chrome did not expose DevTools in time.');
}

async function createTarget(port, targetUrl) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Failed to create Chrome target: ${response.status}`);
  return response.json();
}

async function runNodeScript(args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: resolve('.') });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Command failed with exit code ${code}: node ${args.join(' ')}`));
    });
  });
}

function parseArgs(rawArgs) {
  const options = {
    url: DEFAULT_URL,
    outDir: DEFAULT_OUT_DIR,
    manifestPath: DEFAULT_MANIFEST,
    chromePort: DEFAULT_CHROME_PORT,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--url') options.url = rawArgs[++index];
    else if (arg === '--out-dir') options.outDir = rawArgs[++index];
    else if (arg === '--manifest') options.manifestPath = rawArgs[++index];
    else if (arg === '--bundle') options.bundlePath = rawArgs[++index];
    else if (arg === '--install-db') options.installDbPath = rawArgs[++index];
    else if (arg === '--chrome-path') options.chromePath = rawArgs[++index];
    else if (arg === '--chrome-port') options.chromePort = Number(rawArgs[++index]);
    else if (arg === '--user-data-dir') options.userDataDir = rawArgs[++index];
    else if (arg === '--html') options.htmlPath = rawArgs[++index];
    else if (arg === '--cookie') options.cookieHeader = rawArgs[++index];
    else if (arg === '--download-host') options.downloadHost = rawArgs[++index];
    else if (arg === '--record-seed') {
      options.recordSeeds ||= [];
      options.recordSeeds.push(rawArgs[++index]);
    }
    else if (arg === '--record-seeds' || arg === '--audit-manifest') {
      options.recordSeedPaths ||= [];
      options.recordSeedPaths.push(rawArgs[++index]);
    }
    else if (arg === '--keep-profile') options.keepProfile = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/fetch-feishu-coze-workflows.mjs [options]

Downloads Coze workflow .txt sources from the Feishu template wiki and optionally converts them.

Options:
  --url <url>             Feishu wiki URL. Defaults to the known template library.
  --out-dir <dir>         Directory for downloaded .txt workflow sources.
  --manifest <path>       Download manifest path.
  --bundle <path>         Convert downloaded sources to a draft-template JSON bundle.
  --install-db <path>     Install converted templates into a StoryDream data.db.
  --chrome-path <path>    Chrome executable path.
  --chrome-port <port>    DevTools port. Default: ${DEFAULT_CHROME_PORT}.
  --html <path>           Parse a saved Feishu HTML file instead of loading the page.
  --cookie <header>       Cookie header to use when --html is supplied.
  --verbose               Print per-file download progress.
  --record-seed <id>      Resolve a known Feishu file record id through the hydrated page.
  --record-seeds <path>   Read record ids from a line/JSON/audit manifest file.
  --audit-manifest <path> Alias for --record-seeds for saved attachment audits.
`);
}

function findDefaultChromePath() {
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return 'google-chrome';
}

function decodeJsonString(value) {
  return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
}

if (isCli) {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = await fetchFeishuCozeWorkflows(options);
    console.log(`Downloaded ${result.downloaded.length}/${result.sources.length} Feishu Coze workflow source file(s) to ${result.outDir}.`);
    if (result.bundlePath) {
      console.log(`Converted bundle: ${result.bundlePath}`);
    }
    if (result.failures.length) {
      console.error(`${result.failures.length} download(s) failed. See ${result.manifestPath}.`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
