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
from playwright.sync_api import Page, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".artifacts" / "editorial-collage-workbench"
ELECTRON = ROOT / "node_modules" / "electron" / "dist" / "electron.exe"


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
                data = json.loads(response.read().decode("utf-8"))
                return str(data["webSocketDebuggerUrl"])
        except Exception:
            time.sleep(0.2)
    raise TimeoutError("Electron CDP endpoint did not become ready.")


def set_window_size(page: Page, width: int, height: int) -> None:
    page.set_viewport_size({"width": width, "height": height})
    page.wait_for_timeout(350)


def layout_snapshot(page: Page) -> dict[str, object]:
    return page.locator(".vox-workbench").evaluate(
        """root => {
          const ownRect = element => {
            const value = element?.getBoundingClientRect();
            return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
          };
          const rect = selector => {
            return ownRect(root.querySelector(selector));
          };
          const gridElement = root.querySelector('.vox-workspace-grid');
          const grid = ownRect(gridElement);
          const outline = rect('.vox-outline-pane');
          const canvas = rect('.vox-canvas-pane');
          const inspector = rect('.vox-inspector-pane');
          const frame = rect('.vox-frame');
          const strategyElement = root.querySelector('.vox-inspector-form .sd-segmented-control');
          const strategyTabs = Array.from(strategyElement?.querySelectorAll('[role="tab"]') ?? []);
          const strategyTabWrapped = strategyTabs.map(tab => {
            const content = tab.querySelector('.fui-Tab__content');
            if (!content) return false;
            const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
            return Number.isFinite(lineHeight) && content.getBoundingClientRect().height > lineHeight * 1.5;
          });
          return {
            viewport: { width: innerWidth, height: innerHeight },
            root: ownRect(root), grid, outline, canvas, inspector, frame,
            timelineBeats: root.querySelectorAll('.vox-timeline-beat').length,
            layers: root.querySelectorAll('.vox-preview-layer').length,
            horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            gridOverflow: gridElement ? gridElement.scrollWidth - gridElement.clientWidth : null,
            strategyOverflow: strategyElement ? strategyElement.scrollWidth - strategyElement.clientWidth : null,
            strategyTabOverflow: strategyTabs.map(tab => Math.max(tab.scrollWidth - tab.clientWidth, tab.scrollHeight - tab.clientHeight)),
            strategyTabWrapped,
            panesSeparated: Boolean(outline && canvas && inspector && outline.right <= canvas.x + 1 && canvas.right <= inspector.x + 1),
          };
        }"""
    )


def assert_layout(snapshot: dict[str, object], compact: bool) -> None:
    frame = snapshot.get("frame")
    if not isinstance(frame, dict) or frame.get("width", 0) < 120 or frame.get("height", 0) < 210:
        raise AssertionError(f"VOX preview frame is not visible: {frame}")
    if snapshot.get("timelineBeats") != 4 or int(snapshot.get("layers", 0)) < 3:
        raise AssertionError(f"VOX timeline or layers are incomplete: {snapshot}")
    if not snapshot.get("panesSeparated"):
        raise AssertionError(f"VOX panes overlap: {snapshot}")
    if int(snapshot.get("horizontalOverflow", 0)) > 1 or int(snapshot.get("gridOverflow", 0)) > 1:
        raise AssertionError(f"VOX workbench overflows horizontally: {snapshot}")
    if int(snapshot.get("strategyOverflow", 0)) > 1 or any(int(value) > 1 for value in snapshot.get("strategyTabOverflow", [])):
        raise AssertionError(f"VOX render strategy control is clipped: {snapshot}")
    if any(bool(value) for value in snapshot.get("strategyTabWrapped", [])):
        raise AssertionError(f"VOX render strategy labels wrap unexpectedly: {snapshot}")
    if compact and isinstance(snapshot.get("inspector"), dict) and snapshot["inspector"].get("width", 0) < 250:
        raise AssertionError(f"VOX compact inspector is clipped: {snapshot}")


