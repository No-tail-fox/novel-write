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
ARTIFACTS = ROOT / ".artifacts" / "motion-comic-workbench"
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
    return page.locator(".comic-workbench").evaluate(
        """root => {
          const ownRect = element => {
            const value = element?.getBoundingClientRect();
            return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
          };
          const rect = selector => ownRect(root.querySelector(selector));
          const gridElement = root.querySelector('.comic-workspace-grid');
          const grid = ownRect(gridElement);
          const outline = rect('.comic-outline-pane');
          const canvas = rect('.comic-canvas-pane');
          const inspector = rect('.comic-inspector-pane');
          const frame = rect('.comic-frame');
          const controls = [...root.querySelectorAll('button, select')].filter(element => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
          });
          return {
            viewport: { width: innerWidth, height: innerHeight },
            root: ownRect(root), grid, outline, canvas, inspector, frame,
            timelineShots: root.querySelectorAll('.comic-timeline-shot').length,
            treeShots: root.querySelectorAll(".comic-node-button[data-depth='2']").length,
            characters: root.querySelectorAll('.comic-character-silhouette').length,
            horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            gridOverflow: gridElement ? gridElement.scrollWidth - gridElement.clientWidth : null,
            clippedControls: controls.filter(element => element.scrollWidth - element.clientWidth > 2 || element.scrollHeight - element.clientHeight > 2).map(element => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName),
            wrappedLabels: [...root.querySelectorAll('label')].filter(label => {
              const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight);
              return Number.isFinite(lineHeight) && label.getBoundingClientRect().height > lineHeight * 1.5;
            }).map(label => label.textContent?.trim().slice(0, 40) || 'label'),
            panesSeparated: Boolean(outline && canvas && inspector && outline.right <= canvas.x + 1 && canvas.right <= inspector.x + 1),
          };
        }"""
    )


def assert_layout(snapshot: dict[str, object], compact: bool) -> None:
    frame = snapshot.get("frame")
    if not isinstance(frame, dict) or frame.get("width", 0) < 120 or frame.get("height", 0) < 190:
        raise AssertionError(f"Motion-comic preview frame is not visible: {frame}")
    if snapshot.get("timelineShots") != 6 or snapshot.get("treeShots") != 6:
        raise AssertionError(f"Motion-comic shot board is incomplete: {snapshot}")
    if int(snapshot.get("characters", 0)) < 1:
        raise AssertionError(f"Motion-comic character preview is empty: {snapshot}")
    if not snapshot.get("panesSeparated"):
        raise AssertionError(f"Motion-comic panes overlap: {snapshot}")
    if int(snapshot.get("horizontalOverflow", 0)) > 1 or int(snapshot.get("gridOverflow", 0)) > 1:
        raise AssertionError(f"Motion-comic workbench overflows horizontally: {snapshot}")
    clipped = [item for item in snapshot.get("clippedControls", []) if item]
    if clipped:
        raise AssertionError(f"Motion-comic controls are clipped: {clipped}")
    if snapshot.get("wrappedLabels"):
        raise AssertionError(f"Motion-comic field labels wrap unexpectedly: {snapshot['wrappedLabels']}")
    if compact and isinstance(snapshot.get("inspector"), dict) and snapshot["inspector"].get("width", 0) < 250:
        raise AssertionError(f"Motion-comic compact inspector is clipped: {snapshot}")


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
    profile = Path(tempfile.mkdtemp(prefix="motion-comic-electron-", dir=qa_temp_root))
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
            page.get_by_role("button", name="AI 漫剧").click()
            page.wait_for_selector("[data-motion-comic-workbench='true']")
            page.get_by_role("textbox", name="系列名称").fill("雨夜来信")
            page.get_by_role("textbox", name="核心设定").fill("女孩在雨夜收到一封来自十年后的信，必须在天亮前验证其中的警告。")
            page.get_by_role("textbox", name="首集标题").fill("信从未来来")
            page.get_by_role("button", name="创建系列骨架").click()
            page.wait_for_selector(".comic-frame")
            expect(page.locator(".comic-timeline-shot")).to_have_count(6)
            page.locator(".comic-tree .comic-node-button[data-depth='2']").nth(1).click()
            page.get_by_role("textbox", name="景别").fill("特写反应")
            page.get_by_role("button", name="保存").click()
            expect(page.get_by_role("button", name="保存")).to_be_disabled(timeout=15_000)

            desktop_path = ARTIFACTS / "desktop-1440x900.png"
            page.screenshot(path=desktop_path, full_page=False)
            desktop = layout_snapshot(page)
            assert_layout(desktop, compact=False)
            desktop_variance = screenshot_variance(desktop_path, desktop["frame"])
            if desktop_variance < 250:
                raise AssertionError(f"Motion-comic desktop preview is visually blank: variance={desktop_variance}")
            report["captures"].append({"name": desktop_path.name, "layout": desktop, "frameVariance": desktop_variance})

            set_window_size(page, 1040, 720)
            compact_path = ARTIFACTS / "compact-1040x720.png"
            page.screenshot(path=compact_path, full_page=False)
            compact = layout_snapshot(page)
            assert_layout(compact, compact=True)
            compact_variance = screenshot_variance(compact_path, compact["frame"])
            if compact_variance < 250:
                raise AssertionError(f"Motion-comic compact preview is visually blank: variance={compact_variance}")
            report["captures"].append({"name": compact_path.name, "layout": compact, "frameVariance": compact_variance})

            report["project"] = page.locator(".comic-workbench-title h2").inner_text()
            report["selectedShot"] = page.locator(".comic-tree .comic-node-button[data-depth='2']").nth(1).inner_text()
            report["framing"] = page.get_by_role("textbox", name="景别").input_value()
            report["providerJobs"] = 0
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
