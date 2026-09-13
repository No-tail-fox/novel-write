from __future__ import annotations

import json
import math
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any

from PIL import Image, ImageStat
from playwright.sync_api import Locator, Page, TimeoutError as PlaywrightTimeoutError, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get("STORYDREAM_QA_OUTPUT", str(ROOT / ".artifacts" / "director-desk-qa")))
QA_TEMP_ROOT = ROOT / ".codex-audit-temp"
ELECTRON = ROOT / "node_modules" / "electron" / "dist" / "electron.exe"
PROJECT_TITLE = "VOX 双引擎流程验收"
PROJECT_SOURCE = "第一镜交代地点与核心问题。第二镜补充历史背景和人物关系。第三镜给出可核查的事实证据。第四镜回到结论并提出下一步行动。"
DESKTOP = (1536, 1024)
REFERENCE_VIEWPORT = (1440, 1024)
COMPACT = (1040, 720)
MOJIBAKE = ("\ufffd", "锟斤拷", "Ã¤", "æµ‹è¯•", "闁诲", "�")


def accept_optional_dialog(dialog: Any) -> None:
    """Accept an expected reload confirmation without racing Playwright."""
    try:
        dialog.accept()
    except Exception:
        # The app may close the dialog before Playwright handles the event.
        pass


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def wait_for_async_condition(page: Page, expression: str, *, arg: Any, timeout: int = 15_000) -> None:
    # wait_for_function treats a returned Promise as truthy before it resolves.
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if page.evaluate(expression, arg):
            return
        page.wait_for_timeout(100)
    raise AssertionError(f'Async condition did not become true within {timeout}ms: {expression}')


def start_video_stub(video_path: Path) -> tuple[ThreadingHTTPServer, Thread, dict[str, Any], str]:
    state: dict[str, Any] = {"requests": []}

    class VideoStubHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, _format: str, *_args: object) -> None:
            return

        def send_json(self, status: int, payload: dict[str, Any]) -> None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
            if self.path != "/v1/videos/generations":
                self.send_json(404, {"error": "QA stub route not found."})
                return
            try:
                content_length = int(self.headers.get("content-length", "0"))
            except ValueError:
                content_length = 0
            if content_length <= 0 or content_length > 32 * 1024 * 1024:
                self.send_json(413, {"error": "QA stub rejected the request size."})
                return
            try:
                payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self.send_json(400, {"error": "QA stub expected a UTF-8 JSON body."})
                return
            if not isinstance(payload, dict):
                self.send_json(400, {"error": "QA stub expected a JSON object."})
                return
            state["requests"].append({
                "method": "POST",
                "path": self.path,
                "model": str(payload.get("model", "")),
                "duration": payload.get("duration"),
                "aspectRatio": str(payload.get("aspect_ratio", "")),
                "hasFirstFrame": bool(payload.get("first_frame_image")),
                "authorizationPresent": bool(self.headers.get("authorization")),
                "contentLength": content_length,
            })
            port = int(self.server.server_address[1])
            self.send_json(200, {
                "id": f"qa-local-video-{len(state['requests'])}",
                "status": "completed",
                "video_url": f"http://127.0.0.1:{port}/fixture.mp4",
            })

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
            if self.path != "/fixture.mp4":
                self.send_json(404, {"error": "QA stub fixture not found."})
                return
            data = video_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), VideoStubHandler)
    thread = Thread(target=server.serve_forever, name="director-video-qa-stub", daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}/v1"
    return server, thread, state, base_url


def wait_cdp(port: int, process: subprocess.Popen[bytes]) -> str:
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


def set_size(page: Page, width: int, height: int) -> None:
    page.set_viewport_size({"width": width, "height": height})
    page.wait_for_timeout(450)


def wait_app(page: Page) -> None:
    page.wait_for_selector(".app-shell", state="visible", timeout=30_000)
    page.wait_for_function(
        "() => Boolean(document.querySelector('.app-shell') && document.body.innerText.includes('StoryDream'))",
        timeout=30_000,
    )
    page.wait_for_timeout(350)


def reload_app(page: Page) -> None:
    """Reload the Electron renderer and tolerate a late navigation event."""
    page.once("dialog", accept_optional_dialog)
    try:
        page.reload(wait_until="domcontentloaded", timeout=15_000)
    except PlaywrightTimeoutError:
        # Electron can finish replacing the document without emitting the
        # domcontentloaded signal to Playwright. wait_app below is authoritative.
        pass
    wait_app(page)


def dismiss_modal_layers(page: Page) -> None:
    """Dismiss optional dialogs through normal input and wait for Fluent to close."""
    for _ in range(3):
        if page.locator('.fui-DialogSurface__backdrop:visible').count() == 0:
            return
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
    expect(page.locator('.fui-DialogSurface__backdrop:visible')).to_have_count(0, timeout=5_000)


def clean_artifacts() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    prefixes = ("vox-", "wizard-", "state-", "provider-", "reload-", "workflow-entry", "failure")
    for path in ARTIFACTS.iterdir():
        if path.is_file() and (path.name == "report.json" or path.name.startswith(prefixes)):
            path.unlink()


