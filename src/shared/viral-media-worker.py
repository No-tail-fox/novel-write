# Internal viral media worker.
#
# The Douyin and Bilibili parsing shape is informed by Evil0ctal/Douyin_TikTok_Download_API
# (Apache-2.0): https://github.com/Evil0ctal/Douyin_TikTok_Download_API
# This worker is intentionally standalone and only downloads user-accessible public media.

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

try:
    import httpx
except Exception as exc:  # pragma: no cover - surfaced as a runtime error
    raise RuntimeError("Python dependency httpx is required for viral media downloads.") from exc


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)


class ViralWorkerError(RuntimeError):
    pass


@dataclass
class WorkerRequest:
    url: str
    platform: str
    work_dir: Path
    cookie_fallback_mode: str
    browser_cookie_source: str
    cookie_file_path: str
    timeout_ms: int


@dataclass
class CookieAttempt:
    source: str
    header: str


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] != "download":
        print("Usage: viral-media-worker.py download <request.json>", file=sys.stderr)
        return 2
    try:
        request = load_request(Path(sys.argv[2]))
        result = download_with_cookie_fallback(request)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(normalize_error_message(exc), file=sys.stderr)
        return 1


def load_request(path: Path) -> WorkerRequest:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    work_dir = Path(str(payload.get("workDir", ""))).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    platform = str(payload.get("platform") or "unknown")
    url = str(payload.get("url") or "").strip()
    if not url:
        raise ViralWorkerError("视频链接不能为空。")
    if platform == "unknown":
        platform = detect_platform(url)
    if platform not in {"douyin", "kuaishou", "bilibili"}:
        raise ViralWorkerError("只支持抖音、快手、B站公开视频链接。")
    return WorkerRequest(
        url=url,
        platform=platform,
        work_dir=work_dir,
        cookie_fallback_mode=str(payload.get("cookieFallbackMode") or "browser-first-after-failure"),
        browser_cookie_source=str(payload.get("browserCookieSource") or "auto"),
        cookie_file_path=str(payload.get("cookieFilePath") or "").strip(),
        timeout_ms=int(payload.get("timeoutMs") or 180000),
    )


def detect_platform(url: str) -> str:
    lower = url.lower()
    if "douyin.com" in lower or "iesdouyin.com" in lower or "amemv.com" in lower:
        return "douyin"
    if "kuaishou.com" in lower or "gifshow.com" in lower or "kwai.com" in lower:
        return "kuaishou"
    if "bilibili.com" in lower or "b23.tv" in lower:
        return "bilibili"
    return "unknown"


def download_with_cookie_fallback(request: WorkerRequest) -> dict[str, Any]:
    attempts = build_cookie_attempts(request)
    errors: list[str] = []
    for attempt in attempts:
        try:
            if request.platform == "douyin":
                return download_douyin(request, attempt)
            if request.platform == "kuaishou":
                return download_kuaishou(request, attempt)
            if request.platform == "bilibili":
                return download_bilibili(request, attempt)
        except Exception as exc:
            errors.append(f"{attempt.source}: {normalize_error_message(exc)}")
    detail = "；".join(errors) if errors else "没有可用的下载尝试。"
    raise ViralWorkerError(f"视频采集失败：公开视频不可访问、平台风控或下载地址已过期。{detail}")


def build_cookie_attempts(request: WorkerRequest) -> list[CookieAttempt]:
    attempts = [CookieAttempt("none", "")]
    if request.cookie_fallback_mode == "browser-first-after-failure":
        for source in browser_cookie_sources(request.browser_cookie_source):
            header = load_browser_cookie_header(request.platform, source)
            if header:
                attempts.append(CookieAttempt(f"browser-{source}", header))
    if request.cookie_file_path:
        header = load_cookie_file_header(Path(request.cookie_file_path))
        if header:
            attempts.append(CookieAttempt("cookie-file", header))
    return dedupe_attempts(attempts)


def browser_cookie_sources(source: str) -> list[str]:
    if source == "chrome":
        return ["chrome"]
    if source == "edge":
        return ["edge"]
    return ["chrome", "edge"]


def dedupe_attempts(attempts: list[CookieAttempt]) -> list[CookieAttempt]:
    seen: set[tuple[str, str]] = set()
    unique: list[CookieAttempt] = []
    for attempt in attempts:
        key = (attempt.source, attempt.header)
        if key in seen:
            continue
        seen.add(key)
        unique.append(attempt)
    return unique


