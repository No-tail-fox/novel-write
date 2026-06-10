import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { buildViralMediaWorkerInvocation, buildViralMediaWorkerRequest, resolveViralMediaWorkerScriptPath } from '@shared/viral-media-worker';

const pythonPath = existsSync(join(process.cwd(), 'vendor/python/python.exe')) ? join(process.cwd(), 'vendor/python/python.exe') : 'python';
const workerPath = join(process.cwd(), 'src/shared/viral-media-worker.py');

function runWorkerProbe(code: string): string {
  return execFileSync(pythonPath, ['-c', code, workerPath], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  }).trim();
}

describe('viral media worker wiring', () => {
  it('resolves the bundled or source-side worker script path', () => {
    expect(resolveViralMediaWorkerScriptPath({ baseDir: 'I:/opc/src/shared' })).toBe(normalize('I:/opc/src/shared/viral-media-worker.py'));
    expect(resolveViralMediaWorkerScriptPath({ baseDir: 'I:/opc/dist-electron/electron' })).toBe(normalize('I:/opc/dist-electron/electron/viral-media-worker.py'));
  });

  it('builds a download request that prefers browser cookies after a no-cookie attempt', () => {
    const request = buildViralMediaWorkerRequest({
      url: 'https://www.douyin.com/jingxuan?modal_id=7637518006653963529',
      platform: 'douyin',
      workDir: 'I:/opc/tmp/viral',
      cookieFallbackMode: 'browser-first-after-failure',
      browserCookieSource: 'auto',
      cookieFilePath: 'C:/cookies/douyin.txt',
      timeoutMs: 180000,
    });

    expect(request).toMatchObject({
      url: 'https://www.douyin.com/jingxuan?modal_id=7637518006653963529',
      platform: 'douyin',
      workDir: 'I:/opc/tmp/viral',
      cookieFallbackMode: 'browser-first-after-failure',
      browserCookieSource: 'auto',
      cookieFilePath: 'C:/cookies/douyin.txt',
      timeoutMs: 180000,
    });
  });

  it('builds a python invocation that targets the internal worker script instead of yt-dlp', () => {
    const invocation = buildViralMediaWorkerInvocation({
      baseDir: 'I:/opc/dist-electron/electron',
      requestPath: 'I:/opc/tmp/viral/request.json',
    });

    expect(invocation.workerScriptPath).toBe(normalize('I:/opc/dist-electron/electron/viral-media-worker.py'));
    expect(invocation.args).toEqual([normalize('I:/opc/dist-electron/electron/viral-media-worker.py'), 'download', 'I:/opc/tmp/viral/request.json']);
    expect(invocation.args.join(' ')).not.toContain('yt_dlp');
  });

  it('packages the internal worker and removes yt-dlp from the bundled runtime', async () => {
    const buildScript = await readFile(new URL('../scripts/build-electron.mjs', import.meta.url), 'utf8');
    const runtimeScript = await readFile(new URL('../scripts/prepare-python-runtime.ps1', import.meta.url), 'utf8');
    const workerScript = await readFile(new URL('../src/shared/viral-media-worker.py', import.meta.url), 'utf8');

    expect(buildScript).toContain("copyFile('src/shared/viral-media-worker.py'");
    expect(runtimeScript).toContain('browser-cookie3');
    expect(runtimeScript).toContain('pycryptodomex');
    expect(runtimeScript).toContain('local Chrome/Edge');
    expect(runtimeScript).not.toContain('yt-dlp');
    expect(runtimeScript).not.toContain('yt_dlp');
    expect(workerScript).toContain('find_local_chromium_executable');
    expect(workerScript).toContain('STORYBOUND_CHROMIUM_PATH');
    expect(workerScript).toContain('is_blocked_download_url');
    expect(workerScript).toContain('choose_sniffed_media_url');
    expect(workerScript).toContain('__vid=');
    expect(workerScript).toContain('下载地址返回了安装包而不是视频文件');
  });

  it('extracts Douyin media URLs from slash-escaped page scripts', () => {
    const output = runWorkerProbe(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

script = r'window.__DATA__={"play_addr":{"url_list":["https:\/\/v3-douyinvod.com\/abc\/video\/tos\/clip.mp4?__vid=123"]}}'
parsed = worker.parse_media_from_scripts([script], "douyin")
print(json.dumps(parsed["mediaUrls"], ensure_ascii=False))
`);

    expect(JSON.parse(output)).toContain('https://v3-douyinvod.com/abc/video/tos/clip.mp4?__vid=123');
  });

  it('recognizes Douyin verification pages as a cookie or login problem', () => {
    const output = runWorkerProbe(String.raw`
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

reason = worker.blocked_page_reason(
    "douyin",
    "https://www.douyin.com/video/123",
    "登录 视频数据加载中",
    ["https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter/index.js"],
)
print(reason)
`);

    expect(output).toContain('触发验证或未登录');
    expect(output).toContain('打开抖音登录窗口');
  });
});
