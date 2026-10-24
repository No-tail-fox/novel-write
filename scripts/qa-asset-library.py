"""Offline acceptance of the shared image/text library in an isolated Electron profile."""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("comic_qa", ROOT / "scripts/qa-motion-comic.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.PROJECT_TITLE = "后台分集剧本流程验收"
ART = ROOT / ".artifacts/asset-library"
ART.mkdir(parents=True, exist_ok=True)
(ROOT / ".codex-temp").mkdir(exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix="asset-library-", dir=ROOT / ".codex-temp"))
subprocess.run([str(ROOT / "scripts/run-npm-node.cmd"), "node_modules/tsx/dist/cli.mjs", "scripts/qa-motion-comic-script-fixture.ts", str(profile)], cwd=ROOT, check=True)
fixture = json.loads((profile / "script-fixture.json").read_text(encoding="utf8"))
audit = base.create_offline_electron_entry(profile)
env = os.environ.copy()
env["NODE_ENV"] = "production"
for key in (*base.PAID_API_ENV_VARS, "VITE_DEV_SERVER_URL", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"):
    env.pop(key, None)
port = base.available_port()
log = (ART / "electron.log").open("w", encoding="utf8")
process = subprocess.Popen([str(base.ELECTRON), f"--remote-debugging-port={port}", f"--user-data-dir={profile}", str(profile)], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
report = {"checks": [], "screenshots": [], "errors": [], "profile": str(profile), "paidCalls": 0}


def navigate(page, view, selector):
    button = page.locator(f"button[data-nav-view='{view}']")
    if button.count() == 0 or not button.first.is_visible():
        page.locator("button[data-nav-view='person-assets'][data-nav-level='primary']").click()
    page.locator(f"button[data-nav-view='{view}']").click()
    page.wait_for_selector(selector)


def choose(page, title, action):
    picker = page.locator("[data-library-picker]")
    expect(picker).to_be_visible()
    picker.get_by_role("button", name=title, exact=False).click()
    page.get_by_role("dialog").get_by_role("button", name=action, exact=True).click()
    expect(picker).to_have_count(0, timeout=15000)


def capture(page, name):
    assert not page.evaluate("document.documentElement.scrollWidth>innerWidth+2"), name
    path = ART / f"{name}.png"
    page.screenshot(path=str(path))
    report["screenshots"].append(str(path))


try:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(base.wait_for_cdp(port, process))
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=30000)
        page.on("pageerror", lambda error: report["errors"].append(str(error)))
        base.wait_for_app(page)
        base.set_window_size(page, 1536, 1024)
        image_path = str(ROOT / "src/assets/drawing-style-previews/ghibli.webp")
        seeded = page.evaluate("""async imagePath => {
          const api=window.storydream;
          const image=await api.saveLibraryAsset({kind:'image',title:'雨夜门厅参考',imagePath,collection:'雨夜来信',tags:['场景','雨夜'],favorite:false,source:{kind:'local'}});
          const text=await api.saveLibraryAsset({kind:'text',title:'阿青人物小传',text:'阿青，二十六岁，记者。深色短发、灰色外套，谨慎而敏锐。她在雨夜门厅发现一封没有署名的信。',collection:'人物设定',tags:['人物','阿青'],favorite:false,source:{kind:'local'}});
          await api.saveLibraryAsset({kind:'text',title:'雨夜镜头提示词',text:'雨夜、老宅门厅、木门、旧信纸。中景构图，柔和光线，手绘动画质感。',collection:'提示词',tags:['分镜'],favorite:false,source:{kind:'local'}});
          await api.addImageLabRecord({prompt:'雨夜来信生成记录',ratio:'16:9',style:'reference',provider:'local-import',imagePath});
          return {image,text};
        }""", image_path)
        page.reload()
        base.wait_for_app(page)
        navigate(page, "person-assets", "[data-asset-library]")
        expect(page.locator(".library-card")).to_have_count(3)
        page.get_by_role("button", name="阿青人物小传", exact=False).click()
        expect(page.get_by_label("素材名称", exact=True)).to_have_value("阿青人物小传")
        page.get_by_label("素材名称", exact=True).fill("临时改名")
        page.get_by_label("搜索素材", exact=True).fill("雨夜")
        dialog = page.get_by_role("dialog")
        expect(dialog).to_contain_text("保留未保存的改动")
        dialog.get_by_role("button", name="继续编辑", exact=True).click()
        expect(page.get_by_label("搜索素材", exact=True)).to_have_value("")
        expect(page.get_by_label("素材名称", exact=True)).to_have_value("临时改名")
        page.get_by_role("button", name="雨夜门厅参考", exact=False).click()
        page.get_by_role("dialog").get_by_role("button", name="放弃改动并离开", exact=True).click()
        expect(page.get_by_label("素材名称", exact=True)).to_have_value("雨夜门厅参考")
        page.get_by_label("收藏", exact=True).check()
        page.get_by_role("button", name="保存信息", exact=False).click()
        expect(page.get_by_role("button", name="保存信息", exact=False)).to_be_disabled()
        page.get_by_role("navigation", name="素材库视图").get_by_role("button", name="收藏", exact=True).click()
        expect(page.locator(".library-card")).to_have_count(1)
        page.get_by_role("navigation", name="素材库视图").get_by_role("button", name="全部素材", exact=True).click()
        page.get_by_role("button", name="雨夜门厅参考", exact=False).click()
        expect(page.locator(".library-inspector img")).to_be_visible()
        report["checks"].append("real IPC: owned image/text, search dirty-cancel, selection discard, metadata save and favorite filtering")
        for theme in ("dark", "light"):
            base.set_theme(page, theme)
            for width, height in ((1536, 1024), (1040, 720)):
                base.set_window_size(page, width, height)
                capture(page, f"{theme}-{width}-library")
                expect(page.get_by_label("搜索素材")).to_be_in_viewport()
                expect(page.get_by_label("素材名称", exact=True)).to_be_in_viewport()
        base.set_window_size(page, 1536, 1024)
        page.get_by_role("button", name="新建文本", exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("素材名称", exact=True).fill("雨夜对白")
        dialog.get_by_label("文本内容", exact=True).fill("阿青：这封信为什么会出现在这里？")
        dialog.get_by_role("button", name="保存素材", exact=True).click()
        expect(dialog).to_have_count(0)
        expect(page.locator(".library-card")).to_have_count(4)
        page.get_by_role("button", name="雨夜对白", exact=False).click()
        page.get_by_role("button", name="移入回收站", exact=True).click()
        expect(page.locator(".library-card")).to_have_count(3)
        page.get_by_role("navigation", name="素材库视图").get_by_role("button", name="回收站", exact=True).click()
        expect(page.locator(".library-card")).to_have_count(1)
        page.get_by_role("button", name="雨夜对白", exact=False).click()
        page.get_by_role("button", name="恢复素材", exact=True).click()
        expect(page.locator(".library-card")).to_have_count(0)
        report["checks"].append("create text, recycle, view trash and restore through actual controls")

        navigate(page, "copy-studio", "[data-copy-studio]")
        page.get_by_label("当前文案", exact=True).fill("尚未保存的原始文案")
        page.get_by_role("button", name="从素材库添加来源", exact=True).click()
        choose(page, "阿青人物小传", "添加来源")
        expect(page.locator(".copy-studio-source-list")).to_contain_text("阿青人物小传")
        page.get_by_role("button", name="从素材库采用文本", exact=True).click()
        choose(page, "阿青人物小传", "采用为新版本")
        expect(page.get_by_label("当前文案", exact=True)).to_have_value(seeded["text"]["text"])
        expect(page.locator("[data-copy-studio]")).to_contain_text("采用素材前")
        page.get_by_role("button", name="存入素材库", exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("素材名称", exact=True).fill("阿青文案定稿")
        dialog.get_by_role("button", name="保存素材", exact=True).click()
        expect(dialog).to_have_count(0)
        base.set_window_size(page, 1040, 720)
        action_sizes = page.locator('.copy-studio-sources > .sd-button, .copy-studio-editor > .sd-button').evaluate_all('(buttons) => buttons.map(button => ({ label: button.textContent, height: button.getBoundingClientRect().height }))')
        assert action_sizes and all(action['height'] >= 32 for action in action_sizes), action_sizes
        capture(page, "light-1040-copy")
        base.set_theme(page, 'dark')
        capture(page, 'dark-1040-copy')
        base.set_theme(page, 'light')
        base.set_window_size(page, 1536, 1024)
        capture(page, 'light-1536-copy')
        page.reload()
        base.wait_for_app(page)
        navigate(page, "copy-studio", "[data-copy-studio]")
        expect(page.get_by_label("当前文案", exact=True)).to_have_value(seeded["text"]["text"])
        report["checks"].append("copy source + adoption preserve edited draft as prior version; save to library; editor survives reload; compact action heights remain usable")

        navigate(page, "conversation-workbench", ".conversation-workbench")
        page.locator(".conversation-create-button").click()
        page.get_by_role("button", name="从素材库添加资料", exact=True).click()
        choose(page, "阿青人物小传", "添加到对话")
        expect(page.locator(".conversation-context-count")).to_have_text("1 个资料")
        expect(page.locator(".conversation-context-strip")).to_contain_text("阿青人物小传")
        page.get_by_role("button", name="移除资料：阿青人物小传", exact=True).click()
        expect(page.locator(".conversation-context-count")).to_have_text("0 个资料")
        source_titles = page.evaluate("""async () => {
          const titles=[];
          for(let index=1;index<=12;index++) {
            const title=`长期设定资料 ${String(index).padStart(2,'0')}：雨夜来信人物关系、地点环境与关键道具说明`;
            await window.storydream.saveLibraryAsset({kind:'text',title,text:`第 ${index} 份设定资料。阿青在雨夜门厅发现信件。`,collection:'资料排版验收',tags:[],favorite:false,source:{kind:'local'}});
            titles.push(title);
          }
          return titles;
        }""")
        for title in source_titles:
            page.get_by_role("button", name="从素材库添加资料", exact=True).click()
            choose(page, title, "添加到对话")
        expect(page.locator(".conversation-context-count")).to_have_text("12 个资料")
        expect(page.get_by_role("button", name="从素材库添加资料", exact=True)).to_be_disabled()
        for width, height in ((1536, 1024), (1040, 720)):
            base.set_window_size(page, width, height)
            capture(page, f"light-{width}-conversation")
            expect(page.get_by_role("button", name="发送", exact=True)).to_be_in_viewport()
            expect(page.get_by_label("输入消息", exact=True)).to_be_in_viewport()
            assert page.get_by_role("region", name="已添加资料", exact=True).bounding_box()["height"] <= 82
        page.get_by_role("button", name=f"移除资料：{source_titles[-1]}", exact=True).click()
        expect(page.locator(".conversation-context-count")).to_have_text("11 个资料")
        expect(page.get_by_role("button", name="从素材库添加资料", exact=True)).to_be_enabled()
        page.locator(".conversation-create-button").click()
        expect(page.locator(".conversation-context-count")).to_have_text("0 个资料")
        report["checks"].append("conversation adds/removes text snapshots; 12 long source titles keep composer visible at desktop + compact sizes; sources stay session-specific; no paid request")

        base.set_window_size(page, 1536, 1024)
        navigate(page, "image-lab", ".image-lab-page")
        page.get_by_role("button", name="从素材库选择", exact=True).click()
        choose(page, "雨夜门厅参考", "添加参考图")
        expect(page.locator(".image-lab-section-head").filter(has_text="参考图")).to_contain_text("已选 1")
        page.get_by_role("button", name="从素材库追加文本", exact=True).click()
        choose(page, "雨夜镜头提示词", "追加到需求描述")
        expect(page.locator(".image-lab-prompt")).to_have_value(re.compile("雨夜、老宅门厅"))
        result = page.locator(".image-record").filter(has_text="雨夜来信生成记录")
        result.get_by_role("button", name="存入素材库", exact=True).click()
        page.get_by_role("dialog").get_by_label("素材名称", exact=True).fill("已生成的门厅")
        page.get_by_role("dialog").get_by_role("button", name="保存素材", exact=True).click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        report["checks"].append("image creation selects saved reference + text, and saves generated result into the library")

        base.reopen_created_project(page)
        page.get_by_role("tab", name="项目资产", exact=True).click()
        page.get_by_label("项目资产列表", exact=True).get_by_role("button").first.click()
        page.get_by_role("button", name="从素材库选择", exact=True).first.click()
        choose(page, "雨夜门厅参考", "采用并固定新版本")
        page.get_by_role("button", name="保存", exact=True).click()
        expect(page.get_by_role("button", name="保存", exact=True)).to_be_disabled()
        document = page.evaluate("async id=>JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)", fixture["id"])
        adopted = next(asset for asset in document["assets"] if asset.get("librarySource", {}).get("id") == seeded["image"]["id"])
        assert adopted["librarySource"]["revision"] == seeded["image"]["revision"]
        assert adopted["localPath"] != seeded["image"]["imagePath"]
        assert Path(adopted["localPath"]).is_file()
        page.evaluate("id=>window.storydream.recycleLibraryAsset(id)", seeded["image"]["id"])
        assert page.evaluate("path=>window.storydream.readAssetDataUrl(path)", adopted["localPath"]).startswith("data:image/")
        capture(page, "light-1536-comic-adopted")
        report["checks"].append("comic adopts separate managed copy + immutable library revision; adopted file remains readable after source recycled")
        page.reload()
        base.wait_for_app(page)
        navigate(page, "person-assets", "[data-asset-library]")
        page.get_by_role("navigation", name="素材库视图").get_by_role("button", name="回收站", exact=True).click()
        expect(page.locator(".library-card")).to_have_count(1)
        report["checks"].append("library metadata and recycle state survive renderer reload")
        assert not report["errors"], report["errors"]
        report["externalFetches"] = base.read_json_lines(audit)
        report["success"] = True
except Exception as error:
    report["success"] = False
    report["failure"] = repr(error)
    try:
        page.screenshot(path=str(ART / "failure.png"))
        report["body"] = page.locator("body").inner_text()[:7000]
    except Exception:
        pass
    raise
finally:
    (ART / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=20)
    log.close()
    print(json.dumps({"success": report.get("success"), "checks": report["checks"], "report": str(ART / "report.json")}, ensure_ascii=False))