def load_browser_cookie_header(platform: str, source: str) -> str:
    try:
        import browser_cookie3
    except Exception:
        return ""
    loader = getattr(browser_cookie3, source, None)
    if loader is None:
        return ""
    cookie_pairs: dict[str, str] = {}
    for domain in cookie_domains(platform):
        try:
            jar = loader(domain_name=domain)
        except Exception:
            continue
        for cookie in jar:
            cookie_pairs[cookie.name] = cookie.value
    return "; ".join(f"{name}={value}" for name, value in cookie_pairs.items())


def cookie_domains(platform: str) -> list[str]:
    if platform == "douyin":
        return [".douyin.com", "douyin.com", ".iesdouyin.com", "iesdouyin.com"]
    if platform == "kuaishou":
        return [".kuaishou.com", "kuaishou.com", ".gifshow.com", "gifshow.com", ".kwai.com", "kwai.com"]
    if platform == "bilibili":
        return [".bilibili.com", "bilibili.com", ".b23.tv", "b23.tv"]
    return []


def load_cookie_file_header(path: Path) -> str:
    if not path.exists():
        return ""
    pairs: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7:
            pairs[parts[5]] = parts[6]
        elif "=" in line and ";" not in line:
            name, value = line.split("=", 1)
            pairs[name.strip()] = value.strip()
        elif "=" in line:
            for item in line.split(";"):
                if "=" in item:
                    name, value = item.split("=", 1)
                    pairs[name.strip()] = value.strip()
    return "; ".join(f"{name}={value}" for name, value in pairs.items() if name)


def common_headers(url: str, cookie_header: str = "") -> dict[str, str]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": url,
    }
    if cookie_header:
        headers["Cookie"] = cookie_header
    return headers


def resolve_url(url: str, timeout_ms: int, cookie_header: str = "") -> str:
    headers = common_headers(url, cookie_header)
    with httpx.Client(follow_redirects=True, timeout=timeout_ms / 1000) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        return str(response.url)


def normalize_douyin_url(url: str, timeout_ms: int, cookie_header: str = "") -> str:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    modal_id = first(query.get("modal_id"))
    if modal_id and modal_id.isdigit():
        return f"https://www.douyin.com/video/{modal_id}"
    match = re.search(r"/(?:video|note|share/video)/(\d+)", parsed.path)
    if match:
        return f"https://www.douyin.com/video/{match.group(1)}"
    if "v.douyin.com" in parsed.netloc or "iesdouyin.com" in parsed.netloc:
        resolved = resolve_url(url, timeout_ms, cookie_header)
        if resolved != url:
            return normalize_douyin_url(resolved, timeout_ms, cookie_header)
    return url


def extract_douyin_id(url: str) -> str:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    modal_id = first(query.get("modal_id"))
    if modal_id and modal_id.isdigit():
        return modal_id
    match = re.search(r"/(?:video|note|share/video)/(\d+)", parsed.path)
    if match:
        return match.group(1)
    raise ViralWorkerError("无法从抖音链接中识别视频 ID。")


def download_douyin(request: WorkerRequest, cookie: CookieAttempt) -> dict[str, Any]:
    normalized_url = normalize_douyin_url(request.url, request.timeout_ms, cookie.header)
    aweme_id = extract_douyin_id(normalized_url)
    metadata = fetch_douyin_metadata(aweme_id, normalized_url, request.timeout_ms, cookie.header)
    if metadata is None:
        metadata = sniff_public_media_with_playwright(request, cookie, normalized_url, "douyin")
    video_url = metadata.get("videoUrl") or ""
    if not video_url:
        raise ViralWorkerError("抖音页面没有暴露可下载的视频地址。")
    video_path = request.work_dir / "video.mp4"
    download_media_url(video_url, video_path, normalized_url, request.timeout_ms, cookie.header, validate_video=True)
    cover_path = download_cover(metadata.get("coverUrl"), request.work_dir, normalized_url, request.timeout_ms, cookie.header)
    source = {
        "platform": "douyin",
        "url": request.url,
        "normalizedUrl": normalized_url,
        "downloadProvider": "douyin-internal",
        "usedCookieSource": cookie.source,
        "videoPath": str(video_path),
        "coverPath": cover_path,
        "title": str(metadata.get("title") or ""),
        "author": str(metadata.get("author") or ""),
        "duration": number_or_zero(metadata.get("duration")),
        "stats": {
            "likes": nullable_number(metadata.get("likes")),
            "comments": nullable_number(metadata.get("comments")),
            "shares": nullable_number(metadata.get("shares")),
        },
    }
    return media_result(video_path, source, "douyin-internal", normalized_url, cookie.source, metadata.get("raw"))


