"""Isolated Electron QA for per-character, per-cue motion-comic narration.

The only synthesis endpoint is an in-process HTTP server on 127.0.0.1. A
temporary Node preload redirects the fixed MiniMax URL before the app starts
and rejects every other non-loopback fetch. No production credentials are read.
"""
from __future__ import annotations

import importlib.util
import io
import json
import math
import os
import shutil
import struct
import subprocess
import tempfile
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any

from playwright.sync_api import Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".artifacts" / "motion-comic-dialogue"
TEMP_ROOT = ROOT / ".artifacts" / "subtitle-validation-temp"
PROJECT_TITLE = "雨夜对白 · 角色配音验收"
FIRST_TEXT = "这封信来自未来，我们必须马上离开。"
SECOND_TEXT = "先别急，我要核对信上的日期。"
DESKTOP = (1536, 1024)
COMPACT = (1040, 720)

_spec = importlib.util.spec_from_file_location("motion_comic_qa_helpers", ROOT / "scripts" / "qa-motion-comic.py")
assert _spec and _spec.loader
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
base.ARTIFACTS = ARTIFACTS
base.PROJECT_TITLE = PROJECT_TITLE


def fixture_wav(frequency: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        rate = 32_000
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(rate)
        samples = (int(math.sin(index * 2 * math.pi * frequency / rate) * 6500) for index in range(rate * 2))
        stream.writeframes(b"".join(struct.pack("<h", value) for value in samples))
    return output.getvalue()


def start_tts_stub() -> tuple[ThreadingHTTPServer, Thread, dict[str, Any], str]:
    state: dict[str, Any] = {"requests": [], "unexpectedRequests": []}
    payloads = {"female-shaonv": fixture_wav(440), "male-qn-jingying": fixture_wav(660)}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 128_000 or self.path != "/v1/t2a_v2":
                state["unexpectedRequests"].append({"method": "POST", "path": self.path, "length": length})
                self.send_error(400)
                return
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            voice = body.get("voice_setting", {})
            record = {"text": body.get("text"), "voiceId": voice.get("voice_id"), "speed": voice.get("speed"), "model": body.get("model")}
            state["requests"].append(record)
            data = payloads.get(str(record["voiceId"]))
            if data is None:
                self.send_error(400, "Only the two explicitly configured QA voices are permitted")
                return
            response = json.dumps({"data": {"audio": data.hex()}, "base_resp": {"status_code": 0, "status_msg": "local QA fixture"}}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def do_GET(self) -> None:
            state["unexpectedRequests"].append({"method": "GET", "path": self.path})
            self.send_error(404)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, name="motion-comic-dialogue-local-tts", daemon=True)
    thread.start()
    return server, thread, state, f"http://127.0.0.1:{server.server_address[1]}"


def create_network_guard(profile: Path, base_url: str) -> Path:
    """Generated QA fixture, not a modification of the application runtime."""
    preload = profile / "dialogue-network-guard.cjs"
    audit = profile / "dialogue-network-audit.jsonl"
    ready = profile / "dialogue-network-ready.json"
    preload.write_text(
        "const fs = require('node:fs');\n"
        f"const auditPath = {json.dumps(str(audit))};\n"
        f"const readyPath = {json.dumps(str(ready))};\n"
        f"const localOrigin = {json.dumps(base_url)};\n"
        "const originalFetch = globalThis.fetch.bind(globalThis);\n"
        "const append = value => fs.appendFileSync(auditPath, JSON.stringify(value) + '\\n', 'utf8');\n"
        "globalThis.fetch = (input, options = {}) => {\n"
        "  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);\n"
        "  if (url.href === 'https://api.minimaxi.com/v1/t2a_v2') {\n"
        "    const { dispatcher, ...safeOptions } = options;\n"
        "    append({ kind: 'local-tts-redirect', origin: url.origin, path: url.pathname });\n"
        "    return originalFetch(localOrigin + '/v1/t2a_v2', safeOptions);\n"
        "  }\n"
        "  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, options);\n"
        "  append({ kind: 'blocked-external-fetch', origin: url.origin, path: url.pathname });\n"
        "  return Promise.reject(new Error('QA_EXTERNAL_FETCH_BLOCKED: ' + url.origin));\n"
        "};\n"
        "fs.writeFileSync(readyPath, JSON.stringify({ pid: process.pid, localOrigin, externalFetchBlocked: true }), 'utf8');\n",
        encoding="utf-8",
    )
    return preload


def configure_local_tts(page: Page) -> dict[str, Any]:
    return page.evaluate("""async () => {
      const state = await window.storydream.getBootstrap();
      const config = structuredClone(state.config);
      const minimax = { ...config.tts.minimax, model: 'speech-02-hd', voiceId: 'female-shaonv' };
      config.tts = { ...config.tts, provider: 'minimax', minimax };
      config.ttsProfiles = [{ ...config.ttsProfiles[0], id: 'qa-dialogue-minimax', name: '本地 MiniMax 桩', enabled: true, provider: 'minimax', minimax }];
      config.activeTtsProfileId = 'qa-dialogue-minimax';
      await window.storydream.saveConfig({ config, secretChanges: {
        'tts/qa-dialogue-minimax/minimax/apiKey': 'qa-loopback-only-never-a-production-key',
        'tts/@active/minimax/apiKey': 'qa-loopback-only-never-a-production-key',
      } });
      const saved = await window.storydream.getBootstrap();
      return { activeTtsProfileId: saved.config.activeTtsProfileId, provider: saved.config.tts.provider,
        secretConfigured: saved.secretStatus['tts/qa-dialogue-minimax/minimax/apiKey'] === true };
    }""")


def create_project(page: Page) -> str:
    base.navigate_sidebar(page, "motion-comic", "[data-motion-comic-workbench='true'] [data-director-create-wizard]")
    page.get_by_role("textbox", name="系列名称", exact=True).fill(PROJECT_TITLE)
    page.get_by_role("textbox", name="核心设定", exact=True).fill(base.PROJECT_PREMISE)
    page.get_by_role("textbox", name="首集标题", exact=True).fill("信中的两个人")
    page.get_by_role("button", name="下一步", exact=True).click()
    page.get_by_role("textbox", name="主角", exact=True).fill("林夏")
    page.get_by_role("textbox", name="关键人物", exact=True).fill("周沉")
    page.get_by_role("textbox", name="核心场景", exact=True).fill("旧城雨巷")
    page.get_by_role("button", name="下一步", exact=True).click()
    page.get_by_role("button", name="创建 AI 漫剧系列", exact=True).click()
    page.wait_for_selector(".director-desk", timeout=30_000)
    return str(base.find_created_task(page)["id"])


def inject_dialogue_fixture(page: Page, task_id: str, image_path: Path) -> dict[str, Any]:
    return page.evaluate("""async ({ id, imagePath }) => {
      const task = await window.storydream.getTaskDetail(id);
      const document = JSON.parse(task.pipelineData);
      const imported = await window.storydream.addImageLabRecord({ prompt: '本地对白 QA 首帧', ratio: document.ratio,
        style: 'reference', provider: 'local-import', imagePath, resolution: '2K', quality: 'high', smartMode: 'reference-edit', upstreamTaskId: id });
      const record = await window.storydream.getImageLabRecordDetail(imported.patch.record.id);
      const asset = { id: 'qa-dialogue-first-frame', assetId: 'qa-dialogue-first-frame', kind: 'image', localPath: record.imagePath,
        provider: 'local-import', createdAt: document.createdAt, selected: true, pinned: true };
      document.assets.push(asset);
      const episode = document.episodes.find(item => item.id === document.activeEpisodeId) ?? document.episodes[0];
      const shot = episode.scenes[0].shots[0];
      const timeline = episode.timeline.clips.find(item => item.shotId === shot.id);
      if (shot.durationMs < 5000) throw new Error('QA first shot must have room for two cues and a gap');
      shot.firstFrameAssetVersionId = asset.id;
      delete shot.voiceAssetVersionId;
      const cueIds = [`${shot.id}-qa-cue-a`, `${shot.id}-qa-cue-b`];
      episode.dialogueCues = episode.dialogueCues.filter(cue => cue.shotId !== shot.id);
      episode.dialogueCues.push(
        { id: cueIds[0], shotId: shot.id, startMs: timeline.startMs, endMs: timeline.startMs + 2000, text: '待编辑第一句', emotion: '自然' },
        { id: cueIds[1], shotId: shot.id, startMs: timeline.startMs + 3000, endMs: timeline.startMs + 5000, text: '待编辑第二句', emotion: '自然' }
      );
      shot.dialogueCueIds = cueIds;
      timeline.subtitleCueIds = cueIds;
      timeline.assetVersionIds = [asset.id];
      episode.timeline.audioClips = [];
      episode.timeline.audioAssetVersionIds = [];
      await window.storydream.saveMotionComic({ id, expectedUpdatedAt: document.updatedAt, document });
      return { shotId: shot.id, cueIds, characterIds: document.characters.map(character => character.id),
        characterNames: document.characters.map(character => character.name), shotStartMs: timeline.startMs, durationMs: shot.durationMs };
    }""", {"id": task_id, "imagePath": str(image_path)})


def saved_state(page: Page, task_id: str, shot_id: str) -> dict[str, Any]:
    return page.evaluate("""async ({ id, shotId }) => {
      const task = await window.storydream.getTaskDetail(id);
      const document = JSON.parse(task.pipelineData);
      const episode = document.episodes.find(item => item.id === document.activeEpisodeId) ?? document.episodes[0];
      const shot = episode.scenes.flatMap(scene => scene.shots).find(item => item.id === shotId);
      return { characters: document.characters.map(character => ({ id: character.id, name: character.name, voiceProvider: character.voiceProvider, voiceId: character.voiceId, voiceSpeed: character.voiceSpeed })),
        cues: shot.dialogueCueIds.map(cueId => episode.dialogueCues.find(cue => cue.id === cueId)),
        clips: (episode.timeline.audioClips ?? []).filter(clip => clip.shotId === shotId),
        assets: document.assets.filter(asset => asset.kind === 'audio').map(asset => ({ id: asset.id, assetId: asset.assetId, localPath: asset.localPath })),
        jobs: document.providerJobs.filter(job => job.nodeId === shotId && job.capability === 'text-to-speech').map(job => ({ id: job.id, status: job.status })),
        shotVoiceAssetVersionId: shot.voiceAssetVersionId ?? null };
    }""", {"id": task_id, "shotId": shot_id})


def reset_scroll(page: Page) -> None:
    page.locator(".director-inspector-scroll").evaluate("element => { element.scrollTop = 0; }")


def reachable(locator: Any, label: str) -> dict[str, Any]:
    locator.scroll_into_view_if_needed(timeout=15_000)
    result = locator.evaluate("""element => {
      const box = element.getBoundingClientRect();
      const points = [[.2,.3],[.5,.5],[.8,.7]].map(([x,y]) => ({ x: box.left + box.width*x, y: box.top + box.height*y }));
      return { width: box.width, height: box.height, viewport: box.left >= -1 && box.right <= innerWidth+1 && box.top >= -1 && box.bottom <= innerHeight+1,
        hit: points.every(point => { const top = document.elementFromPoint(point.x,point.y); return top === element || element.contains(top); }) };
    }""")
    if not result["viewport"] or not result["hit"] or result["width"] < 10 or result["height"] < 10:
        raise AssertionError(f"Unreachable {label}: {result}")
    return result


def capture_subtitles(page: Page, report: dict[str, Any], state: str, size: tuple[int, int]) -> None:
    base.set_window_size(page, *size)
    page.get_by_role("tab", name="字幕", exact=True).click()
    editor = page.locator("[data-director-subtitle-editor='true']")
    expect(editor).to_be_visible()
    checks = {}
    for role, name in [("combobox", "字幕句子"), ("combobox", "本句配音角色"), ("textbox", "字幕内容"),
                       ("textbox", "开始（秒）"), ("textbox", "结束（秒）"), ("button", "应用时间")]:
        checks[name] = reachable(editor.get_by_role(role, name=name, exact=True), name)
    editor.get_by_role("combobox", name="本句配音角色", exact=True).scroll_into_view_if_needed()
    page.wait_for_timeout(200)
    snapshot = base.base_snapshot(page, ".director-desk")
    base.assert_base_snapshot(snapshot, f"dialogue-{state}-{size[0]}", 100)
    snapshot["reachableSubtitleControls"] = checks
    preview = page.locator(".director-media-preview").bounding_box()
    preview_rect = {**preview, "right": preview["x"] + preview["width"], "bottom": preview["y"] + preview["height"]} if preview else None
    base.save_capture(page, report, f"dialogue-{state}", "dialogue", state, *size, snapshot, preview_rect)


def edit_character_voices(page: Page, report: dict[str, Any]) -> None:
    base.set_window_size(page, *DESKTOP)
    base.open_series_bible(page)
    female = page.get_by_role("combobox", name="林夏音色", exact=True)
    male = page.get_by_role("combobox", name="周沉音色", exact=True)
    expect(female).to_be_visible(timeout=15_000)
    female.select_option("female-shaonv")
    page.get_by_role("combobox", name="林夏语速", exact=True).select_option("1")
    male.select_option("male-qn-jingying")
    page.get_by_role("combobox", name="周沉语速", exact=True).select_option("1.2")
    for size in [DESKTOP, COMPACT]:
        base.set_window_size(page, *size)
        female.scroll_into_view_if_needed()
        page.screenshot(path=ARTIFACTS / f"character-voices-{size[0]}x{size[1]}.png", full_page=False)
    page.get_by_role("button", name="保存系列圣经", exact=True).click()
    page.wait_for_selector(".director-desk", timeout=30_000)
    report["interactions"]["characterVoiceSelection"] = {"female": "female-shaonv", "male": "male-qn-jingying", "speeds": [1, 1.2]}


def edit_cues(page: Page, fixture: dict[str, Any]) -> None:
    base.set_window_size(page, *DESKTOP)
    page.get_by_role("tab", name="字幕", exact=True).click()
    editor = page.locator("[data-director-subtitle-editor='true']")
    for index, text in enumerate([FIRST_TEXT, SECOND_TEXT]):
        selector = editor.get_by_role("combobox", name="字幕句子", exact=True)
        selector.select_option(fixture["cueIds"][index])
        character = editor.get_by_role("combobox", name="本句配音角色", exact=True)
        character.scroll_into_view_if_needed()
        character.select_option(fixture["characterIds"][index])
        content = editor.get_by_role("textbox", name="字幕内容", exact=True)
        content.fill(text)
        expect(content).to_have_value(text)
    page.get_by_role("button", name="保存版本", exact=True).click()


def assert_authored_state(value: dict[str, Any], fixture: dict[str, Any], generated: bool) -> None:
    if [cue["text"] for cue in value["cues"]] != [FIRST_TEXT, SECOND_TEXT]:
        raise AssertionError(f"Independent subtitle text did not persist: {value['cues']}")
    if [cue.get("characterId") for cue in value["cues"]] != fixture["characterIds"][:2]:
        raise AssertionError(f"Per-cue character bindings did not persist: {value['cues']}")
    if [character.get("voiceId") for character in value["characters"][:2]] != ["female-shaonv", "male-qn-jingying"]:
        raise AssertionError(f"Character voices did not persist: {value['characters']}")
    if generated:
        if len(value["clips"]) != 2 or len(value["assets"]) != 2 or len(value["jobs"]) != 2 or any(job["status"] != "completed" for job in value["jobs"]):
            raise AssertionError(f"Independent TTS assets/clips/jobs were not persisted: {value}")
        if value["shotVoiceAssetVersionId"] is not None:
            raise AssertionError("Independent cue audio incorrectly became aggregate shot narration")
        ids = {asset["id"] for asset in value["assets"]}
        for cue in value["cues"]:
            matches = [clip for clip in value["clips"] if clip["assetVersionId"] == cue.get("voiceAssetVersionId")]
            if cue.get("voiceAssetVersionId") not in ids or len(matches) != 1 or matches[0]["startMs"] != cue["startMs"]:
                raise AssertionError(f"Cue/clip/audio version mismatch: {cue}, {matches}")
        for asset in value["assets"]:
            if not Path(asset["localPath"]).is_file() or Path(asset["localPath"]).stat().st_size < 1000:
                raise AssertionError(f"Generated audio does not exist: {asset['id']}")


def generate_two_voices(page: Page, task_id: str, fixture: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    base.set_window_size(page, *DESKTOP)
    page.get_by_role("tab", name="字幕", exact=True).click()
    reset_scroll(page)
    editor = page.locator("[data-director-subtitle-editor='true']")
    for cue_id in fixture["cueIds"]:
        selector = editor.get_by_role("combobox", name="字幕句子", exact=True)
        expect(selector).to_be_enabled(timeout=15_000)
        selector.select_option(cue_id)
        button = editor.get_by_role("button", name="生成本句配音", exact=True)
        expect(button).to_be_enabled(timeout=15_000)
        button.click()
        page.wait_for_function("""async ({id,shotId,cueId}) => {
          const task = await window.storydream.getTaskDetail(id); const data = JSON.parse(task.pipelineData);
          const episode = data.episodes.find(item => item.id === data.activeEpisodeId) ?? data.episodes[0];
          return episode.dialogueCues.some(cue => cue.id === cueId && cue.voiceAssetVersionId);
        }""", arg={"id": task_id, "shotId": fixture["shotId"], "cueId": cue_id}, timeout=30_000)
    page.wait_for_function("""async ({id,shotId}) => {
      const task = await window.storydream.getTaskDetail(id); const data = JSON.parse(task.pipelineData);
      const episode = data.episodes.find(item => item.id === data.activeEpisodeId) ?? data.episodes[0];
      return (episode.timeline.audioClips ?? []).filter(clip => clip.shotId === shotId).length === 2
        && data.providerJobs.filter(job => job.nodeId === shotId && job.capability === 'text-to-speech' && job.status === 'completed').length === 2;
    }""", arg={"id": task_id, "shotId": fixture["shotId"]}, timeout=30_000)
    if state["unexpectedRequests"] or len(state["requests"]) != 2:
        raise AssertionError(f"Unexpected local provider requests: {state}")
    expected = [(FIRST_TEXT, "female-shaonv", 1), (SECOND_TEXT, "male-qn-jingying", 1.2)]
    actual = [(item["text"], item["voiceId"], item["speed"]) for item in state["requests"]]
    if actual != expected:
        raise AssertionError(f"TTS used wrong per-cue text/voice/speed: {actual}")
    return saved_state(page, task_id, fixture["shotId"])


def verify_audio_playback(page: Page, fixture: dict[str, Any], size: tuple[int, int]) -> dict[str, Any]:
    base.set_window_size(page, *size)
    page.get_by_role("tab", name="字幕", exact=True).click()
    editor = page.locator("[data-director-subtitle-editor='true']")
    editor.get_by_role("combobox", name="字幕句子", exact=True).select_option(fixture["cueIds"][0])
    editor.get_by_role("button", name="定位本句", exact=True).click()
    expect(page.locator("audio[data-audio-clip-id]")).to_have_count(2)
    preview_button = page.locator(".director-preview-transport").get_by_role("button", name="播放", exact=True)
    preview_button.click()
    page.wait_for_function("""() => { const clips = [...document.querySelectorAll('audio[data-audio-clip-id]')]; return clips.length === 2 && !clips[0].paused && clips[0].currentTime > .2 && clips[1].paused; }""", timeout=12_000)
    first = page.locator("audio[data-audio-clip-id]").evaluate_all("nodes => nodes.map(audio => ({ id: audio.dataset.audioClipId, paused: audio.paused, time: audio.currentTime, readyState: audio.readyState }))")
    page.wait_for_function("""() => { const clips = [...document.querySelectorAll('audio[data-audio-clip-id]')]; return clips.length === 2 && clips[0].paused && !clips[1].paused && clips[1].currentTime > .2; }""", timeout=12_000)
    second = page.locator("audio[data-audio-clip-id]").evaluate_all("nodes => nodes.map(audio => ({ id: audio.dataset.audioClipId, paused: audio.paused, time: audio.currentTime, readyState: audio.readyState }))")
    page.locator(".director-preview-transport").get_by_role("button", name="暂停", exact=True).click()
    page.wait_for_timeout(250)
    if not page.locator("audio[data-audio-clip-id]").evaluate_all("nodes => nodes.every(audio => audio.paused)"):
        raise AssertionError("Audio remained playing after preview pause")
    return {"firstCuePlayback": first, "secondCuePlayback": second, "allPausedAfterStop": True}


def verify_export(page: Page, task_id: str, fixture: dict[str, Any]) -> dict[str, Any]:
    """Render a one-shot QA episode, then measure both cues in the actual MP4."""
    page.evaluate("""async ({id,shotId}) => {
      const task = await window.storydream.getTaskDetail(id); const document = JSON.parse(task.pipelineData);
      const episode = document.episodes.find(item => item.id === document.activeEpisodeId);
      const scene = episode.scenes.find(item => item.shots.some(shot => shot.id === shotId));
      const shot = scene.shots.find(item => item.id === shotId);
      episode.scenes = [{ ...scene, shots: [shot] }];
      episode.dialogueCues = episode.dialogueCues.filter(cue => cue.shotId === shotId);
      episode.timeline.clips = episode.timeline.clips.filter(clip => clip.shotId === shotId);
      episode.timeline.durationMs = shot.durationMs;
      await window.storydream.saveMotionComic({ id, expectedUpdatedAt: document.updatedAt, document });
    }""", {"id": task_id, "shotId": fixture["shotId"]})
    base.reopen_project_from_history(page, switch_through_vox=True)
    base.set_window_size(page, *DESKTOP)
    page.get_by_role("tab", name="生成", exact=True).click()
    page.get_by_role("button", name="生成成片", exact=True).click()
    deadline = time.monotonic() + 90
    output: dict[str, Any] = {}
    # Evaluate and inspect the resolved IPC result. A pending Promise is not
    # evidence that the output asset and its atomic completion records exist.
    while time.monotonic() < deadline:
        output = page.evaluate("""async id => {
          const task = await window.storydream.getTaskDetail(id); const document = JSON.parse(task.pipelineData);
          return { stage: document.stage, updatedAt: document.updatedAt, assets: document.assets, providerJobs: document.providerJobs, qualityReports: document.qualityReports,
            asset: document.assets.find(asset => asset.assetId === 'director-final-video' && asset.selected),
            quality: document.qualityReports.at(-1), job: document.providerJobs.filter(job => job.capability === 'deterministic-render').at(-1) };
        }""", task_id)
        if output.get("asset") or (output.get("job") or {}).get("status") == "failed":
            break
        page.wait_for_timeout(250)
    (ARTIFACTS / "export-state.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not output.get("quality") or not output.get("job") or output["quality"]["status"] != "passed" or output["job"]["status"] != "completed":
        raise AssertionError(f"Export quality did not pass: {output}")
    exported = ARTIFACTS / "dialogue-local-fixture.mp4"
    shutil.copy2(output["asset"]["localPath"], exported)
    import imageio_ffmpeg
    decoded = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(exported), "-vn", "-ar", "44100", "-ac", "1", "-f", "wav", "pipe:1"], capture_output=True, check=True)
    with wave.open(io.BytesIO(decoded.stdout), "rb") as audio:
        data = audio.readframes(audio.getnframes())
        rate = audio.getframerate()
    samples = struct.unpack(f"<{len(data)//2}h", data)
    def rms(start: float, end: float) -> float:
        chunk = samples[int(start*rate):int(end*rate)]
        return math.sqrt(sum((value/32768)**2 for value in chunk)/max(1,len(chunk)))
    measured = {"firstCueRms": rms(.3,1.5), "gapRms": rms(2.2,2.8), "secondCueRms": rms(3.3,4.5), "audioDurationSec": len(samples)/rate}
    if measured["firstCueRms"] < .05 or measured["secondCueRms"] < .05 or measured["gapRms"] > .01 or abs(measured["audioDurationSec"]-5) > .15:
        raise AssertionError(f"Actual MP4 dialogue timing or audio failed: {measured}")
    page.screenshot(path=ARTIFACTS / "dialogue-export-1536x1024.png", full_page=False)
    return {"outputPath": str(exported), "quality": output["quality"], "measurements": measured}


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="motion-comic-dialogue-", dir=TEMP_ROOT))
    server, thread, stub_state, origin = start_tts_stub()
    preload = create_network_guard(profile, origin)
    fixture_paths = base.create_reference_fixtures(profile / "images")
    env = os.environ.copy()
    env.update({"NODE_ENV": "production", "NODE_OPTIONS": f'--require="{preload.as_posix()}"', "TEMP": str(TEMP_ROOT), "TMP": str(TEMP_ROOT)})
    env.pop("VITE_DEV_SERVER_URL", None)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    port = base.available_port()
    creation_flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen([str(base.ELECTRON), f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1", "--remote-allow-origins=*", f"--user-data-dir={profile}", str(ROOT)],
                               cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=creation_flags)
    errors: list[dict[str, str]] = []
    report: dict[str, Any] = {"status": "running", "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "processId": process.pid,
        "runtimeErrors": errors, "interactions": {}, "stateAssertions": {}, "captures": [], "paidGenerationCalls": 0,
        "scope": "Isolated profile, temporary Node network guard, loopback MiniMax HTTP stub, local WAV only"}
    browser = None
    page = None
    playwright = None
    try:
        endpoint = base.wait_for_cdp(port, process)
        guard_path = profile / "dialogue-network-ready.json"
        if not guard_path.is_file():
            raise AssertionError("Main-process network guard did not install; refusing to run generation")
        report["networkGuard"] = json.loads(guard_path.read_text(encoding="utf-8"))
        playwright = sync_playwright().start()
        if playwright is not None:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            page.on("pageerror", lambda error: errors.append({"type": "pageerror", "message": str(error)}))
            page.on("console", lambda message: errors.append({"type": "console", "message": message.text}) if message.type == "error" else None)
            base.wait_for_app(page)
            base.set_window_size(page, *DESKTOP)
            base.seed_isolated_provider_profiles(page)
            report["providerPreflight"] = configure_local_tts(page)
            task_id = create_project(page)
            report["taskId"] = task_id
            fixture = inject_dialogue_fixture(page, task_id, fixture_paths[0])
            report["fixture"] = fixture
            base.reopen_project_from_history(page, switch_through_vox=True)
            edit_character_voices(page, report)
            edit_cues(page, fixture)
            before = saved_state(page, task_id, fixture["shotId"])
            assert_authored_state(before, fixture, False)
            base.reopen_project_from_history(page, switch_through_vox=True)
            reopened = saved_state(page, task_id, fixture["shotId"])
            assert_authored_state(reopened, fixture, False)
            report["stateAssertions"]["editedAndReopened"] = reopened
            for size in [DESKTOP, COMPACT]:
                capture_subtitles(page, report, "edited-reopened", size)
            generated = generate_two_voices(page, task_id, fixture, stub_state)
            assert_authored_state(generated, fixture, True)
            base.reopen_project_from_history(page, switch_through_vox=True)
            after = saved_state(page, task_id, fixture["shotId"])
            assert_authored_state(after, fixture, True)
            if generated != after:
                raise AssertionError("Generated cue audio changed after workflow reopen")
            report["stateAssertions"]["generatedAndReopened"] = after
            for size in [DESKTOP, COMPACT]:
                report["interactions"][f"preview-{size[0]}x{size[1]}"] = verify_audio_playback(page, fixture, size)
                capture_subtitles(page, report, "generated-reopened", size)
            report["stateAssertions"]["actualMp4Export"] = verify_export(page, task_id, fixture)
            if errors:
                raise AssertionError(f"Runtime errors during dialogue QA: {errors}")
            report["status"] = "passed"
            browser.close()
            browser = None
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        if page is not None:
            try:
                page.screenshot(path=ARTIFACTS / "99-failure.png", full_page=False)
                report["failurePage"] = page.evaluate("() => ({ view: document.querySelector('.app-shell')?.getAttribute('data-shell-view'), text: document.body.innerText.slice(-6000) })")
            except Exception as capture_error:
                report["failureCaptureError"] = str(capture_error)
        raise
    finally:
        report["stub"] = stub_state
        report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        if playwright is not None:
            playwright.stop()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False) if os.name == "nt" else process.kill()
        try:
            stdout, stderr = process.communicate(timeout=2)
            report["processOutputTail"] = {"stdout": stdout.decode("utf-8", errors="replace")[-4000:], "stderr": stderr.decode("utf-8", errors="replace")[-4000:]}
        except Exception as output_error:
            report["processOutputError"] = str(output_error)
        audit_path = profile / "dialogue-network-audit.jsonl"
        report["networkAudit"] = [json.loads(line) for line in audit_path.read_text(encoding="utf-8").splitlines()] if audit_path.exists() else []
        if any(item["kind"] == "blocked-external-fetch" for item in report["networkAudit"]):
            report["status"] = "failed"
            report["networkError"] = "An unexpected external fetch was blocked"
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        (ARTIFACTS / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        shutil.rmtree(profile, ignore_errors=True)
        print(json.dumps({"status": report["status"], "report": str(ARTIFACTS / 'report.json'), "localTtsRequests": len(stub_state["requests"]), "paidGenerationCalls": 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
