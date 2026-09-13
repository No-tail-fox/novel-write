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
MOJIBAKE_MARKERS = ("\ufffd", "锟斤拷", "Ã¤", "æµ‹è¯•", "闁诲")
DESKTOP = (1536, 1024)
COMPACT = (1040, 720)


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
          const mutation = await window.storydream.saveConfig({
            config,
            secretChanges: {
              'image/qa-gpt-image/gptImage/apiKey': 'qa-key-never-sent',
              'image/qa-custom-image/customImage/apiKey': 'qa-key-never-sent',
            },
          });
          if (!mutation || mutation.kind !== 'state-patch' || mutation.patch.kind !== 'config') {
            throw new Error('QA provider profiles were not persisted.');
          }
          const refreshed = await window.storydream.getBootstrap();
          return {
            activeProfileId: refreshed.config.activeImageProfileId,
            profileIds: refreshed.config.imageProfiles.map((profile) => profile.id),
            connectedProfileIds: Object.entries(refreshed.secretStatus)
              .filter(([id, connected]) => id.startsWith('image/') && connected)
              .map(([id]) => id),
          };
        }"""
    )
    page.wait_for_timeout(500)
    if result.get("activeProfileId") != "qa-gpt-image":
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
    if state != "missing":
        page.wait_for_function(
            """() => {
              const image = document.querySelector('.director-media-preview img');
              return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
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
                shellChromeHidden: shellHidden('.app-shell > .window-line') && shellHidden('.app-shell .sidebar') && shellHidden('.app-shell .page-head'),
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
    if state != "missing" and not snapshot.get("previewImageReady"):
        raise AssertionError(f"Director Desk preview failed to load: {snapshot}")
    if not snapshot.get("shellChromeHidden"):
        raise AssertionError(f"Director Desk preview or immersive shell failed: {snapshot}")
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
        page.get_by_role("button", name="返回全部任务", exact=True).click()
        page.wait_for_selector("[data-task-operations='history']", timeout=30_000)
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
    page.get_by_role("button", name="剧本", exact=True).click()
    page.wait_for_selector("[data-motion-comic-series-bible='true']", timeout=15_000)
    expect(page.get_by_role("button", name="返回导演台", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="保存系列圣经", exact=True)).to_be_visible()


def main() -> None:
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


if __name__ == "__main__":
    main()