def make_fixtures(profile: Path) -> dict[str, Path]:
    directory = profile / "qa-fixtures"
    directory.mkdir(parents=True, exist_ok=True)
    image = directory / "director-frame.png"
    shutil.copyfile(ROOT / "src" / "assets" / "director-desk" / "preview-city.png", image)

    audio = directory / "director-voice.wav"
    sample_rate = 16_000
    frames = round(sample_rate * 7.5)
    with wave.open(str(audio), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        payload = bytearray()
        for index in range(frames):
            envelope = min(1.0, index / 500, (frames - index) / 500)
            sample = math.sin(index * 330 * math.pi * 2 / sample_rate) * envelope * 3500
            payload.extend(int(sample).to_bytes(2, "little", signed=True))
        handle.writeframes(payload)

    video = directory / "director-video.mp4"
    python_exe = ROOT / "vendor" / "python" / "python.exe"
    if not python_exe.is_file():
        python_exe = Path(os.environ.get("PYTHON", "python"))
    script = (
        "import imageio_ffmpeg, subprocess, sys\n"
        "ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()\n"
        "args=[ffmpeg,'-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24:duration=7.5',"
        "'-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=7.5',"
        "'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',"
        "'-movflags','+faststart',sys.argv[1]]\n"
        "subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)\n"
    )
    subprocess.run(
        [str(python_exe), "-c", script, str(video)],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        timeout=90,
    )
    if video.stat().st_size < 10_000:
        raise RuntimeError("The local MP4 fixture is unexpectedly small.")
    return {"image": image, "audio": audio, "video": video}


def navigate(page: Page, view: str, selector: str) -> None:
    button = page.locator(f"button[data-nav-view='{view}']").first
    expect(button).to_be_visible(timeout=15_000)
    button.click()
    page.wait_for_selector(selector, state="visible", timeout=30_000)
    page.wait_for_timeout(250)


def seed_services(page: Page, video_base_url: str) -> dict[str, Any]:
    result = page.evaluate(
        """async videoBaseUrl => {
          const bootstrap = await window.storydream.getBootstrap();
          const config = structuredClone(bootstrap.config);
          const imageBase = config.gptImage || config.image || {};
          const gptImage = { ...imageBase, baseUrl: 'https://qa.invalid/v1', model: 'qa-image-model', resolution: '2K', quality: 'high' };
          const customImage = { ...config.customImage || gptImage, displayName: 'QA 兼容图片服务', baseUrl: 'https://qa-custom.invalid/v1', model: 'qa-custom-image-model', resolution: '2K', quality: 'high' };
          config.imageProvider = 'gpt_image';
          config.gptImage = gptImage;
          config.customImage = customImage;
          config.imageProfiles = [
            { id: 'qa-gpt-image', name: 'QA GPT Image', enabled: true, provider: 'gpt_image', gptImage },
            { id: 'qa-custom-image', name: 'QA 兼容图片服务', enabled: true, provider: 'custom', customImage },
          ];
          config.activeImageProfileId = 'qa-gpt-image';
          const base = (config.video && config.video.providers && config.video.providers[0]) || {};
          const videoProvider = (id, name, model) => ({
            ...base, id, name, enabled: true, baseUrl: videoBaseUrl, apiKey: '', model,
            submitPath: '/videos/generations', statusPathTemplate: '/videos/generations/{id}',
            pollIntervalMs: 1, timeoutMs: 1500, concurrency: 1, pricePerSecond: 0,
            maxDurationSec: 15, maxResolution: '1080p', capabilities: ['i2v'],
            license: 'QA 本地桩，不产生费用', requestParamsJson: '{}',
          });
          const primary = videoProvider('qa-video-primary', 'QA 视频服务 A', 'qa-video-model-a');
          const secondary = videoProvider('qa-video-secondary', 'QA 视频服务 B', 'qa-video-model-b');
          config.video = {
            ...config.video, providers: [primary, secondary], activeProviderId: primary.id,
            automation: { ...config.video.automation, budgetLimit: 100, providerWhitelist: [primary.id, secondary.id], retryCount: 0 },
          };
          const mutation = await window.storydream.saveConfig({
            config,
            secretChanges: {
              'image/qa-gpt-image/gptImage/apiKey': 'qa-image-key-never-sent',
              'image/qa-custom-image/customImage/apiKey': 'qa-image-key-never-sent',
              'video/qa-video-primary/apiKey': 'qa-video-key-never-sent',
              'video/qa-video-secondary/apiKey': 'qa-video-key-never-sent',
            },
          });
          if (!mutation || mutation.kind !== 'state-patch' || mutation.patch.kind !== 'config') throw new Error('QA service configuration was not persisted.');
          const refreshed = await window.storydream.getBootstrap();
          return {
            imageProfiles: refreshed.config.imageProfiles.map(item => item.id),
            activeImageProfileId: refreshed.config.activeImageProfileId,
            videoProviders: refreshed.config.video.providers.map(item => item.id),
            activeVideoProviderId: refreshed.config.video.activeProviderId,
            connectedVideoKeys: Object.entries(refreshed.secretStatus).filter(([id, connected]) => id.startsWith('video/') && connected).map(([id]) => id),
          };
        }""",
        video_base_url,
    )
    if result.get("activeVideoProviderId") != "qa-video-primary":
        raise AssertionError(f"Video service seed failed: {result}")
    return result


def capture_wizard(page: Page, report: dict[str, Any], name: str, size: tuple[int, int]) -> None:
    set_size(page, *size)
    root = page.locator("[data-editorial-collage-workbench='true'] .director-create-panel")
    expect(root).to_be_visible(timeout=15_000)
    inspection = root.evaluate(
        """root => ({
          textLength: root.innerText.trim().length,
          steps: root.querySelectorAll('.director-create-steps > button').length,
          overflow: Math.max(0, root.scrollWidth - root.clientWidth),
          documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          mojibake: ['�','锟斤拷','Ã¤','æµ‹è¯•'].filter(marker => root.innerText.includes(marker)),
        })"""
    )
    if inspection["steps"] != 3 or inspection["textLength"] < 120 or inspection["overflow"] > 1 or inspection["documentOverflow"] > 1 or inspection["mojibake"]:
        raise AssertionError(f"VOX creation wizard contract failed: {inspection}")
    canonical_name = f"{name}.png" if name.endswith(f"-{size[0]}x{size[1]}") else f"{name}-{size[0]}x{size[1]}.png"
    path = ARTIFACTS / canonical_name
    page.screenshot(path=path, full_page=False, scale="css", animations="disabled")
    report["captures"].append({"name": path.name, "kind": "wizard", "inspection": inspection, "variance": screenshot_variance(path)})


def snapshot(page: Page) -> dict[str, Any]:
    return page.locator(".director-desk").evaluate(
        r"""root => {
          const rect = element => {
            const value = element?.getBoundingClientRect();
            return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
          };
          const visible = element => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
          };
          const label = element => element?.getAttribute('aria-label') || element?.title || element?.textContent?.trim().slice(0, 80) || element?.tagName || '';
          const providerLabel = [...root.querySelectorAll('label')].find(item => item.textContent?.trim() === '视频生成服务');
          const provider = providerLabel?.htmlFor ? document.getElementById(providerLabel.htmlFor) : providerLabel?.parentElement?.querySelector('select');
          const preview = root.querySelector('.director-media-preview');
          const video = preview?.querySelector('video');
          const image = preview?.querySelector('img');
          // Textareas may legitimately scroll long prompts; only controls whose
          // labels must stay on one line are considered clipping candidates.
          const controls = [...root.querySelectorAll('button,select,[role="tab"]')].filter(visible);
          return {
            viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
            root: rect(root),
            textLength: root.innerText.trim().length,
            text: root.innerText.trim().replace(/\\s+/g, ' ').slice(0, 2000),
            mojibake: ['�','锟斤拷','Ã¤','æµ‹è¯•','闁诲'].filter(marker => root.innerText.includes(marker)),
            routeError: document.querySelector('.route-error-state,.application-error-state')?.textContent?.trim() || '',
            shellChromeHidden: ['.app-shell .sidebar','.app-shell .page-head'].every(selector => !document.querySelector(selector) || getComputedStyle(document.querySelector(selector)).display === 'none'),
            windowControlsVisible: [...document.querySelectorAll('.window-controls button')].length === 3 && [...document.querySelectorAll('.window-controls button')].every(visible),
            horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
            rootOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
            clippedControls: controls.filter(element => element.scrollWidth - element.clientWidth > 3 || element.scrollHeight - element.clientHeight > 3).map(label),
            panes: {
              left: rect(root.querySelector('.director-left-pane')),
              center: rect(root.querySelector('.director-center-pane')),
              inspector: rect(root.querySelector('.director-inspector-pane')),
              preview: rect(preview),
              filmstrip: rect(root.querySelector('.director-filmstrip-section')),
              queue: rect(root.querySelector('.director-queue-panel')),
              footer: rect(root.querySelector('.director-status-footer')),
              toolbar: rect(root.querySelector('.director-preview-toolbar')),
            },
            shots: root.querySelectorAll('.director-shot-row').length,
            filmstrip: root.querySelectorAll('.director-filmstrip-card').length,
            assets: root.querySelectorAll('.director-asset-tile').length,
            inspectorTabs: root.querySelectorAll('.director-inspector-pane [role="tab"]').length,
            strategy: preview?.getAttribute('data-render-strategy') || '',
            previewRatio: preview?.getAttribute('data-preview-ratio') || '',
            imageLoaded: Boolean(image?.complete && image?.naturalWidth > 0),
            videoLoaded: Boolean(video && video.readyState >= 1 && video.videoWidth > 0),
            videos: [...root.querySelectorAll('video')].map(item => ({ readyState: item.readyState, duration: Number.isFinite(item.duration) ? item.duration : 0, currentTime: item.currentTime, paused: item.paused, label: item.getAttribute('aria-label') || '' })),
            emptyState: root.querySelector('.director-video-empty')?.textContent?.trim() || '',
            provider: provider instanceof HTMLSelectElement ? { value: provider.value, disabled: provider.disabled, options: [...provider.options].map(option => ({ value: option.value, disabled: option.disabled, label: option.textContent?.trim() || '' })) } : null,
            queueStates: [...root.querySelectorAll('.director-queue-item')].map(item => item.className),
            alerts: [...root.querySelectorAll('[role="alert"]')].map(item => item.textContent?.trim()).filter(Boolean),
          };
        }"""
    )


def screenshot_variance(path: Path, rect: dict[str, Any] | None = None) -> float:
    with Image.open(path) as source:
        image = source.convert("RGB")
        if rect:
            left = max(0, int(float(rect.get("x", 0))))
            top = max(0, int(float(rect.get("y", 0))))
            right = min(image.width, int(float(rect.get("right", image.width))))
            bottom = min(image.height, int(float(rect.get("bottom", image.height))))
            if right <= left or bottom <= top:
                return 0.0
            image = image.crop((left, top, right, bottom))
        return float(sum(ImageStat.Stat(image).var))


def assert_workbench(data: dict[str, Any], compact: bool, state: str) -> None:
    root = data.get("root")
    panes = data.get("panes")
    viewport = data.get("viewport")
    if not isinstance(root, dict) or not isinstance(panes, dict) or not isinstance(viewport, dict):
        raise AssertionError(f"{state} geometry is incomplete: {data}")
    if float(root.get("width", 0)) < 600 or float(root.get("height", 0)) < float(viewport.get("height", 0)) * 0.82:
        raise AssertionError(f"{state} is blank or collapsed: {data}")
    if data.get("routeError") or data.get("mojibake") or data.get("clippedControls"):
        raise AssertionError(f"{state} has route/encoding/clipping errors: {data}")
    if int(data.get("horizontalOverflow", 0)) > 1 or int(data.get("rootOverflow", 0)) > 1:
        raise AssertionError(f"{state} overflows horizontally: {data}")
    if int(data.get("textLength", 0)) < 140 or int(data.get("shots", 0)) < 4 or int(data.get("filmstrip", 0)) < 4:
        raise AssertionError(f"{state} is missing core workbench content: {data}")
    if int(data.get("assets", 0)) < 4 or int(data.get("inspectorTabs", 0)) < 4:
        raise AssertionError(f"{state} is missing assets or inspector tabs: {data}")
    preview = panes.get("preview")
    minimum_width = 200 if data.get('previewRatio') == '9:16' else (240 if compact else 280)
    if not isinstance(preview, dict) or float(preview.get("width", 0)) < minimum_width or float(preview.get("height", 0)) < 150:
        raise AssertionError(f"{state} preview is not visible: {preview}")
    if not data.get("shellChromeHidden"):
        raise AssertionError(f"{state} has duplicated shell chrome.")
    if not data.get("windowControlsVisible"):
        raise AssertionError(f"{state} is missing Electron window controls.")
    if compact:
        inspector = panes.get("inspector")
        if not isinstance(inspector, dict) or float(inspector.get("width", 0)) < 280:
            raise AssertionError(f"{state} compact inspector is clipped: {inspector}")
    else:
        left, center, inspector = panes.get("left"), panes.get("center"), panes.get("inspector")
        if not all(isinstance(item, dict) for item in (left, center, inspector)):
            raise AssertionError(f"{state} is missing a desktop pane: {data}")
        if left["right"] > center["x"] + 1 or center["right"] > inspector["x"] + 1:
            raise AssertionError(f"{state} panes overlap: {data}")


def capture_workbench(page: Page, report: dict[str, Any], name: str, size: tuple[int, int], state: str, require_media: bool = False) -> dict[str, Any]:
    set_size(page, *size)
    page.wait_for_selector(".director-desk", state="visible", timeout=20_000)
    page.wait_for_timeout(350)
    data = snapshot(page)
    assert_workbench(data, size[0] <= 1100, state)
    if require_media and not (data.get("imageLoaded") or data.get("videoLoaded")):
        raise AssertionError(f"{state} has no loaded preview media: {data}")
    canonical_name = f"{name}.png" if name.endswith(f"-{size[0]}x{size[1]}") else f"{name}-{size[0]}x{size[1]}.png"
    path = ARTIFACTS / canonical_name
    page.screenshot(path=path, full_page=False, scale="css", animations="disabled")
    with Image.open(path) as captured:
        if captured.size != size:
            raise AssertionError(f"{state} screenshot dimensions differ from requested viewport: {captured.size} != {size}")
    viewport_variance = screenshot_variance(path)
    preview_variance = screenshot_variance(path, data["panes"]["preview"])
    if viewport_variance < 180 or (require_media and preview_variance < 80):
        raise AssertionError(f"{state} screenshot is visually blank: {viewport_variance}, {preview_variance}")
    report["captures"].append({
        "name": path.name,
        "kind": "workbench",
        "state": state,
        "viewport": {"width": size[0], "height": size[1]},
        "viewportVariance": viewport_variance,
        "previewVariance": preview_variance,
        "inspection": {key: value for key, value in data.items() if key != "text"},
    })
    return data


def exercise_preview_ratios(page: Page, report: dict[str, Any]) -> None:
    for ratio in ['9:16', '1:1', '4:3', '16:9']:
        page.get_by_role('combobox', name='画面比例', exact=True).select_option(ratio)
        for size in (DESKTOP, COMPACT):
            data = capture_workbench(page, report, 'preview-' + ratio.replace(':', 'x'), size, 'preview-ratio-' + ratio, require_media=True)
            box = data['panes']['preview']
            width, height = map(int, ratio.split(':'))
            if abs(box['width'] / box['height'] - width / height) > .001:
                raise AssertionError(f'Preview ratio differs from project: {ratio}, {box}')
    set_size(page, *DESKTOP)
    page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True).click()
    expect(page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)).to_be_disabled(timeout=15000)
    report['interactions']['previewRatios'] = ['9:16', '1:1', '4:3', '16:9']


