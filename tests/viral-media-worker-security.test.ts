import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pythonPath = existsSync(join(process.cwd(), 'vendor/python/python.exe')) ? join(process.cwd(), 'vendor/python/python.exe') : 'python';
const workerPath = join(process.cwd(), 'src/shared/viral-media-worker.py');

function runWorkerJsonProbe(code: string): unknown {
  const output = execFileSync(pythonPath, ['-c', code, workerPath], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  }).trim();
  return JSON.parse(output);
}

describe('viral media worker security policy', () => {
  it('validates HTTPS source URLs against exact platform hostnames', () => {
    const results = runWorkerJsonProbe(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

def validate(url, platform):
    validator = getattr(worker, "validate_platform_url", None)
    if validator is None:
        detected = worker.detect_platform(url)
        return {"ok": detected == platform, "error": "validate_platform_url is missing", "detected": detected}
    try:
        validator(url, platform)
        return {"ok": True, "error": ""}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

print(json.dumps([
    validate("https://evil.example/?q=douyin.com", "douyin"),
    validate("https://douyin.com.evil.example/video/1", "douyin"),
    validate("https://v.douyin.com/abc", "douyin"),
    validate("file:///C:/secret.txt", "douyin"),
    validate("https://www.douyin.com/video/1", "kuaishou"),
], ensure_ascii=False))
`);

    expect(results).toEqual([
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: false, error: expect.stringMatching(/HTTPS/) }),
      expect.objectContaining({ ok: false, error: expect.stringMatching(/平台/) }),
    ]);
  });

  it('preserves Netscape cookie domain, path, secure, and expiry attributes', () => {
    const result = runWorkerJsonProbe(String.raw`
import importlib.util
import json
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

loader = getattr(worker, "load_cookie_file", None)
if loader is None:
    print(json.dumps({"available": False}))
else:
    with tempfile.TemporaryDirectory() as directory:
        cookie_file = Path(directory) / "cookies.txt"
        cookie_file.write_text(
            ".douyin.com\tTRUE\t/api\tTRUE\t2147483647\tsessionid\tdouyin-secret\n"
            ".kuaishou.com\tTRUE\t/\tFALSE\t2147483646\tdid\tkuaishou-secret\n",
            encoding="utf-8",
        )
        cookies = loader(cookie_file)
        print(json.dumps({"available": True, "cookies": [asdict(cookie) for cookie in cookies]}))
`);

    expect(result).toEqual({
      available: true,
      cookies: [
        {
          name: 'sessionid',
          value: 'douyin-secret',
          domain: '.douyin.com',
          path: '/api',
          secure: true,
          expires: 2147483647,
        },
        {
          name: 'did',
          value: 'kuaishou-secret',
          domain: '.kuaishou.com',
          path: '/',
          secure: false,
          expires: 2147483646,
        },
      ],
    });
  });

  it('sends cookies only when domain, path, secure, and expiry all match', () => {
    const result = runWorkerJsonProbe(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

cookie_type = getattr(worker, "StoredCookie", None)
header_for = getattr(worker, "cookie_header_for_url", None)
if cookie_type is None or header_for is None:
    print(json.dumps({"available": False}))
else:
    cookies = [
        cookie_type("sessionid", "douyin-secret", ".douyin.com", "/api", True, 2147483647),
        cookie_type("expired", "old", ".douyin.com", "/", True, 1),
        cookie_type("did", "kuaishou-secret", ".kuaishou.com", "/", False, 2147483646),
    ]
    print(json.dumps({
        "available": True,
        "firstParty": header_for(cookies, "https://www.douyin.com/api/detail"),
        "wrongPath": header_for(cookies, "https://www.douyin.com/video/1"),
        "insecure": header_for(cookies, "http://www.douyin.com/api/detail"),
        "attacker": header_for(cookies, "https://media.evil.example/api/detail"),
        "suffixAttacker": header_for(cookies, "https://douyin.com.evil.example/api/detail"),
    }))
`);

    expect(result).toEqual({
      available: true,
      firstParty: 'sessionid=douyin-secret',
      wrongPath: '',
      insecure: '',
      attacker: '',
      suffixAttacker: '',
    });
  });

  it('adds only matching cookies to Playwright with original attributes', () => {
    const result = runWorkerJsonProbe(String.raw`
import asyncio
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

cookie_type = getattr(worker, "StoredCookie", None)
if cookie_type is None:
    print(json.dumps({"available": False}))
else:
    class Context:
        def __init__(self):
            self.cookies = []

        async def add_cookies(self, cookies):
            self.cookies.extend(cookies)

    context = Context()
    cookies = [
        cookie_type("sessionid", "douyin-secret", ".douyin.com", "/api", True, 2147483647),
        cookie_type("did", "kuaishou-secret", ".kuaishou.com", "/", False, 2147483646),
    ]
    try:
        asyncio.run(worker.add_playwright_cookies(context, cookies, "https://www.douyin.com/api/detail"))
        print(json.dumps({"available": True, "cookies": context.cookies}))
    except Exception as exc:
        print(json.dumps({"available": False, "error": str(exc)}))
`);

    expect(result).toEqual({
      available: true,
      cookies: [
        {
          name: 'sessionid',
          value: 'douyin-secret',
          domain: '.douyin.com',
          path: '/api',
          secure: true,
          expires: 2147483647,
        },
      ],
    });
  });

  it('allows known media CDNs but rejects attacker-controlled media hosts', () => {
    const result = runWorkerJsonProbe(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

checker = getattr(worker, "is_allowed_media_url", None)
if checker is None:
    checker = lambda url, platform: worker.looks_like_video_url(url)

print(json.dumps({
    "douyin": checker("https://v3-douyinvod.com/abc/video/clip.mp4", "douyin"),
    "kuaishou": checker("https://v1.kwaicdn.com/abc/clip.mp4", "kuaishou"),
    "bilibili": checker("https://upos-sz-mirrorcos.bilivideo.com/abc/clip.m4s", "bilibili"),
    "attacker": checker("https://media.evil.example/clip.mp4", "douyin"),
    "suffixAttacker": checker("https://douyinvod.com.evil.example/clip.mp4", "douyin"),
}))
`);

    expect(result).toEqual({
      douyin: true,
      kuaishou: true,
      bilibili: true,
      attacker: false,
      suffixAttacker: false,
    });
  });

  it('rejects a redirect away from the selected platform without forwarding cookies', () => {
    const result = runWorkerJsonProbe(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

options = {}
calls = []

class Response:
    status_code = 302
    headers = {"location": "https://evil.example/?next=douyin.com"}
    url = "https://v.douyin.com/abc"

    def raise_for_status(self):
        return None

class Client:
    def __init__(self, **kwargs):
        options.update(kwargs)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def get(self, url, headers):
        calls.append({"url": url, "cookie": headers.get("Cookie", "")})
        return Response()

worker.httpx.Client = Client
try:
    worker.resolve_url("https://v.douyin.com/abc", 1000, "sessionid=secret", "douyin")
    outcome = {"ok": True, "error": ""}
except Exception as exc:
    outcome = {"ok": False, "error": str(exc)}

print(json.dumps({
    "outcome": outcome,
    "followRedirects": options.get("follow_redirects"),
    "calls": calls,
}))
`);

    expect(result).toEqual({
      outcome: { ok: false, error: expect.stringMatching(/平台|跳转/) },
      followRedirects: false,
      calls: [{ url: 'https://v.douyin.com/abc', cookie: 'sessionid=secret' }],
    });
  });

  it('does not swallow a Kuaishou short-link redirect policy failure', () => {
    const result = runWorkerJsonProbe(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

class Response:
    status_code = 302
    headers = {"location": "https://evil.example/?next=kuaishou.com"}
    url = "https://v.kuaishou.com/abc"

    def raise_for_status(self):
        return None

class Client:
    def __init__(self, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def get(self, url, headers):
        return Response()

worker.httpx.Client = Client
try:
    normalized = worker.normalize_kuaishou_url("https://v.kuaishou.com/abc", 1000, [])
    outcome = {"ok": True, "normalized": normalized, "error": ""}
except Exception as exc:
    outcome = {"ok": False, "normalized": "", "error": str(exc)}

print(json.dumps(outcome, ensure_ascii=False))
`);

    expect(result).toEqual({ ok: false, normalized: '', error: expect.stringMatching(/平台|跳转/) });
  });

  it('aborts Playwright main-frame navigation to a host outside the platform', () => {
    const result = runWorkerJsonProbe(String.raw`
import asyncio
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

installer = getattr(worker, "install_playwright_navigation_guard", None)
if installer is None:
    print(json.dumps({"available": False}))
else:
    class Page:
        def __init__(self):
            self.main_frame = object()
            self.handler = None

        async def route(self, pattern, handler):
            self.handler = handler

    class Request:
        def __init__(self, url, frame):
            self.url = url
            self.frame = frame

        def is_navigation_request(self):
            return True

    class Route:
        def __init__(self, request):
            self.request = request
            self.aborted = False
            self.continued = False

        async def abort(self):
            self.aborted = True

        async def continue_(self):
            self.continued = True

    async def scenario():
        page = Page()
        await installer(page, "douyin")
        allowed = Route(Request("https://www.douyin.com/video/1", page.main_frame))
        attacker = Route(Request("https://evil.example/?next=douyin.com", page.main_frame))
        await page.handler(allowed)
        await page.handler(attacker)
        return {
            "available": True,
            "allowed": {"aborted": allowed.aborted, "continued": allowed.continued},
            "attacker": {"aborted": attacker.aborted, "continued": attacker.continued},
        }

    print(json.dumps(asyncio.run(scenario())))
`);

    expect(result).toEqual({
      available: true,
      allowed: { aborted: false, continued: true },
      attacker: { aborted: true, continued: false },
    });
  });

  it('deletes a partial file when a streamed download exceeds its byte limit', () => {
    const result = runWorkerJsonProbe(String.raw`
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

writer = getattr(worker, "write_limited_stream", None)
if writer is None:
    print(json.dumps({"available": False}))
else:
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "video.mp4"
        try:
            writer(output, [b"1234", b"5678"], 6)
            outcome = {"ok": True, "error": ""}
        except Exception as exc:
            outcome = {"ok": False, "error": str(exc)}
        print(json.dumps({"available": True, "outcome": outcome, "exists": output.exists()}))
`);

    expect(result).toEqual({
      available: true,
      outcome: { ok: false, error: expect.stringMatching(/大小|字节|上限/) },
      exists: false,
    });
  });
});
