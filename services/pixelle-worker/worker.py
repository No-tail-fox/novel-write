"""Isolated adapter around unchanged Pixelle template scanner and HTML renderer.

No upstream package __init__, model clients or generation services are executed.
Only verified local resources are rendered; missing remote dependencies fail loudly.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import types
from urllib.parse import unquote, urlparse

REVISION = "848b054e4fae40dabc62ec58e960b573e83793ac"
CORE_FILES = ("pixelle_video/utils/os_util.py", "pixelle_video/utils/template_util.py", "pixelle_video/services/frame_html.py", "pixelle_video/services/video.py")
URL_RE = re.compile(r"https?://[^\s\"'<>)}]+")


class ResourceRequiredError(ValueError):
    def __init__(self, urls):
        self.urls = sorted(urls)
        super().__init__("PIXELLE_RESOURCE_REQUIRED: " + ", ".join(self.urls))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inside(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Path escapes its resource root")
    return path


def verified_sources(root):
    manifest = json.loads((root / "storydream-upstream.json").read_text(encoding="utf-8"))
    if manifest.get("revision") != REVISION:
        raise ValueError("Unsupported Pixelle revision")
    inventory = {f["path"]: f for f in manifest["files"]}
    templates = [p for p in inventory if p.startswith("templates/") and p.endswith(".html")]
    if len(templates) != 31:
        raise ValueError("The complete pinned set of 31 templates is required")
    data = {}
    for name in [*CORE_FILES, *templates]:
        value = inside(root, name).read_bytes()
        if digest(value) != inventory[name]["sha256"]:
            raise ValueError("Upstream integrity failed: " + name)
        data[name] = value
    return data


def load_core(root, runtime):
    # Namespace loading avoids upstream __init__.py's full AI-service singleton.
    # The scanner, parameter DSL and renderer below are the actual upstream code.
    sys.dont_write_bytecode = True
    for name in ("pixelle_video", "pixelle_video.utils", "pixelle_video.services"):
        module = types.ModuleType(name)
        module.__path__ = [str(root.joinpath(*name.split(".")))]
        sys.modules[name] = module
    os.environ["PIXELLE_VIDEO_ROOT"] = str(runtime)
    from loguru import logger
    logger.remove()
    logger.add(sys.stderr, level="WARNING")
    from pixelle_video.utils import template_util
    from pixelle_video.services.frame_html import HTMLFrameGenerator
    return template_util, HTMLFrameGenerator


def catalogue(util, generator, runtime):
    result = []
    for info in util.get_all_templates_with_info():
        path = inside(runtime / "templates", info.template_path)
        engine = generator(str(path))
        metadata = info.display_info.model_dump()
        template_type = "asset" if path.name.startswith("asset_") else util.get_template_type(path.name)
        result.append({
            "ref": {"provider": "pixelle", "revision": REVISION, "path": info.template_path, "sha256": digest(path.read_bytes())},
            "name": path.stem, "type": template_type, **metadata,
            "parameters": engine.parse_template_parameters(),
            "mediaSize": list(engine.get_media_size()),
            "remoteDependencies": sorted(set(URL_RE.findall(engine.template))),
        })
    return sorted(result, key=lambda item: item["ref"]["path"])


def safe_parameters(engine, supplied):
    if not isinstance(supplied, dict):
        raise ValueError("Template parameters must be an object")
    definitions = engine.parse_template_parameters()
    if set(supplied) - set(definitions):
        raise ValueError("Unknown or reserved template parameter")
    values = {}
    for name, value in supplied.items():
        kind = definitions[name]["type"]
        if kind == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError("Invalid numeric parameter: " + name)
        elif kind == "bool":
            if not isinstance(value, bool):
                raise ValueError("Invalid boolean parameter: " + name)
        else:
            if not isinstance(value, str):
                raise ValueError("Invalid text parameter: " + name)
            if kind == "color" and not re.fullmatch(r"#[0-9a-fA-F]{3,8}", value):
                raise ValueError("Invalid color parameter: " + name)
            value = html.escape(value, quote=True)
        values[name] = value
    return values


async def render_frame(request, entry, generator, runtime, work):
    path = inside(runtime / "templates", entry["ref"]["path"])
    output = inside(work, request.get("output", "pixelle-frame.png"))
    if output.suffix.lower() != ".png":
        raise ValueError("Frame output must be PNG")
    kind = entry["type"]
    media_kind = request.get("mediaKind", "image")
    if media_kind not in ("image", "video"):
        raise ValueError("Unsupported media kind")
    if kind == "video" and media_kind != "video":
        raise ValueError("Video templates require video media; screenshots are overlays only")
    overlay = kind == "video" or (kind == "asset" and media_kind == "video")
    image = ""
    allowed_files = set()
    if kind != "static" and not overlay:
        image_path = Path(request.get("imagePath", "")).resolve()
        if not image_path.is_file() or image_path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            raise ValueError("A reusable local image is required; no image generation is performed")
        image = image_path.as_uri()
        allowed_files.add(image)
    blocked = set()
    page_errors = []
    resources = {}
    for url, item in request.get("resourceMap", {}).items():
        local = Path(item["path"]).resolve()
        contents = local.read_bytes()
        if digest(contents) != item["sha256"]:
            raise ValueError("Cached resource integrity failed: " + url)
        resources[url] = (contents, item["contentType"])

    async def route_resource(route):
        url = route.request.url
        if url in resources:
            data, content_type = resources[url]
            await route.fulfill(body=data, content_type=content_type)
            return
        parsed = urlparse(url)
        if parsed.scheme in ("data", "blob") or url in allowed_files:
            await route.continue_()
            return
        local_path = Path(unquote(parsed.path).lstrip("/") if os.name == "nt" else unquote(parsed.path))
        if parsed.scheme == "file" and route.request.is_navigation_request() and route.request.resource_type == "document" and local_path.parent.resolve() == Path(tempfile.gettempdir()).resolve() and local_path.name.startswith("pv_frame_") and local_path.suffix == ".html":
            await route.continue_()
            return
        blocked.add(url)
        await route.abort("blockedbyclient")

    class PageGuard:
        def __init__(self, page): self.page = page
        def __getattr__(self, name): return getattr(self.page, name)
        async def screenshot(self, **kwargs):
            await self.page.wait_for_function("() => document.fonts.status === 'loaded'", timeout=15000)
            fonts_failed = await self.page.evaluate("() => Array.from(document.fonts).some(font => font.status === 'error')")
            images_failed = await self.page.evaluate("() => Array.from(document.images).some(img => !img.complete || img.naturalWidth === 0)")
            if blocked:
                raise ResourceRequiredError(blocked)
            if fonts_failed or images_failed or page_errors:
                raise ValueError("PIXELLE_RENDER_INCOMPLETE: fonts, images or template JavaScript failed: " + "; ".join(page_errors))
            return await self.page.screenshot(**kwargs)

    class BrowserGuard:
        def __init__(self, browser): self.browser = browser
        async def new_page(self, **kwargs):
            page = await self.browser.new_page(**kwargs)
            await page.route("**/*", route_resource)
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            return PageGuard(page)

    class GuardedGenerator(generator):
        @classmethod
        async def _ensure_browser(cls):
            return BrowserGuard(await super()._ensure_browser())

    engine = GuardedGenerator(str(path))
    parameters = safe_parameters(engine, request.get("parameters", {}))
    index = request.get("index", 1)
    if isinstance(index, bool) or not isinstance(index, int) or index < 1:
        raise ValueError("Frame index must be a positive integer")
    parameters["index"] = index
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix="pixelle-frame-", dir=work) as tmp:
            partial = Path(tmp) / "frame.png"
            await engine.generate_frame(title=html.escape(str(request.get("title", "")), quote=True), text=html.escape(str(request.get("text", "")), quote=True), image=image, ext=parameters, output_path=str(partial))
            from PIL import Image
            with Image.open(partial) as frame:
                if frame.size != (entry["width"], entry["height"]):
                    raise ValueError("Rendered dimensions do not match the original template")
                frame.load()
            os.replace(partial, output)
        return {"path": str(output), "width": entry["width"], "height": entry["height"], "ref": entry["ref"], "kind": "video-overlay" if overlay else "frame", "requiresVideoComposition": overlay, "paidRequests": 0}
    except Exception:
        # Upstream wraps render errors; preserve a structured dependency contract.
        if blocked:
            raise ResourceRequiredError(blocked) from None
        raise
    finally:
        await GuardedGenerator.close_browser()


async def render_clip(request, entry, generator, runtime, work):
    import importlib.util
    spec = importlib.util.spec_from_file_location("pixelle_media_runtime", Path(__file__).with_name("media_runtime.py"))
    media = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(media)
    original_video_service, probe_media = media.original_video_service, media.probe_media
    output = inside(work, request.get("output", "pixelle-clip.mp4"))
    if output.suffix.lower() != ".mp4":
        raise ValueError("Clip output must be MP4")
    fps = request.get("fps", 24)
    if isinstance(fps, bool) or not isinstance(fps, int) or not 1 <= fps <= 60:
        raise ValueError("Invalid clip frame rate")
    strategy = request.get("padStrategy", "freeze")
    if strategy not in ("freeze", "black"):
        raise ValueError("Invalid video padding strategy")
    warnings = []
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pixelle-clip-", dir=work) as tmp:
        service = original_video_service()
        paths = request.get("audioPaths") or [request.get("audioPath", "")]
        audio, duration = media.prepare_narration(paths, Path(tmp) / "narration.wav", request.get("durationMs"))
        partial = Path(tmp) / "clip.mp4"
        frame_request = {**request, "output": str(Path(tmp) / "overlay.png")}
        frame = await render_frame(frame_request, entry, generator, runtime, work)
        if frame["requiresVideoComposition"]:
            video = Path(request.get("videoPath", "")).resolve()
            video_probe = probe_media(video)
            if not any(s["codec_type"] == "video" for s in video_probe["streams"]):
                raise ValueError("Video templates require a reusable video stream")
            padding = max(0, duration - float(video_probe["format"]["duration"]))
            if padding > 1:
                warnings.append({"code": "VIDEO_PADDING_REQUIRED", "durationMs": round(padding * 1000), "strategy": strategy})
            overlay = str(Path(tmp) / "video-overlay.mp4")
            service.overlay_image_on_video(str(video), frame["path"], overlay, scale_mode="contain")
            service.merge_audio_video(overlay, str(audio), str(partial), replace_audio=True, pad_strategy=strategy, duration_tolerance=0)
        else:
            service.create_video_from_image(frame["path"], str(audio), str(partial), fps=fps)
        probe = probe_media(partial)
        stream = next((s for s in probe["streams"] if s["codec_type"] == "video"), None)
        result_duration = float(probe["format"]["duration"])
        if not stream or not any(s["codec_type"] == "audio" for s in probe["streams"]) or (stream["width"], stream["height"]) != (entry["width"], entry["height"]) or abs(result_duration - duration) > 0.15:
            raise ValueError("PIXELLE_CLIP_VALIDATION_FAILED: dimensions, audio or duration mismatch")
        os.replace(partial, output)
    return {"path": str(output), "width": entry["width"], "height": entry["height"], "ref": entry["ref"], "kind": "clip", "durationMs": round(result_duration * 1000), "narrationDurationMs": round(duration * 1000), "warnings": warnings, "paidRequests": 0}


async def run(request):
    mode = request.get("mode")
    if mode not in ("catalog", "render-frame", "render-clip", "probe-video"):
        raise ValueError("Unsupported Pixelle worker operation")
    root = Path(request["upstreamDir"]).resolve()
    work = Path(request["workDir"]).resolve()
    if work.is_relative_to(root) or root.is_relative_to(work):
        raise ValueError("Writable runtime must be separate from read-only upstream")
    sources = verified_sources(root)
    work.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pixelle-runtime-", dir=work) as tmp:
        runtime = Path(tmp)
        for name, data in sources.items():
            if name.startswith("templates/"):
                file = inside(runtime, name)
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(data)
        util, generator = load_core(root, runtime)
        entries = catalogue(util, generator, runtime)
        if mode == "catalog":
            return {"revision": REVISION, "templates": entries, "paidRequests": 0}
        if mode == "probe-video":
            import importlib.util
            spec = importlib.util.spec_from_file_location("pixelle_media_runtime", Path(__file__).with_name("media_runtime.py"))
            media = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(media)
            info = media.probe_media(request.get("videoPath", ""))
            stream = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
            duration = float(info["format"]["duration"])
            if not stream or not math.isfinite(duration) or duration <= 0:
                raise ValueError("Local video has no decodable video stream")
            import av
            with av.open(request["videoPath"]) as container:
                if next(container.decode(video=0), None) is None:
                    raise ValueError("Local video has no decodable frame")
            return {"width": stream["width"], "height": stream["height"], "durationMs": round(duration * 1000), "paidRequests": 0}
        ref = request.get("templateRef", {})
        entry = next((item for item in entries if item["ref"] == ref), None)
        if not entry:
            raise ValueError("Unknown, modified or stale visualTemplateRef")
        if mode == "render-clip":
            return await render_clip(request, entry, generator, runtime, work)
        return await render_frame(request, entry, generator, runtime, work)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        request = json.loads(Path(args.request).read_text(encoding="utf-8"))
        result = asyncio.run(run(request))
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error), **({"code": "PIXELLE_RESOURCE_REQUIRED", "missingResources": error.urls} if isinstance(error, ResourceRequiredError) else {})}, ensure_ascii=False))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
