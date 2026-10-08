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

from PIL import Image, ImageDraw, ImageStat
from playwright.sync_api import Page, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".artifacts" / "motion-comic-workbench"
ELECTRON = ROOT / "node_modules" / "electron" / "dist" / "electron.exe"
PROJECT_TITLE = "雨夜来信 · 一致性验收"
PROJECT_PREMISE = "女孩在雨夜收到一封来自十年后的信，必须在天亮前验证警告并保护关键人物。"
PROJECT_SOURCE = """第1集 雨夜来信

雨夜，林夏在旧城邮局门口收到一封署名为十年后自己的信。
信中警告她：天亮前不要让周沉走进钟楼。
她循着信封上的水渍和邮戳，决定先找到周沉核对真相。

第2集 天亮之前

林夏与周沉抵达钟楼，发现信中的每条警告都在逐一发生。
当钟声响起，他们必须在相信未来与改变未来之间作出选择。
"""
MOJIBAKE_MARKERS = ("\ufffd", "锟斤拷", "Ã¤", "æµ‹è¯•", "闁诲")
DESKTOP = (1536, 1024)
COMPACT = (1040, 720)
VIEWPORTS = (("desktop", DESKTOP), ("compact", COMPACT))
THEMES = ("dark", "light")
ASSET_ENTRY_SPECS = (
    ("character", "新增人物"),
    ("scene", "新增场景"),
    ("prop", "新增道具"),
)
PAID_API_ENV_VARS = (
    "GEEKAI_API_KEY",
    "HETU_API_KEY",
    "MOE_API_KEY",
    "YUNJUNET_API_KEY",
    "VLLMPROXY_API_KEY",
    "INPUT_IM_API_KEY",
    "GETEZO_API_KEY",
    "SUNO_API_KEY",
    "SYNORALINK_API_KEY",
)


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
    page.wait_for_timeout(450)


def clean_artifacts() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    for pattern in ("*.png", "report.json"):
        for path in ARTIFACTS.glob(pattern):
            if path.is_file():
                path.unlink()