def create_project(page: Page, report: dict[str, Any]) -> str:
    navigate(page, "editorial-collage", "[data-editorial-collage-workbench='true']")
    wizard = page.locator("[data-editorial-collage-workbench='true'] .director-create-panel")
    if wizard.is_visible():
        page.get_by_role("textbox", name="项目标题").fill(PROJECT_TITLE)
        page.get_by_role("textbox", name="原始文案").fill(PROJECT_SOURCE)
        duration = page.get_by_role("combobox", name="起步时长")
        expect(duration).to_be_visible()
        duration_options = duration.locator("option")
        duration_labels = [option.inner_text() for option in duration_options.all()]
        expected_duration_labels = ["15 秒", "30 秒", "60 秒 · 长版"]
        if not all(any(expected in label for label in duration_labels) for expected in expected_duration_labels):
            raise AssertionError(f"VOX wizard duration options are incomplete: {duration_labels}")
        if duration.input_value() != "30000":
            duration.select_option("30000")
        report["interactions"]["creationDurationOptions"] = {
            "selected": duration.input_value(),
            "labels": duration_labels,
        }
        capture_wizard(page, report, "wizard-content", DESKTOP)
        page.get_by_role("button", name="下一步", exact=True).click()
        provider = page.get_by_role("combobox", name="生成服务")
        expect(provider).to_be_visible()
        options = provider.locator("option")
        if options.count() < 2 or len([option for option in options.all() if not option.is_disabled()]) < 2:
            raise AssertionError("VOX wizard does not expose two selectable image services.")
        provider.select_option("qa-custom-image")
        expect(provider).to_have_value("qa-custom-image", timeout=15_000)
        report["interactions"]["creationImageProviderSelection"] = {"selected": provider.input_value(), "optionCount": options.count()}
        capture_wizard(page, report, "wizard-service", DESKTOP)
        page.get_by_role("button", name="下一步", exact=True).click()
        expect(page.get_by_role("button", name="创建 VOX 项目", exact=True)).to_be_enabled()
        capture_wizard(page, report, "wizard-output", COMPACT)
        page.get_by_role("button", name="创建 VOX 项目", exact=True).click()
    page.wait_for_selector("[data-editorial-collage-workbench='true'] .director-desk", state="visible", timeout=30_000)
    task = page.evaluate(
        """async title => {
          const result = await window.storydream.listTasks({ taskType: 'editorial-collage', limit: 50 });
          const item = result.items.find(candidate => (candidate.title || candidate.name) === title);
          return item ? { id: item.id, title: item.title || item.name } : null;
        }""",
        PROJECT_TITLE,
    )
    if not task:
        raise AssertionError("Created VOX project was not found in history.")
    report["project"] = task
    return str(task["id"])


def inject_fixture_state(page: Page, task_id: str, fixtures: dict[str, Path]) -> dict[str, Any]:
    result = page.evaluate(
        """async ({ id, imagePath, audioPath, videoPath }) => {
          const task = await window.storydream.getTaskDetail(id);
          if (!task) throw new Error('VOX task disappeared before fixture injection.');
          const document = JSON.parse(task.pipelineData);
          const shots = document.beats.flatMap(beat => beat.shots);
          if (shots.length !== 4) throw new Error('Expected four VOX shots, received ' + shots.length + '.');
          const createdAt = new Date().toISOString();
          const imageAssets = [];
          const imageJobs = [];
          const voiceJobs = [];
          const durationMs = 1800;
          const styleCandidate = document.styleCandidates[0];
          if (!styleCandidate) throw new Error('Expected at least one VOX style candidate.');
          const styleJob = {
            id: 'qa-style-job-1', workflowKind: 'editorial-collage', nodeId: 'style-candidate:' + styleCandidate.id,
            providerId: 'qa-local-fixture', model: 'qa-style-model', capability: 'style-sample', status: 'completed',
            inputHash: 'qa-style-hash-1', idempotencyKey: 'qa:style:' + styleCandidate.id + ':1',
            estimatedCost: 0, actualCost: 0, attempt: 1, createdAt, updatedAt: createdAt,
          };
          const styleAsset = {
            id: 'qa-style-asset-1', assetId: 'style-candidate-' + styleCandidate.id, kind: 'image',
            localPath: imagePath, providerJobId: styleJob.id, provider: 'qa-local-fixture',
            model: 'qa-style-model', license: 'QA 本地桩', createdAt, selected: true, pinned: false,
          };
          for (const [index, shot] of shots.entries()) {
            const number = index + 1;
            const imageJobId = 'qa-image-job-' + number;
            imageJobs.push({
              id: imageJobId, workflowKind: 'editorial-collage', nodeId: shot.id, providerId: 'qa-gpt-image',
              model: 'qa-image-model', capability: 'text-to-image', status: 'completed',
              inputHash: 'qa-image-hash-' + number, idempotencyKey: 'qa:image:' + shot.id,
              estimatedCost: 0, actualCost: 0, attempt: 1, createdAt, updatedAt: createdAt,
            });
            imageAssets.push({
              id: 'qa-image-asset-' + number, assetId: 'qa-shot-image-' + number, kind: 'image',
              localPath: imagePath, providerJobId: imageJobId, provider: 'qa-local-fixture',
              model: 'qa-image-model', license: 'QA 本地桩', createdAt, selected: true, pinned: true,
            });
            const voiceJobId = 'qa-voice-job-' + number;
            voiceJobs.push({
              id: voiceJobId, workflowKind: 'editorial-collage', nodeId: shot.id, providerId: 'qa-local-voice',
              model: 'qa-tone', capability: 'text-to-speech', status: 'completed',
              inputHash: 'qa-voice-hash-' + number, idempotencyKey: 'qa:voice:' + shot.id,
              estimatedCost: 0, actualCost: 0, attempt: 1, createdAt, updatedAt: createdAt,
            });
          }
          const voiceAsset = {
            id: 'qa-voice-asset', assetId: 'qa-voice', kind: 'audio', localPath: audioPath,
            provider: 'qa-local-fixture', model: 'qa-tone', license: 'QA 本地桩',
            createdAt, selected: true, pinned: true,
          };
          // Shot 1 is intentionally local-keyframe and has no video job.
          // Shots 2-4 exercise queued, failed and completed; the running
          // variant is injected later so each state is independently visible.
          const statuses = ['queued', 'queued', 'failed', 'completed'];
          const videoJobs = shots.map((shot, index) => {
            const number = index + 1;
            const status = statuses[index];
            const job = {
              id: 'qa-video-job-' + number, workflowKind: 'editorial-collage', nodeId: shot.id,
              providerId: 'qa-video-primary', model: 'qa-video-model-a', capability: 'image-to-video',
              status, inputHash: 'qa-video-hash-' + number, idempotencyKey: 'qa:video:' + shot.id + ':1',
              estimatedCost: 0, attempt: 1, createdAt, updatedAt: createdAt,
            };
            if (status === 'completed') job.actualCost = 0;
            if (status === 'failed') job.error = 'QA 桩模拟失败：上游返回可重试错误。';
            return job;
          });
          const videoAsset = {
            id: 'qa-video-asset-4', assetId: 'qa-shot-video-4', kind: 'video', localPath: videoPath,
            providerJobId: 'qa-video-job-4', provider: 'QA 视频服务 A', model: 'qa-video-model-a',
            license: 'QA 本地桩', createdAt, selected: true, pinned: true,
          };
          document.assets = [...document.assets.filter(asset => !asset.id.startsWith('qa-')), styleAsset, ...imageAssets, voiceAsset, videoAsset];
          document.providerJobs = [...document.providerJobs.filter(job => !job.id.startsWith('qa-')), styleJob, ...imageJobs, ...voiceJobs, ...videoJobs];
          document.styleCandidates = document.styleCandidates.map(candidate => candidate.id === styleCandidate.id
            ? { ...candidate, assetVersionId: styleAsset.id }
            : candidate);
          let startMs = 0;
          document.beats = document.beats.map((beat, index) => {
            const shot = beat.shots[0];
            const number = index + 1;
            const living = index > 0;
            const cue = { ...(beat.subtitleCues[0] || { id: beat.id + '-cue-1', text: beat.narration }), startMs, endMs: startMs + durationMs };
            const nextShot = {
              ...shot, durationMs, renderStrategy: living ? 'living-poster' : 'deterministic-layers',
              providerJobId: 'qa-image-job-' + number, voiceAssetVersionId: voiceAsset.id,
              videoJobId: living ? 'qa-video-job-' + number : undefined,
              videoAssetVersionId: living && index === 3 ? videoAsset.id : undefined,
              // Keep one persisted image layer as the I2V first-frame input.
              // The living-poster renderer ignores layers after generation,
              // while the Director UI still needs a readable first frame for
              // retry and provider preflight.
              layers: living
                ? [{
                    ...shot.layers[0],
                    assetVersionId: 'qa-image-asset-' + number,
                    motion: (shot.layers[0]?.motion || []).map(frame => ({ ...frame, atMs: Math.min(frame.atMs, durationMs) })),
                  }]
                : shot.layers.map((layer, layerIndex) => ({
                    ...layer, assetVersionId: layerIndex < 2 ? 'qa-image-asset-' + number : layer.assetVersionId,
                    motion: layer.motion.map(frame => ({ ...frame, atMs: Math.min(frame.atMs, durationMs) })),
                  })),
              camera: living ? [] : shot.camera.map(frame => ({ ...frame, atMs: Math.min(frame.atMs, durationMs) })),
              subtitleCueIds: [cue.id],
            };
            startMs += durationMs;
            return { ...beat, startMs: startMs - durationMs, durationMs, subtitleCues: [cue], shots: [nextShot] };
          });
          const clips = [];
          const audioAssetVersionIds = [];
          for (const beat of document.beats) {
            for (const shot of beat.shots) {
              const layers = shot.layers.flatMap(layer => layer.assetVersionId ? [layer.assetVersionId] : []);
              const assetVersionIds = shot.renderStrategy === 'deterministic-layers' ? layers : shot.videoAssetVersionId ? [shot.videoAssetVersionId] : [];
              clips.push({
                id: 'clip-' + shot.id, shotId: shot.id, startMs: beat.startMs, durationMs: shot.durationMs,
                assetVersionIds: [...new Set(assetVersionIds)], subtitleCueIds: [...shot.subtitleCueIds],
                source: shot.renderStrategy === 'deterministic-layers' ? 'deterministic' : 'ai-video',
              });
              if (shot.voiceAssetVersionId && !audioAssetVersionIds.includes(shot.voiceAssetVersionId)) audioAssetVersionIds.push(shot.voiceAssetVersionId);
            }
          }
          document.timeline = { durationMs: startMs, clips, audioAssetVersionIds };
          document.stage = 'assets';
          document.estimatedCost = 0;
          document.actualCost = 0;
          await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: document.updatedAt, document });
          const saved = await window.storydream.getTaskDetail(id);
          return saved ? JSON.parse(saved.pipelineData) : null;
        }""",
        {"id": task_id, "imagePath": str(fixtures["image"]), "audioPath": str(fixtures["audio"]), "videoPath": str(fixtures["video"])},
    )
    if not result:
        raise AssertionError("Fixture document was not readable after save.")
    shots = [shot for beat in result["beats"] for shot in beat["shots"]]
    return {
        "stage": result["stage"],
        "shotCount": len(shots),
        "durationMs": result["timeline"]["durationMs"],
        "timelineSources": [clip["source"] for clip in result["timeline"]["clips"]],
        "videoStatuses": [
            next((job["status"] for job in result["providerJobs"] if job["id"] == shot.get("videoJobId")), "idle")
            for shot in shots
        ],
        "styleSample": {
            "candidateId": result["styleCandidates"][0]["id"],
            "assetVersionId": result["styleCandidates"][0].get("assetVersionId"),
            "jobPersisted": any(job["id"] == "qa-style-job-1" for job in result["providerJobs"]),
        },
    }


