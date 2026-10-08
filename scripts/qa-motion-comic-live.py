"""Opt-in, bounded real-model acceptance of the production Electron/IPC workflow.

Run: python scripts/qa-motion-comic-live.py --allow-paid-text
Restart verification (no model calls): --verify-run <successful-artifact-directory>
Uses only the saved active LLM profile; never writes to the source application data.
Credentials remain in the encrypted Electron vault. No image/video/voice calls.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("offline_qa", ROOT / "scripts/qa-motion-comic.py")
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
SOURCE = """第1集 雨停之前
傍晚，林夏在旧邮局柜台前找到一封蓝色信封。周沉站在门边。
林夏说：“这封信是你留下的吗？”
周沉摇头说：“不是。我们去钟楼看看邮戳。”
林夏拿起信封，两人离开邮局。
夜里，两人来到钟楼门前，雨刚停。
周沉指着门上的刻痕说：“邮戳上的图案就在这里。”
林夏说：“先记下图案，明早再来核对。”
两人记下刻痕，带着信封离开钟楼。街道恢复安静。
"""
TITLE = "真实文本验收 · 雨停之前"
EDITED = "这封蓝色信封里的信，是你留下的吗？"


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def create_entry(profile, artifacts, llm):
    base = llm["baseUrl"].rstrip("/")
    base = base if base.endswith("/v1") else base + "/v1"
    protocol = llm.get("protocol", "openai")
    endpoint = base + {"openai": "/chat/completions", "responses": "/responses", "anthropic": "/messages"}[protocol]
    hook = r"""
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {app, ipcMain} = require('electron');
const root = __ROOT__, out = __OUT__, allowed = __ENDPOINT__, model = __MODEL__;
app.setAppPath(root);
app.setPath('userData', __PROFILE__);
const append = (name, value) => fs.appendFileSync(path.join(out, name), JSON.stringify(value)+'\n', 'utf8');
let count = 0;
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (!['http:', 'https:'].includes(url.protocol) || ['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return originalFetch(input, init);
  let body; try { body = JSON.parse(init.body); } catch {}
  if (url.href !== allowed || init.method !== 'POST' || body?.model !== model || count >= 4 || process.env.STORYDREAM_LIVE_QA_READ_ONLY === '1') {
    append('network.jsonl', {kind:'blocked', origin:url.origin, path:url.pathname});
    throw new Error('LIVE_QA_NETWORK_GUARD');
  }
  const id = ++count, started = Date.now();
  append('network.jsonl', {kind:'request', id, model, endpoint:allowed, startedAt:new Date().toISOString()});
  try {
    const response = await originalFetch(input, {...init, redirect:'error'});
    const data = await response.clone().json();
    append('network.jsonl', {kind:'response', id, status:response.status, elapsedMs:Date.now()-started, requestId:data.id ?? null, usage:data.usage ?? null});
    // Only synthetic QA story content, never headers or credentials.
    fs.writeFileSync(path.join(out, `model-response-${id}.json`), JSON.stringify(data,null,2), 'utf8');
    return response;
  } catch (error) {
    append('network.jsonl', {kind:'error', id, elapsedMs:Date.now()-started, name:error.name});
    throw error;
  }
};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (...args) => {
  if (!['motion-comic:plan','motion-comic:apply-plan'].includes(channel)) return listener(...args);
  const started = Date.now();
  try {
    const result = await listener(...args);
    append('ipc.jsonl', {channel, input:args[1], result, elapsedMs:Date.now()-started});
    return result;
  } catch (error) {
    append('ipc.jsonl', {channel, stage:args[1]?.stage, error:error.message, elapsedMs:Date.now()-started});
    throw error;
  }
});
import(pathToFileURL(path.join(root,'dist-electron/electron/main.js')).href);
"""
    for token, value in [("__PROFILE__", str(profile)), ("__ROOT__", str(ROOT)), ("__OUT__", str(artifacts)), ("__ENDPOINT__", endpoint), ("__MODEL__", llm["model"])]:
        hook = hook.replace(token, json.dumps(value))
    (profile / "live-main.cjs").write_text(hook, encoding="utf-8")
    write_json(profile / "package.json", {"name":"storydream-live-qa", "version":"1.0.0", "main":"live-main.cjs"})


def records(artifacts, name):
    return qa.read_json_lines(artifacts / name)


def calls(artifacts):
    return sum(row.get("kind") == "request" for row in records(artifacts, "network.jsonl"))



def verify_evidence(document, ipc_rows):
    episode = document["episodes"][0]
    evidence = episode["planningEvidence"]
    units = evidence["sourceUnits"]
    beats = evidence["beats"]
    shots = [shot for scene in episode["scenes"] for shot in scene["shots"]]
    claims = [beat_id for shot in shots for beat_id in shot["sourceBeatIds"]]
    assert claims == [beat["id"] for beat in beats], "Missing, duplicate, or out-of-order beat claims"
    assert {u["id"] for u in units} == {u for b in beats for u in b["sourceUnitIds"]}
    order = {unit["id"]:i for i, unit in enumerate(units)}
    references = [order[u] for b in beats for u in b["sourceUnitIds"]]
    assert references == sorted(references), "Source order changed"
    cast = {c["id"]:c["name"] for c in document["characters"]}
    dialogue = [b for b in beats if b["kind"] == "dialogue"]
    assert [cast[b["characterId"]] for b in dialogue] == ["林夏", "周沉", "周沉", "林夏"]
    assert [b["text"] for b in dialogue] == [EDITED, "不是。我们去钟楼看看邮戳。", "邮戳上的图案就在这里。", "先记下图案，明早再来核对。"]
    assert len({s["actIndex"] for s in episode["scenes"]}) == 2
    assert [s["actIndex"] for s in episode["scenes"]] == [1, 2]
    clips = {c["shotId"]:c for c in episode["timeline"]["clips"]}
    for cue in episode["dialogueCues"]:
        clip = clips[cue["shotId"]]
        assert cue["characterId"] in cast
        assert clip["startMs"] <= cue["startMs"] < cue["endMs"] <= clip["startMs"] + clip["durationMs"]
    locations = {c["id"] for c in document["sceneAssets"]}
    looks = {look["id"] for c in document["characters"] for look in c["looks"]}
    props = {c["id"] for c in document["props"]}
    for shot in shots:
        assert shot["sceneAssetId"] in locations
        assert set(shot["characterLookIds"]) <= looks
        assert set(shot["propAssetIds"]) <= props
    plans = [r for r in ipc_rows if r["channel"] == "motion-comic:plan"]
    assert [r["input"]["stage"] for r in plans] == ["script", "script", "storyboard"]
    values = [r["result"]["value"] for r in plans]
    assert [v["status"] for v in values] == ["script-ready", "script-ready", "complete"]
    assert values[0]["recovery"]["token"] != values[1]["recovery"]["token"]
    assert plans[1]["input"]["scriptRevisionToken"] == values[0]["recovery"]["token"]
    assert plans[2]["input"]["resumeToken"] == values[1]["recovery"]["token"]
    assert not document["providerJobs"] and not document["assets"]
    assert "\ufffd" not in json.dumps(document, ensure_ascii=False)
    return {"sourceUnitsCovered":len(units), "sourceOrderPreserved":True, "beatsExactlyOnceInOrder":len(beats), "speakers":[cast[b["characterId"]] for b in dialogue], "dialogueTextPreserved":True, "cueTimingWithinShots":True, "entityReferencesValid":True, "manualRevisionTokenRotated":True, "shots":len(shots), "durationSec":sum(s["durationMs"] for s in shots)/1000}


def reopen_project(page, task_id):
    qa.navigate_sidebar(page, "projects", "[data-project-home]")
    card = page.locator(f'[data-project-id="{task_id}"]')
    card.get_by_role("button", name="继续编辑", exact=True).click()
    page.wait_for_selector("[data-motion-comic-production]")



def remove_test_vault(profile):
    profile = profile.resolve()
    assert profile.is_relative_to((ROOT / ".codex-audit-temp").resolve())
    vault_copy = profile / "storydream/secrets.v1.json"
    if vault_copy.exists():
        vault_copy.unlink()


def postflight(artifacts):
    artifacts = artifacts.resolve()
    original = json.loads((artifacts / "report.json").read_text(encoding="utf-8"))
    assert original["status"] == "passed", "Postflight requires a completed real-model run"
    profile = Path(original["profile"]).resolve()
    assert profile.is_relative_to((ROOT / ".codex-audit-temp").resolve())
    report = {"status":"running", "checks":{}, "runtimeErrors":[], "paidTextRequests":0, "mode":"read-only model guard; real Electron restart and existing project reopen"}
    persisted = json.loads((artifacts / "persisted-project.json").read_text(encoding="utf-8"))
    report["checks"]["evidence"] = verify_evidence(persisted, records(artifacts, "ipc.jsonl"))
    create_entry(profile, artifacts, original["model"])
    before_calls = calls(artifacts)
    env = os.environ.copy()
    for name in (*qa.PAID_API_ENV_VARS,"ELECTRON_RUN_AS_NODE","NODE_OPTIONS","VITE_DEV_SERVER_URL"):
        env.pop(name, None)
    env.update(NODE_ENV="production", STORYDREAM_QA_APP_ROOT=str(ROOT), STORYDREAM_LIVE_QA_READ_ONLY="1", TEMP=str(profile), TMP=str(profile))
    port = qa.available_port()
    process = subprocess.Popen([str(qa.ELECTRON), f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1", "--remote-allow-origins=*", f"--user-data-dir={profile}", str(profile)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(qa.wait_for_cdp(port, process))
            page = browser.contexts[0].pages[0]
            browser.contexts[0].route("**/*", lambda route, request: route.abort() if qa.external_http_url(request.url) else route.continue_())
            page.on("pageerror", lambda error: report["runtimeErrors"].append(str(error)))
            qa.wait_for_app(page)
            reread = page.evaluate("async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)", original["taskId"])
            assert reread == persisted
            reopen_project(page, original["taskId"])
            report["checks"]["electronRestartExactPersistence"] = True
            report["checks"]["reopenedFromProjectList"] = True
            for theme in ("dark", "light"):
                qa.set_theme(page, theme)
                for name, size in qa.VIEWPORTS:
                    qa.set_window_size(page, *size)
                    page.screenshot(path=str(artifacts / f"reopened-{theme}-{name}.png"))
                    assert page.locator("[data-motion-comic-production]").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
            assert calls(artifacts) == before_calls
            assert not report["runtimeErrors"]
            report["status"] = "passed"
            browser.close()
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        report["paidTextRequests"] = calls(artifacts)-before_calls
        report["buildSha256"] = hashlib.sha256((ROOT / "dist-electron/electron/main.js").read_bytes()).hexdigest()
        write_json(artifacts / "postflight-report.json", report)
        if process.poll() is None:
            subprocess.run(["taskkill","/PID",str(process.pid),"/T","/F"], stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
        print(json.dumps(report,ensure_ascii=False),flush=True)


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--allow-paid-text", action="store_true")
    mode.add_argument("--verify-run", type=Path)
    parser.add_argument("--source-data", type=Path, default=Path(os.environ["APPDATA"]) / "storydream/storydream")
    args = parser.parse_args()
    if args.verify_run:
        postflight(args.verify_run)
        return
    source = args.source_data.resolve()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    artifacts = ROOT / ".artifacts/motion-comic-live" / stamp
    artifacts.mkdir(parents=True)
    temp_root = ROOT / ".codex-audit-temp"
    temp_root.mkdir(exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="motion-comic-live-", dir=temp_root))
    data_dir = profile / "storydream"
    data_dir.mkdir()
    # Read configuration only; no source projects or source text are copied.
    with sqlite3.connect((source / "data.db").as_uri()+"?mode=ro", uri=True) as db:
        config = json.loads(db.execute("SELECT data FROM config WHERE id=1").fetchone()[0])
    llm = config["llm"]
    public_llm = {k:v for k,v in llm.items() if k != "apiKey"}
    public_llm["apiKey"] = ""
    active = config["activeLlmProfileId"]
    write_json(data_dir / "config.json", {"llm":public_llm, "llmProfiles":[{**public_llm, "id":active}], "activeLlmProfileId":active})
    # Copy ciphertext only. Electron's existing safeStorage decrypts it locally.
    vault = source / "secrets.v1.json"
    source_hash = hashlib.sha256(vault.read_bytes()).hexdigest()
    (data_dir / vault.name).write_bytes(vault.read_bytes())
    # Windows safeStorage also requires the profile's DPAPI-encrypted Chromium key.
    # Copy only os_crypt, never cookies, history, or other browser/profile data.
    local_state = json.loads((source.parent / "Local State").read_text(encoding="utf-8"))
    write_json(profile / "Local State", {"os_crypt":local_state["os_crypt"]})
    create_entry(profile, artifacts, llm)
    port = qa.available_port()
    env = os.environ.copy()
    for name in (*qa.PAID_API_ENV_VARS, "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "VITE_DEV_SERVER_URL"):
        env.pop(name, None)
    env.update(NODE_ENV="production", STORYDREAM_QA_APP_ROOT=str(ROOT), TEMP=str(profile), TMP=str(profile))
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen([str(qa.ELECTRON), f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1", "--remote-allow-origins=*", f"--user-data-dir={profile}", str(profile)], cwd=ROOT, env=env, stdout=(artifacts / "electron.log").open("wb"), stderr=subprocess.STDOUT, creationflags=flags)
    report = {"status":"running", "startedAt":time.strftime("%Y-%m-%dT%H:%M:%S%z"), "profile":str(profile), "artifacts":str(artifacts), "model":{k:llm.get(k) for k in ["provider","baseUrl","model","protocol"]}, "checks":{}, "runtimeErrors":[], "scope":"Real text model: script review, manual edit, storyboard, apply and reload. No media generation."}
    write_json(artifacts / "report.json", report)
    print(json.dumps({"artifacts":str(artifacts), "profile":str(profile), "pid":process.pid}, ensure_ascii=False), flush=True)
    page = None
    try:
        endpoint = qa.wait_for_cdp(port, process)
        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(endpoint)
            context = browser.contexts[0]
            context.route("**/*", lambda route, request: route.abort() if qa.external_http_url(request.url) else route.continue_())
            page = context.pages[0]
            page.on("pageerror", lambda error: report["runtimeErrors"].append(str(error)))
            qa.wait_for_app(page)
            qa.set_window_size(page, 1040, 720)
            bootstrap = page.evaluate("async () => {const b=await window.storydream.getBootstrap(); return {model:b.config.llm.model,baseUrl:b.config.llm.baseUrl,tasks:(await window.storydream.listTasks({limit:10})).items.length};}")
            assert bootstrap == {"model":llm["model"], "baseUrl":llm["baseUrl"], "tasks":0}, bootstrap
            report["checks"]["isolatedConfiguredModel"] = bootstrap
            qa.navigate_sidebar(page, "motion-comic", "[data-motion-comic-create-flow]")
            page.get_by_role("textbox", name="项目名称", exact=True).fill(TITLE)
            page.get_by_role("textbox", name="剧本正文", exact=True).fill(SOURCE)
            page.get_by_role("button", name="下一步", exact=True).click()
            expect(page.locator(".motion-comic-episode-draft")).to_have_count(1)
            page.get_by_role("button", name="下一步", exact=True).click()
            page.get_by_role("button", name="创建漫剧项目", exact=True).click()
            page.wait_for_selector("[data-motion-comic-production][data-stage='episodes']")
            task = page.evaluate("async () => { const r=await window.storydream.listTasks({taskType:'motion-comic',limit:10}); return window.storydream.getTaskDetail(r.items[0].id); }")
            task_id = task["id"]
            report["taskId"] = task_id
            page.get_by_role("button", name="生成剧本与分幕预览", exact=True).click()
            page.get_by_role("textbox", name="补充要求（可选）", exact=True).fill("忠实保留原文四句对白及两位说话人。邮局和钟楼分为两个场次，按地点与目标变化分两幕；不扩写新人物和支线。")
            assert calls(artifacts) == 0
            page.get_by_role("button", name="生成剧本，进入审核", exact=True).click()
            print("Real script request started", flush=True)
            review = page.get_by_role("button", name="确认剧本，生成分镜", exact=True)
            expect(review).to_be_visible(timeout=420_000)
            expect(review).to_be_disabled()
            script_calls = calls(artifacts)
            assert 1 <= script_calls <= 2
            report["checks"]["scriptOnlyCalls"] = script_calls
            page.screenshot(path=str(artifacts / "script-review-dark-compact.png"))
            rows = page.locator(".motion-comic-script-beat")
            edited = False
            for i in range(rows.count()):
                text = rows.nth(i).get_by_role("textbox", name="剧情内容", exact=True)
                if "留下" in text.input_value():
                    report["editBefore"] = text.input_value()
                    text.fill(EDITED)
                    edited = True
                    break
            assert edited, "Expected source dialogue not present in first scene"
            page.get_by_role("button", name="保存修改并重新校验", exact=True).click()
            expect(review).to_be_visible(timeout=30_000)
            assert calls(artifacts) == script_calls
            report["checks"]["manualValidationModelCalls"] = 0
            expect(review).to_be_disabled()
            page.get_by_role("checkbox", name="我已核对本集剧情、角色及修改记录，确认后生成分镜", exact=True).check()
            expect(review).to_be_enabled()
            review.click()
            print("Real storyboard request started", flush=True)
            apply = page.get_by_role("button", name="确认并写入第 1 集", exact=True)
            expect(apply).to_be_visible(timeout=420_000)
            assert script_calls < calls(artifacts) <= script_calls + 2
            report["checks"]["storyboardCalls"] = calls(artifacts)-script_calls
            # Review gate for application-owned adjustments, if any.
            check = page.get_by_role("checkbox", name=re.compile("我已核对(自动整理与补齐项|人工修改与系统整理)，同意写入本集"))
            if check.count():
                check.check()
            expect(apply).to_be_enabled()
            page.screenshot(path=str(artifacts / "storyboard-dark-compact.png"))
            apply.click()
            expect(page.locator(".motion-comic-plan-preview")).to_have_count(0, timeout=30_000)
            persisted = page.evaluate("async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)", task_id)
            write_json(artifacts / "persisted-project.json", persisted)
            assert len(persisted["episodes"]) == 1
            assert len(persisted["characters"]) == 2
            assert len(persisted["sceneAssets"]) == 2
            episode = persisted["episodes"][0]
            assert len(episode["scenes"]) == 2
            assert len({s["actIndex"] for s in episode["scenes"]}) == 2
            assert EDITED in json.dumps(episode, ensure_ascii=False)
            assert not persisted["providerJobs"]
            report["checks"]["persisted"] = {"episodes":1, "characters":2, "scenes":2, "shots":sum(len(s["shots"]) for s in episode["scenes"]), "manualEditPreserved":True, "providerJobs":0}
            report["checks"]["evidence"] = verify_evidence(persisted, records(artifacts, "ipc.jsonl"))
            before_reload = calls(artifacts)
            page.reload()
            qa.wait_for_app(page)
            reread = page.evaluate("async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)", task_id)
            assert reread == persisted
            assert calls(artifacts) == before_reload
            report["checks"]["reloadExactPersistence"] = True
            reopen_project(page, task_id)
            qa.set_theme(page, "light")
            page.screenshot(path=str(artifacts / "persisted-light-compact.png"))
            assert not report["runtimeErrors"], report["runtimeErrors"]
            report["status"] = "passed"
            browser.close()
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)[-4500:]
        if page:
            try:
                page.screenshot(path=str(artifacts / "failure.png"))
                (artifacts / "failure-ui.txt").write_text(page.locator("body").inner_text(), encoding="utf-8")
            except Exception:
                pass
        raise
    finally:
        report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        report["network"] = records(artifacts, "network.jsonl")
        report["paidTextRequests"] = calls(artifacts)
        report["sourceVaultUnchanged"] = hashlib.sha256(vault.read_bytes()).hexdigest() == source_hash
        write_json(artifacts / "report.json", report)
        if process.poll() is None:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        remove_test_vault(profile)
        report["testCredentialCopyRemoved"] = True
        write_json(artifacts / "report.json", report)
        print(json.dumps({"status":report["status"], "paidTextRequests":report["paidTextRequests"], "report":str(artifacts/"report.json")}, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
