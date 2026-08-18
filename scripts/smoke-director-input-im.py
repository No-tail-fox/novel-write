from __future__ import annotations

import getpass
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".artifacts" / "director-desk-live-smoke"
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


def main() -> None:
    api_key = os.environ.get("INPUT_IM_API_KEY") or getpass.getpass("INPUT_IM_API_KEY: ")
    capture_only = os.environ.get("DIRECTOR_CAPTURE_ONLY") == "1"
    if not api_key.strip():
        raise RuntimeError("INPUT_IM_API_KEY is required.")

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    qa_temp_root = ROOT / ".codex-audit-temp"
    qa_temp_root.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="director-input-im-electron-", dir=qa_temp_root))
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
    report: dict[str, object] = {"processId": process.pid, "runtimeErrors": [], "captureOnly": capture_only}
    try:
        endpoint = wait_for_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            page.on("pageerror", lambda error: report["runtimeErrors"].append(str(error)))
            page.on("console", lambda message: report["runtimeErrors"].append(message.text) if message.type == "error" else None)
            page.wait_for_selector(".app-shell", timeout=30_000)
            page.set_viewport_size({"width": 1536, "height": 1024})

            page.locator("button[data-nav-view='settings']").click()
            page.wait_for_selector(".settings-layout")
            page.locator(".settings-tab", has_text="AI 绘图").click()
            page.locator("label.config-input", has_text="GPT Image 接口地址").locator("input").fill("https://ai.input.im")
            page.locator("label.config-input", has_text="GPT Image 接口密钥").locator("input").fill(api_key)
            model_field = page.locator(".model-picker-field", has_text="GPT Image 模型")
            model_control = model_field.locator("input, select").first
            if model_control.evaluate("element => element.tagName") == "SELECT":
                model_control.select_option("gpt-image-2")
            else:
                model_control.fill("gpt-image-2")
            page.get_by_role("button", name="保存配置", exact=True).click()
            expect(page.locator(".test-result")).to_contain_text("[pass]", timeout=30_000)

            page.locator("button[data-nav-view='editorial-collage']").click()
            page.wait_for_selector("[data-editorial-collage-workbench='true']")
            if page.locator(".director-media-preview").count() > 0:
                page.get_by_role("button", name="新建 VOX 项目", exact=True).click()
            page.get_by_role("textbox", name="项目标题").fill("Director Desk API 连通测试")
            page.get_by_role("textbox", name="原始文案").fill("清晨的城市从旧街巷醒来，阳光越过屋顶，新的生活与旧日记忆在同一条路上交汇。")
            page.get_by_role("button", name="创建 30 秒结构", exact=True).click()
            page.wait_for_selector(".director-media-preview", timeout=30_000)
            if capture_only:
                page.locator(".director-shot-row").nth(1).click()
                page.screenshot(path=ARTIFACTS / "connected-vox-1536x1024.png", full_page=False)
                if report["runtimeErrors"]:
                    raise AssertionError(f"Electron reported runtime errors: {report['runtimeErrors']}")
                report["provider"] = page.locator(".director-provider-line").first.inner_text()
                report["project"] = "Director Desk API 连通测试"
                report["status"] = "passed"
                browser.close()
                return
            generate = page.get_by_role("button", name="生成当前镜头", exact=True)
            expect(generate).to_be_enabled(timeout=15_000)
            report["provider"] = page.locator(".director-provider-line").inner_text()
            report["model"] = page.locator(".director-inspector-actions .sd-field").nth(2).inner_text()
            generate.click()
            completed = page.locator(".director-queue-item.is-completed").first
            expect(completed).to_be_visible(timeout=300_000)
            page.wait_for_timeout(750)
            image = page.locator(".director-media-preview img")
            report["project"] = "Director Desk API 连通测试"
            preview_src = image.get_attribute("src") or ""
            report["previewSrcPrefix"] = preview_src[:80]
            report["previewSrcLength"] = len(preview_src)
            report["queue"] = completed.inner_text()
            page.screenshot(path=ARTIFACTS / "generated-vox-shot.png", full_page=False)

            persisted = page.evaluate(
                """async () => {
                  const page = await window.storydream.listTasks({ taskType: 'editorial-collage', limit: 20 });
                  const summary = page.items.find(item => item.name === 'Director Desk API 连通测试') ?? page.items[0];
                  const task = summary ? await window.storydream.getTaskDetail(summary.id) : null;
                  return task ? { task, document: JSON.parse(task.pipelineData) } : null;
                }"""
            )
            if not persisted:
                raise AssertionError("Generated VOX project could not be loaded through the trusted API.")
            task_id = str(persisted["task"]["id"])
            document = persisted["document"]
            image_assets = [asset for asset in document["assets"] if asset.get("kind") == "image" and asset.get("localPath")]
            image_jobs = [job for job in document["providerJobs"] if job.get("capability") == "text-to-image"]
            if not image_assets or not image_jobs or image_jobs[-1].get("status") != "completed":
                raise AssertionError("Generated image asset or completed provider job was not persisted.")
            generated_path = Path(str(image_assets[-1]["localPath"]))
            if not generated_path.is_file() or generated_path.stat().st_size <= 1_024:
                raise AssertionError(f"Generated image file is missing or empty: {generated_path}")
            evidence_image = ARTIFACTS / f"generated-provider-image{generated_path.suffix or '.png'}"
            shutil.copyfile(generated_path, evidence_image)

            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(".app-shell", timeout=30_000)
            reloaded = page.evaluate(
                """async id => {
                  const task = await window.storydream.getTaskDetail(id);
                  return task ? JSON.parse(task.pipelineData) : null;
                }""",
                task_id,
            )
            if not reloaded or not any(asset.get("localPath") == str(generated_path) for asset in reloaded["assets"]):
                raise AssertionError("Generated image asset did not survive renderer reload.")
            report["persisted"] = {
                "taskId": task_id,
                "imageAssets": len(image_assets),
                "completedImageJobs": len([job for job in image_jobs if job.get("status") == "completed"]),
                "generatedPath": str(generated_path),
                "generatedSizeBytes": generated_path.stat().st_size,
                "evidencePath": str(evidence_image),
                "reloadVerified": True,
            }
            browser.close()

        if report["runtimeErrors"]:
            raise AssertionError(f"Electron reported runtime errors: {report['runtimeErrors']}")
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        api_key = ""
        report_name = "capture-report.json" if capture_only else "report.json"
        (ARTIFACTS / report_name).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
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