def open_from_history(page: Page, title: str, preserve_current: bool = False) -> None:
    # A renderer reload can restore the last workbench route directly. Keep
    # that state only for callers that have already validated the reloaded data.
    if preserve_current:
        try:
            page.wait_for_selector("[data-editorial-collage-workbench='true'] .director-desk", state="visible", timeout=15_000)
            if page.locator(".director-shot-row").count() > 0:
                return
        except PlaywrightTimeoutError:
            pass
    back = page.get_by_role("button", name="返回全部任务", exact=True)
    if page.locator(".director-desk").is_visible() and back.count() > 0:
        back.first.click()
    else:
        history_nav = page.locator("button[data-nav-view='history']").first
        if history_nav.count() == 0:
            # History is a secondary task entry; switch the primary group first.
            queue_nav = page.locator("button[data-nav-view='queue']").first
            expect(queue_nav).to_have_count(1, timeout=15_000)
            queue_nav.evaluate("element => element.click()")
            page.wait_for_timeout(250)
            history_nav = page.locator("button[data-nav-view='history']").first
        # The desktop shell keeps nav controls mounted but may hide them while
        # the workbench is restoring after a renderer reload; force the route
        # click once the element exists.
        expect(history_nav).to_have_count(1, timeout=15_000)
        history_nav.evaluate("element => element.click()")
    page.wait_for_selector("[data-task-operations='history']", state="visible", timeout=30_000)
    search = page.get_by_role("textbox", name="搜索历史记录")
    expect(search).to_be_visible(timeout=15_000)
    search.fill(title)
    button = page.get_by_role("button", name=f"打开任务 {title}", exact=True)
    expect(button).to_be_visible(timeout=15_000)
    button.click()
    page.wait_for_selector("[data-editorial-collage-workbench='true'] .director-desk", state="visible", timeout=30_000)
    page.wait_for_timeout(500)


def select_shot(page: Page, index: int) -> None:
    rows = page.locator(".director-shot-row")
    expect(rows).to_have_count(4, timeout=15_000)
    target = rows.nth(index) if rows.nth(index).is_visible() else page.locator('.director-filmstrip-card').nth(index)
    target.click()
    page.wait_for_timeout(300)


def generation_tab(page: Page) -> None:
    page.get_by_role("tab", name="画面", exact=True).click()
    expect(page.get_by_role("tab", name="画面", exact=True)).to_have_attribute("aria-selected", "true")
    page.wait_for_timeout(200)


def reset_inspector_scroll(page: Page) -> None:
    page.locator(".director-inspector-pane").evaluate(
        """pane => {
          for (const element of [pane, ...pane.querySelectorAll('*')]) {
            if (/auto|scroll/.test(getComputedStyle(element).overflowY)) element.scrollTop = 0;
          }
        }"""
    )
    page.wait_for_timeout(100)


def reachable_control(page: Page, target: Locator, label: str) -> dict[str, Any]:
    """Exercise native ancestor scrolling and verify the actual hit surface.

    Playwright's visible state only checks a positive bounding box. A control
    may pass that check while clipped by its pane, behind the queue or outside
    the desktop window, so use clipping intersections plus hit tests as well.
    """
    expect(target).to_have_count(1)
    expect(target).to_be_visible()
    result = None
    for attempt in range(3):
        try:
            target.scroll_into_view_if_needed(timeout=10_000)
            page.wait_for_timeout(100)
            result = target.evaluate(
        """element => {
          const box = element.getBoundingClientRect();
          const rect = value => ({ x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom });
          const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
          const scrollAncestors = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const bounds = parent.getBoundingClientRect();
            if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
              clip.left = Math.max(clip.left, bounds.left + parent.clientLeft);
              clip.right = Math.min(clip.right, bounds.left + parent.clientLeft + parent.clientWidth);
            }
            if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
              clip.top = Math.max(clip.top, bounds.top + parent.clientTop);
              clip.bottom = Math.min(clip.bottom, bounds.top + parent.clientTop + parent.clientHeight);
            }
            if (/auto|scroll/.test(style.overflowY)) {
              scrollAncestors.push({ className: parent.className, scrollTop: parent.scrollTop, clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight });
            }
          }
          const fullyVisible = box.left >= clip.left - 1 && box.top >= clip.top - 1 && box.right <= clip.right + 1 && box.bottom <= clip.bottom + 1;
          const insetX = Math.min(8, box.width / 4);
          const insetY = Math.min(8, box.height / 4);
          const points = [
            [box.left + box.width / 2, box.top + box.height / 2],
            [box.left + insetX, box.top + insetY],
            [box.right - insetX, box.top + insetY],
            [box.left + insetX, box.bottom - insetY],
            [box.right - insetX, box.bottom - insetY],
          ];
          const hitTests = points.map(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return { x, y, unobscured: Boolean(hit && (hit === element || element.contains(hit))), hit: hit?.tagName + '.' + (typeof hit?.className === 'string' ? hit.className : '') };
          });
          return { bounds: rect(box), clip, fullyVisible, hitTests, scrollAncestors, disabled: element.matches(':disabled,[aria-disabled="true"]') };
        }"""
            )
            break
        except Exception:
            if attempt == 2:
                raise
            page.wait_for_timeout(250)
    if result is None:
        raise AssertionError(f"Could not inspect reachable control: {label}")
    if not result["fullyVisible"] or any(not point["unobscured"] for point in result["hitTests"]):
        raise AssertionError(f"Inspector control {label!r} remains clipped or obscured after scrolling: {result}")
    return {"label": label, **result}


def exercise_generation_inspector(page: Page, report: dict[str, Any], size: tuple[int, int], engine: str) -> None:
    set_size(page, *size)
    select_shot(page, 3 if engine == "living-poster" else 0)
    generation_tab(page)
    reset_inspector_scroll(page)
    inspector = page.locator(".director-inspector-pane")
    controls: list[tuple[str, Locator]] = [
        ("本地关键帧", inspector.get_by_role("tab", name="本地关键帧", exact=True)),
        ("AI 动态海报", inspector.get_by_role("tab", name="AI 动态海报", exact=True)),
    ]
    if engine == "living-poster":
        controls.append(("视频生成服务", inspector.get_by_role("combobox", name="视频生成服务", exact=True)))
    controls.extend([
        ("编辑提示词", inspector.get_by_role("textbox", name="编辑提示词", exact=True)),
        ("版式模板", inspector.get_by_role("combobox", name="版式模板", exact=True)),
        ("运动控制", inspector.get_by_role("combobox", name="运动控制", exact=True)),
        ("图片生成服务", inspector.get_by_role("combobox", name="图片生成服务", exact=True)),
        ("画面比例", inspector.get_by_role("combobox", name="画面比例", exact=True)),
        ("音色", inspector.get_by_role("textbox", name="音色", exact=True)),
        ("字幕样式", inspector.get_by_role("combobox", name="字幕样式", exact=True)),
        ("Seed 锁定", inspector.get_by_role("textbox", name="Seed 锁定", exact=True)),
    ])
    if engine == "living-poster":
        controls.append(("更新首帧", inspector.get_by_role("button", name="更新首帧", exact=True)))
        controls.append(("AI 动态海报主操作", inspector.locator(".director-primary-action")))
    else:
        controls.append(("生成当前镜头", inspector.get_by_role("button", name="生成当前镜头", exact=True)))
    controls.extend([
        ("保存版本", inspector.get_by_role("button", name="保存版本", exact=True)),
        ("生成成片", inspector.get_by_role("button", name="生成成片", exact=True)),
    ])
    results = [reachable_control(page, target, label) for label, target in controls]
    name = f"{engine}-{size[0]}x{size[1]}"
    report["interactions"].setdefault("inspectorReachability", {})[name] = {
        "engine": engine,
        "viewport": {"width": size[0], "height": size[1]},
        "controls": results,
        "paidGenerationCalls": 0,
    }
    capture_workbench(page, report, f"state-inspector-actions-{engine}", size, f"{name}-actions", require_media=True)
    reset_inspector_scroll(page)


def exercise_style_candidates(page: Page, task_id: str, report: dict[str, Any]) -> None:
    """Select a fixture-backed style sample and prove it survives a reload."""
    set_size(page, *DESKTOP)
    page.get_by_role("tab", name="动效", exact=True).click()
    section = page.locator(".director-style-candidates")
    expect(section).to_be_visible(timeout=15_000)
    rows = section.locator(".director-style-candidate-row")
    if rows.count() < 2:
        raise AssertionError("VOX style selection requires at least two candidates.")
    samples = section.locator("img.director-style-candidate-thumb")
    expect(samples).to_have_count(1)
    expect(samples.first).to_be_visible()
    page.wait_for_function(
        "() => { const image = document.querySelector('img.director-style-candidate-thumb'); return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0; }",
        timeout=15_000,
    )
    generate_actions = section.locator("button[aria-label$='试片']")
    if generate_actions.count() != rows.count():
        raise AssertionError("Every VOX style candidate must expose its own sample action.")
    selection = rows.nth(1).locator(".director-style-candidate-select")
    selection.click()
    expect(selection).to_have_attribute("aria-pressed", "true")
    save = page.locator(".director-desk-header").get_by_role("button", name="保存版本", exact=True)
    expect(save).to_be_enabled()
    save.click()
    wait_for_async_condition(page,
        """async id => {
          const task = await window.storydream.getTaskDetail(id);
          const document = task && JSON.parse(task.pipelineData);
          return Boolean(document && document.styleCandidates[1]?.selected && document.selectedStyleId === document.styleCandidates[1].id);
        }""",
        arg=task_id,
        timeout=20_000,
    )
    capture_workbench(page, report, "state-style-candidates", DESKTOP, "style-candidate-selected", require_media=True)

    reload_app(page)
    open_from_history(page, PROJECT_TITLE, preserve_current=True)
    dismiss_modal_layers(page)
    page.get_by_role("tab", name="动效", exact=True).click()
    section = page.locator(".director-style-candidates")
    rows = section.locator(".director-style-candidate-row")
    expect(rows.nth(1).locator(".director-style-candidate-select")).to_have_attribute("aria-pressed", "true")
    persisted = page.evaluate(
        """async id => {
          const task = await window.storydream.getTaskDetail(id);
          const document = task && JSON.parse(task.pipelineData);
          const candidate = document?.styleCandidates[0];
          const asset = document?.assets.find(item => item.id === candidate?.assetVersionId);
          const job = document?.providerJobs.find(item => item.id === asset?.providerJobId);
          return {
            selectedStyleId: document?.selectedStyleId,
            selectedCandidateId: document?.styleCandidates.find(item => item.selected)?.id,
            sampleAssetId: candidate?.assetVersionId,
            samplePath: asset?.localPath,
            sampleJobId: job?.id,
            sampleJobCapability: job?.capability,
          };
        }""",
        task_id,
    )
    if not persisted.get("samplePath") or persisted.get("sampleJobCapability") != "style-sample":
        raise AssertionError(f"VOX style sample asset/job did not survive reload: {persisted}")
    report["interactions"]["styleCandidates"] = {
        "candidateCount": rows.count(),
        "sampleThumbnailLoaded": True,
        "generationActions": generate_actions.count(),
        "selectedAndReopened": True,
        "paidGenerationCalls": 0,
        **persisted,
    }