def fetch_douyin_metadata(aweme_id: str, referer: str, timeout_ms: int, cookie_header: str) -> dict[str, Any] | None:
    params = douyin_detail_params(aweme_id)
    endpoint = "https://www.douyin.com/aweme/v1/web/aweme/detail/?" + urlencode(params)
    headers = common_headers(referer, cookie_header)
    headers["Accept"] = "application/json,text/plain,*/*"
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout_ms / 1000) as client:
            response = client.get(endpoint, headers=headers)
            response.raise_for_status()
            if not response.text.strip():
                return None
            payload = response.json()
    except Exception:
        return None
    detail = payload.get("aweme_detail") or payload.get("awemeDetail")
    if not isinstance(detail, dict):
        return None
    parsed = parse_douyin_aweme_detail(detail)
    parsed["raw"] = payload
    return parsed


def douyin_detail_params(aweme_id: str) -> dict[str, str]:
    return {
        "device_platform": "webapp",
        "aid": "6383",
        "channel": "channel_pc_web",
        "pc_client_type": "1",
        "version_code": "290100",
        "version_name": "29.1.0",
        "cookie_enabled": "true",
        "screen_width": "1920",
        "screen_height": "1080",
        "browser_language": "zh-CN",
        "browser_platform": "Win32",
        "browser_name": "Chrome",
        "browser_version": "130.0.0.0",
        "browser_online": "true",
        "engine_name": "Blink",
        "engine_version": "130.0.0.0",
        "os_name": "Windows",
        "os_version": "10",
        "cpu_core_num": "12",
        "device_memory": "8",
        "platform": "PC",
        "downlink": "10",
        "effective_type": "4g",
        "from_user_page": "1",
        "locate_query": "false",
        "need_time_list": "1",
        "pc_libra_divert": "Windows",
        "publish_video_strategy_type": "2",
        "round_trip_time": "0",
        "show_live_replay_strategy": "1",
        "time_list_query": "0",
        "whale_cut_token": "",
        "update_version_code": "170400",
        "aweme_id": aweme_id,
        "msToken": "",
    }


def parse_douyin_aweme_detail(detail: dict[str, Any]) -> dict[str, Any]:
    video = as_dict(detail.get("video"))
    video_url = first_url(as_dict(first(as_list(video.get("bit_rate")))).get("play_addr")) or first_url(video.get("play_addr"))
    if video_url:
        video_url = video_url.replace("playwm", "play")
    statistics = as_dict(detail.get("statistics"))
    author = as_dict(detail.get("author"))
    duration_ms = number_or_zero(video.get("duration"))
    return {
        "title": detail.get("desc") or detail.get("preview_title") or "",
        "author": author.get("nickname") or author.get("unique_id") or "",
        "duration": duration_ms / 1000 if duration_ms > 1000 else duration_ms,
        "likes": statistics.get("digg_count"),
        "comments": statistics.get("comment_count"),
        "shares": statistics.get("share_count"),
        "coverUrl": first_url(video.get("cover")) or first_url(video.get("origin_cover")),
        "videoUrl": video_url,
    }


def normalize_bilibili_url(url: str, timeout_ms: int, cookie_header: str = "") -> str:
    parsed = urlparse(url)
    if "b23.tv" in parsed.netloc:
        url = resolve_url(url, timeout_ms, cookie_header)
        parsed = urlparse(url)
    match = re.search(r"/video/(BV[0-9A-Za-z]+|av\d+)", parsed.path, re.I)
    if match:
        return f"https://www.bilibili.com/video/{match.group(1)}"
    return url


def extract_bilibili_id(url: str) -> tuple[str, str]:
    match = re.search(r"/video/(BV[0-9A-Za-z]+)", url, re.I)
    if match:
        return "bvid", match.group(1)
    match = re.search(r"/video/(av\d+)", url, re.I)
    if match:
        return "aid", match.group(1)[2:]
    raise ViralWorkerError("无法从 B 站链接中识别 BV/AV 号。")


