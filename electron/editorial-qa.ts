import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { BrowserWindow } from 'electron';

export const editorialQaScopes = ['all', 'theme-smoke', 'shell', 'workflow', 'labs', 'system'] as const;
export type EditorialQaScope = (typeof editorialQaScopes)[number];
export type EditorialQaEnvironment = Partial<Record<
  | 'STORYDREAM_QA_RUN_ROOT'
  | 'STORYDREAM_QA_RUN_TOKEN'
  | 'STORYDREAM_QA_SENTINEL'
  | 'STORYDREAM_QA_USER_DATA'
  | 'STORYDREAM_QA_REPORT'
  | 'STORYDREAM_QA_CAPTURES'
  | 'STORYDREAM_QA_SCOPE'
  | 'STORYDREAM_SMOKE_OUTPUT'
  | 'STORYDREAM_SMOKE_USER_DATA',
  string | undefined
>>;

export interface EditorialQaConfig {
  root: string;
  token: string;
  sentinel: string;
  userData: string;
  report: string;
  captures: string;
  scope: EditorialQaScope;
}

export const editorialQaMatrix = {
  themes: ['dark', 'light'] as const,
  viewports: [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'compact', width: 1080, height: 720 },
  ],
  views: {
    shell: ['new-task'],
    workflow: ['new-task', 'queue', 'history', 'task-detail', 'html-video', 'music-mv', 'viral-analyzer'],
    labs: ['image-lab', 'voice-lab', 'book-selection', 'benchmark', 'person-assets'],
    system: ['prompt-templates', 'draft-templates', 'settings', 'account', 'activation'],
  },
} as const;

const qaComputedTokenNames = [
  '--shell-bg', '--shell-surface', '--shell-border', '--shell-text', '--shell-muted',
  '--shell-focus', '--shell-focus-contrast', '--media-bg', '--media-surface',
  '--media-border', '--media-text', '--media-muted',
] as const;

export function resolveEditorialQaConfig(
  environment: EditorialQaEnvironment = process.env,
  osTempDirectory = tmpdir(),
): EditorialQaConfig | null {
  const names = [
    'STORYDREAM_QA_RUN_ROOT',
    'STORYDREAM_QA_RUN_TOKEN',
    'STORYDREAM_QA_SENTINEL',
    'STORYDREAM_QA_USER_DATA',
    'STORYDREAM_QA_REPORT',
    'STORYDREAM_QA_CAPTURES',
  ] as const;
  const values = Object.fromEntries(names.map((name) => [name, environment[name]?.trim() ?? ''])) as Record<(typeof names)[number], string>;
  const scope = (environment.STORYDREAM_QA_SCOPE?.trim() || 'all') as EditorialQaScope;
  if (!editorialQaScopes.includes(scope)) throw new Error(`Unknown editorial QA scope: ${scope}`);
  const supplied = names.filter((name) => values[name].length > 0);
  if (supplied.length === 0) {
    if ((environment.STORYDREAM_QA_SCOPE ?? '').trim()) throw new Error('Editorial QA scope requires the complete QA environment.');
    return null;
  }
  if (supplied.length !== names.length) throw new Error('Editorial QA environment must be all-or-none.');
  if ((environment.STORYDREAM_SMOKE_OUTPUT ?? '').trim() || (environment.STORYDREAM_SMOKE_USER_DATA ?? '').trim()) {
    throw new Error('Electron smoke and editorial QA modes are mutually exclusive.');
  }
  const pathValues = names.filter((name) => name !== 'STORYDREAM_QA_RUN_TOKEN').map((name) => values[name]);
  if (pathValues.some((value) => value.length > 4096 || value.includes('\0') || !isAbsolute(value))) {
    throw new Error('Editorial QA paths must be bounded absolute paths.');
  }
  if (values.STORYDREAM_QA_RUN_TOKEN.length < 24 || values.STORYDREAM_QA_RUN_TOKEN.length > 256) {
    throw new Error('Editorial QA run token is invalid.');
  }

  const tempRoot = realpathSync(osTempDirectory);
  const root = realpathSync(values.STORYDREAM_QA_RUN_ROOT);
  assertStrictDescendant(tempRoot, root, 'Editorial QA root');
  assertNonReparseDirectory(root, 'Editorial QA root');
  const sentinel = resolve(values.STORYDREAM_QA_SENTINEL);
  const userData = resolve(values.STORYDREAM_QA_USER_DATA);
  const report = resolve(values.STORYDREAM_QA_REPORT);
  const captures = resolve(values.STORYDREAM_QA_CAPTURES);
  for (const [value, label] of [[sentinel, 'sentinel'], [userData, 'userData'], [report, 'report'], [captures, 'captures']] as const) {
    assertStrictDescendant(root, value, `Editorial QA ${label}`);
  }
  if (dirname(sentinel) !== root || basename(sentinel) !== '.editorial-qa-sentinel') {
    throw new Error('Editorial QA sentinel must be the parent-created root sentinel.');
  }
  assertNonReparseRegularFile(sentinel, 'Editorial QA sentinel');
  const token = readFileSync(sentinel, 'utf8');
  if (token !== values.STORYDREAM_QA_RUN_TOKEN) throw new Error('Editorial QA sentinel token does not match.');
  unlinkSync(sentinel);
  if (existsSync(join(userData, 'storydream', 'data.db'))) {
    throw new Error('Editorial QA userData database must not preexist.');
  }
  return { root, token, sentinel, userData, report, captures, scope };
}