def exercise_motion_editor(page: Page, task_id: str, report: dict[str, Any]) -> None:
    """Edit deterministic layer order/visibility and a camera keyframe, then reopen."""
    set_size(page, *DESKTOP)
    select_shot(page, 0)
    page.get_by_role("tab", name="动效", exact=True).click()
    before = page.evaluate("""async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData).beats[0].shots[0]""", task_id)
    editor = page.locator(".director-motion-layers")
    expect(editor).to_be_visible(timeout=15_000)
    rows = editor.locator(":scope > div")
    if rows.count() < 2:
        raise AssertionError("Motion editor needs at least two persisted layers.")
    background, subject = before["layers"][:2]
    background_row = editor.locator(f'[data-layer-id="{background["id"]}"]')
    subject_row = editor.locator(f'[data-layer-id="{subject["id"]}"]')
    background_row.get_by_role("button", name=f'上移 {background["label"]}', exact=True).click()
    subject_row.get_by_role("button", name=f'隐藏 {subject["label"]}', exact=True).click()
    expect(page.locator(f'[data-preview-layer-id="{subject["id"]}"]')).to_have_count(0)
    # Hiding every backed layer must show an honest empty state, never a thumbnail fallback.
    background_row.get_by_role("button", name=f'隐藏 {background["label"]}', exact=True).click()
    expect(page.locator('.director-deterministic-stage img')).to_have_count(0)
    expect(page.get_by_text("没有可见的图片图层，请显示图层或补齐图片素材。", exact=True)).to_be_visible()
    background_row.get_by_role("button", name=f'显示 {background["label"]}', exact=True).click()
    camera = page.get_by_role("combobox", name="编辑相机关键帧", exact=True)
    expect(camera).to_be_visible()
    zoom = page.get_by_role("slider", name="缩放", exact=True)
    zoom.press("ArrowRight")
    page.get_by_role("slider", name="水平位置", exact=True).press("ArrowRight")
    expected_camera = {**before["camera"][0], "zoom": round(before["camera"][0]["zoom"] + .01, 2), "x": round(before["camera"][0]["x"] + .01, 2)}
    save = page.locator(".director-desk-header").get_by_role("button", name="保存版本", exact=True)
    expect(save).to_be_enabled()
    save.click()
    wait_for_async_condition(page,
        """async ({ id, camera, hiddenId }) => {
          const task = await window.storydream.getTaskDetail(id);
          const document = task && JSON.parse(task.pipelineData);
          const shot = document?.beats?.[0]?.shots?.[0];
          return Boolean(shot && shot.layers?.find(layer => layer.id === hiddenId)?.visible === false && Math.abs(shot.camera[0].zoom - camera.zoom) < .00001 && Math.abs(shot.camera[0].x - camera.x) < .00001);
        }""",
        arg={"id": task_id, "camera": expected_camera, "hiddenId": subject["id"]},
        timeout=20_000,
    )
    reload_app(page)
    open_from_history(page, PROJECT_TITLE, preserve_current=True)
    dismiss_modal_layers(page)
    page.get_by_role("tab", name="动效", exact=True).click()
    expect(page.locator(".director-motion-layers")).to_be_visible()
    persisted = page.evaluate(
        """async id => {
          const task = await window.storydream.getTaskDetail(id);
          const document = task && JSON.parse(task.pipelineData);
          const shot = document?.beats?.[0]?.shots?.[0];
          return { visible: shot?.layers?.map(layer => layer.visible !== false), zIndexes: shot?.layers?.map(layer => layer.zIndex), camera: shot?.camera };
        }""",
        task_id,
    )
    if persisted.get("visible", [])[:2] != [True, False] or persisted.get("zIndexes", [])[:2] != [1, 0] or persisted.get("camera", [None])[0] != expected_camera:
        raise AssertionError(f"Motion edits did not survive reload: {persisted}")
    expect(page.locator(f'[data-preview-layer-id="{subject["id"]}"]')).to_have_count(0)
    expect(page.locator(f'[data-preview-layer-id="{background["id"]}"]')).to_have_css("z-index", "1")
    transform = page.locator('.director-deterministic-stage').evaluate('(node) => node.style.transform')
    if f'scale({expected_camera["zoom"]})' not in transform:
        raise AssertionError(f"Reopened preview did not apply the saved camera: {transform}")
    reachability = {}
    for size in (DESKTOP, COMPACT):
        set_size(page, *size)
        reachability[f"{size[0]}x{size[1]}"] = [reachable_control(page, control, label) for label, control in [
            ("相机缩放", page.get_by_role("slider", name="缩放", exact=True)),
            ("显示隐藏图层", page.get_by_role("button", name=f'显示 {subject["label"]}', exact=True)),
        ]]
        page.locator('.director-motion-keyframe-editor').scroll_into_view_if_needed()
        page.screenshot(path=ARTIFACTS / f"state-motion-editor-{size[0]}x{size[1]}.png", full_page=False)
    set_size(page, *DESKTOP)
    # Edit the selected layer's first frame and author an interpolated camera midpoint.
    page.get_by_role("combobox", name="运动轨道", exact=True).select_option(f'layer:{background["id"]}')
    layer_zoom = page.get_by_role("slider", name="图层缩放", exact=True)
    layer_zoom.press("ArrowRight")
    expected_scale = round(before["layers"][0]["motion"][0]["scale"] + .01, 2)
    page.get_by_role("combobox", name="运动轨道", exact=True).select_option('camera')
    page.get_by_role("slider", name="镜内时间", exact=True).press('Home')
    page.get_by_role("slider", name="镜内时间", exact=True).press('ArrowRight')
    page.get_by_role("button", name="在播放位置添加关键帧", exact=True).click()
    camera = page.get_by_role("combobox", name="编辑相机关键帧", exact=True)
    expect(camera.locator('option')).to_have_count(len(before["camera"]) + 1)
    time_input = page.get_by_role("spinbutton", name="关键帧时间（毫秒）", exact=True)
    time_input.fill('900')
    time_input.press('Enter')
    page.get_by_role("slider", name="缩放", exact=True).press('ArrowRight')
    page.get_by_role("button", name="定位首帧", exact=True).click()
    page.get_by_role("button", name="预览到下一帧", exact=True).click()
    expect(page.get_by_role("button", name="预览整个镜头", exact=True)).to_be_visible(timeout=5000)
    expect(page.get_by_role("slider", name="镜内时间", exact=True)).to_have_value('900')
    page.get_by_role("button", name="预览整个镜头", exact=True).click()
    expect(page.get_by_role("button", name="预览整个镜头", exact=True)).to_be_visible(timeout=5000)
    expect(page.get_by_role("slider", name="镜内时间", exact=True)).to_have_value(str(before["durationMs"]))
    expect(page.locator('.director-shot-list button[aria-pressed="true"]')).to_contain_text('钩子')
    page.get_by_role("button", name="定位首帧", exact=True).click()
    page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True).click()
    expect(page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)).to_be_disabled(timeout=15000)
    reload_app(page)
    open_from_history(page, PROJECT_TITLE, preserve_current=True)
    dismiss_modal_layers(page)
    page.get_by_role('tab', name='动效', exact=True).click()
    after = page.evaluate("""async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData).beats[0].shots[0]""", task_id)
    if len(after['camera']) != len(before['camera']) + 1 or after['camera'][1]['atMs'] != 900 or abs(after['layers'][0]['motion'][0]['scale'] - expected_scale) > .00001:
        raise AssertionError(f'Camera or layer keyframes lost on reopen: {after}')
    expect(page.locator(f'[data-preview-layer-id="{background["id"]}"]')).to_have_css('z-index', '1')
    for size in (DESKTOP, COMPACT):
        set_size(page, *size)
        page.locator('.director-motion-keyframe-editor').scroll_into_view_if_needed()
        page.screenshot(path=ARTIFACTS / f'state-motion-keyframes-{size[0]}x{size[1]}.png', full_page=False)
    set_size(page, *DESKTOP)
    report["interactions"]["motionEditor"] = {"layerCount": rows.count(), "savedAndReopened": True, "emptyPreviewWithoutFallback": True, "previewTransform": transform, "reachability": reachability, "layerTransformSaved": True, "keyframeInsertedAndReopened": True, "segmentPreviewEndMs": 900, "shotPreviewEndMs": before['durationMs'], **persisted}


def exercise_quality_review(page: Page, task_id: str, report: dict[str, Any]) -> None:
    """Show a persisted failed gate and verify its location/action surface."""
    page.evaluate(
        """async id => {
          const task = await window.storydream.getTaskDetail(id);
          if (!task) throw new Error('VOX task disappeared before quality review check.');
          const document = JSON.parse(task.pipelineData);
          const video = document.assets.find(asset => asset.kind === 'video' && asset.localPath);
          if (!video) throw new Error('Quality fixture requires a readable local video.');
          for (const shot of document.beats.flatMap(beat => beat.shots)) {
            if (shot.renderStrategy !== 'living-poster' || shot.videoAssetVersionId) continue;
            const job = document.providerJobs.find(item => item.id === shot.videoJobId);
            if (!job) throw new Error('Quality fixture is missing its video job.');
            job.status = 'completed';
            job.actualCost = 0;
            delete job.error;
            const asset = { ...video, id: 'qa-quality-video-' + shot.id, assetId: 'qa-quality-video-' + shot.id, providerJobId: job.id, selected: true, pinned: true };
            document.assets.push(asset);
            shot.videoAssetVersionId = asset.id;
            document.timeline.clips.find(clip => clip.shotId === shot.id).assetVersionIds = [asset.id];
          }
          await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: document.updatedAt, document });
          await window.storydream.renderDirectorProject({ id });
          const renderedTask = await window.storydream.getTaskDetail(id);
          if (!renderedTask) throw new Error('VOX task disappeared after local quality render.');
          const renderedDocument = JSON.parse(renderedTask.pipelineData);
          const renderedReport = renderedDocument.qualityReports.at(-1);
          if (!renderedReport || renderedReport.stage !== 'export' || !renderedReport.providerJobId || !renderedReport.renderFingerprint) {
            throw new Error('Local quality render did not produce a current export report.');
          }
          const createdAt = new Date().toISOString();
          const failedReport = {
            ...renderedReport,
            id: 'qa-quality-failed',
            createdAt,
            status: 'failed',
            checks: renderedReport.checks.map(item => item.id === 'subtitle-timing'
              ? { ...item, severity: 'blocking', status: 'failed', detail: '镜头 2 字幕 cue-2 越界（定位：镜头 2 / cue-2 / 1800ms）' }
              : { ...item, status: 'passed' }),
          };
          document.qualityReports = (renderedDocument.qualityReports || []).filter(item => !String(item.id).startsWith('qa-quality-'));
          document.qualityReports.push(failedReport);
          await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: renderedDocument.updatedAt, document: { ...renderedDocument, qualityReports: document.qualityReports } });
        }""",
        task_id,
    )
    open_from_history(page, PROJECT_TITLE)
    set_size(page, *DESKTOP)
    stage = page.get_by_role('button', name='审片报告', exact=True)
    expect(stage).to_be_visible(timeout=15_000)
    stage.click()
    review = page.locator('.director-quality-review')
    expect(review).to_be_visible(timeout=15_000)
    expect(review.locator('.director-quality-badge.is-failed')).to_have_text('已阻断')
    expect(review).to_contain_text('镜头 2 字幕 cue-2 越界')
    expect(review).to_contain_text('1 项阻断')
    report['interactions']['qualityReview'] = {
        'status': 'failed',
        'failedCheck': 'subtitle-timing',
        'detailVisible': True,
        'recheckActionVisible': review.get_by_role('button', name='重新生成并审片', exact=True).is_visible(),
        'paidGenerationCalls': 0,
    }
    capture_workbench(page, report, 'quality-review-failed', DESKTOP, 'quality-review-failed', require_media=True)
    page.get_by_role('button', name='制作步骤', exact=True).click()
    page.get_by_role('menuitem', name='导出', exact=True).click()
    video = page.locator('.director-media-preview > video')
    expect(video).to_be_visible()
    expect(video).to_have_attribute('controls', '')
    expect(page.locator('.director-preview-copy')).to_have_count(0)
    expect(page.locator('.director-preview-transport')).to_have_count(0)
    for size in (DESKTOP, COMPACT):
        capture_workbench(page, report, 'export-preview', size, 'export-preview', require_media=True)
    page.get_by_role('button', name='审片报告', exact=True).click()
    report['interactions']['exportPreview'] = {'nativeControls': True, 'noDuplicateOverlays': True}


