// Douyin (viral) and benchmark login windows + cookie export, split out of main.ts (O-5).
import { BrowserWindow, session, type Cookie } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { classifyBenchmarkUrl, normalizeBenchmarkSourceUrl } from '../src/shared/benchmark-monitoring';
import type { AppConfig, BenchmarkLoginInput, BenchmarkLoginResult, BenchmarkPlatform } from '../src/shared/types';
import { attachDouyinLoginSecurity, attachBenchmarkLoginSecurity, isAllowedBenchmarkCookieDomain, isAllowedDouyinCookieDomain } from './security';
import type { FileDatabase } from '../src/shared/storage';
import type { ConfigService } from './config-service';

export interface LoginWindowDependencies {
  appDataDir: () => string;
  getDb: () => Promise<FileDatabase>;
  getConfigService: () => Promise<ConfigService>;
}

export function createLoginWindows({ appDataDir, getDb, getConfigService }: LoginWindowDependencies) {
let viralLoginWindow: BrowserWindow | null = null;
let benchmarkLoginWindow: BrowserWindow | null = null;

function viralCookieDir(): string {
  return join(appDataDir(), 'viral-cookies');
}

function viralCookieFilePath(): string {
  return join(viralCookieDir(), 'douyin-cookies.txt');
}

function netscapeCookieLine(cookie: Cookie): string {
  const domain = cookie.domain || '.douyin.com';
  const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const path = cookie.path || '/';
  const secure = cookie.secure ? 'TRUE' : 'FALSE';
  const expires = Number.isFinite(cookie.expirationDate ?? NaN) ? Math.floor(cookie.expirationDate ?? 0) : 0;
  return [domain, includeSubdomains, path, secure, expires, cookie.name, cookie.value].join('\t');
}

async function exportDouyinLoginCookies(win: BrowserWindow): Promise<string> {
  await mkdir(viralCookieDir(), { recursive: true });
  const allCookies = await win.webContents.session.cookies.get({});
  const cookies = allCookies.filter((cookie) => isAllowedDouyinCookieDomain(cookie.domain || ''));
  const lines = ['# Netscape HTTP Cookie File', ...cookies.map(netscapeCookieLine)];
  const outputPath = viralCookieFilePath();
  await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  const database = await getDb();
  const service = await getConfigService();
  const state = await service.getPublicState();
  const updatedConfig: AppConfig = {
    ...state.config,
    viral: {
      ...state.config.viral,
      cookieFilePath: outputPath,
      cookieFallbackMode: 'browser-first-after-failure',
    },
  };
  await service.save({ config: updatedConfig, secretChanges: {} });
  void database;
  return outputPath;
}

async function openViralLoginWindow(): Promise<string | null> {
  if (viralLoginWindow && !viralLoginWindow.isDestroyed()) {
    viralLoginWindow.focus();
    return null;
  }

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let exportingCookies = false;
    function settle(cookiePath: string | null) {
      if (settled) return;
      settled = true;
      resolve(cookiePath);
    }

    const loginWindow = new BrowserWindow({
      width: 1100,
      height: 760,
      title: '抖音登录',
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:storydream-viral-douyin',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    viralLoginWindow = loginWindow;
    attachDouyinLoginSecurity(loginWindow);
    loginWindow.on('closed', () => {
      if (viralLoginWindow === loginWindow) viralLoginWindow = null;
      settle(null);
    });
    loginWindow.on('close', (event) => {
      if (loginWindow.isDestroyed()) return;
      event.preventDefault();
      if (exportingCookies) return;
      exportingCookies = true;
      void exportDouyinLoginCookies(loginWindow)
        .then((cookiePath) => {
          settle(cookiePath);
        })
        .catch((error) => {
          console.error('Failed to export Douyin cookies', error);
          settle(null);
        })
        .finally(() => {
          if (!loginWindow.isDestroyed()) loginWindow.destroy();
        });
    });
    void loginWindow.loadURL('https://www.douyin.com/').catch((error) => {
      console.error('Failed to open Douyin login window', error);
      settle(null);
      if (!loginWindow.isDestroyed()) loginWindow.destroy();
    });
  });
}

function benchmarkSessionPartition(platform: BenchmarkPlatform): string {
  if (platform === 'douyin') return 'persist:storydream-viral-douyin';
  return `persist:storydream-benchmark-${platform}`;
}

function benchmarkCookieDir(): string {
  return join(appDataDir(), 'benchmark-cookies');
}

function benchmarkCookieFilePath(platform: BenchmarkPlatform): string {
  return join(benchmarkCookieDir(), `${platform}-cookies.txt`);
}

async function exportBenchmarkLoginCookies(win: BrowserWindow, platform: BenchmarkPlatform): Promise<BenchmarkLoginResult> {
  await mkdir(benchmarkCookieDir(), { recursive: true });
  const allCookies = await win.webContents.session.cookies.get({});
  const cookies = allCookies.filter((cookie) => isAllowedBenchmarkCookieDomain(cookie.domain || '', platform));
  const lines = ['# Netscape HTTP Cookie File', ...cookies.map(netscapeCookieLine)];
  const outputPath = benchmarkCookieFilePath(platform);
  await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  return { cookieFilePath: outputPath, cookieCount: cookies.length };
}

async function openBenchmarkLoginWindow(input: BenchmarkLoginInput): Promise<BenchmarkLoginResult> {
  const target = normalizeBenchmarkSourceUrl(input.url);
  const classification = classifyBenchmarkUrl(target);
  if (classification.platform !== input.platform) {
    throw new Error('BENCHMARK_PLATFORM_MISMATCH: 登录链接与账号平台不一致。');
  }
  if (benchmarkLoginWindow && !benchmarkLoginWindow.isDestroyed()) {
    benchmarkLoginWindow.focus();
    return { cookieFilePath: '', cookieCount: 0 };
  }
  return new Promise<BenchmarkLoginResult>((resolve, reject) => {
    let settled = false;
    let exportingCookies = false;
    let loginResult: BenchmarkLoginResult | null = null;
    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(loginResult ?? { cookieFilePath: '', cookieCount: 0 });
    };
    const loginWindow = new BrowserWindow({
      width: 1100,
      height: 760,
      title: `${input.platform === 'douyin' ? '抖音' : input.platform === 'wechat-channels' ? '视频号' : 'B站'}账号登录`,
      autoHideMenuBar: true,
      webPreferences: {
        partition: benchmarkSessionPartition(input.platform),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    benchmarkLoginWindow = loginWindow;
    attachBenchmarkLoginSecurity(loginWindow, input.platform);
    loginWindow.on('closed', () => {
      if (benchmarkLoginWindow === loginWindow) benchmarkLoginWindow = null;
      settle();
    });
    loginWindow.on('close', (event) => {
      if (loginWindow.isDestroyed()) return;
      event.preventDefault();
      if (exportingCookies) return;
      exportingCookies = true;
      void exportBenchmarkLoginCookies(loginWindow, input.platform)
        .then((result) => {
          loginResult = result;
          settle();
        })
        .catch((error) => {
          console.error('Failed to export benchmark cookies', error);
          settle(error);
        })
        .finally(() => {
          if (!loginWindow.isDestroyed()) loginWindow.destroy();
        });
    });
    void loginWindow.loadURL(target).catch((error) => {
      if (benchmarkLoginWindow === loginWindow) benchmarkLoginWindow = null;
      settle(error);
      if (!loginWindow.isDestroyed()) loginWindow.destroy();
    });
  });
}

  return { openViralLoginWindow, openBenchmarkLoginWindow, benchmarkSessionPartition };
}