def download_bilibili(request: WorkerRequest, cookie: CookieAttempt) -> dict[str, Any]:
    normalized_url = normalize_bilibili_url(request.url, request.timeout_ms, cookie.header)
    id_kind, video_id = extract_bilibili_id(normalized_url)
    page_data = fetch_bilibili_page_data(normalized_url, request.timeout_ms, cookie.header)
    metadata = build_bilibili_metadata(page_data, id_kind, video_id, request.timeout_ms, cookie.header)
    video_path = request.work_dir / "video.mp4"
    if metadata.get("progressiveUrl"):
        download_media_url(str(metadata["progressiveUrl"]), video_path, normalized_url, request.timeout_ms, cookie.header, validate_video=True)
    else:
        video_url = str(metadata.get("videoUrl") or "")
        audio_url = str(metadata.get("audioUrl") or "")
        if not video_url or not audio_url:
            raise ViralWorkerError("B站下载地址缺少视频流或音频流。")
        merge_bilibili_streams(video_url, audio_url, video_path, request, cookie, normalized_url)
    cover_path = download_cover(metadata.get("coverUrl"), request.work_dir, normalized_url, request.timeout_ms, cookie.header)
    source = {
        "platform": "bilibili",
        "url": request.url,
        "normalizedUrl": normalized_url,
        "downloadProvider": "bilibili-internal",
        "usedCookieSource": cookie.source,
        "videoPath": str(video_path),
        "coverPath": cover_path,
        "title": str(metadata.get("title") or ""),
        "author": str(metadata.get("author") or ""),
        "duration": number_or_zero(metadata.get("duration")),
        "stats": {
            "likes": nullable_number(metadata.get("likes")),
            "comments": nullable_number(metadata.get("comments")),
            "shares": nullable_number(metadata.get("shares")),
        },
    }
    return media_result(video_path, source, "bilibili-internal", normalized_url, cookie.source, metadata.get("raw"))


def fetch_bilibili_page_data(url: str, timeout_ms: int, cookie_header: str) -> dict[str, Any]:
    headers = common_headers(url, cookie_header)
    headers["Referer"] = "https://www.bilibili.com/"
    with httpx.Client(follow_redirects=True, timeout=timeout_ms / 1000) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
    html = response.text
    return {
        "playinfo": extract_json_assignment(html, "window.__playinfo__"),
        "initial": extract_json_assignment(html, "window.__INITIAL_STATE__"),
        "htmlTitle": extract_html_title(html),
    }


def build_bilibili_metadata(page_data: dict[str, Any], id_kind: str, video_id: str, timeout_ms: int, cookie_header: str) -> dict[str, Any]:
    initial = as_dict(page_data.get("initial"))
    playinfo = as_dict(page_data.get("playinfo"))
    view = as_dict(initial.get("videoData")) or fetch_bilibili_view_api(id_kind, video_id, timeout_ms, cookie_header)
    cid = str(view.get("cid") or first([as_dict(item).get("cid") for item in as_list(view.get("pages")) if as_dict(item).get("cid")]) or "")
    if not playinfo and cid:
        playinfo = fetch_bilibili_playurl_api(id_kind, video_id, cid, timeout_ms, cookie_header)
    play_data = as_dict(playinfo.get("data")) or playinfo
    progressive_url = ""
    durl = as_list(play_data.get("durl"))
    if durl:
        progressive_url = str(as_dict(first(durl)).get("url") or "")
    dash = as_dict(play_data.get("dash"))
    video_url = choose_bilibili_stream(as_list(dash.get("video")))
    audio_url = choose_bilibili_stream(as_list(dash.get("audio")))
    owner = as_dict(view.get("owner"))
    stat = as_dict(view.get("stat"))
    return {
        "title": view.get("title") or page_data.get("htmlTitle") or "",
        "author": owner.get("name") or "",
        "duration": view.get("duration") or 0,
        "likes": stat.get("like"),
        "comments": stat.get("reply"),
        "shares": stat.get("share"),
        "coverUrl": view.get("pic") or "",
        "progressiveUrl": progressive_url,
        "videoUrl": video_url,
        "audioUrl": audio_url,
        "raw": {"view": view, "playinfo": playinfo},
    }


def fetch_bilibili_view_api(id_kind: str, video_id: str, timeout_ms: int, cookie_header: str) -> dict[str, Any]:
    query = urlencode({id_kind: video_id})
    endpoint = f"https://api.bilibili.com/x/web-interface/view?{query}"
    with httpx.Client(follow_redirects=True, timeout=timeout_ms / 1000) as client:
        response = client.get(endpoint, headers=common_headers("https://www.bilibili.com/", cookie_header))
        response.raise_for_status()
        payload = response.json()
    data = as_dict(payload.get("data"))
    if not data:
        raise ViralWorkerError(str(payload.get("message") or "B站公开详情接口没有返回视频数据。"))
    return data