def create_reference_fixtures(directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    palette = [
        ((42, 54, 68), (243, 191, 78), (224, 91, 76)),
        ((30, 73, 71), (104, 199, 170), (246, 232, 202)),
        ((67, 45, 73), (224, 132, 158), (247, 202, 93)),
        ((49, 66, 95), (91, 155, 213), (241, 239, 226)),
        ((72, 58, 45), (210, 158, 88), (101, 184, 131)),
        ((43, 66, 57), (132, 196, 118), (233, 229, 202)),
        ((68, 45, 49), (220, 104, 91), (118, 178, 212)),
    ]
    paths: list[Path] = []
    for index, (background, accent, highlight) in enumerate(palette, start=1):
        image = Image.new("RGB", (640, 480), background)
        draw = ImageDraw.Draw(image)
        draw.rectangle((38, 34, 602, 446), outline=accent, width=8)
        draw.rectangle((76, 72, 284, 408), fill=accent)
        draw.ellipse((326, 86, 554, 314), fill=highlight)
        draw.polygon(((320, 406), (438, 244), (570, 406)), fill=(236, 230, 210))
        for offset in range(5):
            y = 104 + offset * 52
            draw.line((92, y, 266, y), fill=background, width=9)
        draw.text((336, 354), f"REF {index:02d}", fill=(255, 255, 255))
        path = directory / f"reference-{index:02d}.png"
        image.save(path, format="PNG")
        paths.append(path)
    return paths


def create_video_fixture(image_path: Path, output_path: Path) -> Path:
    import av

    image = Image.open(image_path).convert("RGB").resize((640, 360))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with av.open(str(output_path), mode="w") as container:
        stream = container.add_stream("libx264", rate=24)
        stream.width = image.width
        stream.height = image.height
        stream.pix_fmt = "yuv420p"
        for frame_index in range(24):
            frame = av.VideoFrame.from_image(image)
            frame.pts = frame_index
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    return output_path


def wait_for_app(page: Page) -> None:
    page.wait_for_selector(".app-shell", timeout=30_000)
    page.wait_for_function(
        """() => {
          const shell = document.querySelector('.app-shell');
          return Boolean(shell && shell.getBoundingClientRect().width > 600 && document.body.innerText.includes('StoryDream'));
        }""",
        timeout=30_000,
    )
    page.wait_for_timeout(350)


def navigate_sidebar(page: Page, view: str, target_selector: str) -> None:
    button = page.locator(f"button[data-nav-view='{view}']")
    if button.count() == 0 or not button.first.is_visible():
        primary_view = {
            "motion-comic": "projects",
            "editorial-collage": "projects",
            "history": "queue",
        }.get(view)
        if primary_view:
            primary = page.locator(f"button[data-nav-view='{primary_view}'][data-nav-level='primary']")
            expect(primary).to_be_visible(timeout=15_000)
            primary.click()
            page.wait_for_timeout(250)
            button = page.locator(f"button[data-nav-view='{view}']")
    expect(button).to_be_visible(timeout=15_000)
    button.click()
    page.wait_for_selector(target_selector, timeout=30_000)
    page.wait_for_timeout(250)


def seed_isolated_provider_profiles(page: Page) -> dict[str, object]:
    result = page.evaluate(
        """async () => {
          const bootstrap = await window.storydream.getBootstrap();
          const config = structuredClone(bootstrap.config);
          const gptImage = {
            ...config.gptImage,
            baseUrl: 'https://qa.invalid/v1',
            model: 'gpt-image-2',
            resolution: '2K',
            quality: 'high',
          };
          const customImage = {
            ...config.customImage,
            displayName: 'QA 兼容图片服务',
            baseUrl: 'https://qa-custom.invalid/v1',
            model: 'gpt-image-2',
            resolution: '2K',
            quality: 'high',
          };
          config.imageProvider = 'gpt_image';
          config.gptImage = gptImage;
          config.customImage = customImage;
          config.imageProfiles = [
            { id: 'qa-gpt-image', name: 'QA GPT Image', enabled: true, provider: 'gpt_image', gptImage },
            { id: 'qa-custom-image', name: 'QA 兼容图片服务', enabled: true, provider: 'custom', customImage },
          ];
          config.activeImageProfileId = 'qa-gpt-image';
          const qaVideo = {
            ...config.video.providers[0],
            id: 'qa-remote-video',
            name: 'QA 远程视频',
            enabled: true,
            baseUrl: 'https://qa-video.invalid/v1',
            model: 'qa-i2v-1080p',
            submitPath: '/videos/generations',
            statusPathTemplate: '/videos/generations/{id}',
            pricePerSecond: 0.24,
            maxDurationSec: 15,
            maxResolution: '1080P',
            capabilities: ['i2v', 'first-last-frame'],
            license: 'QA 本地桩，禁止发送请求',
            requestParamsJson: '{}',
          };
          config.video = {
            ...config.video,
            providers: [qaVideo],
            activeProviderId: qaVideo.id,
            automation: {
              ...config.video.automation,
              budgetLimit: 50,
              providerWhitelist: [qaVideo.id],
            },
          };
          const mutation = await window.storydream.saveConfig({
            config,
            secretChanges: {
              'image/qa-gpt-image/gptImage/apiKey': 'qa-key-never-sent',
              'image/qa-custom-image/customImage/apiKey': 'qa-key-never-sent',
              'video/qa-remote-video/apiKey': 'qa-key-never-sent',
            },
          });
          if (!mutation || mutation.kind !== 'state-patch' || mutation.patch.kind !== 'config') {
            throw new Error('QA provider profiles were not persisted.');
          }
          const refreshed = await window.storydream.getBootstrap();
          return {
            activeProfileId: refreshed.config.activeImageProfileId,
            profileIds: refreshed.config.imageProfiles.map((profile) => profile.id),
            activeVideoProviderId: refreshed.config.video.activeProviderId,
            videoProviders: refreshed.config.video.providers.map((provider) => ({
              id: provider.id,
              model: provider.model,
              enabled: provider.enabled,
              pricePerSecond: provider.pricePerSecond,
            })),
            connectedProfileIds: Object.entries(refreshed.secretStatus)
              .filter(([, connected]) => connected)
              .map(([id]) => id),
          };
        }"""
    )
    page.wait_for_timeout(500)
    if result.get("activeProfileId") != "qa-gpt-image" or result.get("activeVideoProviderId") != "qa-remote-video":
        raise AssertionError(f"Isolated image provider setup failed: {result}")
    return result


def base_snapshot(page: Page, root_selector: str) -> dict[str, object]:
    return page.locator(root_selector).evaluate(
        r"""(root, badPatterns) => {
          const ownRect = (element) => {
            const value = element?.getBoundingClientRect();
            return value ? {
              x: value.x, y: value.y, width: value.width, height: value.height,
              right: value.right, bottom: value.bottom,
            } : null;
          };
          const visible = (element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden'
              && Number(style.opacity || 1) > 0 && box.width > 0 && box.height > 0;
          };
          const rootRect = root.getBoundingClientRect();
          const controls = [...root.querySelectorAll('button, input, select, textarea, [role="tab"]')].filter(visible);
          const controlsWithCenterInViewport = controls.filter((element) => {
            const box = element.getBoundingClientRect();
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            return centerX >= 0 && centerX <= innerWidth && centerY >= 0 && centerY <= innerHeight;
          });
          const label = (element) => element.getAttribute('aria-label')
            || element.getAttribute('title')
            || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60)
            || element.tagName;
          const text = root.innerText.trim();
          return {
            viewport: { width: innerWidth, height: innerHeight },
            theme: document.documentElement.dataset.theme || '',
            fluentTheme: document.querySelector('.storydream-provider')?.getAttribute('data-storydream-theme') || '',
            root: ownRect(root),
            rootDisplay: getComputedStyle(root).display,
            rootOpacity: getComputedStyle(root).opacity,
            text,
            textLength: text.length,
            mojibake: badPatterns.filter((pattern) => text.includes(pattern)),
            routeError: document.querySelector('.route-error-state')?.textContent?.trim() || '',
            documentHorizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            rootHorizontalOverflow: root.scrollWidth - root.clientWidth,
            clippedControls: controls
              .filter((element) => ['BUTTON', 'SELECT'].includes(element.tagName) || element.getAttribute('role') === 'tab')
              .filter((element) => element.scrollWidth - element.clientWidth > 3 || element.scrollHeight - element.clientHeight > 3)
              .filter((element) => getComputedStyle(element).textOverflow !== 'ellipsis')
              .map(label),
            controlBoundsIssues: controlsWithCenterInViewport.filter((element) => {
              const box = element.getBoundingClientRect();
              return box.left < Math.max(0, rootRect.left) - 2
                || box.right > Math.min(innerWidth, rootRect.right) + 2;
            }).map((element) => ({ label: label(element), rect: ownRect(element) })),
          };
        }""",
        list(MOJIBAKE_MARKERS),
    )


def assert_base_snapshot(snapshot: dict[str, object], label: str, minimum_text: int = 80) -> None:
    root = snapshot.get("root")
    if not isinstance(root, dict) or float(root.get("width", 0)) < 520 or float(root.get("height", 0)) < 420:
        raise AssertionError(f"{label} root is blank or collapsed: {root}")
    if int(snapshot.get("textLength", 0)) < minimum_text:
        raise AssertionError(f"{label} contains too little visible text: {snapshot.get('textLength')}")
    if snapshot.get("routeError"):
        raise AssertionError(f"{label} hit the route error boundary: {snapshot['routeError']}")
    if snapshot.get("mojibake"):
        raise AssertionError(f"{label} contains mojibake markers: {snapshot['mojibake']}")
    if int(snapshot.get("documentHorizontalOverflow", 0)) > 1 or int(snapshot.get("rootHorizontalOverflow", 0)) > 1:
        raise AssertionError(f"{label} overflows horizontally: {snapshot}")
    if snapshot.get("clippedControls"):
        raise AssertionError(f"{label} has clipped buttons or selects: {snapshot['clippedControls']}")
    if snapshot.get("controlBoundsIssues"):
        raise AssertionError(f"{label} has controls outside the visible workspace: {snapshot['controlBoundsIssues']}")


def screenshot_variance(path: Path, rect: dict[str, object] | None = None) -> float:
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        if rect:
            left = max(0, int(float(rect.get("x", 0))))
            top = max(0, int(float(rect.get("y", 0))))
            right = min(rgb.width, int(float(rect.get("right", rgb.width))))
            bottom = min(rgb.height, int(float(rect.get("bottom", rgb.height))))
            if right <= left or bottom <= top:
                return 0.0
            rgb = rgb.crop((left, top, right, bottom))
        return float(sum(ImageStat.Stat(rgb).var))


def save_capture(
    page: Page,
    report: dict[str, object],
    name: str,
    kind: str,
    state: str,
    width: int,
    height: int,
    snapshot: dict[str, object],
    critical_rect: dict[str, object] | None,
) -> None:
    path = ARTIFACTS / f"{name}-{width}x{height}.png"
    page.screenshot(path=path, full_page=False)
    viewport_variance = screenshot_variance(path)
    critical_variance = screenshot_variance(path, critical_rect)
    if viewport_variance < 180 or critical_variance < 60:
        raise AssertionError(
            f"{kind} {state} capture is visually blank: viewport={viewport_variance}, critical={critical_variance}"
        )
    snapshot.pop("text", None)
    report["captures"].append(
        {
            "name": path.name,
            "kind": kind,
            "state": state,
            "viewportVariance": viewport_variance,
            "criticalVariance": critical_variance,
            "inspection": snapshot,
        }
    )


def capture_create(
    page: Page,
    report: dict[str, object],
    name: str,
    width: int,
    height: int,
    state: str,
) -> None:
    set_window_size(page, width, height)
    root_selector = "[data-motion-comic-workbench='true'] .director-create-panel"
    page.wait_for_selector(root_selector, timeout=15_000)
    snapshot = base_snapshot(page, root_selector)
    snapshot.update(
        page.locator(root_selector).evaluate(
            r"""root => {
              const ownRect = element => {
                const value = element?.getBoundingClientRect();
                return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
              };
              const visible = element => {
                if (!element) return false;
                const style = getComputedStyle(element);
                const box = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
              };
              const form = root.querySelector('.director-create-form');
              const summary = root.querySelector('.director-create-summary');
              const serviceField = [...root.querySelectorAll('.sd-field')]
                .find(field => field.querySelector('label')?.textContent?.trim() === '图片生成服务');
              const service = serviceField?.querySelector('select');
              return {
                layout: ownRect(root.querySelector('.director-create-layout')),
                form: ownRect(form),
                summary: ownRect(summary),
                summaryVisible: visible(summary),
                steps: root.querySelectorAll('.director-create-steps > button').length,
                fields: root.querySelectorAll('input, textarea, select').length,
                providerSelect: ownRect(service),
                providerSelectEnabled: service ? !service.disabled : false,
                providerOptions: service ? [...service.options].map(option => ({ value: option.value, label: option.textContent?.trim() || '', disabled: option.disabled, selected: option.selected })) : [],
              };
            }"""
        )
    )
    assert_base_snapshot(snapshot, f"Creation page ({state}, {width}x{height})")
    if snapshot.get("steps") != 3 or int(snapshot.get("fields", 0)) < 3:
        raise AssertionError(f"Creation wizard is incomplete: {snapshot}")
    form = snapshot.get("form")
    summary = snapshot.get("summary")
    if not isinstance(form, dict) or not isinstance(summary, dict):
        raise AssertionError(f"Creation form or preflight summary is missing: {snapshot}")
    if float(form.get("right", 0)) > float(summary.get("x", 0)) + 1:
        raise AssertionError(f"Creation form overlaps its preflight summary: {snapshot}")
    if state == "service-selection":
        options = snapshot.get("providerOptions")
        enabled_options = [option for option in options if not option.get("disabled")] if isinstance(options, list) else []
        if not snapshot.get("providerSelectEnabled") or len(enabled_options) < 2:
            raise AssertionError(f"Generation service cannot be selected: {snapshot}")
    save_capture(page, report, name, "create", state, width, height, snapshot, snapshot.get("layout"))


def capture_director(
    page: Page,
    report: dict[str, object],
    name: str,
    width: int,
    height: int,
    state: str,
) -> None:
    set_window_size(page, width, height)
    page.wait_for_selector(".director-desk", timeout=15_000)
    if state == "ready-reopened":
        page.wait_for_function(
            """() => {
              const images = [...document.querySelectorAll('.director-desk .director-asset-tile img')];
              return images.length === 6 && images.every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
            }""",
            timeout=15_000,
        )
    else:
        page.wait_for_function(
            """() => document.querySelectorAll('.director-asset-missing').length === 6""",
            timeout=15_000,
        )
    if state == "ready-reopened":
        page.wait_for_timeout(750)
        page.wait_for_function(
            """() => document.querySelectorAll('.director-desk .director-media-image.is-loading, .director-desk .director-media-state.is-loading').length === 0""",
            timeout=15_000,
        )
    root_selector = ".director-desk"
    snapshot = base_snapshot(page, root_selector)
    snapshot.update(
        page.locator(root_selector).evaluate(
            r"""root => {
              const ownRect = element => {
                const value = element?.getBoundingClientRect();
                return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
              };
              const visible = element => {
                if (!element) return false;
                const style = getComputedStyle(element);
                const box = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
              };
              const grid = root.querySelector('.director-desk-grid');
              const left = root.querySelector('.director-left-pane');
              const center = root.querySelector('.director-center-pane');
              const inspector = root.querySelector('.director-inspector-pane');
              const preview = root.querySelector('.director-media-preview');
              const previewImage = preview?.querySelector('img');
              const assetImages = [...root.querySelectorAll('.director-asset-tile img')];
              const shellHidden = selector => {
                const element = document.querySelector(selector);
                return !element || getComputedStyle(element).display === 'none';
              };
              return {
                grid: ownRect(grid),
                left: ownRect(left),
                leftVisible: visible(left),
                center: ownRect(center),
                inspector: ownRect(inspector),
                inspectorVisible: visible(inspector),
                preview: ownRect(preview),
                filmstripSection: ownRect(root.querySelector('.director-filmstrip-section')),
                queue: ownRect(root.querySelector('.director-queue-panel')),
                footer: ownRect(root.querySelector('.director-status-footer')),
                shots: root.querySelectorAll('.director-shot-row').length,
                filmstrip: root.querySelectorAll('.director-filmstrip-card').length,
                assets: root.querySelectorAll('.director-asset-tile').length,
                missingAssets: root.querySelectorAll('.director-asset-missing').length,
                assetImages: assetImages.length,
                readyAssetImages: assetImages.filter(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0).length,
                loadingMediaStates: root.querySelectorAll('.director-media-image.is-loading, .director-media-state.is-loading').length,
                errorMediaStates: root.querySelectorAll('.director-media-image.is-error, .director-media-state.is-error').length,
                inspectorTabs: root.querySelectorAll('.director-inspector-pane [role="tab"]').length,
                previewImageReady: Boolean(previewImage && previewImage.complete && previewImage.naturalWidth > 0 && previewImage.naturalHeight > 0),
                workspaceShellFocused: shellHidden('.app-shell .sidebar') && shellHidden('.app-shell .page-head'),
                titleBarVisible: !shellHidden('.app-shell > .window-line'),
                gridHorizontalOverflow: grid ? grid.scrollWidth - grid.clientWidth : null,
                centerHorizontalOverflow: center ? center.scrollWidth - center.clientWidth : null,
              };
            }"""
        )
    )
    assert_base_snapshot(snapshot, f"Director Desk ({state}, {width}x{height})", minimum_text=100)
    if snapshot.get("shots") != 6 or snapshot.get("filmstrip") != 6 or snapshot.get("assets") != 6:
        raise AssertionError(f"Director Desk project content is incomplete: {snapshot}")
    if int(snapshot.get("inspectorTabs", 0)) < 4 or not snapshot.get("queue") or not snapshot.get("footer"):
        raise AssertionError(f"Director Desk inspector or status areas are incomplete: {snapshot}")
    if state == "missing" and int(snapshot.get("missingAssets", 0)) != 6:
        raise AssertionError(f"Missing-reference state is not explicit: {snapshot}")
    if not snapshot.get("workspaceShellFocused") or not snapshot.get("titleBarVisible"):
        raise AssertionError(f"Director Desk did not preserve the focused desktop shell: {snapshot}")
    if int(snapshot.get("gridHorizontalOverflow", 0)) > 1 or int(snapshot.get("centerHorizontalOverflow", 0)) > 1:
        raise AssertionError(f"Director Desk columns overflow horizontally: {snapshot}")
    left = snapshot.get("left")
    center = snapshot.get("center")
    inspector = snapshot.get("inspector")
    preview = snapshot.get("preview")
    filmstrip = snapshot.get("filmstripSection")
    if not all(isinstance(item, dict) for item in (center, inspector, preview, filmstrip)):
        raise AssertionError(f"Director Desk primary regions are missing: {snapshot}")
    compact = width == COMPACT[0]
    if compact and snapshot.get("leftVisible"):
        raise AssertionError(f"Compact Director Desk did not collapse the project pane: {snapshot}")
    if not compact:
        if not snapshot.get("leftVisible") or not isinstance(left, dict):
            raise AssertionError(f"Desktop Director Desk project pane is missing: {snapshot}")
        if float(left.get("right", 0)) > float(center.get("x", 0)) + 1:
            raise AssertionError(f"Director Desk left and center panes overlap: {snapshot}")
    if not snapshot.get("inspectorVisible") or float(center.get("right", 0)) > float(inspector.get("x", 0)) + 1:
        raise AssertionError(f"Director Desk center and inspector panes overlap: {snapshot}")
    if float(preview.get("right", 0)) > float(center.get("right", 0)) + 1 or float(preview.get("x", 0)) < float(center.get("x", 0)) - 1:
        raise AssertionError(f"Director preview escapes the center pane: {snapshot}")
    if float(filmstrip.get("y", 0)) < float(preview.get("bottom", 0)) - 1:
        raise AssertionError(f"Director filmstrip overlaps the preview: {snapshot}")
    if state == "missing":
        if snapshot.get("missingAssets") != 6 or snapshot.get("assetImages") != 0:
            raise AssertionError(f"Missing references do not render stable placeholders: {snapshot}")
    elif state == "ready-reopened":
        if snapshot.get("missingAssets") != 0 or snapshot.get("assetImages") != 6 or snapshot.get("readyAssetImages") != 6:
            raise AssertionError(f"Persisted reference thumbnails did not reopen: {snapshot}")
        if snapshot.get("loadingMediaStates") != 0 or snapshot.get("errorMediaStates") != 0:
            raise AssertionError(f"Reopened Director Desk still shows transient or failed media states: {snapshot}")
    save_capture(page, report, name, "director", state, width, height, snapshot, preview)


def set_theme(page: Page, theme: str) -> dict[str, object]:
    result = page.evaluate(
        """async theme => {
          const mutation = await window.storydream.saveUiPreferences({ theme });
          if (!mutation || mutation.kind !== 'state-patch' || mutation.patch.kind !== 'theme-preference') {
            throw new Error('Theme preference was not persisted.');
          }
          return { persistedTheme: mutation.patch.ui.theme };
        }""",
        theme,
    )
    page.wait_for_function(
        """expected => document.documentElement.dataset.theme === expected
          && document.querySelector('.storydream-provider')?.getAttribute('data-storydream-theme') === expected""",
        arg=theme,
        timeout=15_000,
    )
    page.wait_for_timeout(250)
    if result.get("persistedTheme") != theme:
        raise AssertionError(f"Theme persistence mismatch: expected={theme}, actual={result}")
    result["fluentTheme"] = page.locator(".storydream-provider").get_attribute("data-storydream-theme")
    return result


def capture_remote_video(
    page: Page,
    report: dict[str, object],
    name: str,
    width: int,
    height: int,
    theme: str,
) -> None:
    set_window_size(page, width, height)
    page.wait_for_selector(".director-desk", timeout=15_000)
    remote_tab = page.get_by_role("tab", name="远程视频", exact=True)
    expect(remote_tab).to_be_visible(timeout=15_000)
    if remote_tab.get_attribute("aria-selected") != "true":
        remote_tab.click()
    page.wait_for_selector(".motion-comic-video-readiness__checks", timeout=15_000)
    page.locator(".director-inspector-scroll").evaluate("element => { element.scrollTop = 0; }")
    page.wait_for_timeout(350)

    root_selector = ".director-desk"
    snapshot = base_snapshot(page, root_selector)
    snapshot.update(
        page.locator(".director-inspector-pane").evaluate(
            r"""root => {
              const ownRect = element => {
                const value = element?.getBoundingClientRect();
                return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
              };
              const readiness = root.querySelector('.motion-comic-video-readiness');
              const scroll = root.querySelector('.director-inspector-scroll');
              const provider = readiness?.querySelector('select');
              const mode = readiness?.querySelector('.motion-comic-video-readiness__mode');
              const modeTabs = [...(mode?.querySelectorAll('[role="tab"]') || [])];
              const remoteTab = modeTabs
                .find(tab => tab.textContent?.trim().includes('远程视频'));
              const checks = [...(readiness?.querySelectorAll('.motion-comic-video-readiness__checks > span') || [])];
              const footer = root.querySelector('.director-action-footer');
              const queue = root.querySelector('.director-queue-panel');
              const buttons = [...root.querySelectorAll('button')];
              const keyframeButton = buttons.find(button => button.textContent?.trim() === '生成关键帧');
              const videoButton = buttons.find(button => button.textContent?.trim() === '生成视频');
              return {
                inspector: ownRect(root),
                inspectorScroll: ownRect(scroll),
                readiness: ownRect(readiness),
                actionFooter: ownRect(footer),
                queue: ownRect(queue),
                mode: ownRect(mode),
                modeTabs: modeTabs.map(ownRect),
                remoteSelected: remoteTab?.getAttribute('aria-selected') === 'true',
                providerValue: provider?.value || '',
                providerOptions: provider ? [...provider.options].map(option => ({ value: option.value, label: option.textContent?.trim() || '', disabled: option.disabled })) : [],
                checkStates: checks.map(item => item.getAttribute('data-state') || ''),
                checkText: checks.map(item => item.textContent?.trim().replace(/\s+/g, ' ') || ''),
                costText: readiness?.querySelector('.motion-comic-video-readiness__cost')?.textContent?.trim().replace(/\s+/g, ' ') || '',
                runningText: readiness?.querySelector('.motion-comic-video-readiness__running')?.textContent?.trim().replace(/\s+/g, ' ') || '',
                noticeText: readiness?.querySelector('.motion-comic-video-readiness__notice')?.textContent?.trim().replace(/\s+/g, ' ') || '',
                readinessHorizontalOverflow: readiness ? readiness.scrollWidth - readiness.clientWidth : null,
                inspectorHorizontalOverflow: root.scrollWidth - root.clientWidth,
                keyframeButton: keyframeButton ? { disabled: keyframeButton.disabled, title: keyframeButton.title } : null,
                videoButton: videoButton ? { disabled: videoButton.disabled, title: videoButton.title } : null,
                checkDetailFontSize: checks[0]?.querySelector('small') ? parseFloat(getComputedStyle(checks[0].querySelector('small')).fontSize) : 0,
                costFontSize: readiness?.querySelector('.motion-comic-video-readiness__cost') ? parseFloat(getComputedStyle(readiness.querySelector('.motion-comic-video-readiness__cost')).fontSize) : 0,
              };
            }"""
        )
    )
    label = f"Remote video readiness ({theme}, {width}x{height})"
    assert_base_snapshot(snapshot, label, minimum_text=140)
    if snapshot.get("theme") != theme:
        raise AssertionError(f"{label} rendered in the wrong theme: {snapshot}")
    if not snapshot.get("remoteSelected") or snapshot.get("providerValue") != "qa-remote-video":
        raise AssertionError(f"{label} did not select the isolated remote provider: {snapshot}")
    if snapshot.get("checkStates") != ["blocked", "ready", "pending"]:
        raise AssertionError(f"{label} readiness states are incomplete: {snapshot}")
    check_text = " ".join(str(value) for value in snapshot.get("checkText", []))
    if "关键帧" not in check_text or "远程服务" not in check_text or "任务状态" not in check_text:
        raise AssertionError(f"{label} readiness labels are incomplete: {snapshot}")
    if "QA 远程视频" not in check_text or "qa-i2v-1080p" not in check_text:
        raise AssertionError(f"{label} does not identify the selected provider and model: {snapshot}")
    if "¥ 1.20" not in str(snapshot.get("costText", "")):
        raise AssertionError(f"{label} does not show the 5-second cost estimate: {snapshot}")
    mode = snapshot.get("mode")
    mode_tabs = snapshot.get("modeTabs")
    if not isinstance(mode, dict) or not isinstance(mode_tabs, list) or len(mode_tabs) != 2 or not all(isinstance(tab, dict) for tab in mode_tabs):
        raise AssertionError(f"{label} is missing its two production modes: {snapshot}")
    if abs(float(mode_tabs[0].get("width", 0)) - float(mode_tabs[1].get("width", 0))) > 2:
        raise AssertionError(f"{label} production modes do not share the available width: {snapshot}")
    if abs(float(mode_tabs[0].get("x", 0)) - float(mode.get("x", 0))) > 6 or abs(float(mode_tabs[1].get("right", 0)) - float(mode.get("right", 0))) > 6:
        raise AssertionError(f"{label} production modes leave an unintended empty segment: {snapshot}")
    if float(snapshot.get("checkDetailFontSize", 0)) < 11 or float(snapshot.get("costFontSize", 0)) < 11:
        raise AssertionError(f"{label} status or cost text is too small for desktop review: {snapshot}")
    keyframe_button = snapshot.get("keyframeButton")
    video_button = snapshot.get("videoButton")
    if not isinstance(keyframe_button, dict) or keyframe_button.get("disabled"):
        raise AssertionError(f"{label} does not keep keyframe generation available: {snapshot}")
    if not isinstance(video_button, dict) or not video_button.get("disabled") or "关键帧" not in str(video_button.get("title", "")):
        raise AssertionError(f"{label} does not explain why remote video generation is blocked: {snapshot}")
    if int(snapshot.get("readinessHorizontalOverflow", 0)) > 1 or int(snapshot.get("inspectorHorizontalOverflow", 0)) > 1:
        raise AssertionError(f"{label} overflows horizontally: {snapshot}")
    readiness = snapshot.get("readiness")
    inspector = snapshot.get("inspector")
    if not isinstance(readiness, dict) or not isinstance(inspector, dict):
        raise AssertionError(f"{label} is missing its primary regions: {snapshot}")
    if float(readiness.get("x", 0)) < float(inspector.get("x", 0)) - 1 or float(readiness.get("right", 0)) > float(inspector.get("right", 0)) + 1:
        raise AssertionError(f"{label} escapes the inspector pane: {snapshot}")
    save_capture(page, report, name, "remote-video", f"{theme}-idle", width, height, snapshot, readiness)

    if height == COMPACT[1]:
        cost = page.locator(".motion-comic-video-readiness__cost")
        cost.scroll_into_view_if_needed(timeout=15_000)
        page.wait_for_timeout(250)
        details = base_snapshot(page, root_selector)
        details.update(
            page.locator(".director-inspector-pane").evaluate(
                r"""root => {
                  const ownRect = element => {
                    const value = element?.getBoundingClientRect();
                    return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
                  };
                  const scroll = root.querySelector('.director-inspector-scroll');
                  const checks = [...root.querySelectorAll('.motion-comic-video-readiness__checks > span')];
                  return {
                    inspectorScroll: ownRect(scroll),
                    lastCheck: ownRect(checks.at(-1)),
                    cost: ownRect(root.querySelector('.motion-comic-video-readiness__cost')),
                    actionFooter: ownRect(root.querySelector('.director-action-footer')),
                    queue: ownRect(root.querySelector('.director-queue-panel')),
                    scrollTop: scroll?.scrollTop || 0,
                  };
                }"""
            )
        )
        scroll = details.get("inspectorScroll")
        last_check = details.get("lastCheck")
        cost_rect = details.get("cost")
        footer = details.get("actionFooter")
        queue = details.get("queue")
        if not all(isinstance(item, dict) for item in (scroll, last_check, cost_rect, footer, queue)):
            raise AssertionError(f"{label} compact detail regions are incomplete: {details}")
        for visible_rect in (last_check, cost_rect):
            if float(visible_rect.get("y", 0)) < float(scroll.get("y", 0)) - 1 or float(visible_rect.get("bottom", 0)) > float(scroll.get("bottom", 0)) + 1:
                raise AssertionError(f"{label} compact task status or cost is not scroll-visible: {details}")
        if float(scroll.get("bottom", 0)) > float(footer.get("y", 0)) + 1 or float(footer.get("bottom", 0)) > float(queue.get("y", 0)) + 1:
            raise AssertionError(f"{label} compact inspector regions overlap: {details}")
        save_capture(page, report, f"{name}-details", "remote-video", f"{theme}-idle-details", width, height, details, scroll)


def wait_for_first_reference_images(page: Page, expected: int) -> None:
    images = page.locator(".motion-comic-reference").first.locator("img")
    expect(images).to_have_count(expected, timeout=15_000)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        ready = images.evaluate_all(
            "nodes => nodes.every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)"
        )
        if ready:
            return
        page.wait_for_timeout(150)
    raise AssertionError("Reference thumbnails did not finish loading.")


def capture_series(
    page: Page,
    report: dict[str, object],
    name: str,
    width: int,
    height: int,
    state: str,
    expected_missing: int,
    expected_fixed: int,
    expected_unfixed: int,
    expected_versions: int,
) -> None:
    set_window_size(page, width, height)
    root_selector = "[data-motion-comic-series-bible='true']"
    page.wait_for_selector(root_selector, timeout=15_000)
    first_reference = page.locator(".motion-comic-reference").first
    first_reference.scroll_into_view_if_needed(timeout=15_000)
    page.wait_for_timeout(350)
    if state in {"ready", "unfixed"}:
        wait_for_first_reference_images(page, 2)
    if state == "broken-file":
        page.wait_for_function(
            """() => document.querySelectorAll('.motion-comic-reference-image.is-error').length === 1
              && document.body.innerText.includes('1 个固定参考文件不可用')""",
            timeout=15_000,
        )
    snapshot = base_snapshot(page, root_selector)
    snapshot.update(
        page.locator(root_selector).evaluate(
            r"""root => {
              const ownRect = element => {
                const value = element?.getBoundingClientRect();
                return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
              };
              const visible = element => {
                if (!element) return false;
                const style = getComputedStyle(element);
                const box = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
              };
              const layout = root.querySelector('.director-series-layout');
              const summary = root.querySelector('.director-series-summary');
              const editor = root.querySelector('.director-series-editor');
              const references = [...root.querySelectorAll('.motion-comic-reference')];
              const images = [...root.querySelectorAll('.motion-comic-reference-image img')];
              const layoutStyle = layout ? getComputedStyle(layout) : null;
              const editorStyle = editor ? getComputedStyle(editor) : null;
              return {
                header: ownRect(root.querySelector('.director-series-header')),
                layout: ownRect(layout),
                summary: ownRect(summary),
                summaryVisible: visible(summary),
                editor: ownRect(editor),
                firstReference: ownRect(references[0]),
                sections: root.querySelectorAll('.director-series-editor > section').length,
                references: references.length,
                missingReferences: root.querySelectorAll('[data-motion-comic-reference="missing"]').length,
                fixedReferences: root.querySelectorAll('[data-motion-comic-reference="fixed"]').length,
                unfixedReferences: root.querySelectorAll('[data-motion-comic-reference="unfixed"]').length,
                versions: root.querySelectorAll('.motion-comic-reference-version').length,
                fixedVersions: root.querySelectorAll('.motion-comic-reference-version.is-fixed').length,
                referenceImages: images.length,
                readyReferenceImages: images.filter(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0).length,
                errorReferenceImages: root.querySelectorAll('.motion-comic-reference-image.is-error').length,
                readinessText: root.querySelector('.motion-comic-readiness')?.textContent?.trim().replace(/\s+/g, ' ') || '',
                missingText: root.querySelector('.motion-comic-missing-list')?.textContent?.trim().replace(/\s+/g, ' ') || '',
                layoutColumns: layoutStyle?.gridTemplateColumns || '',
                layoutOverflowY: layoutStyle?.overflowY || '',
                editorOverflowY: editorStyle?.overflowY || '',
                editorScrollHeight: editor?.scrollHeight || 0,
                editorClientHeight: editor?.clientHeight || 0,
                layoutHorizontalOverflow: layout ? layout.scrollWidth - layout.clientWidth : null,
                editorHorizontalOverflow: editor ? editor.scrollWidth - editor.clientWidth : null,
              };
            }"""
        )
    )
    assert_base_snapshot(snapshot, f"Series Bible ({state}, {width}x{height})", minimum_text=140)
    if snapshot.get("sections") != 4 or snapshot.get("references") != 6:
        raise AssertionError(f"Series Bible sections or reference editors are incomplete: {snapshot}")
    actual_counts = (
        snapshot.get("missingReferences"),
        snapshot.get("fixedReferences"),
        snapshot.get("unfixedReferences"),
        snapshot.get("versions"),
    )
    expected_counts = (expected_missing, expected_fixed, expected_unfixed, expected_versions)
    if actual_counts != expected_counts:
        raise AssertionError(f"Series reference state mismatch: expected={expected_counts}, actual={actual_counts}")
    if int(snapshot.get("layoutHorizontalOverflow", 0)) > 1 or int(snapshot.get("editorHorizontalOverflow", 0)) > 1:
        raise AssertionError(f"Series Bible overflows horizontally: {snapshot}")
    layout = snapshot.get("layout")
    summary = snapshot.get("summary")
    editor = snapshot.get("editor")
    first_reference_rect = snapshot.get("firstReference")
    if not all(isinstance(item, dict) for item in (layout, editor, first_reference_rect)):
        raise AssertionError(f"Series Bible primary regions are missing: {snapshot}")
    if snapshot.get("summaryVisible"):
        if not snapshot.get("summaryVisible") or not isinstance(summary, dict):
            raise AssertionError(f"Series Bible summary is missing: {snapshot}")
        if float(summary.get("right", 0)) > float(editor.get("x", 0)) + 1:
            raise AssertionError(f"Series Bible columns overlap: {snapshot}")
        if snapshot.get("editorOverflowY") not in {"auto", "scroll"} or int(snapshot.get("editorScrollHeight", 0)) <= int(snapshot.get("editorClientHeight", 0)):
            raise AssertionError(f"Two-column Series Bible does not own its editor scroll: {snapshot}")
    else:
        if abs(float(editor.get("x", 0)) - float(layout.get("x", 0))) > 2 or abs(float(editor.get("width", 0)) - float(layout.get("width", 0))) > 2:
            raise AssertionError(f"Single-column Series Bible editor is horizontally clipped: {snapshot}")
        if snapshot.get("layoutOverflowY") not in {"auto", "scroll"}:
            raise AssertionError(f"Single-column Series Bible does not provide page scrolling: {snapshot}")
    readiness = str(snapshot.get("readinessText", ""))
    missing_text = str(snapshot.get("missingText", ""))
    if state == "missing":
        if "一致性素材待补充" not in readiness or "0/6 个引用目标已固定" not in readiness:
            raise AssertionError(f"Missing readiness summary is wrong: {snapshot}")
        if snapshot.get("errorReferenceImages") != 0:
            raise AssertionError(f"Missing references unexpectedly render broken images: {snapshot}")
    elif state == "ready":
        if "一致性素材已就绪" not in readiness or "6/6 个引用目标已固定" not in readiness:
            raise AssertionError(f"Ready summary is wrong: {snapshot}")
        if snapshot.get("fixedVersions") != 6 or snapshot.get("errorReferenceImages") != 0:
            raise AssertionError(f"Ready reference versions are incomplete: {snapshot}")
    elif state == "unfixed":
        if "一致性素材待补充" not in readiness or "5/6 个引用目标已固定" not in readiness:
            raise AssertionError(f"Unfixed summary is wrong: {snapshot}")
        if snapshot.get("fixedVersions") != 5 or snapshot.get("errorReferenceImages") != 0:
            raise AssertionError(f"Unfixed reference versions are wrong: {snapshot}")
    elif state == "broken-file":
        if "一致性素材待补充" not in readiness or "6/6 个引用目标已固定" not in readiness:
            raise AssertionError(f"Broken-file readiness summary is wrong: {snapshot}")
        if "1 个固定参考文件不可用" not in missing_text or snapshot.get("errorReferenceImages") != 1:
            raise AssertionError(f"Broken fixed reference was not surfaced: {snapshot}")
    save_capture(page, report, name, "series-bible", state, width, height, snapshot, first_reference_rect)


def find_created_task(page: Page) -> dict[str, object]:
    task = page.evaluate(
        """async title => {
          const result = await window.storydream.listTasks({ taskType: 'motion-comic', limit: 50 });
          const summary = result.items.find(item => item.title === title || item.name === title);
          return summary ? window.storydream.getTaskDetail(summary.id) : null;
        }""",
        PROJECT_TITLE,
    )
    if not task:
        raise AssertionError("Created AI motion-comic task could not be reloaded through the trusted API.")
    return task


def inject_reference_assets(page: Page, task_id: str, fixture_paths: list[Path]) -> dict[str, object]:
    return page.evaluate(
        """async ({ id, paths }) => {
          const task = await window.storydream.getTaskDetail(id);
          if (!task) throw new Error('Motion-comic QA task disappeared before reference injection.');
          const document = JSON.parse(task.pipelineData);
          const targets = [
            ...document.characters.flatMap(character => character.looks.map(look => ({ kind: 'look', id: look.id, label: `${character.name} · ${look.label}`, node: look }))),
            ...document.sceneAssets.map(scene => ({ kind: 'scene', id: scene.id, label: scene.label, node: scene })),
            ...document.props.map(prop => ({ kind: 'prop', id: prop.id, label: prop.label, node: prop })),
          ];
          if (targets.length !== 6 || paths.length !== 7) {
            throw new Error(`Unexpected QA target/fixture count: ${targets.length}/${paths.length}`);
          }
          const imported = [];
          let pathIndex = 0;
          for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
            const target = targets[targetIndex];
            const versionsForTarget = targetIndex === 0 ? 2 : 1;
            for (let versionIndex = 0; versionIndex < versionsForTarget; versionIndex += 1) {
              const sourcePath = paths[pathIndex++];
              const mutation = await window.storydream.addImageLabRecord({
                prompt: `AI 漫剧一致性参考图 · ${target.label} · v${versionIndex + 1}`,
                ratio: document.ratio,
                style: 'reference',
                provider: 'local-import',
                imagePath: sourcePath,
                resolution: '2K',
                quality: 'high',
                smartMode: 'reference-edit',
                upstreamTaskId: id,
              });
              const recordId = mutation?.kind === 'state-patch' && mutation.patch.kind === 'image-lab-upsert'
                ? mutation.patch.record.id
                : '';
              const record = recordId ? await window.storydream.getImageLabRecordDetail(recordId) : null;
              if (!record || record.status !== 'generated' || !record.imagePath) {
                throw new Error(`Managed reference import failed for ${target.kind}:${target.id}`);
              }
              const asset = {
                id: `motion-comic-reference-${record.id}`,
                assetId: `motion-comic-reference-${target.kind}-${target.id}`,
                kind: 'image',
                uri: `storydream:image-lab/${record.id}`,
                localPath: record.imagePath,
                prompt: record.prompt,
                provider: 'local-import',
                model: 'managed-reference',
                license: '版权待确认',
                createdAt: record.finishedAt ?? record.createdAt,
                selected: true,
                pinned: true,
              };
              const currentIds = target.node.referenceAssetVersionIds ?? [];
              const targetIds = new Set([...currentIds, asset.id]);
              document.assets = document.assets
                .map(candidate => targetIds.has(candidate.id) ? { ...candidate, selected: false, pinned: false } : candidate)
                .filter(candidate => candidate.id !== asset.id);
              document.assets.push(asset);
              target.node.referenceAssetVersionIds = [...new Set([...currentIds, asset.id])];
              imported.push({ target: `${target.kind}:${target.id}`, assetId: asset.id, fileName: record.imagePath.split(/[\\/]/).pop() });
            }
          }
          await window.storydream.saveMotionComic({ id, expectedUpdatedAt: document.updatedAt, document });
          const savedTask = await window.storydream.getTaskDetail(id);
          if (!savedTask) throw new Error('Motion-comic QA task disappeared after reference injection.');
          const saved = JSON.parse(savedTask.pipelineData);
          const savedTargets = [
            ...saved.characters.flatMap(character => character.looks.map(look => ({ id: look.id, refs: look.referenceAssetVersionIds }))),
            ...saved.sceneAssets.map(scene => ({ id: scene.id, refs: scene.referenceAssetVersionIds })),
            ...saved.props.map(prop => ({ id: prop.id, refs: prop.referenceAssetVersionIds })),
          ];
          const fixed = savedTargets.map(target => saved.assets.find(asset => target.refs.includes(asset.id) && asset.selected && asset.pinned));
          return {
            imported,
            targetCount: savedTargets.length,
            versionCount: savedTargets.reduce((total, target) => total + target.refs.length, 0),
            fixedCount: fixed.filter(Boolean).length,
            firstTargetVersionIds: savedTargets[0].refs,
          };
        }""",
        {"id": task_id, "paths": [str(path) for path in fixture_paths]},
    )


def persisted_consistency_snapshot(page: Page, task_id: str) -> dict[str, object]:
    return page.evaluate(
        """async id => {
          const task = await window.storydream.getTaskDetail(id);
          if (!task) return null;
          const document = JSON.parse(task.pipelineData);
          const targets = [
            ...document.characters.flatMap(character => character.looks.map(look => ({ id: look.id, refs: look.referenceAssetVersionIds }))),
            ...document.sceneAssets.map(scene => ({ id: scene.id, refs: scene.referenceAssetVersionIds })),
            ...document.props.map(prop => ({ id: prop.id, refs: prop.referenceAssetVersionIds })),
          ];
          const fixed = targets.map(target => document.assets.find(asset => target.refs.includes(asset.id) && asset.selected && asset.pinned));
          return {
            title: document.title,
            targetCount: targets.length,
            versionCount: targets.reduce((total, target) => total + target.refs.length, 0),
            fixedCount: fixed.filter(Boolean).length,
            fixedFileNames: fixed.filter(Boolean).map(asset => asset.localPath?.split(/[\\/]/).pop() || ''),
            firstTargetVersionIds: targets[0]?.refs ?? [],
            firstTargetFixedId: fixed[0]?.id ?? '',
          };
        }""",
        task_id,
    )


def break_first_fixed_reference(page: Page, task_id: str, missing_path: Path) -> dict[str, object]:
    if missing_path.exists():
        missing_path.unlink()
    return page.evaluate(
        """async ({ id, missingPath }) => {
          const task = await window.storydream.getTaskDetail(id);
          if (!task) throw new Error('Motion-comic QA task disappeared before broken-file injection.');
          const document = JSON.parse(task.pipelineData);
          const firstLook = document.characters[0]?.looks[0];
          const fixed = document.assets.find(asset => firstLook?.referenceAssetVersionIds.includes(asset.id) && asset.selected && asset.pinned);
          if (!firstLook || !fixed) throw new Error('No fixed first reference is available to break.');
          document.assets = document.assets.map(asset => asset.id === fixed.id ? { ...asset, localPath: missingPath } : asset);
          await window.storydream.saveMotionComic({ id, expectedUpdatedAt: document.updatedAt, document });
          return { assetId: fixed.id, missingFileName: missingPath.split(/[\\/]/).pop() };
        }""",
        {"id": task_id, "missingPath": str(missing_path)},
    )


def reopen_project_from_history(page: Page, switch_through_vox: bool) -> None:
    if page.locator(".director-desk").is_visible():
        back = page.locator(".director-desk-header button[aria-label^='返回']").first
        expect(back).to_be_visible(timeout=15_000)
        back.click()
        page.wait_for_function("() => !document.querySelector('.director-desk')", timeout=30_000)
        if not page.locator("[data-task-operations='history']").is_visible():
            navigate_sidebar(page, "history", "[data-task-operations='history']")
    elif page.locator("[data-motion-comic-series-bible='true']").is_visible():
        navigate_sidebar(page, "history", "[data-task-operations='history']")
    elif not page.locator("[data-task-operations='history']").is_visible():
        navigate_sidebar(page, "history", "[data-task-operations='history']")

    if switch_through_vox:
        navigate_sidebar(page, "editorial-collage", "[data-editorial-collage-workbench='true']")
        navigate_sidebar(page, "history", "[data-task-operations='history']")

    search = page.get_by_role("textbox", name="搜索历史记录")
    expect(search).to_be_visible(timeout=15_000)
    search.fill(PROJECT_TITLE)
    open_button = page.get_by_role("button", name=f"打开任务 {PROJECT_TITLE}", exact=True)
    expect(open_button).to_be_visible(timeout=15_000)
    open_button.click()
    page.wait_for_selector("[data-motion-comic-workbench='true'] .director-desk", timeout=30_000)
    expect(page.locator(".director-project-menu").get_by_text(PROJECT_TITLE, exact=True)).to_be_visible(timeout=15_000)


def open_series_bible(page: Page) -> None:
    page.get_by_role("button", name="文案", exact=True).click()
    page.wait_for_selector("[data-motion-comic-series-bible='true']", timeout=15_000)
    expect(page.get_by_role("button", name="返回导演台", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="保存系列圣经", exact=True)).to_be_visible()


def create_offline_electron_entry(profile: Path) -> Path:
    """Launch the production bundle behind a main-process external-fetch guard."""
    audit_path = profile / "network-audit.jsonl"
    hook_path = profile / "offline-main.cjs"
    hook_path.write_text(
        "const fs = require('node:fs');\n"
        "const path = require('node:path');\n"
        "const { pathToFileURL } = require('node:url');\n"
        "const { app } = require('electron');\n"
        f"const appRoot = {json.dumps(str(ROOT))};\n"
        f"const auditPath = {json.dumps(str(audit_path))};\n"
        "app.setAppPath(appRoot);\n"
        "const append = value => fs.appendFileSync(auditPath, JSON.stringify(value) + '\\n', 'utf8');\n"
        "const originalFetch = globalThis.fetch.bind(globalThis);\n"
        "globalThis.fetch = (input, init = {}) => {\n"
        "  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;\n"
        "  const url = new URL(raw);\n"
        "  if (!['http:', 'https:'].includes(url.protocol) || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {\n"
        "    return originalFetch(input, init);\n"
        "  }\n"
        "  append({ kind: 'blocked-external-fetch', method: init.method || 'GET', url: url.href });\n"
        "  return Promise.reject(new Error('QA_EXTERNAL_FETCH_BLOCKED: ' + url.origin));\n"
        "};\n"
        "import(pathToFileURL(path.join(appRoot, 'dist-electron/electron/main.js')).href);\n",
        encoding="utf-8",
    )
    (profile / "package.json").write_text(
        json.dumps({"name": "storydream-motion-comic-qa", "version": "1.0.0", "main": hook_path.name}),
        encoding="utf-8",
    )
    return audit_path


def read_json_lines(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    records: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            records.append(json.loads(line))
    return records


def external_http_url(url: str) -> bool:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}


def inspect_workflow_navigation(page: Page, expected_stage: str | None = None) -> dict[str, object]:
    navigation = page.locator(".motion-comic-production__stages")
    expect(navigation).to_be_visible(timeout=15_000)
    snapshot = navigation.evaluate(
        r"""nav => {
          const rect = element => {
            const value = element?.getBoundingClientRect();
            return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
          };
          const buttons = [...nav.querySelectorAll(':scope > button')];
          const body = document.querySelector('.motion-comic-production__body');
          return {
            labels: buttons.map(button => button.getAttribute('aria-label') || ''),
            texts: buttons.map(button => button.textContent?.trim().replace(/\s+/g, ' ') || ''),
            disabled: buttons.map(button => button.disabled),
            current: buttons.map(button => button.getAttribute('aria-current') || ''),
            clipped: buttons.map(button => button.scrollWidth - button.clientWidth > 3 || button.scrollHeight - button.clientHeight > 3),
            nav: rect(nav),
            body: rect(body),
            overflow: nav.scrollWidth - nav.clientWidth,
            stage: document.querySelector('[data-motion-comic-production]')?.getAttribute('data-stage') || '',
          };
        }"""
    )
    expected_labels = ("剧本导入", "分集拆解", "分幕分场", "角色资产", "分镜图", "视频生成", "配音合成", "成片导出")
    labels = snapshot.get("labels")
    if not isinstance(labels, list) or len(labels) != len(expected_labels):
        raise AssertionError(f"Eight-stage workflow navigation is incomplete: {snapshot}")
    for label, expected_label in zip(labels, expected_labels, strict=True):
        if expected_label not in str(label):
            raise AssertionError(f"Workflow stage order is incorrect: {snapshot}")
    if any(bool(value) for value in snapshot.get("clipped", [])):
        raise AssertionError(f"Workflow stage buttons are clipped: {snapshot}")
    if int(snapshot.get("overflow", 0)) > 1:
        raise AssertionError(f"Workflow stage navigation overflows horizontally: {snapshot}")
    nav_rect = snapshot.get("nav")
    body_rect = snapshot.get("body")
    if not isinstance(nav_rect, dict) or not isinstance(body_rect, dict) or float(nav_rect.get("bottom", 0)) > float(body_rect.get("y", 0)) + 1:
        raise AssertionError(f"Workflow navigation overlaps the active stage: {snapshot}")
    if expected_stage and snapshot.get("stage") != expected_stage:
        raise AssertionError(f"Expected workflow stage {expected_stage}, got: {snapshot}")
    if expected_stage and snapshot.get("current", []).count("step") != 1:
        raise AssertionError(f"Workflow navigation must expose one current step: {snapshot}")
    return snapshot


def inspect_director_workspace_layout(page: Page, expected_stage: str) -> dict[str, object]:
    root = page.locator(".director-desk")
    snapshot = root.evaluate(
        r"""root => {
          const rect = element => {
            const value = element?.getBoundingClientRect();
            return value ? {
              x: value.x,
              y: value.y,
              width: value.width,
              height: value.height,
              right: value.right,
              bottom: value.bottom,
            } : null;
          };
          const viewportIntersection = element => {
            const value = element?.getBoundingClientRect();
            if (!value) return 0;
            const width = Math.max(0, Math.min(value.right, window.innerWidth) - Math.max(value.left, 0));
            const height = Math.max(0, Math.min(value.bottom, window.innerHeight) - Math.max(value.top, 0));
            return width * height;
          };
          const grid = root.querySelector('.director-desk-grid');
          const center = root.querySelector('.director-center-pane');
          const preview = root.querySelector('.director-preview-surface');
          const inspector = root.querySelector('.director-inspector-pane');
          return {
            root: rect(root),
            grid: rect(grid),
            center: rect(center),
            preview: rect(preview),
            inspector: rect(inspector),
            gridClientHeight: grid?.clientHeight || 0,
            gridScrollHeight: grid?.scrollHeight || 0,
            centerIntersection: viewportIntersection(center),
            previewIntersection: viewportIntersection(preview),
            inspectorIntersection: viewportIntersection(inspector),
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
        }"""
    )
    root_rect = snapshot.get("root")
    grid_rect = snapshot.get("grid")
    center_rect = snapshot.get("center")
    preview_rect = snapshot.get("preview")
    inspector_rect = snapshot.get("inspector")
    if not all(isinstance(value, dict) for value in (root_rect, grid_rect, center_rect, preview_rect, inspector_rect)):
        raise AssertionError(f"{expected_stage} director workspace is missing a required pane: {snapshot}")
    root_height = float(root_rect.get("height", 0))
    grid_height = float(grid_rect.get("height", 0))
    minimum_grid_height = max(240.0, root_height * 0.55)
    if grid_height < minimum_grid_height:
        raise AssertionError(
            f"{expected_stage} director workspace body collapsed to {grid_height:.1f}px; "
            f"expected at least {minimum_grid_height:.1f}px: {snapshot}"
        )
    if float(center_rect.get("height", 0)) < minimum_grid_height - 2:
        raise AssertionError(f"{expected_stage} director preview pane does not fill the workspace body: {snapshot}")
    if float(inspector_rect.get("height", 0)) < minimum_grid_height - 2:
        raise AssertionError(f"{expected_stage} director inspector does not fill the workspace body: {snapshot}")
    if float(snapshot.get("centerIntersection", 0)) <= 0 or float(snapshot.get("previewIntersection", 0)) <= 0:
        raise AssertionError(f"{expected_stage} director preview is outside the visible viewport: {snapshot}")
    if float(snapshot.get("inspectorIntersection", 0)) <= 0:
        raise AssertionError(f"{expected_stage} director inspector is outside the visible viewport: {snapshot}")
    return snapshot


def capture_surface_matrix(
    page: Page,
    report: dict[str, object],
    slug: str,
    kind: str,
    state: str,
    root_selector: str,
    expected_text: tuple[str, ...],
    expected_stage: str | None = None,
    minimum_text: int = 80,
) -> None:
    for theme in THEMES:
        set_theme(page, theme)
        for viewport_name, (width, height) in VIEWPORTS:
            set_window_size(page, width, height)
            root = page.locator(root_selector)
            expect(root).to_be_visible(timeout=15_000)
            page.wait_for_timeout(200)
            snapshot = base_snapshot(page, root_selector)
            assert_base_snapshot(snapshot, f"{kind} {state} ({theme}, {width}x{height})", minimum_text)
            if snapshot.get("theme") != theme:
                raise AssertionError(f"Theme did not apply to {kind} {state}: {snapshot}")
            if snapshot.get("fluentTheme") != theme:
                raise AssertionError(f"Fluent theme did not apply to {kind} {state}: {snapshot}")
            visible_text = str(snapshot.get("text", ""))
            missing_text = [value for value in expected_text if value not in visible_text]
            if missing_text:
                raise AssertionError(f"{kind} {state} is missing expected text {missing_text}: {visible_text[:600]}")
            if expected_stage:
                snapshot["workflowNavigation"] = inspect_workflow_navigation(page, expected_stage)
            if expected_stage == "episodes" and theme == "light":
                selected_color = page.locator(".motion-comic-source-episode-item.is-selected .motion-comic-ep-title").evaluate("element => getComputedStyle(element).color")
                if selected_color in ("rgb(255, 255, 255)", "rgba(255, 255, 255, 1)"):
                    raise AssertionError("Selected episode title is white on a light selected surface")
            if root_selector == ".director-desk" and expected_stage:
                snapshot["directorWorkspace"] = inspect_director_workspace_layout(page, expected_stage)
            if kind == "create":
                footer = page.locator(".motion-comic-create__footer")
                bounds = footer.bounding_box()
                if not bounds or bounds["y"] < 0 or bounds["y"] + bounds["height"] > height + 1:
                    raise AssertionError(f"Create actions are outside the viewport: {bounds}")
                snapshot["fixedCreateActions"] = bounds
            scroll_selector = {
                "source": ".motion-comic-source-panel__layout",
                "episodes": ".motion-comic-episode-source-detail",
                "scenes": ".motion-comic-scenes-board",
            }.get(expected_stage or "")
            if scroll_selector and page.locator(scroll_selector).count():
                scroll = page.locator(scroll_selector).evaluate("""element => {
                  const before = element.scrollTop;
                  element.scrollTop = element.scrollHeight;
                  const result = { overflow: element.scrollHeight - element.clientHeight,
                    reached: element.scrollTop, height: element.clientHeight, overflowY: getComputedStyle(element).overflowY };
                  element.scrollTop = before;
                  return result;
                }""")
                if scroll["height"] < 100 or (scroll["overflow"] > 3 and scroll["reached"] < scroll["overflow"] - 2):
                    raise AssertionError(f"Stage content cannot scroll to the bottom: {scroll}")
                snapshot["scrollReachability"] = scroll
            capture_number = len(report["captures"]) + 1
            save_capture(
                page,
                report,
                f"{capture_number:02d}-{slug}-{theme}-{viewport_name}",
                kind,
                f"{state}-{theme}",
                width,
                height,
                snapshot,
                snapshot.get("root") if isinstance(snapshot.get("root"), dict) else None,
            )


def capture_asset_entry_matrix(page: Page, report: dict[str, object]) -> None:
    root_selector = "[data-motion-comic-series-bible='true']"
    evidence: list[dict[str, object]] = []
    for theme in THEMES:
        set_theme(page, theme)
        for viewport_name, (width, height) in VIEWPORTS:
            set_window_size(page, width, height)
            root = page.locator(root_selector)
            expect(root).to_be_visible(timeout=15_000)
            for entry_kind, label in ASSET_ENTRY_SPECS:
                button = page.get_by_role("button", name=label, exact=True)
                expect(button).to_have_count(1)
                button.scroll_into_view_if_needed(timeout=15_000)
                expect(button).to_be_visible(timeout=15_000)
                expect(button).to_be_enabled(timeout=15_000)
                page.wait_for_timeout(150)
                entry = button.evaluate(
                    r"""button => {
                      const rect = element => {
                        const value = element?.getBoundingClientRect();
                        return value ? {
                          x: value.x,
                          y: value.y,
                          width: value.width,
                          height: value.height,
                          right: value.right,
                          bottom: value.bottom,
                        } : null;
                      };
                      return {
                        label: button.textContent?.trim().replace(/\s+/g, ' ') || '',
                        disabled: button.disabled,
                        button: rect(button),
                        heading: rect(button.closest('.director-series-section-heading')),
                        viewport: { width: innerWidth, height: innerHeight },
                      };
                    }"""
                )
                button_rect = entry.get("button")
                heading_rect = entry.get("heading")
                if not isinstance(button_rect, dict) or not isinstance(heading_rect, dict):
                    raise AssertionError(f"Asset entry {label} is missing its visible heading: {entry}")
                if (
                    float(button_rect.get("x", -1)) < -1
                    or float(button_rect.get("y", -1)) < -1
                    or float(button_rect.get("right", width + 2)) > width + 1
                    or float(button_rect.get("bottom", height + 2)) > height + 1
                ):
                    raise AssertionError(
                        f"Asset entry {label} is outside the {width}x{height} viewport in {theme}: {entry}"
                    )
                snapshot = base_snapshot(page, root_selector)
                assert_base_snapshot(
                    snapshot,
                    f"asset entry {label} ({theme}, {width}x{height})",
                    minimum_text=120,
                )
                if snapshot.get("theme") != theme:
                    raise AssertionError(f"Asset entry {label} rendered in the wrong theme: {snapshot}")
                if snapshot.get("fluentTheme") != theme:
                    raise AssertionError(f"Asset entry {label} rendered with the wrong Fluent theme: {snapshot}")
                snapshot["assetEntry"] = entry
                snapshot["workflowNavigation"] = inspect_workflow_navigation(page, "assets")
                capture_number = len(report["captures"]) + 1
                save_capture(
                    page,
                    report,
                    f"{capture_number:02d}-stage-assets-{entry_kind}-{theme}-{viewport_name}",
                    "workflow-asset-entry",
                    f"assets-{entry_kind}-{theme}",
                    width,
                    height,
                    snapshot,
                    heading_rect,
                )
                evidence.append(
                    {
                        "kind": entry_kind,
                        "label": label,
                        "theme": theme,
                        "viewport": {"name": viewport_name, "width": width, "height": height},
                        "visible": True,
                        "enabled": not bool(entry.get("disabled")),
                    }
                )
    report["stateAssertions"]["assetEntryVisibility"] = evidence


def add_and_persist_manual_assets(
    page: Page,
    task_id: str,
    before: dict[str, object],
) -> dict[str, object]:
    set_window_size(page, *DESKTOP)
    set_theme(page, "dark")
    expected_controls = (
        ("新增人物", "角色 2", "人物 2", 1),
        ("新增场景", "场景名称", "场景 2", 2),
        ("新增道具", "道具名称", "道具 2", 2),
    )
    for button_label, field_label, field_value, field_count in expected_controls:
        button = page.get_by_role("button", name=button_label, exact=True)
        button.scroll_into_view_if_needed(timeout=15_000)
        expect(button).to_be_visible(timeout=15_000)
        expect(button).to_be_enabled(timeout=15_000)
        button.click()
        fields = page.get_by_role("textbox", name=field_label, exact=True)
        expect(fields).to_have_count(field_count, timeout=15_000)
        expect(fields.last).to_have_value(field_value, timeout=15_000)

    save_button = page.get_by_role("button", name="保存", exact=True)
    expect(save_button).to_be_enabled(timeout=15_000)
    save_button.click()
    save_state = page.locator(".motion-comic-production__save-state")
    expect(save_state).to_have_attribute("data-dirty", "false", timeout=15_000)
    expect(save_state).to_have_text("已保存", timeout=15_000)

    after = persisted_workflow_snapshot(page, task_id)
    expected_counts = {
        "characterCount": int(before.get("characterCount", 0)) + 1,
        "sceneAssetCount": int(before.get("sceneAssetCount", 0)) + 1,
        "propCount": int(before.get("propCount", 0)) + 1,
    }
    actual_counts = {key: after.get(key) for key in expected_counts}
    if actual_counts != expected_counts:
        raise AssertionError(
            f"Manual asset additions were not persisted: before={before}, after={after}, expected={expected_counts}"
        )
    before_jobs = before.get("providerJobs")
    after_jobs = after.get("providerJobs")
    if before_jobs != after_jobs:
        raise AssertionError(f"Manual asset additions created provider jobs: before={before_jobs}, after={after_jobs}")
    if after.get("estimatedCost") != before.get("estimatedCost") or after.get("actualCost") != before.get("actualCost"):
        raise AssertionError(f"Manual asset additions changed generation cost: before={before}, after={after}")
    return {
        "before": {key: before.get(key) for key in expected_counts},
        "after": actual_counts,
        "providerJobsUnchanged": True,
        "generationCostUnchanged": True,
    }


def assert_create_step(page: Page, expected_step: int) -> None:
    root = page.locator("[data-motion-comic-create-flow]")
    expect(root).to_have_attribute("data-step", str(expected_step), timeout=15_000)
    steps = root.locator(".motion-comic-create__steps > button")
    expect(steps).to_have_count(3)
    labels = [steps.nth(index).inner_text().strip() for index in range(3)]
    if labels != ["剧本导入", "分集确认", "创建项目"]:
        raise AssertionError(f"Creation steps are out of order: {labels}")


def seed_structured_motion_comic(page: Page, task_id: str, image_path: Path, video_path: Path) -> dict[str, object]:
    return page.evaluate(
        r"""async ({ id, imagePath, videoPath }) => {
          const task = await window.storydream.getTaskDetail(id);
          if (!task) throw new Error('QA motion-comic project is missing.');
          const document = JSON.parse(task.pipelineData);
          const sourceEpisode = document.sourceDocument?.episodes?.[0];
          const episode = document.episodes?.[0];
          if (!sourceEpisode || !episode || episode.scenes.length !== 0) {
            throw new Error('QA expected a source-backed empty first episode.');
          }
          const now = document.updatedAt;
          const characterId = `qa-character-${id}`;
          const lookId = `qa-look-${id}`;
          const sceneAssetId = `qa-scene-${id}`;
          const propId = `qa-prop-${id}`;
          const referenceAssets = [
            { id: `qa-reference-look-${id}`, assetId: `qa-reference-look-${id}` },
            { id: `qa-reference-scene-${id}`, assetId: `qa-reference-scene-${id}` },
            { id: `qa-reference-prop-${id}`, assetId: `qa-reference-prop-${id}` },
          ].map(asset => ({ ...asset, kind: 'image', localPath: imagePath, provider: 'qa-local-fixture', model: 'offline-fixture', createdAt: now, selected: true, pinned: true }));
          const firstFrame = {
            id: `qa-first-frame-${id}`, assetId: `shot-keyframe-${id}`, kind: 'image', localPath: imagePath,
            provider: 'qa-local-fixture', model: 'offline-fixture', createdAt: now, selected: true,
          };
          document.characters = [{
            id: characterId, name: '林夏', role: '追查未来来信真相的主角',
            identityPrompt: 'young Chinese woman, short dark hair, stable face identity',
            personality: '冷静、敏锐', voiceNotes: '克制、清晰',
            looks: [{ id: lookId, characterId, label: '雨夜造型', appearancePrompt: 'short dark hair, focused gaze',
              wardrobe: '深色防雨外套', continuityNotes: '固定发型、面部比例与衣领',
              referenceAssetVersionIds: [referenceAssets[0].id], pinned: true }],
          }];
          document.sceneAssets = [{
            id: sceneAssetId, label: '旧城邮局与钟楼', description: '持续下雨的旧城街区',
            prompt: 'cinematic rainy old town post office and clock tower', continuityNotes: '固定路灯方向、雨势和钟楼轮廓',
            referenceAssetVersionIds: [referenceAssets[1].id],
          }];
          document.props = [{
            id: propId, label: '来自未来的信', description: '带有十年后邮戳的信封',
            prompt: 'aged envelope with a future postmark, no readable generated text',
            referenceAssetVersionIds: [referenceAssets[2].id],
          }];
          document.series = {
            ...document.series,
            characterIds: [characterId], sceneAssetIds: [sceneAssetId], propAssetIds: [propId],
          };
          const acts = [
            { title: '来信', summary: '林夏在雨夜收到来自未来的信。', actTitle: '开端' },
            { title: '核对', summary: '她循着邮戳找到周沉并核对警告。', actTitle: '对抗' },
            { title: '钟楼', summary: '两人在天亮前赶向钟楼。', actTitle: '收束' },
          ];
          let offset = 0;
          const jobs = [];
          const videoAssets = [];
          const scenes = acts.map((act, index) => {
            const sceneId = `qa-scene-${id}-${index + 1}`;
            const shotId = `qa-shot-${id}-${index + 1}`;
            const jobId = `qa-video-job-${id}-${index + 1}`;
            const videoAssetId = `qa-video-asset-${id}-${index + 1}`;
            jobs.push({
              id: jobId, workflowKind: 'motion-comic', nodeId: shotId, providerId: 'qa-offline-fixture',
              model: 'no-call', capability: 'image-to-video', status: 'completed', inputHash: `qa-${index + 1}`,
              idempotencyKey: `qa-offline-${id}-${index + 1}`, estimatedCost: 0, actualCost: 0, attempt: 1,
              createdAt: now, updatedAt: now, episodeId: episode.id,
            });
            videoAssets.push({
              id: videoAssetId, assetId: `shot-video-${shotId}`, kind: 'video', providerJobId: jobId,
              provider: 'qa-offline-fixture', model: 'no-call', createdAt: now, selected: true, episodeId: episode.id,
              durationMs: 5000, localPath: videoPath,
            });
            const shot = {
              id: shotId, episodeId: episode.id, sceneId, index: 1, title: act.title, durationMs: 5000,
              prompt: `${act.summary}，保持林夏、旧城邮局和未来来信的一致性。`,
              motionPrompt: 'slow camera push, restrained rain and breathing motion', framing: index === 0 ? '中景建立' : '近景推进',
              characterLookIds: [lookId], sceneAssetId, propAssetIds: [propId],
              firstFrameAssetVersionId: firstFrame.id, renderStrategy: 'remote-video',
              videoAssetVersionId: videoAssetId, videoJobId: jobId, dialogueCueIds: [],
            };
            const scene = { id: sceneId, episodeId: episode.id, index: index + 1, actIndex: index + 1,
              actTitle: act.actTitle, actBoundaryReason: `QA 离线规划：${act.summary}`,
              actSource: 'ai-planned', title: act.title, summary: act.summary, locationAssetId: sceneAssetId, shots: [shot] };
            offset += shot.durationMs;
            return scene;
          });
          episode.title = '雨夜来信';
          episode.logline = '一封来自十年后的信迫使林夏在天亮前阻止周沉进入钟楼。';
          episode.script = sourceEpisode.sourceText;
          episode.status = 'boarded';
          episode.scenes = scenes;
          episode.dialogueCues = [];
          episode.planningEvidence = {
            version: 1, sourceText: sourceEpisode.sourceText, sourceEpisodeId: sourceEpisode.id,
            sourceUnits: [{ id: 'S1', text: sourceEpisode.sourceText }], model: 'qa-offline-structure', createdAt: now,
            targetDurationSec: 15, beats: [], shotClaims: [],
          };
          let cursor = 0;
          episode.timeline = {
            durationMs: offset,
            clips: scenes.map(scene => {
              const shot = scene.shots[0];
              const clip = { id: `clip-${shot.id}`, shotId: shot.id, startMs: cursor, durationMs: shot.durationMs,
                assetVersionIds: [firstFrame.id], subtitleCueIds: [], source: 'ai-video' };
              cursor += shot.durationMs;
              return clip;
            }),
            audioAssetVersionIds: [],
          };
          document.stage = 'shot-board';
          document.activeEpisodeId = episode.id;
          document.episodes = [episode];
          document.assets = [...referenceAssets, firstFrame, ...videoAssets];
          document.providerJobs = jobs;
          document.estimatedCost = 0;
          delete document.actualCost;
          const mutation = await window.storydream.saveMotionComic({ id, expectedUpdatedAt: document.updatedAt, document });
          if (!mutation) throw new Error('QA structured fixture was not saved.');
          const savedTask = await window.storydream.getTaskDetail(id);
          const saved = JSON.parse(savedTask.pipelineData);
          return {
            sourceEpisodes: saved.sourceDocument.episodes.length,
            structuredEpisodes: saved.episodes.filter(item => item.scenes.length > 0).length,
            acts: saved.episodes[0].scenes.map(scene => scene.actIndex),
            shots: saved.episodes[0].scenes.flatMap(scene => scene.shots).length,
            referenceAssets: saved.assets.filter(asset => asset.kind === 'image').length,
            syntheticProviderJobs: saved.providerJobs.map(job => ({ id: job.id, providerId: job.providerId, actualCost: job.actualCost })),
          };
        }""",
        {"id": task_id, "imagePath": str(image_path), "videoPath": str(video_path)},
    )


def reopen_created_project(page: Page) -> None:
    navigate_sidebar(page, "history", "[data-task-operations='history']")
    search = page.get_by_role("textbox", name="搜索历史记录")
    expect(search).to_be_visible(timeout=15_000)
    search.fill(PROJECT_TITLE)
    open_button = page.get_by_role("button", name=f"打开任务 {PROJECT_TITLE}", exact=True)
    expect(open_button).to_be_visible(timeout=15_000)
    open_button.click()
    page.wait_for_selector("[data-motion-comic-production]", timeout=30_000)


def select_workflow_stage(page: Page, index: int, stage: str, root_selector: str) -> None:
    buttons = page.locator(".motion-comic-production__stages > button")
    expect(buttons).to_have_count(8)
    button = buttons.nth(index)
    expect(button).to_be_enabled(timeout=15_000)
    button.click()
    page.wait_for_selector(f"[data-motion-comic-production][data-stage='{stage}']", timeout=15_000)
    expect(page.locator(root_selector)).to_be_visible(timeout=15_000)
    inspect_workflow_navigation(page, stage)


def persisted_workflow_snapshot(page: Page, task_id: str) -> dict[str, object]:
    return page.evaluate(
        """async id => {
          const task = await window.storydream.getTaskDetail(id);
          const document = JSON.parse(task.pipelineData);
          return {
            providerJobs: document.providerJobs.map(job => ({ id: job.id, providerId: job.providerId, capability: job.capability, actualCost: job.actualCost })),
            characterCount: document.characters.length,
            sceneAssetCount: document.sceneAssets.length,
            propCount: document.props.length,
            sourceEpisodeCount: document.sourceDocument?.episodes.length || 0,
            structuredEpisodeCount: document.episodes.filter(episode => episode.scenes.length > 0).length,
            sceneCount: document.episodes.flatMap(episode => episode.scenes).length,
            shotCount: document.episodes.flatMap(episode => episode.scenes.flatMap(scene => scene.shots)).length,
            remoteOnly: document.episodes.flatMap(episode => episode.scenes.flatMap(scene => scene.shots)).every(shot => shot.renderStrategy === 'remote-video'),
            estimatedCost: document.estimatedCost,
            actualCost: document.actualCost || 0,
          };
        }""",
        task_id,
    )


def legacy_main() -> None:
    clean_artifacts()
    qa_temp_root = ROOT / ".codex-audit-temp"
    qa_temp_root.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="motion-comic-electron-", dir=qa_temp_root))
    fixture_paths = create_reference_fixtures(profile / "qa-reference-inputs")
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
    runtime_errors: list[dict[str, str]] = []
    report: dict[str, object] = {
        "status": "running",
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "processId": process.pid,
        "viewports": [
            {"name": "desktop", "width": DESKTOP[0], "height": DESKTOP[1]},
            {"name": "compact", "width": COMPACT[0], "height": COMPACT[1]},
        ],
        "runtimeErrors": runtime_errors,
        "interactions": {},
        "stateAssertions": {},
        "captures": [],
    }
    page: Page | None = None
    browser = None
    try:
        endpoint = wait_for_cdp(port, process)
        playwright = sync_playwright().start()
        try:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            context = browser.contexts[0]
            page = context.pages[0]
            video_network_requests: list[dict[str, str]] = []
            page.on("pageerror", lambda error: runtime_errors.append({"type": "pageerror", "message": str(error)}))
            page.on(
                "console",
                lambda message: runtime_errors.append({"type": "console", "message": message.text})
                if message.type == "error"
                else None,
            )
            page.on(
                "request",
                lambda request: video_network_requests.append({"method": request.method, "url": request.url})
                if request.url.startswith("https://qa-video.invalid/")
                else None,
            )
            wait_for_app(page)
            set_window_size(page, *DESKTOP)

            report["providerPreflight"] = seed_isolated_provider_profiles(page)
            report["themePreflight"] = {"dark": set_theme(page, "dark")}
            navigate_sidebar(page, "motion-comic", "[data-motion-comic-workbench='true'] [data-director-create-wizard]")
            page.get_by_role("textbox", name="系列名称").fill(PROJECT_TITLE)
            page.get_by_role("textbox", name="核心设定").fill(PROJECT_PREMISE)
            page.get_by_role("textbox", name="首集标题").fill("信从未来来")
            capture_create(page, report, "01-create-content-desktop", *DESKTOP, "content")
            capture_create(page, report, "02-create-content-compact", *COMPACT, "content")

            set_window_size(page, *DESKTOP)
            page.get_by_role("button", name="下一步", exact=True).click()
            expect(page.get_by_role("textbox", name="主角")).to_be_visible()
            page.get_by_role("textbox", name="主角").fill("林夏")
            page.get_by_role("textbox", name="关键人物").fill("周沉")
            page.get_by_role("textbox", name="核心场景").fill("旧城雨巷")
            page.get_by_role("button", name="下一步", exact=True).click()
            provider_select = page.get_by_role("combobox", name="生成服务")
            expect(provider_select).to_be_visible()
            expect(provider_select).to_be_enabled()
            provider_select.select_option("qa-custom-image")
            expect(provider_select).to_have_value("qa-custom-image", timeout=15_000)
            page.wait_for_function(
                """async expected => (await window.storydream.getBootstrap()).config.activeImageProfileId === expected""",
                arg="qa-custom-image",
                timeout=15_000,
            )
            capture_create(page, report, "03-create-service-desktop", *DESKTOP, "service-selection")
            capture_create(page, report, "04-create-service-compact", *COMPACT, "service-selection")
            report["interactions"]["providerSelection"] = {
                "selectedProfileId": provider_select.input_value(),
                "paidGenerationCalls": 0,
            }

            set_window_size(page, *DESKTOP)
            create_button = page.get_by_role("button", name="创建 AI 漫剧系列", exact=True)
            expect(create_button).to_be_enabled()
            create_button.click()
            page.wait_for_selector("[data-motion-comic-workbench='true'] .director-desk", timeout=30_000)
            task = find_created_task(page)
            task_id = str(task["id"])
            report["taskId"] = task_id
            capture_director(page, report, "05-director-missing-desktop", *DESKTOP, "missing")
            capture_director(page, report, "06-director-missing-compact", *COMPACT, "missing")

            capture_remote_video(page, report, "06a-remote-video-dark-desktop", *DESKTOP, "dark")
            capture_remote_video(page, report, "06b-remote-video-dark-compact", *COMPACT, "dark")
            report["themePreflight"]["light"] = set_theme(page, "light")
            capture_remote_video(page, report, "06c-remote-video-light-desktop", *DESKTOP, "light")
            capture_remote_video(page, report, "06d-remote-video-light-compact", *COMPACT, "light")
            report["themePreflight"]["restored"] = set_theme(page, "dark")
            local_motion_tab = page.get_by_role("tab", name="图片运镜", exact=True)
            local_motion_tab.click()
            expect(local_motion_tab).to_have_attribute("aria-selected", "true", timeout=15_000)
            save_version = page.get_by_role("button", name="保存版本", exact=True).first
            expect(save_version).to_be_enabled(timeout=15_000)
            save_version.click()
            expect(page.locator(".director-save-state")).to_have_text("已保存", timeout=15_000)
            report["interactions"]["remoteVideoReadiness"] = {
                "providerId": "qa-remote-video",
                "model": "qa-i2v-1080p",
                "estimatedCost": 1.20,
                "themes": ["dark", "light"],
                "paidGenerationCalls": 0,
            }

            set_window_size(page, *DESKTOP)
            open_series_bible(page)
            capture_series(page, report, "07-series-missing-desktop", *DESKTOP, "missing", 6, 0, 0, 0)
            capture_series(page, report, "08-series-missing-compact", *COMPACT, "missing", 6, 0, 0, 0)

            injected = inject_reference_assets(page, task_id, fixture_paths)
            if injected.get("targetCount") != 6 or injected.get("versionCount") != 7 or injected.get("fixedCount") != 6:
                raise AssertionError(f"Managed reference injection did not persist: {injected}")
            report["stateAssertions"]["managedReferenceInjection"] = injected
            reopen_project_from_history(page, switch_through_vox=True)
            open_series_bible(page)
            capture_series(page, report, "09-series-ready-desktop", *DESKTOP, "ready", 0, 6, 0, 7)
            capture_series(page, report, "10-series-ready-compact", *COMPACT, "ready", 0, 6, 0, 7)

            set_window_size(page, *DESKTOP)
            first_reference = page.locator(".motion-comic-reference").first
            first_reference.scroll_into_view_if_needed()
            first_reference.get_by_role("button", name="取消固定", exact=True).click()
            expect(first_reference).to_have_attribute("data-motion-comic-reference", "unfixed")
            expect(page.locator(".motion-comic-readiness")).to_contain_text("5/6 个引用目标已固定")
            capture_series(page, report, "11-series-unfixed-desktop", *DESKTOP, "unfixed", 0, 5, 1, 7)
            capture_series(page, report, "12-series-unfixed-compact", *COMPACT, "unfixed", 0, 5, 1, 7)

            set_window_size(page, *DESKTOP)
            first_reference = page.locator(".motion-comic-reference").first
            first_reference.scroll_into_view_if_needed()
            first_reference.get_by_role("button", name="固定此版本", exact=True).first.click()
            expect(first_reference).to_have_attribute("data-motion-comic-reference", "fixed")
            save_button = page.get_by_role("button", name="保存系列圣经", exact=True)
            expect(save_button).to_be_enabled()
            save_button.click()
            page.wait_for_selector(".director-desk", timeout=30_000)
            reopened_before = persisted_consistency_snapshot(page, task_id)
            if reopened_before.get("fixedCount") != 6 or reopened_before.get("versionCount") != 7:
                raise AssertionError(f"UI-fixed reference did not persist before reopen: {reopened_before}")
            reopen_project_from_history(page, switch_through_vox=True)
            capture_director(page, report, "13-director-reopened-ready-desktop", *DESKTOP, "ready-reopened")
            capture_director(page, report, "14-director-reopened-ready-compact", *COMPACT, "ready-reopened")
            reopened_after = persisted_consistency_snapshot(page, task_id)
            if reopened_after != reopened_before:
                raise AssertionError(f"Reference state changed across workflow reopen: before={reopened_before}, after={reopened_after}")
            report["stateAssertions"]["saveAndReopen"] = reopened_after

            set_window_size(page, *DESKTOP)
            open_series_bible(page)
            if runtime_errors:
                raise AssertionError(f"Electron reported runtime errors before the broken-file fixture: {runtime_errors}")
            broken_error_start = len(runtime_errors)
            broken = break_first_fixed_reference(page, task_id, profile / "missing-fixed-reference.png")
            report["stateAssertions"]["brokenFixture"] = broken
            reopen_project_from_history(page, switch_through_vox=True)
            open_series_bible(page)
            capture_series(page, report, "15-series-broken-file-desktop", *DESKTOP, "broken-file", 0, 6, 0, 7)
            capture_series(page, report, "16-series-broken-file-compact", *COMPACT, "broken-file", 0, 6, 0, 7)
            broken_file_errors = runtime_errors[broken_error_start:]
            unexpected_broken_errors = [
                error for error in broken_file_errors
                if error.get("type") != "console" or error.get("message") != "Failed to load resource: net::ERR_FILE_NOT_FOUND"
            ]
            if not broken_file_errors or unexpected_broken_errors:
                raise AssertionError(
                    f"Broken-file state did not produce only the expected missing-resource errors: {broken_file_errors}"
                )
            report["expectedRuntimeErrors"] = [dict(error) for error in broken_file_errors]
            del runtime_errors[broken_error_start:]

            report["interactions"].update(
                {
                    "creationWizard": True,
                    "directorDeskMissingReferences": True,
                    "seriesBibleMissingState": True,
                    "managedReferenceImport": True,
                    "seriesBibleReadyState": True,
                    "referenceUnfixAndRefix": True,
                    "saveAndWorkflowReopen": True,
                    "managedThumbnailsReopened": True,
                    "brokenFixedReferenceSurfaced": True,
                    "providerJobsCreated": 0,
                }
            )
            report["videoNetworkRequests"] = video_network_requests
            if video_network_requests:
                raise AssertionError(f"Remote-video QA unexpectedly sent network requests: {video_network_requests}")
            if runtime_errors:
                raise AssertionError(f"Electron reported runtime errors: {runtime_errors}")
            report["status"] = "passed"
            report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            browser.close()
            browser = None
        except Exception:
            if page is not None:
                try:
                    failure_path = ARTIFACTS / "99-failure.png"
                    page.screenshot(path=failure_path, full_page=False)
                    report["failureCapture"] = failure_path.name
                    report["failurePage"] = page.evaluate(
                        """() => ({
                          view: document.querySelector('.app-shell')?.getAttribute('data-shell-view') || '',
                          title: document.title,
                          text: document.body.innerText.slice(-3000),
                        })"""
                    )
                except Exception as capture_error:
                    report["failureCaptureError"] = str(capture_error)
            raise
        finally:
            playwright.stop()
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        raise
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        check=False,
                        capture_output=True,
                    )
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
        (ARTIFACTS / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        shutil.rmtree(profile, ignore_errors=True)


def main() -> None:
    clean_artifacts()
    qa_temp_root = ROOT / ".codex-audit-temp"
    qa_temp_root.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="motion-comic-eight-stage-", dir=qa_temp_root))
    fixture_image = create_reference_fixtures(profile / "qa-reference-inputs")[0]
    fixture_video = create_video_fixture(fixture_image, profile / "qa-reference-inputs" / "remote-video-fixture.mp4")
    network_audit_path = create_offline_electron_entry(profile)
    port = available_port()
    env = os.environ.copy()
    env["NODE_ENV"] = "production"
    env["STORYDREAM_QA_APP_ROOT"] = str(ROOT)
    env["TEMP"] = str(profile)
    env["TMP"] = str(profile)
    for name in (*PAID_API_ENV_VARS, "VITE_DEV_SERVER_URL", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"):
        env.pop(name, None)
    creation_flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        [
            str(ELECTRON),
            f"--remote-debugging-port={port}",
            "--remote-debugging-address=127.0.0.1",
            "--remote-allow-origins=*",
            f"--user-data-dir={profile}",
            str(profile),
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=creation_flags,
    )
    runtime_errors: list[dict[str, str]] = []
    renderer_external_requests: list[dict[str, str]] = []
    report: dict[str, object] = {
        "status": "running",
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "processId": process.pid,
        "viewports": [
            {"name": name, "width": size[0], "height": size[1]}
            for name, size in VIEWPORTS
        ],
        "themes": list(THEMES),
        "runtimeErrors": runtime_errors,
        "externalRequests": {"renderer": renderer_external_requests, "main": []},
        "paidGenerationCalls": 0,
        "interactions": {},
        "stateAssertions": {},
        "captures": [],
    }
    page: Page | None = None
    browser = None
    try:
        endpoint = wait_for_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            context = browser.contexts[0]
            page = context.pages[0]

            def guard_renderer_request(route, request) -> None:
                if external_http_url(request.url):
                    renderer_external_requests.append({"method": request.method, "url": request.url})
                    route.abort()
                else:
                    route.continue_()

            context.route("**/*", guard_renderer_request)
            page.on("pageerror", lambda error: runtime_errors.append({"type": "pageerror", "message": str(error)}))
            page.on(
                "console",
                lambda message: runtime_errors.append({"type": "console", "message": message.text})
                if message.type == "error"
                else None,
            )
            wait_for_app(page)
            set_window_size(page, *DESKTOP)
            report["providerPreflight"] = seed_isolated_provider_profiles(page)

            navigate_sidebar(page, "motion-comic", "[data-motion-comic-workbench='true'] [data-motion-comic-create-flow]")
            assert_create_step(page, 0)
            page.get_by_role("textbox", name="项目名称", exact=True).fill(PROJECT_TITLE)
            page.get_by_role("textbox", name="剧本正文", exact=True).fill(PROJECT_SOURCE)
            capture_surface_matrix(
                page, report, "create-source", "create", "source-import",
                "[data-motion-comic-create-flow]", ("上传 TXT / MD", "也可以直接粘贴正文", "后续流程"),
            )

            page.get_by_role("button", name="下一步", exact=True).click()
            assert_create_step(page, 1)
            drafts = page.locator(".motion-comic-episode-draft")
            expect(drafts).to_have_count(2, timeout=15_000)
            page.get_by_role("textbox", name="第 1 集标题", exact=True).fill("雨夜来信")
            capture_surface_matrix(
                page, report, "create-episodes", "create", "episode-confirmation",
                "[data-motion-comic-create-flow]", ("2 集", "第 1 集标题", "第 2 集标题"),
            )

            page.get_by_role("tab", name="AI 剧情分集", exact=True).click()
            expect(page.locator(".motion-comic-episode-draft")).to_have_count(0)
            capture_surface_matrix(
                page, report, "create-ai-episodes", "create", "ai-episode-boundary-settings",
                "[data-motion-comic-create-flow]", ("生成 AI 分集", "每集目标时长", "模型只选择原文单元"),
            )
            page.get_by_role("tab", name="按章节", exact=True).click()
            expect(page.locator(".motion-comic-episode-draft")).to_have_count(2, timeout=15_000)
            page.get_by_role("textbox", name="第 1 集标题", exact=True).fill("雨夜来信")

            page.get_by_role("button", name="下一步", exact=True).click()
            assert_create_step(page, 2)
            capture_surface_matrix(
                page, report, "create-review", "create", "project-review",
                "[data-motion-comic-create-flow]", ("源文已保存", "分集方案已确认", "不会调用图片、视频、配音或文本生成接口"),
            )

            set_window_size(page, *DESKTOP)
            create_button = page.get_by_role("button", name="创建漫剧项目", exact=True)
            expect(create_button).to_be_enabled(timeout=15_000)
            create_button.click()
            page.wait_for_selector("[data-motion-comic-production][data-stage='episodes']", timeout=30_000)
            task = find_created_task(page)
            task_id = str(task["id"])
            report["taskId"] = task_id
            initial = page.evaluate(
                """async id => {
                  const task = await window.storydream.getTaskDetail(id);
                  const document = JSON.parse(task.pipelineData);
                  return {
                    sourceEpisodes: document.sourceDocument?.episodes.length || 0,
                    projectEpisodes: document.episodes.length,
                    scenes: document.episodes.flatMap(episode => episode.scenes).length,
                    characters: document.characters.length,
                    sceneAssets: document.sceneAssets.length,
                    props: document.props.length,
                    providerJobs: document.providerJobs.length,
                    stage: document.stage,
                  };
                }""",
                task_id,
            )
            if initial != {
                "sourceEpisodes": 2,
                "projectEpisodes": 1,
                "scenes": 0,
                "characters": 0,
                "sceneAssets": 0,
                "props": 0,
                "providerJobs": 0,
                "stage": "episode-script",
            }:
                raise AssertionError(f"Imported project must open as an empty episode-planning project: {initial}")
            report["stateAssertions"]["emptyImportedProject"] = initial
            navigation_before = inspect_workflow_navigation(page, "episodes")
            if navigation_before.get("disabled") != [False, False, True, True, True, True, True, True]:
                raise AssertionError(f"Unplanned project exposes later production stages: {navigation_before}")
            capture_surface_matrix(
                page, report, "episodes-unplanned", "workflow", "episodes-unplanned",
                "[data-motion-comic-stage-panel='episodes']", ("确认每集内容", "可开始", "不会直接调用图片或视频服务"),
                "episodes", 120,
            )
            detail = page.locator(".motion-comic-episode-source-detail")
            plan_button = page.get_by_role("button", name="生成剧本与分幕预览", exact=True)
            expect(plan_button).to_be_visible(timeout=15_000)
            detail_bounds = detail.bounding_box()
            plan_bounds = plan_button.bounding_box()
            if not detail_bounds or not plan_bounds:
                raise AssertionError("Episode planning action has no visible bounds")
            if plan_bounds["y"] > detail_bounds["y"] + 260:
                raise AssertionError(f"Episode planning action is too far below the detail header: {plan_bounds}")
            if detail.evaluate("element => element.scrollTop") != 0:
                raise AssertionError("Episode planning action requires scrolling before it is discoverable")
            report["stateAssertions"]["episodePlanningActionAtTop"] = True

            seeded = seed_structured_motion_comic(page, task_id, fixture_image, fixture_video)
            if seeded.get("sourceEpisodes") != 2 or seeded.get("structuredEpisodes") != 1 or seeded.get("acts") != [1, 2, 3] or seeded.get("shots") != 3:
                raise AssertionError(f"Offline structured workflow fixture is incomplete: {seeded}")
            synthetic_jobs = seeded.get("syntheticProviderJobs")
            if not isinstance(synthetic_jobs, list) or any(job.get("providerId") != "qa-offline-fixture" or job.get("actualCost") != 0 for job in synthetic_jobs):
                raise AssertionError(f"QA fixture contains a billable provider job: {seeded}")
            report["stateAssertions"]["offlineStructuredFixture"] = seeded
            reopen_created_project(page)

            stage_specs = (
                (0, "source", "stage-source", "[data-motion-comic-stage-panel='source']", ("01 · 剧本导入", "原始文本", "进入分集拆解"), 100),
                (1, "episodes", "stage-episodes", "[data-motion-comic-stage-panel='episodes']", ("02 · 分集拆解", "1/2 集已完成结构化", "可开始"), 120),
                (2, "scenes", "stage-scenes", "[data-motion-comic-stage-panel='scenes']", ("03 · 分幕分场", "第 1 幕", "第 2 幕", "第 3 幕", "AI 规划", "幕边界依据"), 120),
                (3, "assets", "stage-assets", "[data-motion-comic-series-bible='true']", ("角色资产", "一致性素材已就绪", "场景一致性", "道具一致性", "新增人物", "新增场景", "新增道具"), 120),
                (4, "storyboard", "stage-storyboard", ".director-desk", ("雨夜来信", "镜头 01", "更新关键帧"), 120),
                (5, "video", "stage-video", ".director-desk", ("远程视频 API", "视频生成服务", "任务状态", "视频运动提示词"), 140),
                (6, "audio", "stage-audio", ".director-desk", ("字幕", "旁白服务未连接"), 120),
                (7, "export", "stage-export", ".director-desk", ("审片质量门", "重新生成并审片", "当前分集暂无审片报告"), 120),
            )
            for index, stage, slug, selector, expected_text, minimum_text in stage_specs:
                select_workflow_stage(page, index, stage, selector)
                if stage == "video":
                    expect(page.locator(".motion-comic-video-readiness")).to_be_visible(timeout=15_000)
                    mode_tabs = page.locator(".motion-comic-video-readiness__mode [role='tab']")
                    expect(mode_tabs).to_have_count(1)
                    expect(mode_tabs.first).to_contain_text("远程视频")
                    expect(mode_tabs.first).to_be_disabled()
                    expect(page.get_by_role("button", name="更新关键帧", exact=True)).to_have_count(0)
                if stage == "storyboard":
                    expect(page.locator(".motion-comic-video-readiness")).to_have_count(0)
                    expect(page.get_by_role("button", name="更新关键帧", exact=True)).to_be_visible(timeout=15_000)
                    expect(page.get_by_role("button", name="生成视频", exact=True)).to_have_count(0)
                if stage == "audio":
                    expect(page.get_by_role("tab", name="字幕", exact=True)).to_have_attribute("aria-selected", "true", timeout=15_000)
                    expect(page.get_by_role("button", name="更新关键帧", exact=True)).to_have_count(0)
                    expect(page.get_by_role("button", name="生成视频", exact=True)).to_have_count(0)
                if stage == "export":
                    expect(page.get_by_role("tab", name="审片", exact=True)).to_have_attribute("aria-selected", "true", timeout=15_000)
                    expect(page.get_by_role("button", name="更新关键帧", exact=True)).to_have_count(0)
                    expect(page.get_by_role("button", name="生成视频", exact=True)).to_have_count(0)
                capture_surface_matrix(
                    page, report, slug, "workflow", stage, selector, expected_text, stage, minimum_text,
                )
                if stage == "scenes":
                    tabs = page.locator(".motion-comic-scenes-panel__episodes [role='tab']")
                    save = page.get_by_role("button", name="保存", exact=True)
                    expect(save).to_be_disabled()
                    tabs.nth(1).click()
                    expect(page.locator(".motion-comic-scenes-unplanned-box")).to_be_visible()
                    expect(save).to_be_disabled()
                    expect(page.get_by_role("button", name="生成本集结构预览", exact=True)).to_be_enabled()
                    pending_nav = inspect_workflow_navigation(page, "scenes")
                    if pending_nav["disabled"][3:] != [True] * 5:
                        raise AssertionError(f"Unplanned episode exposes another episode's production stages: {pending_nav}")
                    report["stateAssertions"]["unplannedSelectionDoesNotWrite"] = True
                    tabs.first.click()
                    expect(page.locator(".motion-comic-scenes-board")).to_be_visible()
                    board = page.locator(".motion-comic-scenes-board")
                    bounds = board.bounding_box()
                    assert bounds
                    page.mouse.move(bounds["x"] + 4, bounds["y"] + bounds["height"] / 2)
                    page.mouse.wheel(0, 2000)
                    page.wait_for_timeout(250)
                    if board.evaluate("element => element.scrollTop") <= 0:
                        raise AssertionError("Scene board does not respond to mouse-wheel scrolling")
                    report["stateAssertions"]["sceneWheelScroll"] = True
                    page.screenshot(path=str(ARTIFACTS / "scene-scroll-bottom-compact.png"), full_page=False, animations="disabled")
                    board.evaluate("element => { element.scrollTop = 0; }")
                    second_act_boundary = page.get_by_role("checkbox", name="从本场开始新一幕").first
                    expect(second_act_boundary).to_be_checked()
                    second_act_boundary.uncheck()
                    expect(page.locator(".motion-comic-act-card")).to_have_count(2)
                    expect(page.get_by_text("人工调整", exact=True).first).to_be_visible()
                    expect(save).to_be_enabled()
                    save.click()
                    expect(save).to_be_disabled(timeout=15_000)
                    manual_acts = page.evaluate(
                        """async id => {
                          const task = await window.storydream.getTaskDetail(id);
                          const document = JSON.parse(task.pipelineData);
                          return {
                            indexes: document.episodes[0].scenes.map(scene => scene.actIndex),
                            sources: document.episodes[0].scenes.map(scene => scene.actSource),
                          };
                        }""",
                        task_id,
                    )
                    if manual_acts != {"indexes": [1, 1, 2], "sources": ["manual", "manual", "manual"]}:
                        raise AssertionError(f"Manual act-boundary edit was not persisted: {manual_acts}")
                    report["stateAssertions"]["manualActBoundary"] = manual_acts
                    page.screenshot(path=str(ARTIFACTS / "scene-manual-boundary-compact.png"), full_page=False, animations="disabled")
                if stage == "assets":
                    capture_asset_entry_matrix(page, report)

            final_state = persisted_workflow_snapshot(page, task_id)
            if final_state.get("sourceEpisodeCount") != 2 or final_state.get("structuredEpisodeCount") != 1:
                raise AssertionError(f"Workflow navigation changed the imported structure: {final_state}")
            if final_state.get("sceneCount") != 3 or final_state.get("shotCount") != 3 or not final_state.get("remoteOnly"):
                raise AssertionError(f"Structured motion-comic fixture changed during QA: {final_state}")
            final_jobs = final_state.get("providerJobs")
            if not isinstance(final_jobs, list) or [job.get("id") for job in final_jobs] != [job.get("id") for job in synthetic_jobs]:
                raise AssertionError(f"UI navigation created provider jobs: before={synthetic_jobs}, after={final_jobs}")
            if final_state.get("estimatedCost") != 0 or final_state.get("actualCost") != 0:
                raise AssertionError(f"QA workflow accumulated a cost: {final_state}")
            report["stateAssertions"]["finalWorkflow"] = final_state
            select_workflow_stage(page, 3, "assets", "[data-motion-comic-series-bible='true']")
            report["stateAssertions"]["manualAssetAdditions"] = add_and_persist_manual_assets(
                page,
                task_id,
                final_state,
            )
            report["interactions"] = {
                "sourcePasted": True,
                "episodesSplit": 2,
                "aiEpisodePlannerSettingsPreviewed": True,
                "episodeTitleEdited": True,
                "projectCreatedWithoutGeneration": True,
                "workflowStagesVisited": [stage for _, stage, *_ in stage_specs],
                "remoteVideoOnly": True,
                "manualAssetEntriesClicked": [label for _, label in ASSET_ENTRY_SPECS],
            }

            main_external_requests = read_json_lines(network_audit_path)
            report["externalRequests"]["main"] = main_external_requests
            if renderer_external_requests or main_external_requests:
                raise AssertionError(
                    f"Motion-comic QA attempted external network access: renderer={renderer_external_requests}, main={main_external_requests}"
                )
            if runtime_errors:
                raise AssertionError(f"Electron reported runtime errors: {runtime_errors}")
            report["paidGenerationCalls"] = 0
            report["status"] = "passed"
            report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            browser.close()
            browser = None
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        if page is not None:
            try:
                failure_path = ARTIFACTS / "99-failure.png"
                page.screenshot(path=failure_path, full_page=False)
                report["failureCapture"] = failure_path.name
                report["failurePage"] = page.evaluate(
                    """() => ({
                      view: document.querySelector('.app-shell')?.getAttribute('data-shell-view') || '',
                      stage: document.querySelector('[data-motion-comic-production]')?.getAttribute('data-stage') || '',
                      title: document.title,
                      text: document.body.innerText.slice(-3000),
                    })"""
                )
            except Exception as capture_error:
                report["failureCaptureError"] = str(capture_error)
        raise
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        check=False,
                        capture_output=True,
                    )
                else:
                    process.kill()
        report["processReturnCode"] = process.poll()
        report["externalRequests"]["main"] = read_json_lines(network_audit_path)
        try:
            stdout, stderr = process.communicate(timeout=2)
            report["processOutputTail"] = {
                "stdout": stdout.decode("utf-8", errors="replace")[-6000:],
                "stderr": stderr.decode("utf-8", errors="replace")[-6000:],
            }
        except Exception as output_error:
            report["processOutputError"] = str(output_error)
        (ARTIFACTS / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