def screenshot_variance(path: Path, frame: dict[str, object]) -> float:
    with Image.open(path) as image:
        left = max(0, int(float(frame["x"])))
        top = max(0, int(float(frame["y"])))
        right = min(image.width, int(float(frame["right"])))
        bottom = min(image.height, int(float(frame["bottom"])))
        crop = image.convert("RGB").crop((left, top, right, bottom))
        return float(sum(ImageStat.Stat(crop).var))


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    qa_temp_root = ROOT / ".codex-audit-temp"
    qa_temp_root.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="vox-electron-", dir=qa_temp_root))
    port = available_port()
    env = os.environ.copy()
    env["NODE_ENV"] = "production"
    env.pop("VITE_DEV_SERVER_URL", None)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    creation_flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        [
            str(ELECTRON),
            f"--remote-debugging-port={port}",
            "--remote-debugging-address=127.0.0.1",
            "--remote-allow-origins=*",
            f"--user-data-dir={profile}",
            str(ROOT),
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=creation_flags,
    )
    runtime_errors: list[str] = []
    report: dict[str, object] = {"processId": process.pid, "runtimeErrors": runtime_errors, "captures": []}
    try:
        endpoint = wait_for_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            context = browser.contexts[0]
            page = context.pages[0]
            page.on("pageerror", lambda error: runtime_errors.append(str(error)))
            page.on("console", lambda message: runtime_errors.append(message.text) if message.type == "error" else None)
            page.wait_for_selector(".app-shell", timeout=30_000)
            set_window_size(page, 1440, 900)
            page.get_by_role("button", name="VOX 视觉导演").click()
            page.wait_for_selector("[data-editorial-collage-workbench='true']")
            inspector = page.locator(".vox-inspector-pane")
            inspector.locator("input").first.fill("咖啡馆与城市公共空间")
            inspector.locator("textarea").fill("咖啡馆不只卖饮料。它改变了消息交换的速度。报纸、交易和公共讨论聚到同一张桌边。城市因此获得新的公共空间。")
            page.get_by_role("button", name="创建 30 秒结构").click()
            page.wait_for_selector(".vox-frame")
            expect(page.locator(".vox-timeline-beat")).to_have_count(4)
            page.locator(".vox-beat-list button").nth(1).click()
            page.get_by_role("tab", name="混合模式").click()
            page.get_by_role("button", name="保存").click()
            page.locator(".vox-inspector-form .vox-section-heading span", has_text="已保存").wait_for(timeout=15_000)

            desktop_path = ARTIFACTS / "desktop-1440x900.png"
            page.screenshot(path=desktop_path, full_page=False)
            desktop = layout_snapshot(page)
            assert_layout(desktop, compact=False)
            desktop_variance = screenshot_variance(desktop_path, desktop["frame"])
            if desktop_variance < 250:
                raise AssertionError(f"VOX desktop preview is visually blank: variance={desktop_variance}")
            report["captures"].append({"name": desktop_path.name, "layout": desktop, "frameVariance": desktop_variance})

            set_window_size(page, 1040, 720)
            compact_path = ARTIFACTS / "compact-1040x720.png"
            page.screenshot(path=compact_path, full_page=False)
            compact = layout_snapshot(page)
            assert_layout(compact, compact=True)
            compact_variance = screenshot_variance(compact_path, compact["frame"])
            if compact_variance < 250:
                raise AssertionError(f"VOX compact preview is visually blank: variance={compact_variance}")
            report["captures"].append({"name": compact_path.name, "layout": compact, "frameVariance": compact_variance})

            report["project"] = page.locator(".vox-workbench-title h2").inner_text()
            report["selectedBeat"] = page.locator(".vox-beat-list button").nth(1).inner_text()
            report["renderStrategy"] = page.get_by_role("tab", name="混合模式").get_attribute("aria-selected")
            browser.close()
        if runtime_errors:
            raise AssertionError(f"Electron reported runtime errors: {runtime_errors}")
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        (ARTIFACTS / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False, capture_output=True)
                else:
                    process.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
