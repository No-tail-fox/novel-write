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
    try:
        endpoint = wait_for_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            page.on("pageerror", lambda error: runtime_errors.append(str(error)))
            page.on("console", lambda message: runtime_errors.append(message.text) if message.type == "error" else None)
            page.wait_for_selector(".app-shell", timeout=30_000)
            page.get_by_role("button", name="VOX 视觉导演").click()
            page.wait_for_selector("[data-editorial-collage-workbench='true']")
            page.get_by_role("textbox", name="项目标题").fill("VOX 成片渲染烟测")
            page.get_by_role("textbox", name="原始文案").fill("第一镜交代地点。第二镜展示变化。第三镜补充证据。第四镜完成结论。")
            page.get_by_role("button", name="创建 30 秒结构").click()
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
                        camera: shot.camera.map(frame => ({ ...frame, atMs: Math.min(frame.atMs, durationMs) })),
                        layers: shot.layers.map((layer, index) => ({
                          ...layer,
                          ...(index === 0 ? { assetVersionId: imageAssetId } : {}),
                          motion: layer.motion.map(frame => ({ ...frame, atMs: Math.min(frame.atMs, durationMs) })),
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

            rendered = page.evaluate("id => window.storydream.renderDirectorProject({ id })", task_id)
            result = rendered["result"]
            output_path = Path(str(result["outputPath"]))
            if not output_path.is_file() or output_path.stat().st_size <= 1_024:
                raise AssertionError(f"Director MP4 is missing or empty: {output_path}")
            header = output_path.read_bytes()[:64]
            if b"ftyp" not in header:
                raise AssertionError("Rendered output does not contain an MP4 file signature.")
            evidence_video = ARTIFACTS / "director-render-smoke.mp4"
            shutil.copyfile(output_path, evidence_video)
            report["renderResult"] = {
                **result,
                "evidencePath": str(evidence_video),
                "evidenceSizeBytes": evidence_video.stat().st_size,
            }

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
