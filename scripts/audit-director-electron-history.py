from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageStat
from playwright.sync_api import Page, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".artifacts" / "black-screen-audit-2026-08-18" / "electron"
QA_TEMP_ROOT = ROOT / ".codex-audit-temp"
ELECTRON = ROOT / "node_modules" / "electron" / "dist" / "electron.exe"
SOURCE_DATA = Path(os.environ.get("STORYDREAM_HISTORY_DATA_DIR", r"C:\Users\foxnotail\AppData\Roaming\storydream\storydream"))


def available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def wait_for_cdp(port: int, process: subprocess.Popen[bytes]) -> str:
    deadline = time.monotonic() + 30
    url = f"http://127.0.0.1:{port}/json/version"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Electron exited before CDP was ready: {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return str(json.loads(response.read().decode("utf-8"))["webSocketDebuggerUrl"])
        except Exception:
            time.sleep(0.2)
    raise TimeoutError("Electron CDP endpoint did not become ready.")


def copy_history_database(profile: Path) -> dict[str, object]:
    source_database = SOURCE_DATA / "data.db"
    if not source_database.is_file():
        raise FileNotFoundError(f"StoryDream history database not found: {source_database}")
    target_directory = profile / "storydream"
    target_directory.mkdir(parents=True, exist_ok=True)
    copied: list[dict[str, object]] = []
    for name in ["data.db", "data.db-wal", "data.db-shm"]:
        source = SOURCE_DATA / name
        if not source.is_file():
            continue
        target = target_directory / name
        shutil.copy2(source, target)
        copied.append({"name": name, "bytes": target.stat().st_size})
    return {"source": str(source_database), "target": str(target_directory / "data.db"), "files": copied}


def resize(page: Page, width: int, height: int) -> None:
    page.set_viewport_size({"width": width, "height": height})
    page.wait_for_timeout(700)


def wait_for_preview_image(page: Page, timeout_ms: int = 20_000) -> None:
    image = page.locator(".director-media-preview img")
    image.wait_for(state="visible", timeout=timeout_ms)
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if image.evaluate("element => element.complete && element.naturalWidth > 0"):
            return
        page.wait_for_timeout(200)
    state = image.evaluate("element => ({ src: element.currentSrc || element.src, complete: element.complete, naturalWidth: element.naturalWidth })")
    raise TimeoutError(f"Electron preview image did not become usable: {state}")


def page_snapshot(page: Page) -> dict[str, object]:
    return page.evaluate(
        r"""() => {
          const box = element => {
            const value = element?.getBoundingClientRect();
            return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
          };
          const visible = element => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const value = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && value.width > 0 && value.height > 0;
          };
          const desk = document.querySelector('.director-desk');
          const fixedControls = [...document.querySelectorAll('button, [role="button"], [role="tab"]')].filter(visible);
          const preview = document.querySelector('.director-media-preview');
          const previewImage = preview?.querySelector('img');
          const routeError = document.querySelector('.route-error-state, .application-error-state');
          return {
            viewport: { width: innerWidth, height: innerHeight },
            route: document.querySelector('[data-motion-comic-workbench="true"]') ? 'motion-comic'
              : document.querySelector('[data-editorial-collage-workbench="true"]') ? 'editorial-collage'
              : 'shell',
            viewState: document.querySelector('.director-desk-grid') ? 'workbench' : desk ? 'create' : 'shell',
            heading: document.querySelector('h1, h2')?.textContent?.trim() || '',
            bodyText: (document.body.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 1000),
            rects: { root: box(document.querySelector('#root')), desk: box(desk), workspaceGrid: box(document.querySelector('.director-desk-grid')), preview: box(preview), error: box(routeError) },
            routeError: routeError?.textContent?.trim().replace(/\s+/g, ' ') || '',
            previewImageLoaded: Boolean(previewImage?.complete && previewImage?.naturalWidth > 0),
            clippedControls: fixedControls.filter(element => element.scrollWidth - element.clientWidth > 3 || element.scrollHeight - element.clientHeight > 3).map(element => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName),
            horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        }"""
    )


def screenshot_variance(path: Path) -> float:
    with Image.open(path) as image:
        return float(sum(ImageStat.Stat(image.convert("RGB")).var))


def capture(page: Page, name: str) -> dict[str, object]:
    page.wait_for_timeout(700)
    path = ARTIFACTS / f"{name}.png"
    page.screenshot(path=path, full_page=False)
    snapshot = page_snapshot(page)
    snapshot["screenshot"] = path.name
    snapshot["screenshotVariance"] = screenshot_variance(path)
    return snapshot


def assert_route(snapshot: dict[str, object], expected_route: str, expect_workbench: bool) -> None:
    if snapshot.get("route") != expected_route:
        raise AssertionError(f"Expected Electron route {expected_route}, received {snapshot.get('route')}.")
    if expect_workbench and snapshot.get("viewState") != "workbench":
        raise AssertionError(f"Expected {expected_route} workbench, received {snapshot.get('viewState')}.")
    viewport = snapshot.get("viewport")
    rects = snapshot.get("rects")
    if not isinstance(viewport, dict) or not isinstance(rects, dict) or not isinstance(rects.get("desk"), dict):
        raise AssertionError(f"Missing Electron route geometry: {snapshot}")
    if float(rects["desk"].get("height", 0)) < float(viewport.get("height", 0)) * 0.85:
        raise AssertionError(f"Electron {expected_route} collapsed: {rects['desk']}")
    if snapshot.get("routeError") or int(snapshot.get("horizontalOverflow", 0)) > 1 or snapshot.get("clippedControls"):
        raise AssertionError(f"Electron {expected_route} is unhealthy: {snapshot}")
    if expect_workbench and not snapshot.get("previewImageLoaded"):
        raise AssertionError(f"Electron {expected_route} preview is blank.")


def return_home(page: Page) -> None:
    button = page.get_by_role("button", name="返回工作流列表", exact=True).first
    if button.is_visible():
        button.click()
        page.wait_for_selector(".sidebar", state="visible", timeout=15_000)
        return
    page.get_by_role("button", name="新建任务", exact=True).first.click()
    page.wait_for_selector(".sidebar", state="visible", timeout=15_000)


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    QA_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="black-screen-electron-history-", dir=QA_TEMP_ROOT))
    port = available_port()
    report: dict[str, object] = {
        "sourceProfile": "copied historical database",
        "runtimeErrors": [],
        "steps": [],
    }
    process: subprocess.Popen[bytes] | None = None
    try:
        report["databaseCopy"] = copy_history_database(profile)
        env = os.environ.copy()
        env["NODE_ENV"] = "production"
        env.pop("VITE_DEV_SERVER_URL", None)
        env.pop("ELECTRON_RUN_AS_NODE", None)
        process = subprocess.Popen(
            [str(ELECTRON), f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1", "--remote-allow-origins=*", f"--user-data-dir={profile}", str(ROOT)],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        report["processId"] = process.pid
        endpoint = wait_for_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            errors = report["runtimeErrors"]
            assert isinstance(errors, list)
            page.on("pageerror", lambda error: errors.append({"type": "pageerror", "message": str(error)}))
            page.on("console", lambda message: errors.append({"type": "console", "message": message.text}) if message.type == "error" else None)
            page.wait_for_selector(".app-shell", timeout=30_000)
            resize(page, 1536, 1024)
            if page.locator(".director-desk").is_visible():
                return_home(page)

            steps = report["steps"]
            assert isinstance(steps, list)
            steps.append(capture(page, "01-home-with-history"))

            page.get_by_role("button", name="VOX 视觉导演", exact=True).click()
            page.wait_for_selector("[data-editorial-collage-workbench='true']", timeout=15_000)
            page.wait_for_selector(".director-media-preview", timeout=15_000)
            wait_for_preview_image(page)
            vox_desktop = capture(page, "02-existing-vox-desktop")
            steps.append(vox_desktop)
            assert_route(vox_desktop, "editorial-collage", True)
            resize(page, 1040, 720)
            vox_compact = capture(page, "03-existing-vox-compact")
            steps.append(vox_compact)
            assert_route(vox_compact, "editorial-collage", True)

            resize(page, 1536, 1024)
            return_home(page)
            page.get_by_role("button", name="AI 漫剧", exact=True).first.click()
            page.wait_for_selector("[data-motion-comic-workbench='true']", timeout=15_000)
            comic_create = capture(page, "04-comic-create")
            steps.append(comic_create)
            assert_route(comic_create, "motion-comic", False)

            page.get_by_role("textbox", name="系列名称").fill("历史数据隔离复审漫剧")
            page.get_by_role("textbox", name="核心设定").fill("旧项目继续可读，新项目可以创建，角色和场景一致性在同一导演台中保持稳定。")
            page.get_by_role("textbox", name="首集标题").fill("隔离复审")
            page.get_by_role("button", name="创建系列骨架", exact=True).click()
            page.wait_for_selector(".director-media-preview", timeout=15_000)
            wait_for_preview_image(page)
            comic_desktop = capture(page, "05-comic-workbench-desktop")
            steps.append(comic_desktop)
            assert_route(comic_desktop, "motion-comic", True)
            resize(page, 1040, 720)
            comic_compact = capture(page, "06-comic-workbench-compact")
            steps.append(comic_compact)
            assert_route(comic_compact, "motion-comic", True)
            browser.close()

        if report["runtimeErrors"]:
            raise AssertionError(f"Electron runtime errors: {report['runtimeErrors']}")
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["failure"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        (ARTIFACTS / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        if process is not None and process.poll() is None:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)
            else:
                process.terminate()
        profile_root = profile.resolve()
        audit_root = QA_TEMP_ROOT.resolve()
        if profile_root.is_relative_to(audit_root):
            shutil.rmtree(profile_root, ignore_errors=True)


if __name__ == "__main__":
    main()
