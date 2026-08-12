import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadSecurityModule() {
  return import('../electron/security').catch(() => null);
}

describe('electron window chrome', () => {
  it('removes the native Electron menu bar while keeping the renderer chrome', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('Menu.setApplicationMenu(null)');
    expect(main).toContain('autoHideMenuBar: true');
    expect(main).toContain('setMenuBarVisibility(false)');
  });

  it('uses a frameless window controlled by the renderer dark title bar', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    expect(main).toContain('frame: false');
    expect(main).toContain("trustedHandle('window:control'");
    expect(main).toContain('mainWindow?.minimize()');
    expect(main).toContain('mainWindow?.isMaximized()');
    expect(main).toContain('mainWindow?.close()');
    expect(preload).toContain('windowControl');
    expect(preload).toContain('window:control');
  });

  it('accepts only credential-free loopback development server URLs', async () => {
    const security = await loadSecurityModule();
    expect(security).not.toBeNull();
    if (!security) return;

    expect(security.validateDevServerUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/');
    expect(security.validateDevServerUrl('https://[::1]:5173')).toBe('https://[::1]:5173/');
    expect(() => security.validateDevServerUrl('https://evil.example')).toThrow(/loopback/i);
    expect(() => security.validateDevServerUrl('http://127.0.0.1.evil.example:5173')).toThrow(/loopback/i);
    expect(() => security.validateDevServerUrl('http://user:pass@127.0.0.1:5173')).toThrow(/credentials/i);
    expect(() => security.validateDevServerUrl('file:///I:/opc/index.html')).toThrow(/HTTP/i);
  });

  it('allows renderer navigation only within the configured renderer entry boundary', async () => {
    const security = await loadSecurityModule();
    expect(security).not.toBeNull();
    if (!security) return;

    const productionPolicy = { mode: 'production' as const, entryUrl: 'file:///app/dist-renderer/index.html' };
    const developmentPolicy = { mode: 'development' as const, entryUrl: 'http://127.0.0.1:5173/' };

    expect(security.isAllowedRendererNavigation('file:///app/dist-renderer/index.html', productionPolicy)).toBe(true);
    expect(security.isAllowedRendererNavigation('file:///app/dist-renderer/index.html#/settings', productionPolicy)).toBe(true);
    expect(security.isAllowedRendererNavigation('file:///app/dist-renderer/other.html', productionPolicy)).toBe(false);
    expect(security.isAllowedRendererNavigation('https://evil.example', productionPolicy)).toBe(false);
    expect(security.isAllowedRendererNavigation('http://127.0.0.1:5173/settings', developmentPolicy)).toBe(true);
    expect(security.isAllowedRendererNavigation('http://localhost:5173/settings', developmentPolicy)).toBe(false);
    expect(security.isAllowedRendererNavigation('http://127.0.0.1.evil.example:5173', developmentPolicy)).toBe(false);
  });

  it('allows Douyin login navigation and exported cookies only for exact platform domains', async () => {
    const security = await loadSecurityModule();
    expect(security).not.toBeNull();
    if (!security) return;

    expect(security.isAllowedDouyinLoginNavigation('https://www.douyin.com/passport/login')).toBe(true);
    expect(security.isAllowedDouyinLoginNavigation('https://sso.douyin.com/login')).toBe(true);
    expect(security.isAllowedDouyinLoginNavigation('http://www.douyin.com/passport/login')).toBe(false);
    expect(security.isAllowedDouyinLoginNavigation('https://evil.example/douyin.com')).toBe(false);
    expect(security.isAllowedDouyinLoginNavigation('https://douyin.com.evil.example/login')).toBe(false);
    expect(security.isAllowedDouyinCookieDomain('.douyin.com')).toBe(true);
    expect(security.isAllowedDouyinCookieDomain('passport.iesdouyin.com')).toBe(true);
    expect(security.isAllowedDouyinCookieDomain('douyin.com.evil.example')).toBe(false);
    expect(security.isAllowedBenchmarkCookieDomain('.bilibili.com', 'bilibili')).toBe(true);
    expect(security.isAllowedBenchmarkCookieDomain('bilibili.com.evil.example', 'bilibili')).toBe(false);
  });

  it('allows hidden HTML navigation only to files under the task root', async () => {
    const security = await loadSecurityModule();
    expect(security).not.toBeNull();
    if (!security) return;

    const taskRoot = join(process.cwd(), 'tmp', 'task-1');
    const allowed = pathToFileURL(join(taskRoot, 'html-scenes', 'scene-001.html')).toString();
    const outside = pathToFileURL(join(process.cwd(), 'tmp', 'task-2', 'scene-001.html')).toString();

    expect(security.isAllowedLocalHtmlNavigation(allowed, taskRoot)).toBe(true);
    expect(security.isAllowedLocalHtmlNavigation(outside, taskRoot)).toBe(false);
    expect(security.isAllowedLocalHtmlNavigation('data:text/html,unsafe', taskRoot)).toBe(false);
    expect(security.isAllowedLocalHtmlNavigation('https://evil.example/scene.html', taskRoot)).toBe(false);
  });

  it('installs deny-by-default navigation policies and explicit sandboxing on every window', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');
    const security = await readFile(new URL('../electron/security.ts', import.meta.url), 'utf8').catch(() => '');

    expect(main).toContain('validateDevServerUrl');
    expect(main).toContain('attachMainWindowSecurity');
    expect(main).toContain('attachDouyinLoginSecurity');
    expect(main).toContain('isAllowedDouyinCookieDomain');
    expect((main.match(/sandbox: true/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(main).not.toContain("domain.includes('douyin.com')");
    expect(renderer).toContain('attachLocalHtmlSecurity');
    expect(renderer).toContain('sandbox: true');
    expect(renderer).not.toContain('data:text/html');
    expect(security).toContain("'will-navigate'");
    expect(security).toContain("'will-redirect'");
    expect(security).toContain('setWindowOpenHandler');
    expect(security).toContain("action: 'deny'");
  });

  it('declares a restrictive renderer content security policy with loopback-only development connections', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

    expect(html).toContain("default-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("connect-src 'self' storydream-media: http://127.0.0.1:* ws://127.0.0.1:*");
    expect(html).not.toMatch(/connect-src[^;]*https:\/\//);
  });

  it('omits sources and directives that Chromium ignores in a meta content security policy', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

    expect(html).not.toContain("frame-ancestors 'none'");
    expect(html).not.toMatch(/(?:http|ws):\/\/\[::1\]:\*/);
  });
});