def exercise_compact_queue(page: Page, report: dict[str, Any]) -> None:
    set_size(page, *COMPACT)
    queue = page.locator(".director-queue-panel")
    items = queue.locator(".director-queue-item")
    if items.count() < 3:
        raise AssertionError("Compact queue requires populated fixtures to verify scrolling.")
    controls = [
        reachable_control(page, queue.get_by_role("button", name="批量生成", exact=True), "队列批量生成"),
        reachable_control(page, items.first, "队列首条任务"),
        reachable_control(page, items.last, "队列末条任务"),
    ]
    retry = queue.get_by_role("button", name="重试", exact=True)
    for index in range(retry.count()):
        controls.append(reachable_control(page, retry.nth(index), f"队列重试 {index + 1}"))
    report["interactions"]["compactQueueReachability"] = {"itemCount": items.count(), "controls": controls}
    capture_workbench(page, report, "state-queue-scrolled", COMPACT, "compact-queue-scrolled")
    reset_inspector_scroll(page)


def exercise_vox_structure_edits(page: Page, report: dict[str, Any]) -> None:
    """Exercise the VOX structural toolbar without leaving a dirty fixture behind."""
    set_size(page, *DESKTOP)
    page.locator('.director-structure-disclosure > summary').click()
    rows = page.locator(".director-shot-row")
    expect(rows).to_have_count(4, timeout=15_000)
    rows.nth(0).click()
    before_order = page.locator(".director-shot-row").evaluate_all("items => items.map(item => item.textContent?.trim() || '')")
    page.get_by_role("button", name="拆分当前镜头", exact=True).click()
    expect(rows).to_have_count(5, timeout=15_000)
    split_count = rows.count()
    indexes = rows.locator('.director-shot-row__index').all_text_contents()
    if indexes != ['01', '02', '03', '04', '05']:
        raise AssertionError(f'Split shot numbering is not contiguous: {indexes}')
    page.get_by_role("button", name="保存版本", exact=True).first.click()
    try:
        wait_for_async_condition(page,
            """async id => { const task = await window.storydream.getTaskDetail(id); return Boolean(task && JSON.parse(task.pipelineData).beats.flatMap(beat => beat.shots).length === 5); }""",
            arg=report["project"]["id"], timeout=20_000,
        )
        expect(page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)).to_be_disabled(timeout=15_000)
    except AssertionError:
        report['structureSaveFailure'] = page.evaluate(
            """async id => ({
              document: JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData),
              bodyText: document.body.innerText,
            })""", report['project']['id'],
        )
        page.screenshot(path=ARTIFACTS / 'structure-save-failure.png', full_page=False)
        raise
    reload_app(page)
    open_from_history(page, PROJECT_TITLE, preserve_current=True)
    dismiss_modal_layers(page)
    rows = page.locator(".director-shot-row")
    expect(rows).to_have_count(5, timeout=15_000)
    reopened_split_count = rows.count()
    rows.nth(0).click()
    page.locator('.director-structure-disclosure > summary').click()
    page.get_by_role("button", name="合并当前镜头与下一镜头", exact=True).click()
    expect(rows).to_have_count(4, timeout=15_000)
    merge_count = rows.count()
    page.get_by_role("button", name="新增镜头", exact=True).click()
    expect(rows).to_have_count(5, timeout=15_000)
    added_order = rows.evaluate_all("items => items.map(item => item.textContent?.trim() || '')")
    if len(added_order) != 5:
        raise AssertionError(f"VOX add shot did not update the filmstrip: {added_order}")
    page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True).click()
    expect(page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)).to_be_disabled(timeout=15_000)
    saved_opening = page.evaluate("async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData).beats[0].durationMs", report['project']['id'])
    if saved_opening <= 3000:
        raise AssertionError(f'Extended opening fixture did not exceed three seconds: {saved_opening}')
    reload_app(page)
    open_from_history(page, PROJECT_TITLE, preserve_current=True)
    expect(rows).to_have_count(5, timeout=15_000)
    rows.nth(0).click()
    page.locator('.director-structure-disclosure > summary').click()
    page.get_by_role('button', name='合并当前镜头与下一镜头', exact=True).click()
    expect(page.locator('.director-header-message')).to_contain_text('超过 6 个图层')
    expect(rows).to_have_count(5)
    for size in (DESKTOP, COMPACT):
        set_size(page, *size)
        capture_workbench(page, report, 'state-structure-error', size, 'structure-error')
        page.get_by_role('button', name='查看错误详情', exact=True).click()
        detail = page.get_by_role('dialog', name='操作未完成')
        expect(detail).to_contain_text('超过 6 个图层')
        page.screenshot(path=ARTIFACTS / f'state-error-details-{size[0]}x{size[1]}.png', full_page=False, animations='disabled')
        detail.get_by_role('button', name='关闭', exact=True).click()
        expect(detail).not_to_be_visible()
    set_size(page, *DESKTOP)
    rows.nth(1).click()
    page.get_by_role("button", name="上移当前镜头", exact=True).click()
    moved_order = rows.evaluate_all("items => items.map(item => item.textContent?.trim() || '')")
    page.get_by_role("button", name="删除当前镜头", exact=True).click()
    page.get_by_role("button", name="删除镜头", exact=True).click()
    expect(rows).to_have_count(4, timeout=15_000)
    dismiss_modal_layers(page)
    restored_order = rows.evaluate_all("items => items.map(item => item.textContent?.trim() || '')")
    rows.nth(0).click()
    beat_toolbar = page.locator('.director-structure-group--beat')
    expect(beat_toolbar).to_be_visible(timeout=15_000)
    beat_before = page.locator('.director-structure-group--beat .director-structure-group__label').inner_text()
    page.get_by_role('button', name='新增节拍', exact=True).click()
    expect(page.locator('.director-structure-group--beat .director-structure-group__label')).to_contain_text('/ 5')
    page.get_by_role('button', name='下移当前节拍', exact=True).click()
    expect(page.locator('.director-structure-group--beat .director-structure-group__label')).to_contain_text('3 / 5')
    page.get_by_role('button', name='删除当前节拍', exact=True).click()
    beat_dialog = page.get_by_role('dialog', name='删除当前节拍')
    expect(beat_dialog).to_be_visible(timeout=15_000)
    expect(beat_dialog).to_contain_text('第 3 节拍')
    beat_dialog.get_by_role('button', name='删除节拍', exact=True).click()
    expect(page.locator('.director-structure-group--beat .director-structure-group__label')).to_contain_text('/ 4')
    page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True).click()
    expect(page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)).to_be_disabled(timeout=15_000)
    reload_app(page)
    open_from_history(page, PROJECT_TITLE, preserve_current=True)
    expect(page.locator('.director-structure-group--beat .director-structure-group__label')).to_contain_text('/ 4')
    expect(rows).to_have_count(4, timeout=15_000)
    report["interactions"]["voxStructureEdits"] = {
        "beforeCount": len(before_order),
        "afterSplitCount": split_count,
        "reopenedSplitCount": reopened_split_count,
        "afterMergeCount": merge_count,
        "afterInsertCount": len(added_order),
        "afterMoveCount": len(moved_order),
        "afterRemoveCount": len(restored_order),
        "restoredCount": len(restored_order) == len(before_order),
        "restoredSavedAndReopened": True,
        "beatOperations": {
            "before": beat_before,
            "insertedAndReordered": True,
            "deleteConfirmation": True,
            "savedAndReopened": True,
        },
        "contiguousShotNumbers": indexes,
        "extendedOpeningSavedAndReopenedMs": saved_opening,
        "invalidMergeRejectedWithDetails": True,
    }


def switch_video_provider(page: Page, report: dict[str, Any]) -> None:
    select_shot(page, 1)
    generation_tab(page)
    select = page.get_by_role("combobox", name="视频生成服务")
    expect(select).to_be_visible(timeout=15_000)
    options = select.locator("option")
    if options.count() != 2 or any(option.is_disabled() for option in options.all()):
        raise AssertionError("Connected state does not expose two selectable video providers.")
    select.select_option("qa-video-secondary")
    expect(select).to_have_value("qa-video-secondary", timeout=15_000)
    wait_for_async_condition(page,
        "expected => window.storydream.getBootstrap().then(state => state.config.video.activeProviderId === expected)",
        arg="qa-video-secondary",
        timeout=15_000,
    )
    report["interactions"]["videoProviderSwitch"] = {"selected": select.input_value(), "optionCount": options.count()}


def video_state(page: Page, index: int, expected_text: str) -> dict[str, Any]:
    select_shot(page, index)
    generation_tab(page)
    page.wait_for_timeout(300)
    data = snapshot(page)
    text = page.locator(".director-video-readiness").inner_text()
    if expected_text not in text:
        raise AssertionError(f"Shot {index + 1} did not expose {expected_text}: {text}")
    return data


