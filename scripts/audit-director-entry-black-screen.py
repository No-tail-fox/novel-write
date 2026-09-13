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
ARTIFACTS = ROOT / ".artifacts" / "black-screen-audit-2026-08-18"
QA_TEMP_ROOT = ROOT / ".codex-audit-temp"
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
TARGET_URL = os.environ.get("STORYDREAM_AUDIT_URL", "http://127.0.0.1:5173/")


def available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def wait_for_cdp(port: int, process: subprocess.Popen[bytes]) -> str:
    deadline = time.monotonic() + 30
    url = f"http://127.0.0.1:{port}/json/version"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Edge exited before CDP was ready: {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return str(json.loads(response.read().decode("utf-8"))["webSocketDebuggerUrl"])
        except Exception:
            time.sleep(0.2)
    raise TimeoutError("Edge CDP endpoint did not become ready.")


def page_snapshot(page: Page) -> dict[str, object]:
    return page.evaluate(
        r"""() => {
          const rect = element => {
            const box = element?.getBoundingClientRect();
            return box ? { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom } : null;
          };
          const visible = element => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
          };
          const root = document.querySelector('#root');
          const shell = document.querySelector('.app-shell');
          const content = document.querySelector('.content');
          const desk = document.querySelector('.director-desk');
          const workspaceGrid = document.querySelector('.director-desk-grid');
          const previewImage = document.querySelector('.director-media-preview img');
          const routeError = document.querySelector('.route-error-state, .application-error-state');
          const controlElements = [...document.querySelectorAll('button, [role="button"], [role="tab"], input, textarea, select')]
            .filter(visible);
          const fixedControls = [...document.querySelectorAll('button, [role="button"], [role="tab"]')]
            .filter(visible);
          const controls = controlElements
            .map(element => (element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' '))
            .filter(Boolean);
          const style = root ? getComputedStyle(root) : null;
          return {
            url: location.href,
            title: document.title,
            viewport: { width: innerWidth, height: innerHeight },
            route: document.querySelector('[data-motion-comic-workbench="true"]') ? 'motion-comic'
              : document.querySelector('[data-editorial-collage-workbench="true"]') ? 'editorial-collage'
              : document.querySelector('.route-loading-state') ? 'loading'
              : 'shell',
            heading: document.querySelector('h1, h2')?.textContent?.trim() || '',
            bodyText: (document.body.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 1200),
            rootHtmlLength: root?.innerHTML.length || 0,
            viewState: workspaceGrid ? 'workbench' : desk ? 'create' : 'shell',
            rects: { root: rect(root), shell: rect(shell), content: rect(content), desk: rect(desk), workspaceGrid: rect(workspaceGrid), error: rect(routeError) },
            styles: {
              htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
              bodyBackground: getComputedStyle(document.body).backgroundColor,
              rootBackground: style?.backgroundColor || '',
              rootDisplay: style?.display || '',
              rootVisibility: style?.visibility || '',
              rootOpacity: style?.opacity || '',
              contentGridRows: content ? getComputedStyle(content).gridTemplateRows : '',
            },
            routeError: routeError?.textContent?.trim().replace(/\s+/g, ' ') || '',
            visibleControls: controls.slice(0, 120),
            clippedControls: fixedControls.filter(element => element.scrollWidth - element.clientWidth > 3 || element.scrollHeight - element.clientHeight > 3).map(element => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName),
            previewImage: previewImage ? { src: previewImage.currentSrc || previewImage.src, complete: previewImage.complete, naturalWidth: previewImage.naturalWidth, naturalHeight: previewImage.naturalHeight } : null,
            previewImageLoaded: Boolean(previewImage?.complete && previewImage?.naturalWidth > 0),
            horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            storageKeys: Object.keys(localStorage).sort(),
          };
        }"""
    )


def screenshot_variance(path: Path) -> float:
    with Image.open(path) as image:
        return float(sum(ImageStat.Stat(image.convert("RGB")).var))


def capture(page: Page, name: str) -> dict[str, object]:
    page.wait_for_timeout(850)
    path = ARTIFACTS / f"{name}.png"
    page.screenshot(path=path, full_page=False)
    snapshot = page_snapshot(page)
    snapshot["screenshot"] = path.name
    snapshot["screenshotVariance"] = screenshot_variance(path)
    return snapshot


def assert_route_uses_viewport(snapshot: dict[str, object], expected_route: str) -> None:
    if snapshot.get("route") != expected_route:
        raise AssertionError(f"Expected route {expected_route}, received {snapshot.get('route')}.")
    rects = snapshot.get("rects")
    viewport = snapshot.get("viewport")
    if not isinstance(rects, dict) or not isinstance(viewport, dict):
        raise AssertionError(f"Missing route geometry: {snapshot}")
    desk = rects.get("desk")
    if not isinstance(desk, dict) or float(desk.get("height", 0)) < float(viewport.get("height", 0)) * 0.85:
        raise AssertionError(f"{expected_route} collapsed instead of using the viewport: {desk}")
    if snapshot.get("routeError"):
        raise AssertionError(f"{expected_route} rendered an error state: {snapshot['routeError']}")


def click_from_latest_dom(page: Page, label: str) -> None:
    launch = page.locator(".director-quick-launch")
    if not launch.is_visible():
        raise AssertionError(f"Video workflow launch bar is not visible before clicking {label}.")
    button = launch.get_by_role("button", name=label, exact=True)
    if not button.is_visible():
        raise AssertionError(f"{label} is not visible in the latest DOM snapshot.")
    button.click()


def return_home(page: Page) -> None:
    for label in ["返回工作流列表", "返回首页", "新建任务"]:
        button = page.get_by_role("button", name=label, exact=True).first
        if button.is_visible():
            button.click()
            break
    else:
        raise AssertionError("No visible control returns the Director Desk to the workflow list.")
    page.wait_for_timeout(700)


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
    state = image.evaluate("element => ({ src: element.currentSrc || element.src, complete: element.complete, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight })")
    raise TimeoutError(f"Director preview image did not become usable: {state}")


def assert_workbench(snapshot: dict[str, object], expected_route: str) -> None:
    assert_route_uses_viewport(snapshot, expected_route)
    if snapshot.get("viewState") != "workbench":
        raise AssertionError(f"{expected_route} did not reach its full workbench: {snapshot.get('viewState')}")
    if not snapshot.get("previewImageLoaded"):
        raise AssertionError(f"{expected_route} preview image did not load.")
    if snapshot.get("clippedControls"):
        raise AssertionError(f"{expected_route} has clipped controls: {snapshot['clippedControls']}")
    if int(snapshot.get("horizontalOverflow", 0)) > 1:
        raise AssertionError(f"{expected_route} overflows horizontally: {snapshot['horizontalOverflow']}")


def main() -> None:
    if not EDGE.exists():
        raise FileNotFoundError(f"Microsoft Edge not found: {EDGE}")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    QA_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="black-screen-edge-", dir=QA_TEMP_ROOT))
    port = available_port()
    process = subprocess.Popen(
        [
            str(EDGE),
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            "--no-default-browser-check",
            "--remote-allow-origins=*",
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            "--window-size=1536,1024",
            "about:blank",
        ],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )
    report: dict[str, object] = {
        "targetUrl": TARGET_URL,
        "browser": "Microsoft Edge",
        "processId": process.pid,
        "runtimeErrors": [],
        "networkErrors": [],
        "steps": [],
    }
    try:
        endpoint = wait_for_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            context = browser.contexts[0]
            page = context.pages[0]
            errors = report["runtimeErrors"]
            network_errors = report["networkErrors"]
            assert isinstance(errors, list)
            assert isinstance(network_errors, list)
            page.on("pageerror", lambda error: errors.append({"type": "pageerror", "message": str(error)}))
            page.on("console", lambda message: errors.append({"type": "console", "message": message.text}) if message.type == "error" else None)
            page.on("response", lambda response: network_errors.append({"status": response.status, "url": response.url}) if response.status >= 400 else None)
            resize(page, 1536, 1024)
            page.goto(TARGET_URL, wait_until="domcontentloaded")
            page.wait_for_selector(".app-shell", timeout=30_000)
            page.wait_for_timeout(1000)

            steps = report["steps"]
            assert isinstance(steps, list)
            steps.append(capture(page, "01-before"))

            click_from_latest_dom(page, "VOX 视频")
            page.wait_for_timeout(1200)
            vox_create = capture(page, "02-after-vox")
            steps.append(vox_create)
            assert_route_uses_viewport(vox_create, "editorial-collage")

            page.get_by_role("textbox", name="项目标题").fill("黑屏复审 VOX")
            page.get_by_role("textbox", name="原始文案").fill("城市档案、街道细节与人物口述共同解释一段真实变化，画面保持清晰、克制并可核验。")
            page.get_by_role("button", name="创建 30 秒结构", exact=True).click()
            page.wait_for_selector(".director-media-preview", timeout=15_000)
            wait_for_preview_image(page)
            vox_desktop = capture(page, "03-vox-workbench-desktop")
            steps.append(vox_desktop)
            assert_workbench(vox_desktop, "editorial-collage")
            resize(page, 1040, 720)
            vox_compact = capture(page, "04-vox-workbench-compact")
            steps.append(vox_compact)
            assert_workbench(vox_compact, "editorial-collage")
            resize(page, 1536, 1024)

            return_home(page)
            steps.append(capture(page, "05-before-comic"))
            click_from_latest_dom(page, "AI 漫剧")
            page.wait_for_timeout(1200)
            comic_create = capture(page, "06-after-comic")
            steps.append(comic_create)
            assert_route_uses_viewport(comic_create, "motion-comic")

            page.get_by_role("textbox", name="系列名称").fill("黑屏复审漫剧")
            page.get_by_role("textbox", name="核心设定").fill("女孩在雨夜收到来自十年后的信，必须在天亮前确认警告，同时保持人物服装和场景一致。")
            page.get_by_role("textbox", name="首集标题").fill("信从未来来")
            page.get_by_role("button", name="创建系列骨架", exact=True).click()
            page.wait_for_selector(".director-media-preview", timeout=15_000)
            wait_for_preview_image(page)
            comic_desktop = capture(page, "07-comic-workbench-desktop")
            steps.append(comic_desktop)
            assert_workbench(comic_desktop, "motion-comic")
            resize(page, 1040, 720)
            comic_compact = capture(page, "08-comic-workbench-compact")
            steps.append(comic_compact)
            assert_workbench(comic_compact, "motion-comic")
            browser.close()

        report["runtimeErrors"] = [
            error for error in report["runtimeErrors"]
            if not (error.get("type") == "console" and error.get("message") == "Failed to load resource: the server responded with a status of 404 (Not Found)")
        ]
        if report["runtimeErrors"]:
            raise AssertionError(f"Browser runtime errors: {report['runtimeErrors']}")
        report["status"] = "captured"
    except Exception as error:
        report["status"] = "failed"
        report["failure"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        (ARTIFACTS / "browser-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        if process.poll() is None:
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