export async function captureEditorialQa(
  window: BrowserWindow,
  config: EditorialQaConfig,
  getMetrics: () => Array<{ pid: number }>,
): Promise<void> {
  await mkdir(config.captures, { recursive: true });
  const captures: EditorialQaCapture[] = [];
  const views = viewsForScope(config.scope);
  await window.webContents.executeJavaScript(qaCssAndReadinessScript(), true);
  for (const theme of editorialQaMatrix.themes) {
    for (const viewport of editorialQaMatrix.viewports) {
      window.setContentSize(viewport.width, viewport.height);
      for (const view of views) {
        const state = await window.webContents.executeJavaScript(qaScenarioScript(view, theme), true) as QaScenarioState;
        if (!state.ready || state.width !== viewport.width || state.height !== viewport.height || state.scale !== 1) {
          throw new Error(`Editorial QA scenario did not reach a stable ${view}/${theme}/${viewport.name} state.`);
        }
        const image = await window.webContents.capturePage();
        const png = image.toPNG();
        const capturePath = join(config.captures, `${view}-${theme}-${viewport.name}.png`);
        await writeFile(capturePath, png, { flag: 'wx' });
        await assertCapturePng(capturePath, png, image.toBitmap(), viewport.width, viewport.height);
        captures.push({ view, theme, viewport: viewport.name, path: basename(capturePath), visibleText: state.visibleText, tokens: state.tokens });
      }
    }
  }
  const ownedProcessIds = [...new Set(getMetrics().map((metric) => metric.pid).filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  await writeFile(config.report, `${JSON.stringify({
    scope: config.scope,
    processId: process.pid,
    ownedProcessIds,
    remainingOwnedProcessIds: [],
    captures,
  }, null, 2)}\n`, 'utf8');
}

interface EditorialQaCapture {
  view: string;
  theme: string;
  viewport: string;
  path: string;
  visibleText: string;
  tokens: Record<string, string>;
}

interface QaScenarioState {
  ready: boolean;
  width: number;
  height: number;
  scale: number;
  visibleText: string;
  tokens: Record<string, string>;
}

function viewsForScope(scope: EditorialQaScope): readonly string[] {
  if (scope === 'all') return Object.values(editorialQaMatrix.views).flat();
  if (scope === 'theme-smoke') return ['new-task'];
  return editorialQaMatrix.views[scope];
}

function assertStrictDescendant(parent: string, child: string, label: string): void {
  const relation = relative(parent, child);
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) throw new Error(`${label} must be a strict descendant of its trusted parent.`);
}

function assertNonReparseDirectory(path: string, label: string): void {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real non-reparse directory.`);
}

function assertNonReparseRegularFile(path: string, label: string): void {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-reparse file.`);
}

function qaCssAndReadinessScript(): string {
  return `(() => {
    const style = document.createElement('style');
    style.dataset.editorialQa = 'true';
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    document.head.append(style);
  })()`;
}

function qaScenarioScript(view: string, theme: string): string {
  return `(async () => {
    const waitFor = async (check, timeout = 10000) => {
      const until = Date.now() + timeout;
      while (!check()) { if (Date.now() >= until) return false; await new Promise((resolve) => setTimeout(resolve, 25)); }
      return true;
    };
    const api = window.storydream;
    if (api) await api.saveUiPreferences({ theme: ${JSON.stringify(theme)} });
    const themeReady = await waitFor(() => document.documentElement.dataset.theme === ${JSON.stringify(theme)});
    const nav = document.querySelector('[data-nav-view=${JSON.stringify(view)}]');
    if (nav instanceof HTMLButtonElement) nav.click();
    const ready = themeReady && await waitFor(() => document.querySelector('.app-shell')
      && document.documentElement.dataset.themeReady === 'true'
      && document.querySelector('[data-shell-view=${JSON.stringify(view)}]'));
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.activeElement instanceof HTMLElement && document.activeElement.blur();
    const computed = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(${JSON.stringify(qaComputedTokenNames)}.map((name) => [name, computed.getPropertyValue(name).trim()]));
    return {
      ready,
      width: window.innerWidth,
      height: window.innerHeight,
      scale: window.devicePixelRatio,
      visibleText: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 1000),
      tokens,
    };
  })()`;
}

async function assertCapturePng(path: string, png: Buffer, bitmap: Buffer, width: number, height: number): Promise<void> {
  const info = await stat(path);
  if (info.size !== png.byteLength || png.byteLength < 256) throw new Error('Editorial QA capture is empty.');
  if (png.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) throw new Error('Editorial QA capture is not PNG.');
  const pngWidth = png.readUInt32BE(16);
  const pngHeight = png.readUInt32BE(20);
  if (pngWidth !== width || pngHeight !== height) throw new Error(`Editorial QA capture dimensions differ from ${width}x${height}.`);
  const sampledPixels = new Set<string>();
  const pixelCount = Math.floor(bitmap.byteLength / 4);
  const stride = Math.max(1, Math.floor(pixelCount / 2048));
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    sampledPixels.add(bitmap.subarray(offset, offset + 4).toString('hex'));
    if (sampledPixels.size >= 16) break;
  }
  if (sampledPixels.size < 4) throw new Error('Editorial QA capture has insufficient pixel variance.');
}
