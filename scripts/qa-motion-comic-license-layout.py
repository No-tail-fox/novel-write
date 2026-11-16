from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".artifacts" / "motion-comic-workbench"
ELECTRON = ROOT / "node_modules" / "electron" / "dist" / "electron.exe"
spec = importlib.util.spec_from_file_location("motion_comic_base", ROOT / "scripts" / "qa-motion-comic.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    temp_root = ROOT / ".codex-audit-temp"
    temp_root.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="motion-comic-license-layout-", dir=temp_root))
    env = os.environ.copy()
    env.update(NODE_ENV="production", VITE_DEV_SERVER_URL="")
    for key in (*base.PAID_API_ENV_VARS, "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"):
        env.pop(key, None)
    port = base.available_port()
    log_path = profile / "electron.log"
    log = log_path.open("wb")
    process = subprocess.Popen(
        [str(ELECTRON), f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1", "--remote-allow-origins=*", f"--user-data-dir={profile}", str(ROOT)],
        cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    report = {"status": "running", "paidGenerationCalls": 0, "screenshots": [], "checks": [], "runtimeErrors": []}
    browser = None
    try:
        endpoint = base.wait_for_cdp(port, process)
        deadline = time.monotonic() + 30
        targets = []
        while time.monotonic() < deadline and process.poll() is None:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as response:
                    targets = json.loads(response.read().decode("utf-8"))
            except Exception:
                time.sleep(0.2)
                continue
            if any(target.get("type") == "page" for target in targets):
                break
            time.sleep(0.1)
        else:
            raise TimeoutError(f"No Electron page target: {targets!r}")
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            page.on("pageerror", lambda error: report["runtimeErrors"].append(str(error)))
            page.wait_for_selector(".license-gate, .app-shell", timeout=30000)
            expect(page.locator(".license-gate")).to_be_visible()
            for theme in ("dark",):
                for name, width, height in (("desktop", 1536, 1024), ("compact", 1040, 720)):
                    page.set_viewport_size({"width": width, "height": height})
                    page.wait_for_timeout(250)
                    metrics = page.locator(".license-gate").evaluate("root => ({ pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, panelOverflow: root.scrollWidth > root.clientWidth + 1, outOfBounds: [...root.querySelectorAll('button,input')].filter(node => { const rect=node.getBoundingClientRect(); return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1); }).length })")
                    shot = ARTIFACTS / f"license-gate-{theme}-{name}.png"
                    page.screenshot(path=str(shot), animations="disabled")
                    report["screenshots"].append(str(shot.relative_to(ROOT)))
                    report["checks"].append({"theme": theme, "viewport": name, "width": width, "height": height, **metrics})
                    if metrics != {"pageOverflow": False, "panelOverflow": False, "outOfBounds": 0}:
                        raise AssertionError(f"License gate layout overflow: {report['checks'][-1]}")
            if report["runtimeErrors"]:
                raise AssertionError(f"Renderer errors: {report['runtimeErrors']}")
            report["status"] = "passed"
            browser.close()
            browser = None
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        if browser is not None:
            try:
                page.screenshot(path=str(ARTIFACTS / "license-gate-failure.png"), animations="disabled")
            except Exception:
                pass
        raise
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        if process.poll() is None:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        log.flush()
        log.close()
        report["electronLogTail"] = log_path.read_text(encoding="utf-8", errors="replace")[-8000:]
        (ARTIFACTS / "license-layout-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if report["status"] == "passed":
            shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
