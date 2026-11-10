/**
 * CaptureHost 的 Electron 窗口工厂（底座 §8.1 的隔离要求，照搬 lemo-upstream-renderer.ts 的做法）：
 * offscreen + sandbox + contextIsolation + nodeIntegration:false + backgroundThrottling:false；
 * 每个窗口一个私有内存 partition，拒绝所有权限、下载、弹窗和导航；webRequest 只放行页面同源（file: 页面只放行其目录下的文件）
 * 以及 data: / blob:；DPR 固定为 1（setZoomFactor(1)，窗口按画布尺寸创建，尺寸不符由 CaptureHost 报错）。
 *
 * 只用于 VideoSpec 新项目（ADR-03），没有接入任何现有路线。
 */
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, session } from 'electron';
import type { CaptureImage, CaptureWindow, CaptureWindowFactory, CaptureWindowRequest } from './capture-host';

export interface ElectronCaptureWindowOptions {
  /** 自定义请求白名单；缺省见 `defaultCaptureRequestAllowed`。 */
  allowRequest?: (url: string, pageUrl: string) => boolean;
  backgroundColor?: string;
}

/** 默认白名单：data:/blob:；http(s)/自定义协议页面只放行同源；file: 页面只放行页面所在目录（含子目录）下的文件。 */
export function defaultCaptureRequestAllowed(url: string, pageUrl: string): boolean {
  if (/^(?:data|blob):/iu.test(url)) return true;
  let target: URL;
  let page: URL;
  try { target = new URL(url); page = new URL(pageUrl); } catch { return false; }
  if (page.protocol === 'file:') {
    if (target.protocol !== 'file:') return false;
    try {
      const root = dirname(fileURLToPath(page)).toLowerCase();
      const path = fileURLToPath(target).toLowerCase();
      return path === root || path.startsWith(root.endsWith('\\') || root.endsWith('/') ? root : `${root}${process.platform === 'win32' ? '\\' : '/'}`);
    } catch {
      return false;
    }
  }
  return target.origin === page.origin && target.origin !== 'null';
}

export function createElectronCaptureWindowFactory(options: ElectronCaptureWindowOptions = {}): CaptureWindowFactory {
  const allow = options.allowRequest ?? defaultCaptureRequestAllowed;
  return (request: CaptureWindowRequest): CaptureWindow => {
    const partition = session.fromPartition(`capture-host-${randomUUID()}`);
    const pageErrorListeners: Array<(message: string) => void> = [];
    const crashListeners: Array<(reason: string) => void> = [];
    const emitPageError = (message: string) => { for (const listener of pageErrorListeners) listener(message); };
    partition.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    partition.setPermissionCheckHandler(() => false);
    partition.on('will-download', event => event.preventDefault());
    partition.webRequest.onBeforeRequest((details, callback) => {
      const allowed = allow(details.url, request.pageUrl);
      if (!allowed) emitPageError(`CAPTURE_HOST_EXTERNAL_RESOURCE: ${details.url.slice(0, 300)}`);
      callback({ cancel: !allowed });
    });
    const window = new BrowserWindow({
      show: false,
      width: request.width,
      height: request.height,
      useContentSize: true,
      backgroundColor: options.backgroundColor ?? '#000000',
      webPreferences: {
        session: partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    window.webContents.setZoomFactor(1);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('console-message', details => {
      if (details.level === 'error') emitPageError(details.message.slice(0, 1500));
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      for (const listener of crashListeners) listener(details.reason);
    });
    return {
      loadURL: url => window.loadURL(url),
      executeJavaScript: code => window.webContents.executeJavaScript(code),
      capturePage: async (): Promise<CaptureImage> => {
        const image = await window.webContents.capturePage();
        return {
          getSize: () => image.getSize(),
          toBitmap: () => image.toBitmap(),
          toJPEG: quality => image.toJPEG(quality),
        };
      },
      onPageError: listener => { pageErrorListeners.push(listener); },
      onCrash: listener => { crashListeners.push(listener); },
      destroy: () => {
        if (!window.isDestroyed()) window.destroy();
        partition.webRequest.onBeforeRequest(null);
      },
      isDestroyed: () => window.isDestroyed(),
    };
  };
}