def disable_video_services(page: Page, enabled: bool) -> dict[str, Any]:
    return page.evaluate(
        """async enabled => {
          const bootstrap = await window.storydream.getBootstrap();
          const config = structuredClone(bootstrap.config);
          const ids = config.video.providers.map(provider => provider.id);
          config.video.providers = config.video.providers.map(provider => ({ ...provider, enabled }));
          config.video.automation.providerWhitelist = enabled ? ids : [];
          await window.storydream.saveConfig({ config, secretChanges: {} });
          const refreshed = await window.storydream.getBootstrap();
          return { enabled: refreshed.config.video.providers.map(provider => ({ id: provider.id, enabled: provider.enabled })), activeProviderId: refreshed.config.video.activeProviderId };
        }""",
        enabled,
    )


def retry_with_local_stub(page: Page, task_id: str, report: dict[str, Any], stub_state: dict[str, Any]) -> None:
    select_shot(page, 2)
    generation_tab(page)
    retry = page.get_by_role("button", name="重试 AI 动态海报", exact=True)
    expect(retry).to_be_visible(timeout=15_000)
    expect(retry).to_be_enabled(timeout=15_000)
    before = page.evaluate(
        """async id => {
          const task = await window.storydream.getTaskDetail(id);
          if (!task) return null;
          const document = JSON.parse(task.pipelineData);
          const shot = document.beats[2].shots[0];
          return {
            count: document.providerJobs.length,
            videoCount: document.providerJobs.filter(job => job.nodeId === shot.id && job.capability === 'image-to-video').length,
          };
        }""",
        task_id,
    )
    if not before:
        raise AssertionError("Could not read the failed video job before retry.")
    requests_before = len(stub_state["requests"])
    retry.click()
    deadline = time.monotonic() + 60
    after: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        after = page.evaluate(
            """async id => {
              const task = await window.storydream.getTaskDetail(id);
              if (!task) return null;
              const document = JSON.parse(task.pipelineData);
              const shot = document.beats[2].shots[0];
              const jobs = document.providerJobs.filter(job => job.nodeId === shot.id && job.capability === 'image-to-video');
              return { count: document.providerJobs.length, videoJobs: jobs, shot };
            }""",
            task_id,
        )
        if after and len(after["videoJobs"]) > before["videoCount"] and after["videoJobs"][-1]["status"] == "completed":
            break
        page.wait_for_timeout(300)
    after = after or {}
    if not after or not after["videoJobs"] or after["videoJobs"][-1]["status"] != "completed":
        raise AssertionError(f"Retry did not complete against local stub: {after}")
    page.wait_for_selector("video.director-shot-video", state="visible", timeout=20_000)
    requests_after = len(stub_state["requests"])
    if requests_after != requests_before + 1:
        raise AssertionError(f"Retry expected one local video request, got {requests_before} -> {requests_after}.")
    request = stub_state["requests"][-1]
    if request.get("path") != "/v1/videos/generations" or not request.get("hasFirstFrame"):
        raise AssertionError(f"Local video stub received an invalid retry request: {request}")
    report["interactions"]["failedVideoRetry"] = {
        "buttonEnabled": True,
        "stubIntercepted": True,
        "providerJobCountBefore": before["count"],
        "providerJobCountAfter": after["count"],
        "retryJob": after["videoJobs"][-1],
        "localRequest": request,
        "paidGenerationCalls": 0,
    }
def exercise_video_playback(page: Page, report: dict[str, Any]) -> None:
    select_shot(page, 3)
    generation_tab(page)
    video = page.locator("video.director-shot-video")
    expect(video).to_be_visible(timeout=15_000)
    page.wait_for_function(
        "() => { const video = document.querySelector('video.director-shot-video'); return video instanceof HTMLVideoElement && video.readyState >= 3 && Number.isFinite(video.duration) && video.duration > 1; }",
        timeout=20_000,
    )
    transport = page.locator(".director-preview-transport")
    slider = page.get_by_role("slider", name="播放进度")
    before = float(slider.input_value())
    transport.get_by_role("button", name="播放", exact=True).click()
    page.wait_for_timeout(750)
    playing = float(slider.input_value())
    during = video.evaluate("element => ({ paused: element.paused, currentTime: element.currentTime, duration: element.duration })")
    transport.get_by_role("button", name="暂停", exact=True).click()
    paused = float(slider.input_value())
    page.wait_for_timeout(400)
    paused_after = float(slider.input_value())
    bounds = slider.bounding_box()
    if not bounds:
        raise AssertionError("Playback slider has no bounding box.")
    slider.click(position={"x": max(2, bounds["width"] * 0.72), "y": bounds["height"] / 2})
    page.wait_for_timeout(350)
    seeked = float(slider.input_value())
    after = video.evaluate("element => ({ paused: element.paused, currentTime: element.currentTime, duration: element.duration })")
    if (
        playing <= before
        or paused != paused_after
        or abs(seeked - paused) < 50
        or during["paused"]
        or during["currentTime"] <= 0
        or abs(after["currentTime"] - during["currentTime"]) < 0.1
    ):
        raise AssertionError(f"Video playback contract failed: {before}, {playing}, {paused}, {paused_after}, {seeked}, {during}, {after}")
    timecode = page.locator(".director-timecode").inner_text()
    if "/" not in timecode:
        raise AssertionError(f"Unexpected timecode: {timecode}")
    report["interactions"]["videoPlayback"] = {
        "sliderBefore": before, "sliderPlaying": playing, "sliderPaused": paused, "sliderPausedAfterWait": paused_after,
        "sliderSeeked": seeked, "timecode": timecode, "videoDuringPlay": during, "videoAfterSeek": after,
    }


def exercise_subtitle_editor(page: Page, task_id: str, report: dict[str, Any]) -> None:
    set_size(page, *DESKTOP)
    select_shot(page, 0)
    page.get_by_role("tab", name="字幕", exact=True).click()
    editor = page.locator("[data-director-subtitle-editor]")
    expect(editor).to_be_visible()
    selector = editor.get_by_label("字幕句子", exact=True)
    original_id = selector.input_value()
    original_text = editor.get_by_label("字幕内容", exact=True).input_value()
    before = page.evaluate("async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)", task_id)
    count = selector.locator("option").count()
    editor.get_by_role("button", name="新增一句", exact=True).click()
    expect(selector.locator("option")).to_have_count(count + 1)
    new_id = selector.locator("option").last.get_attribute("value")
    selector.select_option(new_id)
    changed_text = "新增一句独立字幕，保持其他句子。"
    editor.get_by_label("字幕内容", exact=True).fill(changed_text)
    editor.get_by_role("button", name="估算逐词时间", exact=True).click()
    expect(editor.get_by_text("估算对齐", exact=False)).to_be_visible()
    selector.select_option(original_id)
    expect(editor.get_by_label("字幕内容", exact=True)).to_have_value(original_text)
    selector.select_option(new_id)
    editor.get_by_role("button", name="定位本句", exact=True).click()
    expect(page.locator(f'[data-active-subtitle-cue="{new_id}"]')).to_have_text(changed_text)
    for size in (DESKTOP, COMPACT):
        set_size(page, *size)
        targets = [
            (editor.get_by_label("字幕句子", exact=True), "字幕句子"),
            (editor.get_by_label("字幕内容", exact=True), "字幕内容"),
            (editor.get_by_label("开始（秒）", exact=True), "字幕开始"),
            (editor.get_by_label("结束（秒）", exact=True), "字幕结束"),
            (editor.get_by_role("button", name="应用时间", exact=True), "应用时间"),
            (editor.get_by_role("button", name="估算逐词时间", exact=True), "估算时间"),
            (editor.get_by_label("字幕样式", exact=True), "字幕样式"),
        ]
        report.setdefault("subtitleReachability", {})[f"{size[0]}x{size[1]}"] = [reachable_control(page, target, label) for target, label in targets]
        editor.get_by_label("字幕句子", exact=True).scroll_into_view_if_needed()
        name = f"subtitle-editor-{size[0]}x{size[1]}.png"
        page.screenshot(path=ARTIFACTS / name, full_page=False)
        report.setdefault("subtitleCaptures", []).append(name)
        editor.get_by_label("字幕样式", exact=True).scroll_into_view_if_needed()
        page.screenshot(path=ARTIFACTS / f"subtitle-editor-bottom-{size[0]}x{size[1]}.png", full_page=False)
    set_size(page, *DESKTOP)
    page.get_by_role("button", name="保存版本", exact=True).first.click()
    wait_for_async_condition(page,
        """async ({ id, cueId, text }) => {
          const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
          return doc.beats[0].subtitleCues.some(cue => cue.id === cueId && cue.text === text && cue.alignmentSource === 'estimated');
        }""", arg={"id": task_id, "cueId": new_id, "text": changed_text}, timeout=20_000,
    )
    reload_app(page)
    open_from_history(page, PROJECT_TITLE, preserve_current=True)
    dismiss_modal_layers(page)
    select_shot(page, 0)
    page.get_by_role("tab", name="字幕", exact=True).click()
    editor = page.locator("[data-director-subtitle-editor]")
    editor.get_by_label("字幕句子", exact=True).select_option(new_id)
    expect(editor.get_by_label("字幕内容", exact=True)).to_have_value(changed_text)
    saved = page.evaluate("async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)", task_id)
    first_shot = saved["beats"][0]["shots"][0]
    if first_shot.get("voiceAssetVersionId"):
        raise AssertionError("Editing subtitles left the old shot narration selected.")
    if first_shot["scenePrompt"] != before["beats"][0]["shots"][0]["scenePrompt"]:
        raise AssertionError("Subtitle edit overwrote the visual prompt.")
    cue = next(item for item in saved["beats"][0]["subtitleCues"] if item["id"] == new_id)
    if not cue.get("tokens") or any(token["endMs"] <= token["startMs"] for token in cue["tokens"]):
        raise AssertionError("Saved subtitle alignment is empty or has non-positive tokens.")
    editor.get_by_label("开始（秒）", exact=True).fill("-1")
    editor.get_by_role("button", name="应用时间", exact=True).click()
    expect(editor.get_by_role("alert")).to_contain_text("时间须位于")
    editor.get_by_role("button", name="删除本句", exact=True).click()
    expect(editor.get_by_label("字幕句子", exact=True).locator("option")).to_have_count(count)
    report["stateAssertions"]["subtitles"] = {"savedAndReopened": True, "cueIsolation": True, "previewByTime": True, "estimatedTokens": len(cue["tokens"]), "oldSpeechDetached": True, "visualPromptPreserved": True, "invalidTimeRejected": True, "deleteSelectedOnly": True, "paidCalls": 0}


