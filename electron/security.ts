import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchmarkPlatform } from '../src/shared/types';

const DOUYIN_LOGIN_DOMAINS = ['douyin.com', 'iesdouyin.com', 'amemv.com'] as const;
const BENCHMARK_LOGIN_DOMAINS: Record<BenchmarkPlatform, readonly string[]> = {
  douyin: DOUYIN_LOGIN_DOMAINS,
  'wechat-channels': ['channels.weixin.qq.com', 'weixin.qq.com', 'open.weixin.qq.com', 'login.weixin.qq.com', 'finder.video.qq.com', 'wxv.qq.com'],
  bilibili: ['bilibili.com', 'b23.tv'],
};

export interface RendererPolicy {
  mode: 'development' | 'production';
  entryUrl: string;
}

function hostnameMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  const base = domain.toLowerCase().replace(/^\./u, '').replace(/\.$/u, '');
  return host === base || host.endsWith(`.${base}`);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hasUrlCredentials(url: URL): boolean {
  return Boolean(url.username || url.password);
}

export function validateDevServerUrl(value: string): string {
  const url = parseUrl(value.trim());
  if (!url || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Development server URL must use HTTP or HTTPS.');
  }
  if (hasUrlCredentials(url)) {
    throw new Error('Development server URL must not include credentials.');
  }
  if (!['127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())) {
    throw new Error('Development server URL must use a loopback host.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Development server URL must be a loopback origin without a path, query, or fragment.');
  }
  return `${url.origin}/`;
}

export function isAllowedRendererNavigation(value: string, policy: RendererPolicy): boolean {
  const target = parseUrl(value);
  if (!target || hasUrlCredentials(target)) return false;

  if (policy.mode === 'development') {
    let entry: URL;
    try {
      entry = new URL(validateDevServerUrl(policy.entryUrl));
    } catch {
      return false;
    }
    return ['http:', 'https:'].includes(target.protocol) && target.origin === entry.origin;
  }

  const entry = parseUrl(policy.entryUrl);
  if (!entry || entry.protocol !== 'file:' || target.protocol !== 'file:') return false;
  return target.host === entry.host && target.pathname === entry.pathname;
}

export function isAllowedDouyinLoginNavigation(value: string): boolean {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:' || hasUrlCredentials(url)) return false;
  return DOUYIN_LOGIN_DOMAINS.some((domain) => hostnameMatches(url.hostname, domain));
}

export function isAllowedDouyinCookieDomain(domain: string): boolean {
  const hostname = domain.trim().replace(/^\./u, '');
  return DOUYIN_LOGIN_DOMAINS.some((allowed) => hostnameMatches(hostname, allowed));
}

export function isAllowedLocalHtmlNavigation(value: string, taskRoot: string): boolean {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'file:' || hasUrlCredentials(url)) return false;
  try {
    const root = resolve(taskRoot);
    const target = resolve(fileURLToPath(url));
    const pathFromRoot = relative(root, target);
    return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
  } catch {
    return false;
  }
}

function attachNavigationPolicy(win: BrowserWindow, isAllowed: (url: string) => boolean): void {
  const preventUntrustedNavigation = (event: Electron.Event, url: string) => {
    if (!isAllowed(url)) event.preventDefault();
  };
  win.webContents.on('will-navigate', preventUntrustedNavigation);
  win.webContents.on('will-redirect', preventUntrustedNavigation);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

export function attachMainWindowSecurity(win: BrowserWindow, policy: RendererPolicy): void {
  attachNavigationPolicy(win, (url) => isAllowedRendererNavigation(url, policy));
}

export function attachDouyinLoginSecurity(win: BrowserWindow): void {
  attachNavigationPolicy(win, isAllowedDouyinLoginNavigation);
}

export function attachBenchmarkLoginSecurity(win: BrowserWindow, platform: BenchmarkPlatform): void {
  attachNavigationPolicy(win, (value) => {
    const url = parseUrl(value);
    if (!url || url.protocol !== 'https:' || hasUrlCredentials(url)) return false;
    return BENCHMARK_LOGIN_DOMAINS[platform].some((domain) => hostnameMatches(url.hostname, domain));
  });
}

export function attachLocalHtmlSecurity(win: BrowserWindow, taskRoot: string): void {
  attachNavigationPolicy(win, (url) => isAllowedLocalHtmlNavigation(url, taskRoot));
}

export function isTrustedRendererSender(event: IpcMainInvokeEvent, win: BrowserWindow, policy: RendererPolicy): boolean {
  if (win.isDestroyed() || event.sender !== win.webContents) return false;
  if (event.senderFrame !== win.webContents.mainFrame) return false;
  const senderUrl = event.senderFrame.url || event.sender.getURL();
  return isAllowedRendererNavigation(senderUrl, policy);
}