def fetch_bilibili_playurl_api(id_kind: str, video_id: str, cid: str, timeout_ms: int, cookie_header: str) -> dict[str, Any]:
    query = {
        id_kind: video_id,
        "cid": cid,
        "qn": "80",
        "fnval": "4048",
        "fourk": "1",
        "platform": "html5",
    }
    endpoint = f"https://api.bilibili.com/x/player/playurl?{urlencode(query)}"
    with httpx.Client(follow_redirects=True, timeout=timeout_ms / 1000) as client:
        response = client.get(endpoint, headers=common_headers("https://www.bilibili.com/", cookie_header))
        response.raise_for_status()
        payload = response.json()
    data = as_dict(payload.get("data"))
    if not data:
        raise ViralWorkerError(str(payload.get("message") or "B站公开播放接口没有返回下载地址。"))
    return {"data": data}


def choose_bilibili_stream(streams: list[Any]) -> str:
    if not streams:
        return ""
    def score(item: Any) -> int:
        data = as_dict(item)
        return int(data.get("bandwidth") or data.get("id") or 0)
    best = as_dict(max(streams, key=score))
    return str(best.get("baseUrl") or best.get("base_url") or first(best.get("backupUrl")) or first(best.get("backup_url")) or "")


def merge_bilibili_streams(video_url: str, audio_url: str, output_path: Path, request: WorkerRequest, cookie: CookieAttempt, referer: str) -> None:
    video_temp = request.work_dir / "bilibili-video.m4s"
    audio_temp = request.work_dir / "bilibili-audio.m4s"
    download_media_url(video_url, video_temp, referer, request.timeout_ms, cookie.header)
    download_media_url(audio_url, audio_temp, referer, request.timeout_ms, cookie.header)
    ffmpeg = resolve_ffmpeg()
    command = [
        ffmpeg,
        "-y",
        "-i",
        str(video_temp),
        "-i",
        str(audio_temp),
        "-c:v",
        "copy",
        "-c:a",
        "copy",
        "-f",
        "mp4",
        str(output_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise ViralWorkerError(f"B站音视频合并失败：{result.stderr[-800:]}")


def normalize_kuaishou_url(url: str, timeout_ms: int, cookie_header: str = "") -> str:
    parsed = urlparse(url)
    if "v.kuaishou.com" in parsed.netloc or "gifshow.com" in parsed.netloc or "kwai.com" in parsed.netloc:
        try:
            return resolve_url(url, timeout_ms, cookie_header)
        except Exception:
            return url
    return url


def download_kuaishou(request: WorkerRequest, cookie: CookieAttempt) -> dict[str, Any]:
    normalized_url = normalize_kuaishou_url(request.url, request.timeout_ms, cookie.header)
    metadata = sniff_public_media_with_playwright(request, cookie, normalized_url, "kuaishou")
    video_url = metadata.get("videoUrl") or ""
    if not video_url:
        raise ViralWorkerError("快手公开页面没有嗅探到 mp4/m3u8 视频资源。")
    video_path = request.work_dir / "video.mp4"
    download_media_url(video_url, video_path, normalized_url, request.timeout_ms, cookie.header, validate_video=True)
    cover_path = download_cover(metadata.get("coverUrl"), request.work_dir, normalized_url, request.timeout_ms, cookie.header)
    source = {
        "platform": "kuaishou",
        "url": request.url,
        "normalizedUrl": normalized_url,
        "downloadProvider": "kuaishou-playwright",
        "usedCookieSource": cookie.source,
        "videoPath": str(video_path),
        "coverPath": cover_path,
        "title": str(metadata.get("title") or ""),
        "author": str(metadata.get("author") or ""),
        "duration": number_or_zero(metadata.get("duration")),
        "stats": {"likes": None, "comments": None, "shares": None},
    }
    return media_result(video_path, source, "kuaishou-playwright", normalized_url, cookie.source, metadata.get("raw"))


def sniff_public_media_with_playwright(request: WorkerRequest, cookie: CookieAttempt, url: str, platform: str) -> dict[str, Any]:
    try:
        from playwright.async_api import async_playwright
    except Exception as exc:
        raise ViralWorkerError("Python runtime 缺少 Playwright，无法嗅探公开页面视频资源。") from exc

    async def run() -> dict[str, Any]:
        media_urls: list[str] = []
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(**playwright_launch_options())
            context = await browser.new_context(
                user_agent=USER_AGENT,
                viewport={"width": 1280, "height": 720},
                locale="zh-CN",
                extra_http_headers={"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
            )
            await add_playwright_cookies(context, cookie.header, url)
            page = await context.new_page()

            def on_response(response: Any) -> None:
                headers = response.headers
                content_type = headers.get("content-type", "")
                response_url = response.url
                media_urls.append(response_url)
                if is_media_response(response_url, content_type):
                    media_urls.append(response_url)

            page.on("response", on_response)
            await page.goto(url, wait_until="domcontentloaded", timeout=min(request.timeout_ms, 60000))
            await page.wait_for_timeout(8000)
            metadata = await page.evaluate(
                """() => {
                    const meta = (name) => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content || '';
                    const videos = [...document.querySelectorAll('video')].map((video) => ({
                        src: video.currentSrc || video.src || '',
                        poster: video.poster || '',
                        duration: Number.isFinite(video.duration) ? video.duration : 0
                    }));
                    const scripts = [...document.scripts].map((script) => script.textContent || '').filter(Boolean).slice(0, 80);
                    return {
                        title: meta('og:title') || document.title || '',
                        bodyText: document.body?.innerText || '',
                        coverUrl: meta('og:image') || videos.find((item) => item.poster)?.poster || '',
                        videos,
                        scripts
                    };
                }"""
            )
            await browser.close()
        for item in metadata.get("videos") or []:
            src = item.get("src") or ""
            if src and not src.startswith("blob:"):
                media_urls.insert(0, src)
            if item.get("duration") and not metadata.get("duration"):
                metadata["duration"] = item["duration"]
        script_metadata = parse_media_from_scripts(metadata.get("scripts") or [], platform)
        for item in script_metadata.get("mediaUrls") or []:
            if item:
                media_urls.insert(0, item)
        media_url = choose_sniffed_media_url(media_urls, platform, url)
        if not media_url:
            blocked_reason = blocked_page_reason(platform, url, str(metadata.get("bodyText") or ""), media_urls)
            if blocked_reason:
                raise ViralWorkerError(blocked_reason)
        return {
            "title": clean_title(metadata.get("title") or script_metadata.get("title") or ""),
            "author": script_metadata.get("author") or "",
            "duration": metadata.get("duration") or script_metadata.get("duration") or 0,
            "coverUrl": metadata.get("coverUrl") or script_metadata.get("coverUrl") or "",
            "videoUrl": media_url or "",
            "raw": {"mediaUrls": media_urls[:20], "scriptMetadata": script_metadata},
        }

    return asyncio.run(run())


async def add_playwright_cookies(context: Any, cookie_header: str, url: str) -> None:
    if not cookie_header:
        return
    parsed = urlparse(url)
    cookies = []
    for item in cookie_header.split(";"):
        if "=" not in item:
            continue
        name, value = item.strip().split("=", 1)
        if name:
            cookies.append({"name": name, "value": value, "domain": parsed.hostname or "", "path": "/"})
    if cookies:
        await context.add_cookies(cookies)


def is_media_response(url: str, content_type: str) -> bool:
    lower_url = url.lower()
    lower_type = content_type.lower()
    if is_blocked_download_url(url):
        return False
    if "video/" in lower_type or "mpegurl" in lower_type:
        return True
    return looks_like_video_url(lower_url)


def blocked_page_reason(platform: str, page_url: str, body_text: str, response_urls: list[str]) -> str:
    if platform != "douyin":
        return ""
    combined = " ".join([page_url, body_text[:2000], *response_urls[:80]]).lower()
    if "verifycenter" in combined or "captcha" in combined or "视频数据加载中" in body_text or "登录" in body_text:
        return "抖音页面触发验证或未登录，未暴露可下载视频地址。请在爆款拆解里打开抖音登录窗口完成登录，关闭窗口后重试；也可以配置 Cookie 文件。"
    return ""


def looks_like_video_url(url: str) -> bool:
    lower = url.lower()
    if is_blocked_download_url(lower):
        return False
    if re.search(r"\.(mp4|m4v|mov|webm|m3u8)(\?|$)", lower):
        return True
    if "mime_type=video" in lower or "video_mp4" in lower:
        return True
    if "douyinvod.com" in lower and "/video/" in lower:
        return True
    return False


def is_blocked_download_url(url: str) -> bool:
    lower = url.lower()
    if re.search(r"\.(exe|msi|apk|dmg|zip|7z|rar)(\?|$)", lower):
        return True
    return any(
        marker in lower
        for marker in [
            "douyin_pc_client",
            "douyin-downloader",
            "douyinstopplay",
            "douyin-pc-web/uuu_",
            "douyin-pc-client",
        ]
    )


def choose_sniffed_media_url(media_urls: list[str], platform: str, page_url: str) -> str:
    candidates = [item for item in media_urls if looks_like_video_url(item) and not item.startswith("blob:")]
    if platform == "douyin":
        try:
            aweme_id = extract_douyin_id(page_url)
        except Exception:
            aweme_id = ""
        preferred = [
            item
            for item in candidates
            if "douyinvod.com" in item.lower() and (not aweme_id or f"__vid={aweme_id}" in item or aweme_id in item)
        ]
        if preferred:
            return preferred[0]
        douyin_vod = [item for item in candidates if "douyinvod.com" in item.lower()]
        if douyin_vod:
            return douyin_vod[0]
    return first(candidates) or ""


def playwright_launch_options() -> dict[str, Any]:
    options: dict[str, Any] = {"headless": True}
    executable = find_local_chromium_executable()
    if executable:
        options["executable_path"] = executable
    return options


def find_local_chromium_executable() -> str:
    env_path = os.environ.get("STORYBOUND_CHROMIUM_PATH", "").strip()
    if env_path and Path(env_path).exists():
        return env_path
    candidates = [
        os.path.join(os.environ.get("PROGRAMFILES", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("PROGRAMFILES(X86)", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("PROGRAMFILES", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(os.environ.get("PROGRAMFILES(X86)", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return ""


def parse_media_from_scripts(scripts: list[str], platform: str) -> dict[str, Any]:
    media_urls: list[str] = []
    title = ""
    author = ""
    cover_url = ""
    duration = 0
    for script in scripts:
        normalized_script = normalize_script_escapes(script)
        for raw in re.findall(r"https?://[^\"'<>\\\s]+", normalized_script):
            url = raw
            if looks_like_video_url(url):
                media_urls.append(url)
        for obj in extract_json_objects(normalized_script):
            for candidate in walk_dicts(obj):
                if platform == "douyin" and candidate.get("video"):
                    parsed = parse_douyin_aweme_detail(candidate)
                    if parsed.get("videoUrl"):
                        media_urls.insert(0, parsed["videoUrl"])
                    title = title or str(parsed.get("title") or "")
                    author = author or str(parsed.get("author") or "")
                    cover_url = cover_url or str(parsed.get("coverUrl") or "")
                    duration = duration or number_or_zero(parsed.get("duration"))
                url = first_url(candidate.get("play_addr")) or first_url(candidate.get("download_addr"))
                if url:
                    media_urls.append(url)
                title = title or str(candidate.get("caption") or candidate.get("title") or candidate.get("desc") or "")
                cover_url = cover_url or str(candidate.get("poster") or candidate.get("coverUrl") or candidate.get("cover_url") or "")
    return {
        "mediaUrls": media_urls,
        "title": title,
        "author": author,
        "coverUrl": cover_url,
        "duration": duration,
    }


def normalize_script_escapes(value: str) -> str:
    return value.replace("\\/", "/").replace("\\u002F", "/").replace("\\u002f", "/")


def extract_json_assignment(html: str, marker: str) -> Any:
    index = html.find(marker)
    if index < 0:
        return None
    start = html.find("=", index)
    if start < 0:
        return None
    start += 1
    decoder = json.JSONDecoder()
    try:
        value, _ = decoder.raw_decode(html[start:].lstrip())
        return value
    except Exception:
        return None


def extract_json_objects(text: str) -> list[Any]:
    decoder = json.JSONDecoder()
    values: list[Any] = []
    for match in re.finditer(r"[\{\[]", text):
        try:
            value, _ = decoder.raw_decode(text[match.start() :])
        except Exception:
            continue
        values.append(value)
        if len(values) >= 30:
            break
    return values


def extract_html_title(html: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if not match:
        return ""
    return clean_title(re.sub(r"\s+", " ", match.group(1)).strip())


def clean_title(value: str) -> str:
    return re.sub(r"[_\-\s]*(哔哩哔哩|bilibili|抖音|快手).*$", "", value, flags=re.I).strip()


def download_media_url(url: str, output_path: Path, referer: str, timeout_ms: int, cookie_header: str, validate_video: bool = False) -> None:
    if not url:
        raise ViralWorkerError("下载地址为空。")
    if validate_video and not looks_like_video_url(url):
        raise ViralWorkerError("下载地址不是可识别的视频资源。")
    if ".m3u8" in url.lower():
        ffmpeg_download(url, output_path, referer, timeout_ms, cookie_header)
        if validate_video:
            validate_downloaded_video(output_path)
        return
    headers = common_headers(referer, cookie_header)
    headers["Range"] = "bytes=0-"
    safe_unlink(output_path)
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout_ms / 1000) as client:
            with client.stream("GET", url, headers=headers) as response:
                response.raise_for_status()
                with output_path.open("wb") as out_file:
                    for chunk in response.iter_bytes():
                        if chunk:
                            out_file.write(chunk)
        if output_path.stat().st_size <= 0:
            raise ViralWorkerError("下载地址返回了空文件。")
        if validate_video:
            validate_downloaded_video(output_path)
    except Exception:
        safe_unlink(output_path)
        raise


def ffmpeg_download(url: str, output_path: Path, referer: str, timeout_ms: int, cookie_header: str) -> None:
    ffmpeg = resolve_ffmpeg()
    headers = f"User-Agent: {USER_AGENT}\r\nReferer: {referer}\r\n"
    if cookie_header:
        headers += f"Cookie: {cookie_header}\r\n"
    command = [ffmpeg, "-y", "-headers", headers, "-i", url, "-c", "copy", str(output_path)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=max(30, timeout_ms // 1000))
    if result.returncode != 0:
        raise ViralWorkerError(f"m3u8 下载失败：{result.stderr[-800:]}")
    validate_downloaded_video(output_path)


def download_cover(url: Any, work_dir: Path, referer: str, timeout_ms: int, cookie_header: str) -> str:
    cover_url = str(url or "")
    if not cover_url:
        return ""
    suffix = ".jpg"
    parsed_suffix = Path(urlparse(cover_url).path).suffix.lower()
    if parsed_suffix in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = parsed_suffix
    cover_path = work_dir / f"cover{suffix}"
    try:
        download_media_url(cover_url, cover_path, referer, min(timeout_ms, 60000), cookie_header, validate_video=False)
        return str(cover_path)
    except Exception:
        return ""


def resolve_ffmpeg() -> str:
    try:
        import imageio_ffmpeg

        return str(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        return "ffmpeg"


def media_result(video_path: Path, source: dict[str, Any], provider: str, normalized_url: str, used_cookie_source: str, raw: Any) -> dict[str, Any]:
    if not video_path.exists() or video_path.stat().st_size <= 0:
        raise ViralWorkerError("下载完成但没有生成有效视频文件。")
    validate_downloaded_video(video_path)
    return {
        "videoPath": str(video_path),
        "source": source,
        "provider": provider,
        "normalizedUrl": normalized_url,
        "usedCookieSource": used_cookie_source,
        "raw": raw,
    }


def validate_downloaded_video(path: Path) -> None:
    with path.open("rb") as file:
        header = file.read(16)
    if b"ftyp" in header or header.startswith(b"\x1aE\xdf\xa3"):
        return
    if header.startswith(b"MZ"):
        raise ViralWorkerError("下载地址返回了安装包而不是视频文件。")
    raise ViralWorkerError("下载完成但文件头不是可识别的视频格式。")


def safe_unlink(path: Path) -> None:
    if not path.exists():
        return
    last_error: Exception | None = None
    for _ in range(20):
        try:
            path.unlink()
            return
        except PermissionError as exc:
            last_error = exc
            time.sleep(0.25)
    if last_error:
        raise last_error


def first(value: Any) -> Any:
    if isinstance(value, (list, tuple)) and value:
        return value[0]
    return value


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def first_url(value: Any) -> str:
    data = as_dict(value)
    if data:
        return str(first(data.get("url_list") or data.get("UrlList") or data.get("backup_url") or []) or data.get("url") or "")
    if isinstance(value, list):
        return str(first(value) or "")
    if isinstance(value, str):
        return value
    return ""


def walk_dicts(value: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    stack = [value]
    while stack and len(found) < 1000:
        item = stack.pop()
        if isinstance(item, dict):
            found.append(item)
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return found


def nullable_number(value: Any) -> int | float | None:
    try:
        if value is None or value == "":
            return None
        parsed = float(value)
        if parsed.is_integer():
            return int(parsed)
        return parsed
    except Exception:
        return None


def number_or_zero(value: Any) -> float:
    parsed = nullable_number(value)
    return float(parsed) if parsed is not None else 0


def normalize_error_message(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status in {401, 403}:
            return f"平台风控或登录权限限制（HTTP {status}）。"
        if status == 404:
            return "公开视频不可访问或已删除（HTTP 404）。"
        return f"平台请求失败（HTTP {status}）。"
    if isinstance(exc, subprocess.TimeoutExpired):
        return "下载或合并超时。"
    if "browser_cookie3" in message or "cookie" in message.lower() and "decrypt" in message.lower():
        return "浏览器 cookie 不存在或无法解密。"
    return message


if __name__ == "__main__":
    raise SystemExit(main())