def main() -> None:
    clean_artifacts()
    QA_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="director-desk-electron-", dir=QA_TEMP_ROOT))
    fixtures = make_fixtures(profile)
    stub_server, stub_thread, stub_state, stub_base_url = start_video_stub(fixtures["video"])
    port = free_port()
    environment = os.environ.copy()
    environment["NODE_ENV"] = "production"
    environment.pop("VITE_DEV_SERVER_URL", None)
    environment.pop("ELECTRON_RUN_AS_NODE", None)
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        [
            str(ELECTRON), f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1",
            "--remote-allow-origins=*", f"--user-data-dir={profile}", str(ROOT),
        ],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=flags,
    )
    report: dict[str, Any] = {
        "status": "running",
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "processId": process.pid,
        "viewports": [
            {"name": "reference", "width": REFERENCE_VIEWPORT[0], "height": REFERENCE_VIEWPORT[1]},
            {"name": "desktop", "width": DESKTOP[0], "height": DESKTOP[1]},
            {"name": "compact", "width": COMPACT[0], "height": COMPACT[1]},
        ],
        "fixtureMedia": {key: str(value) for key, value in fixtures.items()},
        "runtimeErrors": [],
        "paidGenerationCalls": 0,
        "captures": [],
        "interactions": {},
        "stateAssertions": {},
        "limitations": [
            "图片与旁白任务使用本地持久化 fixture；视频重试只访问 127.0.0.1 回环桩并返回本地 MP4，不会调用真实图片、语音或视频 API。",
            "queued/running/failed 状态由本地 providerJobs 注入，用于验收界面、持久化和重试契约。",
        ],
    }
    page: Page | None = None
    browser = None
    try:
        endpoint = wait_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            errors = report["runtimeErrors"]
            page.on("pageerror", lambda error: errors.append({"type": "pageerror", "message": str(error)}))
            page.on("console", lambda message: errors.append({"type": "console", "message": message.text}) if message.type == "error" else None)
            wait_app(page)
            set_size(page, *DESKTOP)
            report["providerPreflight"] = seed_services(page, stub_base_url)

            navigate(page, "new-task", ".new-task-type-picker")
            expect(page.locator("button[data-nav-view='editorial-collage']")).to_be_visible()
            expect(page.locator("button[data-nav-view='motion-comic']")).to_be_visible()
            page.screenshot(path=ARTIFACTS / "workflow-entry-1536x1024.png", full_page=False)
            report["interactions"]["workflowEntry"] = {"voxButton": True, "motionComicButton": True}

            task_id = create_project(page, report)
            report["stateAssertions"]["createdProject"] = {"taskId": task_id, "threeStepWizard": True, "paidGenerationCalls": 0}
            empty_state = page.evaluate(
                """() => {
                  const summary = document.querySelector('.director-project-summary');
                  const preview = document.querySelector('.director-media-preview');
                  return {
                    coverEmpty: Boolean(summary?.querySelector('.director-project-cover--empty')),
                    coverImageCount: summary?.querySelectorAll('img').length ?? 0,
                    previewImageCount: preview?.querySelectorAll('img').length ?? 0,
                    previewEmpty: Boolean(preview?.querySelector('.director-media-state')),
                    previewText: preview?.textContent?.trim() ?? '',
                  };
                }"""
            )
            if not empty_state["coverEmpty"] or empty_state["coverImageCount"] != 0 or empty_state["previewImageCount"] != 0 or not empty_state["previewEmpty"]:
                raise AssertionError(f"Empty project still exposes placeholder media: {empty_state}")
            for size in (DESKTOP, COMPACT):
                set_size(page, *size)
                empty_path = ARTIFACTS / f"empty-project-{size[0]}x{size[1]}.png"
                page.screenshot(path=empty_path, full_page=False, animations="disabled")
                report["captures"].append({"name": empty_path.name, "kind": "empty-project", "state": "empty-project", "viewport": {"width": size[0], "height": size[1]}, "inspection": empty_state})
            report["stateAssertions"]["emptyProject"] = empty_state
            report["stateAssertions"]["localFixtureInjection"] = inject_fixture_state(page, task_id, fixtures)
            open_from_history(page, PROJECT_TITLE)

            set_size(page, *DESKTOP)
            select_shot(page, 0)
            generation_tab(page)
            reset_inspector_scroll(page)
            reference = capture_workbench(page, report, "vox-reference", REFERENCE_VIEWPORT, "local-keyframe-reference", require_media=True)
            local = capture_workbench(page, report, "vox-desktop-1536x1024", DESKTOP, "local-keyframe-desktop", require_media=True)
            compact = capture_workbench(page, report, "vox-compact", COMPACT, "local-keyframe-compact", require_media=True)
            report["stateAssertions"]["referenceComparisonState"] = {
                "viewport": reference["viewport"],
                "strategy": reference["strategy"],
                "imageLoaded": reference["imageLoaded"],
                "sourceReference": str(ROOT / ".artifacts" / "product-design-rework" / "director-desk.png"),
                "implementationCapture": "vox-reference-1440x1024.png",
            }
            report["stateAssertions"]["localKeyframe"] = {"strategy": local["strategy"], "imageLoaded": local["imageLoaded"], "videoElements": len(local["videos"])}
            report["stateAssertions"]["compactLayout"] = {"preview": compact["panes"]["preview"], "inspector": compact["panes"]["inspector"]}
            exercise_preview_ratios(page, report)
            exercise_style_candidates(page, task_id, report)
            exercise_motion_editor(page, task_id, report)
            for size in (REFERENCE_VIEWPORT, DESKTOP, COMPACT):
                exercise_generation_inspector(page, report, size, "local-keyframe")

            set_size(page, *DESKTOP)
            switch_video_provider(page, report)
            queued = video_state(page, 1, "等待")
            report["stateAssertions"]["queued"] = {"emptyState": queued["emptyState"], "queueStates": queued["queueStates"]}
            capture_workbench(page, report, "state-queued", DESKTOP, "video-queued")
            exercise_compact_queue(page, report)
            set_size(page, *DESKTOP)

            failed = video_state(page, 2, "生成失败")
            report["stateAssertions"]["failed"] = {"emptyState": failed["emptyState"], "queueStates": failed["queueStates"]}
            capture_workbench(page, report, "state-failed", DESKTOP, "video-failed")

            running_job = page.evaluate(
                """async id => {
                  const task = await window.storydream.getTaskDetail(id);
                  const document = JSON.parse(task.pipelineData);
                  const shot = document.beats[1].shots[0];
                  const job = document.providerJobs.find(candidate => candidate.id === shot.videoJobId);
                  job.status = 'running'; job.updatedAt = new Date().toISOString();
                  await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: document.updatedAt, document });
                  return job.id;
                }""",
                task_id,
            )
            open_from_history(page, PROJECT_TITLE)
            running = video_state(page, 1, "生成中")
            report["stateAssertions"]["running"] = {"jobId": running_job, "emptyState": running["emptyState"]}
            capture_workbench(page, report, "state-running", DESKTOP, "video-running")

            page.evaluate(
                """async id => {
                  const task = await window.storydream.getTaskDetail(id);
                  const document = JSON.parse(task.pipelineData);
                  const shot = document.beats[1].shots[0];
                  const job = document.providerJobs.find(candidate => candidate.id === shot.videoJobId);
                  job.status = 'queued'; job.updatedAt = new Date().toISOString();
                  await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: document.updatedAt, document });
                }""",
                task_id,
            )
            disabled_config = disable_video_services(page, False)
            open_from_history(page, PROJECT_TITLE)
            unavailable = video_state(page, 2, "生成失败")
            retry_disabled = page.get_by_role("button", name="重试 AI 动态海报", exact=True)
            if retry_disabled.is_enabled():
                raise AssertionError("Retry remained enabled while video providers were disabled.")
            capture_workbench(page, report, "provider-unavailable", DESKTOP, "video-provider-unavailable")
            report["stateAssertions"]["providerUnavailable"] = {"config": disabled_config, "provider": unavailable["provider"], "retryDisabled": True}

            disable_video_services(page, True)
            open_from_history(page, PROJECT_TITLE)
            retry_with_local_stub(page, task_id, report, stub_state)
            exercise_video_playback(page, report)
            completed = capture_workbench(page, report, "state-living-poster-completed", DESKTOP, "living-poster-completed", require_media=True)
            report["stateAssertions"]["completed"] = {"strategy": completed["strategy"], "videoLoaded": completed["videoLoaded"], "videos": completed["videos"]}
            reset_inspector_scroll(page)
            capture_workbench(page, report, "state-living-poster-completed", COMPACT, "living-poster-completed-compact", require_media=True)
            for size in (REFERENCE_VIEWPORT, DESKTOP, COMPACT):
                exercise_generation_inspector(page, report, size, "living-poster")
            set_size(page, *DESKTOP)

            reload_app(page)
            open_from_history(page, PROJECT_TITLE)
            select_shot(page, 3)
            generation_tab(page)
            page.wait_for_selector("video.director-shot-video", state="visible", timeout=15_000)
            page.wait_for_function(
                "() => { const video = document.querySelector('video.director-shot-video'); return video instanceof HTMLVideoElement && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 1; }",
                timeout=20_000,
            )
            reloaded = snapshot(page)
            if not reloaded["videoLoaded"]:
                raise AssertionError(f"Completed living-poster video disappeared after reload: {reloaded}")
            capture_workbench(page, report, "reload-persisted", DESKTOP, "reload-persisted", require_media=True)
            report["stateAssertions"]["reloadPersistence"] = {"strategy": reloaded["strategy"], "videoLoaded": reloaded["videoLoaded"], "videos": reloaded["videos"]}

            exercise_quality_review(page, task_id, report)
            exercise_subtitle_editor(page, task_id, report)
            exercise_vox_structure_edits(page, report)

            if errors:
                raise AssertionError(f"Electron reported runtime errors: {errors}")
            if report["paidGenerationCalls"] != 0:
                raise AssertionError("QA unexpectedly invoked a paid generation path.")
            report["status"] = "passed"
            report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            browser.close()
            browser = None
    except Exception as error:
        report["status"] = "failed"
        report["error"] = f"{type(error).__name__}: {error}"
        if page is not None:
            try:
                page.screenshot(path=ARTIFACTS / "failure-state.png", full_page=False)
                report["failurePage"] = page.evaluate(
                    "() => ({ shellView: document.querySelector('.app-shell')?.getAttribute('data-shell-view') || '', bodyText: document.body?.innerText?.slice(-5000) || '', routeError: document.querySelector('.route-error-state,.application-error-state')?.textContent || '' })"
                )
            except Exception as diagnostic:
                report["failureCaptureError"] = str(diagnostic)
        raise
    finally:
        report["finishedAt"] = report.get("finishedAt") or time.strftime("%Y-%m-%dT%H:%M:%S%z")
        report["processReturnCodeBeforeCleanup"] = process.poll()
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
            report["processOutputTail"] = {"stdout": stdout.decode("utf-8", errors="replace")[-6000:], "stderr": stderr.decode("utf-8", errors="replace")[-6000:]}
        except Exception as output_error:
            report["processOutputError"] = str(output_error)
        report["localVideoStub"] = {"baseUrl": stub_base_url, "requests": list(stub_state["requests"])}
        stub_server.shutdown()
        stub_server.server_close()
        stub_thread.join(timeout=2)
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        (ARTIFACTS / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        profile_root = profile.resolve()
        audit_root = QA_TEMP_ROOT.resolve()
        if profile_root.is_relative_to(audit_root):
            shutil.rmtree(profile_root, ignore_errors=True)


if __name__ == "__main__":
    main()
