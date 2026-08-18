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
ARTIFACTS = ROOT / ".artifacts" / "director-desk-qa"
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
                return str(json.loads(response.read().decode("utf-8"))["webSocketDebuggerUrl"])
        except Exception:
            time.sleep(0.2)
    raise TimeoutError("Electron CDP endpoint did not become ready.")


def set_window_size(page: Page, width: int, height: int) -> None:
    page.set_viewport_size({"width": width, "height": height})
    page.wait_for_timeout(450)


def layout_snapshot(page: Page) -> dict[str, object]:
    return page.locator(".director-desk").evaluate(
        """root => {
          const ownRect = element => {
            const value = element?.getBoundingClientRect();
            return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
          };
          const rect = selector => ownRect(root.querySelector(selector));
          const gridElement = root.querySelector('.director-desk-grid');
          const previewImage = root.querySelector('.director-media-preview img');
          const controls = [...root.querySelectorAll('button, select')].filter(element => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
          });
          const hidden = selector => {
            const element = document.querySelector(selector);
            return !element || getComputedStyle(element).display === 'none';
          };
          return {
            viewport: { width: innerWidth, height: innerHeight },
            root: ownRect(root),
            grid: ownRect(gridElement),
            left: rect('.director-left-pane'),
            center: rect('.director-center-pane'),
            inspector: rect('.director-inspector-pane'),
            previewToolbar: rect('.director-preview-toolbar'),
            preview: rect('.director-media-preview'),
            filmstripSection: rect('.director-filmstrip-section'),
            queue: rect('.director-queue-panel'),
            statusFooter: rect('.director-status-footer'),
            shots: root.querySelectorAll('.director-shot-row').length,
            filmstrip: root.querySelectorAll('.director-filmstrip-card').length,
            assets: root.querySelectorAll('.director-asset-tile').length,
            inspectorTabs: root.querySelectorAll('.director-inspector-pane [role="tab"]').length,
            shellChromeHidden: hidden('.app-shell > .window-line') && hidden('.app-shell .sidebar') && hidden('.app-shell .page-head'),
            imageLoaded: Boolean(previewImage && previewImage.complete && previewImage.naturalWidth > 0 && previewImage.naturalHeight > 0),
            horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            gridOverflow: gridElement ? gridElement.scrollWidth - gridElement.clientWidth : null,
            clippedControls: controls.filter(element => element.scrollWidth - element.clientWidth > 3 || element.scrollHeight - element.clientHeight > 3).map(element => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName),
          };
        }"""
    )


def assert_layout(snapshot: dict[str, object], compact: bool) -> None:
    preview = snapshot.get("preview")
    if not isinstance(preview, dict) or preview.get("width", 0) < 260 or preview.get("height", 0) < 150:
        raise AssertionError(f"Director preview is not visible: {preview}")
    if int(snapshot.get("shots", 0)) < 4 or int(snapshot.get("filmstrip", 0)) < 4:
        raise AssertionError(f"Director shot board is incomplete: {snapshot}")
    if int(snapshot.get("assets", 0)) < 6 or snapshot.get("inspectorTabs") != 4:
        raise AssertionError(f"Director assets or inspector tabs are incomplete: {snapshot}")
    if not snapshot.get("shellChromeHidden") or not snapshot.get("imageLoaded"):
        raise AssertionError(f"Director immersive shell or preview image failed: {snapshot}")
    if int(snapshot.get("horizontalOverflow", 0)) > 1 or int(snapshot.get("gridOverflow", 0)) > 1:
        raise AssertionError(f"Director Desk overflows horizontally: {snapshot}")
    if snapshot.get("clippedControls"):
        raise AssertionError(f"Director controls are clipped: {snapshot['clippedControls']}")
    left = snapshot.get("left")
    inspector = snapshot.get("inspector")
    center = snapshot.get("center")
    filmstrip_section = snapshot.get("filmstripSection")
    queue = snapshot.get("queue")
    footer = snapshot.get("statusFooter")
    toolbar = snapshot.get("previewToolbar")
    if not all(isinstance(item, dict) for item in [left, center, inspector, filmstrip_section, queue, footer, toolbar]):
        raise AssertionError(f"Director columns are missing: {snapshot}")
    if left.get("right", 0) > center.get("x", 0) + 1 or center.get("right", 0) > inspector.get("x", 0) + 1:
        raise AssertionError(f"Director columns overlap: {snapshot}")
    if preview.get("x", 0) < center.get("x", 0) - 1 or preview.get("right", 0) > center.get("right", 0) + 1:
        raise AssertionError(f"Director preview escapes the center column: {snapshot}")
    if filmstrip_section.get("y", 0) < preview.get("bottom", 0) - 1:
        raise AssertionError(f"Director filmstrip overlaps the preview: {snapshot}")
    if toolbar.get("height", 0) > 54:
        raise AssertionError(f"Director preview toolbar is less dense than the source design: {snapshot}")
    if footer.get("height", 0) < 30 or footer.get("y", 0) < inspector.get("bottom", 0) - 1:
        raise AssertionError(f"Director status footer is missing or overlaps the workspace: {snapshot}")
    if not compact and (queue.get("height", 0) < 320 or queue.get("y", 0) > 675):
        raise AssertionError(f"Desktop generation queue does not match the source proportion: {snapshot}")
    if compact and inspector.get("width", 0) < 300:
        raise AssertionError(f"Compact inspector is too narrow: {snapshot}")


