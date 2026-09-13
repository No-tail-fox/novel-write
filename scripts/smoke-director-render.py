from __future__ import annotations

import json
import math
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".artifacts" / "director-render-smoke"
ELECTRON = ROOT / "node_modules" / "electron" / "dist" / "electron.exe"
SOURCE_IMAGE = ROOT / "src" / "assets" / "director-desk" / "preview-city.png"
EXPECTED_WIDTH = 1920
EXPECTED_HEIGHT = 1080
DURATION_TOLERANCE_MS = 160


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


def create_tone(path: Path, duration_ms: int = 900, frequency: int = 330) -> None:
    sample_rate = 16_000
    frame_count = round(sample_rate * duration_ms / 1000)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        frames = bytearray()
        for index in range(frame_count):
            envelope = min(1, index / 400, (frame_count - index) / 400)
            value = round(math.sin(index * frequency * math.tau / sample_rate) * envelope * 5_000)
            frames.extend(struct.pack("<h", value))
        output.writeframes(bytes(frames))


def verify_render_result(
    result: dict[str, object],
    *,
    expected_duration_ms: int,
    evidence_path: Path,
) -> dict[str, object]:
    output_path = Path(str(result.get("outputPath", "")))
    if not output_path.is_file() or output_path.stat().st_size <= 1_024:
        raise AssertionError(f"Director MP4 is missing or empty: {output_path}")
    if b"ftyp" not in output_path.read_bytes()[:64]:
        raise AssertionError("Rendered output does not contain an MP4 file signature.")
    if result.get("hasVideo") is not True or result.get("hasAudio") is not True:
        raise AssertionError(f"Rendered output is missing an audio or video stream: {result}")
    if result.get("hasNonBlackVideo") is not True:
        raise AssertionError(f"Rendered output did not pass the non-black-frame probe: {result}")
    if result.get("width") != EXPECTED_WIDTH or result.get("height") != EXPECTED_HEIGHT:
        raise AssertionError(
            f"Rendered output must be {EXPECTED_WIDTH}x{EXPECTED_HEIGHT}, got "
            f"{result.get('width')}x{result.get('height')}."
        )
    duration_ms = int(result.get("durationMs", 0))
    duration_delta_ms = abs(duration_ms - expected_duration_ms)
    if duration_ms <= 0 or duration_delta_ms > DURATION_TOLERANCE_MS:
        raise AssertionError(
            f"Rendered output duration must be {expected_duration_ms}ms ±{DURATION_TOLERANCE_MS}ms, "
            f"got {duration_ms}ms."
        )
    reported_size = int(result.get("sizeBytes", 0))
    actual_size = output_path.stat().st_size
    if reported_size != actual_size:
        raise AssertionError(f"Rendered output size probe is stale: reported {reported_size}, actual {actual_size}.")

    shutil.copyfile(output_path, evidence_path)
    return {
        **result,
        "evidencePath": str(evidence_path),
        "evidenceSizeBytes": evidence_path.stat().st_size,
        "expectedDurationMs": expected_duration_ms,
        "durationToleranceMs": DURATION_TOLERANCE_MS,
        "durationDeltaMs": duration_delta_ms,
    }


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    qa_temp_root = ROOT / ".codex-audit-temp"
    qa_temp_root.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="director-render-electron-", dir=qa_temp_root))
    fixture_image = ARTIFACTS / "fixture-frame.png"
    fixture_audio = ARTIFACTS / "fixture-voice.wav"
    shutil.copyfile(SOURCE_IMAGE, fixture_image)
    create_tone(fixture_audio)

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
    report: dict[str, object] = {
        "processId": process.pid,
        "runtimeErrors": runtime_errors,
        "fixtureImage": str(fixture_image),
        "fixtureAudio": str(fixture_audio),
    }
    page = None
    try:
        endpoint = wait_for_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            page.on("pageerror", lambda error: runtime_errors.append(str(error)))
            page.on("console", lambda message: runtime_errors.append(message.text) if message.type == "error" else None)
            page.wait_for_selector(".app-shell", timeout=30_000)
            page.locator("button[data-nav-view='editorial-collage']").click()
            try:
                page.wait_for_selector("[data-editorial-collage-workbench='true'] [data-director-create-wizard]", timeout=10_000)
            except Exception:
                page.screenshot(path=ARTIFACTS / "failure-state.png", full_page=False)
                report["failureState"] = page.evaluate(
                    """() => ({
                      title: document.title,
                      bodyText: document.body?.innerText?.slice(0, 6000) || '',
                      activeNavigation: [...document.querySelectorAll('button[data-nav-view]')].map(button => ({
                        view: button.getAttribute('data-nav-view'),
                        label: button.getAttribute('aria-label') || button.textContent?.trim() || '',
                        disabled: button.disabled,
                        active: button.classList.contains('active'),
                      })),
                      editorialWorkbench: Boolean(document.querySelector('[data-editorial-collage-workbench="true"]')),
                      recovery: Boolean(document.querySelector('[data-director-project-recovery]')),
                      loading: Boolean(document.querySelector('[role="status"]')),
                    })"""
                )
                raise
            page.get_by_role("textbox", name="项目标题").fill("VOX 成片渲染烟测")
            page.get_by_role("textbox", name="原始文案").fill("第一镜交代地点。第二镜展示变化。第三镜补充证据。第四镜完成结论。")
            page.get_by_role("button", name="下一步", exact=True).click()
            page.get_by_role("button", name="下一步", exact=True).click()
            page.get_by_role("button", name="创建 VOX 项目", exact=True).click()
            page.wait_for_selector(".director-media-preview")

            task = page.evaluate(
                """async () => {
                  const page = await window.storydream.listTasks({ taskType: 'editorial-collage', limit: 20 });
                  const summary = page.items.find(item => item.name === 'VOX 成片渲染烟测') ?? page.items[0];
                  return summary ? window.storydream.getTaskDetail(summary.id) : null;
                }"""
            )
            if not task:
                raise AssertionError("Created VOX task could not be reloaded through the trusted API.")
            task_id = str(task["id"])
            report["taskId"] = task_id

            prepared = page.evaluate(
                """async ({ id, imagePath, audioPath }) => {
                  const task = await window.storydream.getTaskDetail(id);
                  if (!task) throw new Error('Smoke task disappeared before fixture injection.');
                  const document = JSON.parse(task.pipelineData);
                  const createdAt = new Date().toISOString();
                  const imageAssetId = 'director-smoke-image-v1';
                  const audioAssetId = 'director-smoke-audio-v1';
                  let offsetMs = 0;
                  document.assets = [
                    ...document.assets.filter(asset => asset.id !== imageAssetId && asset.id !== audioAssetId),
                    { id: imageAssetId, assetId: 'director-smoke-image', kind: 'image', localPath: imagePath, createdAt, selected: true, pinned: true },
                    { id: audioAssetId, assetId: 'director-smoke-audio', kind: 'audio', localPath: audioPath, createdAt, selected: true, pinned: true },
                  ];
                  document.beats = document.beats.map((beat) => {
                    const startMs = offsetMs;
                    const durationMs = 800;
                    offsetMs += durationMs;
                    return {
                      ...beat,
                      startMs,
                      durationMs,
                      subtitleCues: beat.subtitleCues.map((cue, index, cues) => ({
                        ...cue,
                        startMs: Math.round(startMs + durationMs * index / cues.length),
                        endMs: Math.round(startMs + durationMs * (index + 1) / cues.length),
                      })),
                      shots: beat.shots.map((shot) => ({
                        ...shot,
                        durationMs,
                        voiceAssetVersionId: audioAssetId,
                        camera: [
                          { atMs: 0, x: .5, y: .5, zoom: 1.01 },
                          { atMs: 400, x: .52, y: .48, zoom: 1.12 },
                          { atMs: 400, x: .48, y: .52, zoom: 1.02 },
                          { atMs: durationMs, x: .49, y: .5, zoom: 1.06 },
                        ],
                        layers: shot.layers.map((layer, index) => ({
                          ...layer,
                          visible: index === 0,
                          zIndex: shot.layers.length - index,
                          ...(index === 0 ? { assetVersionId: imageAssetId } : {}),
                          motion: layer.motion.map(frame => ({ ...frame, scale: frame.scale + .01, atMs: Math.min(frame.atMs, durationMs) })),
                        })),
                      })),
                    };
                  });
                  document.timeline = {
                    durationMs: offsetMs,
                    clips: document.beats.flatMap(beat => beat.shots.map(shot => ({
                      id: `clip-${shot.id}`,
                      shotId: shot.id,
                      startMs: beat.startMs,
                      durationMs: shot.durationMs,
                      assetVersionIds: [imageAssetId],
                      subtitleCueIds: shot.subtitleCueIds,
                      source: 'deterministic',
                    }))),
                    audioAssetVersionIds: [audioAssetId],
                  };
                  await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: document.updatedAt, document });
                  const saved = await window.storydream.getTaskDetail(id);
                  return saved ? JSON.parse(saved.pipelineData) : null;
                }""",
                {"id": task_id, "imagePath": str(fixture_image), "audioPath": str(fixture_audio)},
            )
            if not prepared or len(prepared.get("beats", [])) != 4 or len(prepared.get("assets", [])) < 2:
                raise AssertionError(f"Fixture project did not persist correctly: {prepared}")

            expected_duration_ms = int(prepared["timeline"]["durationMs"])
            report['motionInputs'] = {
                'hiddenLayersExcluded': True,
                'camera': prepared['beats'][0]['shots'][0]['camera'],
                'layers': [{ 'id': layer['id'], 'visible': layer['visible'], 'zIndex': layer['zIndex'], 'motion': layer['motion'] } for layer in prepared['beats'][0]['shots'][0]['layers']],
            }

            rendered = page.evaluate("id => window.storydream.renderDirectorProject({ id })", task_id)
            result = rendered["result"]
            evidence_video = ARTIFACTS / "director-render-smoke.mp4"
            report["renderResult"] = verify_render_result(
                result,
                expected_duration_ms=expected_duration_ms,
                evidence_path=evidence_video,
            )

            persisted = page.evaluate(
                """async id => {
                  const task = await window.storydream.getTaskDetail(id);
                  const document = task ? JSON.parse(task.pipelineData) : null;
                  return { task, document };
                }""",
                task_id,
            )
            document = persisted["document"]
            video_assets = [asset for asset in document["assets"] if asset.get("assetId") == "director-final-video" and asset.get("selected")]
            render_jobs = [job for job in document["providerJobs"] if job.get("capability") == "deterministic-render"]
            if len(video_assets) != 1 or not render_jobs or render_jobs[-1].get("status") != "completed":
                raise AssertionError("Rendered video asset or completed render job was not persisted.")
            if document.get("stage") != "completed" or not persisted["task"].get("outputDir"):
                raise AssertionError("Rendered project did not persist completed stage and output directory.")

            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(".app-shell", timeout=30_000)
            reloaded = page.evaluate(
                """async id => {
                  const task = await window.storydream.getTaskDetail(id);
                  return task ? { task, document: JSON.parse(task.pipelineData) } : null;
                }""",
                task_id,
            )
            if not reloaded or reloaded["document"].get("stage") != "completed":
                raise AssertionError("Completed Director project did not survive renderer reload.")
            if not any(asset.get("assetId") == "director-final-video" for asset in reloaded["document"]["assets"]):
                raise AssertionError("Rendered video asset disappeared after reload.")

            report["persisted"] = {
                "stage": reloaded["document"]["stage"],
                "videoAssets": len([asset for asset in reloaded["document"]["assets"] if asset.get("assetId") == "director-final-video"]),
                "completedRenderJobs": len([job for job in reloaded["document"]["providerJobs"] if job.get("capability") == "deterministic-render" and job.get("status") == "completed"]),
                "qualityReports": len([item for item in reloaded["document"]["qualityReports"] if item.get("stage") == "export" and item.get("status") == "passed"]),
                "outputDir": reloaded["task"].get("outputDir"),
            }

            living_poster_document = page.evaluate(
                """async ({ id, videoPath }) => {
                  const task = await window.storydream.getTaskDetail(id);
                  if (!task) throw new Error('Smoke task disappeared before living-poster fixture injection.');
                  const document = JSON.parse(task.pipelineData);
                  const createdAt = new Date().toISOString();
                  const fixtureAssets = [];
                  const fixtureJobs = [];
                  let shotIndex = 0;
                  document.beats = document.beats.map((beat) => ({
                    ...beat,
                    shots: beat.shots.map((shot) => {
                      shotIndex += 1;
                      const videoAssetVersionId = `director-smoke-video-v${shotIndex}`;
                      const videoJobId = `director-smoke-i2v-job-${shotIndex}`;
                      fixtureJobs.push({
                        id: videoJobId,
                        workflowKind: 'editorial-collage',
                        nodeId: shot.id,
                        providerId: 'local-fixture',
                        model: 'director-render-smoke-local-mp4',
                        capability: 'image-to-video',
                        status: 'completed',
                        inputHash: `local-fixture-${shot.id}`,
                        idempotencyKey: `director-smoke:i2v:${shot.id}:1`,
                        estimatedCost: 0,
                        actualCost: 0,
                        attempt: 1,
                        createdAt,
                        updatedAt: createdAt,
                      });
                      fixtureAssets.push({
                        id: videoAssetVersionId,
                        assetId: `director-smoke-video-${shotIndex}`,
                        kind: 'video',
                        localPath: videoPath,
                        providerJobId: videoJobId,
                        provider: 'local-fixture',
                        model: 'director-render-smoke-local-mp4',
                        createdAt,
                        selected: true,
                        pinned: true,
                      });
                      return {
                        ...shot,
                        renderStrategy: 'living-poster',
                        layers: [],
                        camera: [],
                        videoAssetVersionId,
                        videoJobId,
                      };
                    }),
                  }));
                  document.assets = [
                    ...document.assets.filter(asset => !asset.id.startsWith('director-smoke-video-v')),
                    ...fixtureAssets,
                  ];
                  document.providerJobs = [
                    ...document.providerJobs.filter(job => !job.id.startsWith('director-smoke-i2v-job-')),
                    ...fixtureJobs,
                  ];

                  // Browser-side equivalent of rebuildEditorialTimeline. Keeping this generic
                  // catches future strategy/asset ownership regressions in the real save path.
                  let startMs = 0;
                  const clips = [];
                  const audioAssetVersionIds = [];
                  for (const beat of document.beats) {
                    for (const shot of beat.shots) {
                      const layerAssetVersionIds = shot.layers.flatMap(layer => layer.assetVersionId ? [layer.assetVersionId] : []);
                      const assetVersionIds = shot.renderStrategy === 'deterministic-layers'
                        ? layerAssetVersionIds
                        : shot.renderStrategy === 'living-poster'
                          ? (shot.videoAssetVersionId ? [shot.videoAssetVersionId] : [])
                          : [...layerAssetVersionIds, ...(shot.videoAssetVersionId ? [shot.videoAssetVersionId] : [])];
                      clips.push({
                        id: `clip-${shot.id}`,
                        shotId: shot.id,
                        startMs,
                        durationMs: shot.durationMs,
                        assetVersionIds: [...new Set(assetVersionIds)],
                        subtitleCueIds: [...shot.subtitleCueIds],
                        source: shot.renderStrategy === 'deterministic-layers'
                          ? 'deterministic'
                          : shot.renderStrategy === 'living-poster' ? 'ai-video' : 'mixed',
                      });
                      if (shot.voiceAssetVersionId && !audioAssetVersionIds.includes(shot.voiceAssetVersionId)) {
                        audioAssetVersionIds.push(shot.voiceAssetVersionId);
                      }
                      startMs += shot.durationMs;
                    }
                  }
                  document.timeline = { durationMs: startMs, clips, audioAssetVersionIds };

                  await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: document.updatedAt, document });
                  const saved = await window.storydream.getTaskDetail(id);
                  return saved ? JSON.parse(saved.pipelineData) : null;
                }""",
                {"id": task_id, "videoPath": str(evidence_video)},
            )
            if not living_poster_document:
                raise AssertionError("Living-poster fixture project could not be reloaded after save.")

            living_shots = [
                shot
                for beat in living_poster_document.get("beats", [])
                for shot in beat.get("shots", [])
            ]
            living_assets = {asset["id"]: asset for asset in living_poster_document.get("assets", [])}
            living_jobs = {job["id"]: job for job in living_poster_document.get("providerJobs", [])}
            living_clips = living_poster_document.get("timeline", {}).get("clips", [])
            if len(living_shots) != 4 or len(living_clips) != len(living_shots):
                raise AssertionError("Living-poster fixture must preserve four shots and one authoritative clip per shot.")
            for shot, clip in zip(living_shots, living_clips, strict=True):
                video_asset = living_assets.get(shot.get("videoAssetVersionId"))
                video_job = living_jobs.get(shot.get("videoJobId"))
                if shot.get("renderStrategy") != "living-poster" or shot.get("layers") != [] or shot.get("camera") != []:
                    raise AssertionError(f"Living-poster shot retained a layer/camera fallback: {shot}")
                if not video_asset or video_asset.get("kind") != "video" or video_asset.get("localPath") != str(evidence_video):
                    raise AssertionError(f"Living-poster shot is not bound to the local video fixture: {shot}")
                if video_asset.get("providerJobId") != shot.get("videoJobId"):
                    raise AssertionError(f"Living-poster video asset/job ownership is inconsistent: {shot}")
                if (
                    not video_job
                    or video_job.get("nodeId") != shot.get("id")
                    or video_job.get("capability") != "image-to-video"
                    or video_job.get("status") != "completed"
                    or video_job.get("estimatedCost") != 0
                    or video_job.get("actualCost") != 0
                ):
                    raise AssertionError(f"Living-poster completed zero-cost I2V job is invalid: {shot}")
                if clip.get("source") != "ai-video" or clip.get("assetVersionIds") != [shot.get("videoAssetVersionId")]:
                    raise AssertionError(f"Living-poster timeline does not exclusively consume its video asset: {clip}")

            living_expected_duration_ms = int(living_poster_document["timeline"]["durationMs"])
            if living_expected_duration_ms != expected_duration_ms:
                raise AssertionError(
                    f"Living-poster fixture changed the declared timeline duration from "
                    f"{expected_duration_ms}ms to {living_expected_duration_ms}ms."
                )
            report["livingPosterFixture"] = {
                "sourceVideo": str(evidence_video),
                "shotCount": len(living_shots),
                "completedImageToVideoJobs": sum(
                    1
                    for job in living_jobs.values()
                    if job.get("capability") == "image-to-video" and job.get("status") == "completed"
                ),
                "videoAssetVersionIds": [shot["videoAssetVersionId"] for shot in living_shots],
                "timelineSources": [clip["source"] for clip in living_clips],
                "declaredDurationMs": living_expected_duration_ms,
                "estimatedCost": sum(
                    float(job.get("estimatedCost", 0))
                    for job in living_jobs.values()
                    if job.get("capability") == "image-to-video"
                ),
            }

            living_rendered = page.evaluate("id => window.storydream.renderDirectorProject({ id })", task_id)
            living_result = living_rendered["result"]
            living_evidence_video = ARTIFACTS / "director-render-living-poster-smoke.mp4"
            report["livingPosterRenderResult"] = verify_render_result(
                living_result,
                expected_duration_ms=living_expected_duration_ms,
                evidence_path=living_evidence_video,
            )

            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(".app-shell", timeout=30_000)
            living_reloaded = page.evaluate(
                """async id => {
                  const task = await window.storydream.getTaskDetail(id);
                  return task ? { task, document: JSON.parse(task.pipelineData) } : null;
                }""",
                task_id,
            )
            if not living_reloaded:
                raise AssertionError("Living-poster render did not survive renderer reload.")
            living_document = living_reloaded["document"]
            persisted_living_shots = [
                shot
                for beat in living_document.get("beats", [])
                for shot in beat.get("shots", [])
            ]
            selected_final_assets = [
                asset
                for asset in living_document.get("assets", [])
                if asset.get("assetId") == "director-final-video" and asset.get("selected")
            ]
            completed_render_jobs = [
                job
                for job in living_document.get("providerJobs", [])
                if job.get("capability") == "deterministic-render" and job.get("status") == "completed"
            ]
            completed_i2v_jobs = [
                job
                for job in living_document.get("providerJobs", [])
                if job.get("capability") == "image-to-video" and job.get("status") == "completed"
            ]
            passed_quality_reports = [
                item
                for item in living_document.get("qualityReports", [])
                if item.get("stage") == "export" and item.get("status") == "passed"
            ]
            if living_document.get("stage") != "completed" or not living_reloaded["task"].get("outputDir"):
                raise AssertionError("Living-poster render did not persist completed stage and output directory.")
            if len(selected_final_assets) != 1 or selected_final_assets[0].get("localPath") != living_result.get("outputPath"):
                raise AssertionError("Living-poster render did not persist exactly one selected final-video asset.")
            if len(completed_render_jobs) < 2 or len(completed_i2v_jobs) != len(persisted_living_shots):
                raise AssertionError("Living-poster jobs were not durably persisted after final render.")
            if len(passed_quality_reports) < 2:
                raise AssertionError("Living-poster export quality report was not durably persisted.")
            if any(
                shot.get("renderStrategy") != "living-poster"
                or shot.get("layers") != []
                or shot.get("camera") != []
                for shot in persisted_living_shots
            ):
                raise AssertionError("Living-poster strategy or no-fallback contract changed after reload.")
            if any(clip.get("source") != "ai-video" for clip in living_document.get("timeline", {}).get("clips", [])):
                raise AssertionError("Living-poster authoritative timeline changed after reload.")

            report["livingPosterPersisted"] = {
                "stage": living_document["stage"],
                "selectedFinalVideoAssets": len(selected_final_assets),
                "completedRenderJobs": len(completed_render_jobs),
                "completedImageToVideoJobs": len(completed_i2v_jobs),
                "qualityReports": len(passed_quality_reports),
                "outputDir": living_reloaded["task"].get("outputDir"),
                "renderStrategies": sorted({shot["renderStrategy"] for shot in persisted_living_shots}),
                "timelineSources": sorted({clip["source"] for clip in living_document["timeline"]["clips"]}),
            }
            browser.close()

        if runtime_errors:
            raise AssertionError(f"Electron reported runtime errors: {runtime_errors}")
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        if page is not None:
            try:
                page.screenshot(path=ARTIFACTS / "failure-state.png", full_page=False)
                report["failureState"] = page.evaluate(
                    """() => ({
                      title: document.title,
                      bodyText: document.body?.innerText?.slice(0, 6000) || '',
                      activeNavigation: [...document.querySelectorAll('button[data-nav-view]')].map(button => ({
                        view: button.getAttribute('data-nav-view'),
                        label: button.getAttribute('aria-label') || button.textContent?.trim() || '',
                        disabled: button.disabled,
                        active: button.classList.contains('active'),
                      })),
                      editorialWorkbench: Boolean(document.querySelector('[data-editorial-collage-workbench="true"]')),
                      recovery: Boolean(document.querySelector('[data-director-project-recovery]')),
                      loading: Boolean(document.querySelector('[role="status"]')),
                    })"""
                )
            except Exception as diagnostic_error:
                report["diagnosticError"] = str(diagnostic_error)
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