def screenshot_variance(path: Path, frame: dict[str, object]) -> float:
    with Image.open(path) as image:
        left = max(0, int(float(frame["x"])))
        top = max(0, int(float(frame["y"])))
        right = min(image.width, int(float(frame["right"])))
        bottom = min(image.height, int(float(frame["bottom"])))
        return float(sum(ImageStat.Stat(image.convert("RGB").crop((left, top, right, bottom))).var))


def capture(page: Page, name: str, width: int, height: int, compact: bool) -> dict[str, object]:
    set_window_size(page, width, height)
    path = ARTIFACTS / f"{name}-{width}x{height}.png"
    page.screenshot(path=path, full_page=False)
    snapshot = layout_snapshot(page)
    assert_layout(snapshot, compact)
    variance = screenshot_variance(path, snapshot["preview"])
    if variance < 250:
        raise AssertionError(f"Director preview is visually blank: variance={variance}")
    return {"name": path.name, "layout": snapshot, "previewVariance": variance}


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    qa_temp_root = ROOT / ".codex-audit-temp"
    qa_temp_root.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="director-desk-electron-", dir=qa_temp_root))
    port = available_port()
    env = os.environ.copy()
    env["NODE_ENV"] = "production"
    env.pop("VITE_DEV_SERVER_URL", None)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    creation_flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        [str(ELECTRON), f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1", "--remote-allow-origins=*", f"--user-data-dir={profile}", str(ROOT)],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=creation_flags,
    )
    runtime_errors: list[str] = []
    report: dict[str, object] = {"processId": process.pid, "runtimeErrors": runtime_errors, "interactions": {}, "captures": []}
    page: Page | None = None
    try:
        endpoint = wait_for_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            page.on("pageerror", lambda error: runtime_errors.append(str(error)))
            page.on("console", lambda message: runtime_errors.append(message.text) if message.type == "error" else None)
            page.wait_for_selector(".app-shell", timeout=30_000)
            set_window_size(page, 1536, 1024)

            quick_launch = page.locator(".director-quick-launch")
            expect(quick_launch.get_by_role("button", name="VOX 视频")).to_be_visible()
            expect(quick_launch.get_by_role("button", name="AI 漫剧")).to_be_visible()
            set_window_size(page, 1040, 720)
            expect(quick_launch.get_by_role("button", name="VOX 视频")).to_be_visible()
            expect(quick_launch.get_by_role("button", name="AI 漫剧")).to_be_visible()
            page.screenshot(path=ARTIFACTS / "workflow-entry-1040x720.png", full_page=False)
            set_window_size(page, 1536, 1024)

            page.get_by_role("button", name="VOX 视觉导演").click()
            page.wait_for_selector("[data-editorial-collage-workbench='true']")
            page.get_by_role("textbox", name="项目标题").fill("拉萨：千年古城的新生")
            page.get_by_role("textbox", name="原始文案").fill("从信仰之城到现代化都市，拉萨在传承与创新中不断前行。旧城街巷、历史档案和今天的建设共同讲述变化。")
            page.get_by_role("button", name="创建 30 秒结构").click()
            page.wait_for_selector(".director-media-preview")
            page.locator(".director-shot-row").nth(1).click()
            prompt = page.get_by_role("textbox", name="编辑提示词")
            prompt.fill(prompt.input_value() + "，高对比纪实光线")
            page.get_by_role("button", name="保存版本").first.click()
            expect(page.get_by_role("button", name="保存版本").first).to_be_disabled(timeout=15_000)
            expect(page.get_by_role("button", name="生成当前镜头")).to_be_disabled()
            for tab in ["模式", "字幕", "版本", "生成"]:
                page.get_by_role("tab", name=tab).click()

            page.get_by_role("button", name="配音字幕").click()
            expect(page.get_by_role("tab", name="字幕")).to_have_attribute("aria-selected", "true")
            page.get_by_role("button", name="镜头生成").click()
            expect(page.get_by_role("tab", name="生成")).to_have_attribute("aria-selected", "true")
            transport = page.locator(".director-preview-transport")
            before_timecode = transport.locator(".director-timecode").inner_text()
            transport.get_by_role("button", name="播放").click()
            page.wait_for_timeout(450)
            expect(transport.get_by_role("button", name="暂停")).to_be_visible()
            after_timecode = transport.locator(".director-timecode").inner_text()
            transport.get_by_role("button", name="暂停").click()
            page.get_by_role("button", name="隐藏安全区").click()
            expect(page.locator(".director-safe-area")).to_have_count(0)
            page.get_by_role("button", name="显示安全区").click()
            expect(page.locator(".director-safe-area")).to_have_count(1)
            page.locator(".director-stage-step").nth(3).click()
            report["interactions"] = {
                "directWorkflowLaunchers": True,
                "stageNavigation": True,
                "playbackAdvanced": before_timecode != after_timecode,
                "playbackPaused": True,
                "safeAreaToggle": True,
            }
            report["captures"].append(capture(page, "vox-desktop", 1536, 1024, False))
            report["captures"].append(capture(page, "vox-compact", 1040, 720, True))
            compact_inspector = page.locator(".director-inspector-pane")
            compact_inspector.evaluate("element => { element.scrollTop = element.scrollHeight; }")
            expect(page.locator(".director-queue-panel")).to_be_visible()
            report["interactions"]["compactQueueReachable"] = True
            compact_inspector.evaluate("element => { element.scrollTop = 0; }")

            page.get_by_role("button", name="项目设置").click()
            page.wait_for_selector(".settings-layout")
            report["interactions"]["settingsNavigation"] = True
            page.locator(".director-quick-launch").get_by_role("button", name="AI 漫剧").click()
            page.wait_for_selector("[data-motion-comic-workbench='true']")
            page.get_by_role("textbox", name="系列名称").fill("雨夜来信")
            page.get_by_role("textbox", name="核心设定").fill("女孩在雨夜收到一封来自十年后的信，必须在天亮前验证警告。")
            page.get_by_role("textbox", name="首集标题").fill("信从未来来")
            page.get_by_role("button", name="创建系列骨架").click()
            page.wait_for_selector(".director-media-preview")
            page.get_by_role("button", name="剧本").click()
            expect(page.get_by_role("dialog")).to_be_visible()
            series_premise = page.get_by_role("textbox", name="核心设定")
            series_premise.fill(series_premise.input_value() + " 主角必须保持黄色雨衣与银色发夹。")
            page.get_by_role("button", name="保存系列设定").click()
            expect(page.get_by_role("dialog")).not_to_be_visible(timeout=15_000)
            expect(page.get_by_role("button", name="保存版本").first).to_be_disabled(timeout=15_000)
            page.get_by_role("button", name="新增集数").click()
            expect(page.locator(".director-episode-row")).to_have_count(2)
            page.get_by_role("button", name="新增场景").click()
            scene_shot_count = page.locator(".director-shot-row").count()
            page.get_by_role("button", name="新增镜头", exact=True).click()
            expect(page.locator(".director-shot-row")).to_have_count(scene_shot_count + 1)
            shot_search = page.get_by_role("textbox", name="搜索镜头")
            selected_title = page.locator(".director-shot-row").last.locator("strong").inner_text()
            shot_search.fill(selected_title)
            expect(page.locator(".director-shot-row")).to_have_count(1)
            page.get_by_role("button", name="清除镜头搜索").click()
            expect(page.locator(".director-shot-row")).to_have_count(scene_shot_count + 1)
            page.get_by_role("button", name="素材一致性").click()
            expect(page.get_by_role("tab", name="一致性设定")).to_have_attribute("aria-selected", "true")
            page.locator(".director-asset-tile").last.click()
            page.locator(".director-filmstrip-card").nth(1).click()
            page.get_by_role("tab", name="生成").click()
            page.get_by_role("combobox", name="版式模板").select_option("漫画分格 · 角色优先")
            page.get_by_role("combobox", name="画面比例").select_option("9:16")
            page.get_by_role("tab", name="模式").click()
            motion_prompt = page.get_by_role("textbox", name="运动提示词")
            motion_prompt.fill(motion_prompt.input_value() + "，雨丝缓慢划过前景")
            page.get_by_role("button", name="保存版本").first.click()
            try:
                expect(page.get_by_role("button", name="保存版本").first).to_be_disabled(timeout=15_000)
            except Exception as save_error:
                report["saveAssertionError"] = str(save_error)
                try:
                    page.screenshot(path=ARTIFACTS / "failure-state.png", full_page=False)
                    report["failureState"] = {
                        "alerts": page.get_by_role("alert").all_inner_texts(),
                        "feedback": page.locator(".director-feedback").all_inner_texts(),
                        "headerStatus": page.locator(".director-header-status").all_text_contents(),
                        "saveButton": page.get_by_role("button", name="保存版本").first.evaluate("button => ({ disabled: button.disabled, title: button.title, className: button.className })"),
                        "projectStatus": page.locator(".director-status-footer").all_inner_texts(),
                    }
                except Exception as capture_error:
                    report["failureCaptureError"] = str(capture_error)
                raise
            page.get_by_role("tab", name="生成").click()
            expect(page.get_by_role("button", name="生成当前镜头")).to_be_disabled()
            page.get_by_role("tab", name="VOX 视频").click()
            page.wait_for_selector("[data-editorial-collage-workbench='true']")
            page.get_by_role("tab", name="AI 漫剧").click()
            page.wait_for_selector("[data-motion-comic-workbench='true']")
            expect(page.locator(".director-episode-row")).to_have_count(2)
            page.get_by_role("tab", name="生成").click()
            expect(page.get_by_role("combobox", name="画面比例")).to_have_value("9:16")
            report["interactions"].update({
                "directMotionComicNavigation": True,
                "seriesSettingsPersisted": True,
                "episodeLifecyclePersisted": True,
                "sceneAndShotLifecyclePersisted": True,
                "shotSearch": True,
                "consistencyBinding": True,
                "ratioAndLayoutPersisted": True,
            })
            report["captures"].append(capture(page, "comic-desktop", 1536, 1024, False))
            report["captures"].append(capture(page, "comic-compact", 1040, 720, True))
            browser.close()

        if runtime_errors:
            raise AssertionError(f"Electron reported runtime errors: {runtime_errors}")
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False, capture_output=True)
                else:
                    process.kill()
        report["processReturnCode"] = process.poll()
        try:
            stdout, stderr = process.communicate(timeout=2)
            report["processOutputTail"] = {
                "stdout": stdout.decode("utf-8", errors="replace")[-6000:],
                "stderr": stderr.decode("utf-8", errors="replace")[-6000:],
            }
        except Exception as output_error:
            report["processOutputError"] = str(output_error)
        (ARTIFACTS / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
