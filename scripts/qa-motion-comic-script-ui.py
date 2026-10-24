"""Offline acceptance of the actual persistent novel-script workspace."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("comic_qa", ROOT / "scripts/qa-motion-comic.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.PROJECT_TITLE = "后台分集剧本流程验收"
ART = ROOT / ".artifacts/novel-script-workflow"
ART.mkdir(parents=True, exist_ok=True)
(ROOT / ".codex-temp").mkdir(exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix="script-workspace-", dir=ROOT / ".codex-temp"))
subprocess.run([str(ROOT / "scripts/run-npm-node.cmd"), "node_modules/tsx/dist/cli.mjs", "scripts/qa-motion-comic-script-fixture.ts", str(profile)], cwd=ROOT, check=True)
fixture = json.loads((profile / "script-fixture.json").read_text(encoding="utf8"))
audit = base.create_offline_electron_entry(profile)
script_read_mode = profile / 'script-read-mode.json'
hook = profile / 'offline-main.cjs'
hook.write_text(hook.read_text(encoding='utf8').replace(
    "import(pathToFileURL",
    "const { ipcMain } = require('electron');\n"
    "const originalHandle = ipcMain.handle.bind(ipcMain);\n"
    "ipcMain.handle = (channel, handler) => originalHandle(channel, async (...args) => {\n"
    f"  const modePath = {json.dumps(str(script_read_mode))};\n"
    "  if (channel === 'motion-comic:scripts-get' && fs.existsSync(modePath)) {\n"
    "    const mode = JSON.parse(fs.readFileSync(modePath, 'utf8'));\n"
    "    if (mode.error) throw new Error('QA_SCRIPT_READ_FAILED');\n"
    "    if (mode.delay) await new Promise(resolve => setTimeout(resolve, mode.delay));\n"
    "  }\n"
    "  return handler(...args);\n"
    "});\n"
    "import(pathToFileURL", 1), encoding='utf8')
env = os.environ.copy()
env["NODE_ENV"] = "production"
for key in (*base.PAID_API_ENV_VARS, "VITE_DEV_SERVER_URL", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"):
    env.pop(key, None)
port = base.available_port()
process = subprocess.Popen([str(base.ELECTRON), f"--remote-debugging-port={port}", f"--user-data-dir={profile}", str(profile)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
report = {"paidCalls": 0, "checks": [], "screenshots": [], "errors": [], "profile": str(profile)}


def open_workspace(page):
    base.reopen_created_project(page)
    page.locator(".motion-comic-production__stages > button").nth(1).click()
    page.wait_for_selector("[data-motion-comic-script-workspace]")
    expect(page.locator(".comic-script-source-row")).to_have_count(24)


def select_episode(page, number):
    page.get_by_role("button", name=f"EP {number:02d} · 雨夜来信 {number}", exact=False).click()
    expect(page.locator(".comic-script-detail__heading")).to_contain_text(f"第 {number} 集")


try:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(base.wait_for_cdp(port, process))
        page = browser.contexts[0].pages[0]
        page.on("pageerror", lambda error: report["errors"].append(str(error)))
        base.wait_for_app(page)
        base.set_window_size(page, 1536, 1024)
        open_workspace(page)
        expect(page.get_by_role("button", name="批准本集剧本", exact=True)).to_be_disabled()
        expect(page.get_by_role("button", name="仅生成本集分镜", exact=True)).to_have_count(0)
        report["checks"].append("unreviewed script cannot be approved or storyboarded")
        initial = page.evaluate("async id=>JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)", fixture["id"])
        assert len(initial['characters']) == 4 and len(initial['sceneAssets']) == 2 and len(initial['props']) == 3
        assert initial['assets'] == [] and initial['providerJobs'] == []
        initial_ids = {kind: [item['id'] for item in initial[kind]] for kind in ('characters', 'sceneAssets', 'props')}
        page.get_by_role('tab', name='项目资产', exact=True).click()
        expect(page.locator('[data-motion-comic-production]')).to_have_attribute('data-stage', 'assets')
        expect(page.locator('.motion-comic-production__stages')).to_have_count(0)
        expect(page.get_by_label('项目资产列表', exact=True).get_by_role('button')).to_have_count(4)
        page.get_by_label('搜索项目资产', exact=True).fill('来信人2')
        expect(page.get_by_label('项目资产列表', exact=True).get_by_role('button')).to_have_count(1)
        page.get_by_text('人物定义与别名', exact=True).click()
        expect(page.get_by_label('人物名称', exact=True)).to_have_value('白杨')
        expect(page.get_by_label('人物别名', exact=True)).to_have_value('来信人2')
        usage = page.get_by_label('跨集引用', exact=True)
        expect(usage.get_by_role('button')).to_have_count(1)
        expect(usage).to_contain_text('第 2 集 · 雨夜来信 2')
        expect(usage).to_contain_text('剧本已确认')
        expect(usage).not_to_contain_text('分镜已引用')
        usage.get_by_role('button').click()
        expect(page.locator('.comic-script-detail__heading')).to_contain_text('第 2 集')
        page.get_by_role('tab', name='项目资产', exact=True).click()
        page.get_by_label('搜索项目资产', exact=True).fill('')
        report['checks'].append('project library available before storyboard application; stable definitions persisted at approval and searchable by alias')
        for theme in ('dark', 'light'):
            base.set_theme(page, theme)
            for width, height in ((1536, 1024), (1280, 800), (1040, 720)):
                base.set_window_size(page, width, height)
                page.get_by_text('人物定义与别名', exact=True).click()
                page.get_by_label('人物名称', exact=True).scroll_into_view_if_needed()
                expect(page.get_by_label('人物名称', exact=True)).to_be_in_viewport()
                page.get_by_text('人物定义与别名', exact=True).click()
                page.locator('.director-series-editor').evaluate('el => {el.scrollTop=0;}')
                expect(page.locator('.motion-comic-reference').first).to_be_in_viewport()
                expect(page.get_by_label('搜索项目资产', exact=True)).to_be_in_viewport()
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+2'), 'library horizontal overflow'
                path = ART / f'{theme}-{width}-project-library.png'
                page.screenshot(path=str(path))
                report['screenshots'].append(str(path))
        page.get_by_role('tab', name='分集制作', exact=True).click()
        select_episode(page, 1)

        for theme in ("dark", "light"):
            base.set_theme(page, theme)
            for width, height in ((1536, 1024), (1280, 800), (1040, 720)):
                base.set_window_size(page, width, height)
                page.locator('.comic-script-editor').evaluate('el => {el.scrollTop=0;}')
                expect(page.get_by_role("tab", name="分幕分场", exact=True)).to_be_in_viewport()
                expect(page.locator('.motion-comic-script-scene-entry h3')).to_have_count(2)
                page.get_by_role('tab', name='人物 (4)', exact=True).click()
                expect(page.get_by_label('本集人物列表')).to_contain_text('阿青')
                expect(page.get_by_label('人物定义', exact=True)).to_contain_text('雨夜常服')
                page.get_by_role('button', name='白杨 配角', exact=False).click()
                expect(page.get_by_label('人物定义', exact=True)).to_contain_text('白杨')
                page.get_by_role('tab', name='场景 (2)', exact=True).click()
                expect(page.get_by_label('场景定义', exact=True)).to_contain_text('引用场次')
                page.get_by_role('button', name='线索场次 4', exact=True).click()
                expect(page.locator('.motion-comic-script-beats .motion-comic-plan-pane-heading')).to_contain_text('线索场次 4')
                page.get_by_role('tab', name='道具 (3)', exact=True).click()
                expect(page.get_by_label('道具定义', exact=True)).to_contain_text('信纸')
                path = ART / f'{theme}-{width}-assets.png'
                page.screenshot(path=str(path))
                report['screenshots'].append(str(path))
                page.get_by_role('tab', name='分幕分场', exact=True).click()
                page.get_by_role('button', name='01 线索场次 1', exact=False).click()
                page.get_by_role('button', name='批准本集剧本', exact=True).scroll_into_view_if_needed()
                expect(page.get_by_role("button", name="批准本集剧本", exact=True)).to_be_in_viewport()
                expect(page.locator('.comic-script-detail__heading')).to_be_in_viewport(ratio=1)
                expect(page.get_by_role('tab', name='剧本与对白', exact=True)).to_be_in_viewport(ratio=1)
                pane_metrics = {}
                for selector, minimum_height in ((".comic-script-source-list__items", 156), (".motion-comic-script-beats", 180), (".motion-comic-plan-scene-list", 88)):
                    metrics = page.locator(selector).evaluate("el => {el.scrollTop=el.scrollHeight;return {height:el.clientHeight,scroll:el.scrollHeight,top:el.scrollTop};}")
                    assert metrics["height"] >= minimum_height, (selector, metrics, minimum_height)
                    if metrics["scroll"] > metrics["height"] + 2:
                        assert metrics["top"] > 0, (selector, metrics)
                    page.locator(selector).evaluate("el => {el.scrollTop=0;}")
                    pane_metrics[selector] = metrics
                report.setdefault("paneMetrics", []).append({"theme": theme, "width": width, "height": height, "panes": pane_metrics})
                content = page.get_by_label("剧情内容", exact=True).first
                content.scroll_into_view_if_needed()
                expect(content).to_be_in_viewport(ratio=0.99)
                expect(page.get_by_role("button", name="批准本集剧本", exact=True)).to_be_in_viewport(ratio=1)
                assert not page.evaluate("document.documentElement.scrollWidth>innerWidth+2"), "horizontal overflow"
                path = ART / f"{theme}-{width}.png"
                page.screenshot(path=str(path))
                report["screenshots"].append(str(path))
        report["checks"].append("six viewport/theme combinations with long synopsis and nonempty assets: usable scene/beat heights, independent scrolling, asset definitions and location-to-scene navigation before storyboarding")

        base.set_window_size(page, 1536, 1024)
        page.get_by_text('本集梗概', exact=True).click()
        expect(page.locator('.motion-comic-script-overview details')).to_have_attribute('open', '')
        assert page.locator('.motion-comic-script-beats').evaluate('el => el.clientHeight') >= 180
        page.get_by_text('本集梗概', exact=True).click()
        select_episode(page, 4)
        page.get_by_role('tab', name='人物 (0)', exact=True).click()
        expect(page.get_by_text('本集未提取人物', exact=True)).to_be_visible()
        page.get_by_role('tab', name='道具 (0)', exact=True).click()
        expect(page.get_by_text('本集未提取道具', exact=True)).to_be_visible()
        select_episode(page, 1)
        report['checks'].append('expanded long synopsis preserves reading height; empty character/prop extraction has explicit states')
        page.get_by_role("tab", name="原文与边界", exact=True).click()
        expect(page.get_by_label("本集原文", exact=True)).to_have_value("\n".join(f"雨夜门厅中，阿青检查第{i}处信件线索。" for i in range(1, 33)))
        page.get_by_role("tab", name="剧本与对白", exact=True).click()
        select_episode(page, 2)
        page.get_by_role("tab", name="分镜 (8)", exact=True).click()
        apply = page.get_by_role("button", name="确认并应用本集分镜", exact=True)
        expect(apply).to_be_disabled()
        page.get_by_label("已核对当前分镜与整理记录，同意写入正式分集；不启动媒体生成", exact=True).check()
        apply.click()
        expect(page.locator("[data-motion-comic-production]")).to_have_attribute("data-stage", "scenes", timeout=15000)
        saved = page.evaluate("async id=>JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)", fixture["id"])
        assert len(saved["episodes"]) == 1 and saved["episodes"][0]["number"] == 2
        assert len(saved["episodes"][0]["scenes"]) == 8
        assert saved["assets"] == [] and saved["providerJobs"] == []
        assert {kind: [item['id'] for item in saved[kind]] for kind in initial_ids} == initial_ids
        assert all(shot['characterLookIds'] == [saved['characters'][0]['looks'][0]['id']] and shot['propAssetIds'] == [saved['props'][0]['id']] for scene in saved['episodes'][0]['scenes'] for shot in scene['shots'])
        page.locator(".motion-comic-production__stages > button").nth(1).click()
        select_episode(page, 2)
        expect(page.locator(".comic-script-workspace")).to_contain_text("分镜已应用 1")
        page.get_by_role("tab", name="分镜 (8)", exact=True).click()
        expect(page.get_by_role("button", name="确认并应用本集分镜", exact=True)).to_be_disabled()
        report["checks"].append("episode 2 storyboard reviewed/applied before episode 1; no media and no overwrite")

        select_episode(page, 3)
        review = page.get_by_label("我已核对当前版本的剧情、对白、人物地点道具及修改记录，加入待批准列表", exact=True)
        review.check()
        page.get_by_role("button", name="批准已审阅 (1)", exact=True).click()
        dialog = page.get_by_role("dialog")
        expect(dialog.get_by_role("button", name="批准 1 集", exact=True)).to_be_disabled()
        dialog.get_by_label("确认以上版本已逐集审阅；批准后仍需单独生成分镜", exact=True).check()
        dialog.get_by_role("button", name="批准 1 集", exact=True).click()
        expect(dialog).to_have_count(0)
        expect(page.get_by_role("button", name="仅生成本集分镜", exact=True)).to_be_enabled()
        reused = page.evaluate("async id=>JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)", fixture['id'])
        assert {kind: [item['id'] for item in reused[kind]] for kind in initial_ids} == initial_ids
        page.get_by_role('tab', name='项目资产', exact=True).click()
        expect(page.get_by_label('项目资产列表', exact=True).get_by_role('button')).to_have_count(4)
        page.get_by_label('项目资产列表', exact=True).get_by_role('button', name='阿青', exact=False).click()
        usage = page.get_by_label('跨集引用', exact=True)
        expect(usage.get_by_role('button')).to_have_count(2)
        expect(usage.get_by_role('button').first).to_contain_text('剧本已确认 · 分镜已引用')
        usage.get_by_role('button').first.click()
        expect(page.locator('[data-motion-comic-production]')).to_have_attribute('data-stage', 'scenes')
        page.get_by_role('tab', name='项目资产', exact=True).click()
        page.get_by_label('查看地点资产', exact=True).click()
        expect(page.get_by_label('跨集引用', exact=True).get_by_role('button')).to_have_count(2)
        page.get_by_label('查看道具资产', exact=True).click()
        expect(page.get_by_label('跨集引用', exact=True).get_by_role('button')).to_have_count(2)
        page.get_by_role('tab', name='分集制作', exact=True).click()
        page.locator('.motion-comic-production__stages > button').nth(1).click()
        report['checks'].append('character/location/prop usage combines approved scripts and applied storyboards once per episode; navigation opens the corresponding script or scenes')
        report["checks"].append("bulk approval only explicitly reviewed revisions; storyboard remains separate")
        report['checks'].append('storyboard application and a later episode approval reuse all canonical project IDs; frontend reload does not overwrite new assets')
        page.get_by_role('button', name='保存', exact=True).click()
        expect(page.get_by_role('button', name='保存', exact=True)).to_be_disabled()

        select_episode(page, 1)
        edited = "阿青在门厅仔细核对第一处信件线索。"
        page.get_by_label("剧情内容", exact=True).first.fill(edited)
        page.get_by_role('tab', name='人物 (4)', exact=True).click()
        page.get_by_role('tab', name='分幕分场', exact=True).click()
        expect(page.get_by_label('剧情内容', exact=True).first).to_have_value(edited)
        expect(page.get_by_role("button", name="批准本集剧本", exact=True)).to_be_disabled()
        select_episode(page, 4)
        select_episode(page, 1)
        expect(page.get_by_label("剧情内容", exact=True).first).to_have_value(edited)
        page.reload()
        base.wait_for_app(page)
        open_workspace(page)
        select_episode(page, 1)
        expect(page.get_by_label("剧情内容", exact=True).first).to_have_value(edited)
        page.get_by_role("button", name="保存修改并校验", exact=True).click()
        expect(page.get_by_role("button", name="保存修改并校验", exact=True)).to_be_disabled(timeout=15000)
        snapshot = page.evaluate("async id=>window.storydream.getMotionComicScripts(id)", fixture["id"])
        assert snapshot["candidates"][0]["outputRevision"] == 2
        assert snapshot["candidates"][0]["script"]["scenes"][0]["beats"][0]["text"] == edited
        assert snapshot["tasks"][2]["status"] == "stale"
        report["checks"].append("draft survives episode switch/reload; save validates new revision and invalidates downstream")

        page.get_by_role("button", name="生成未完成剧本", exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("button", name="开始后台生成", exact=True).click()
        expect(dialog).to_have_count(0, timeout=15000)
        snapshot = page.evaluate("async id=>window.storydream.getMotionComicScripts(id)", fixture["id"])
        assert snapshot["paused"] and any(task["status"] == "queued" for task in snapshot["tasks"])
        base.navigate_sidebar(page, "history", "[data-task-operations='history']")
        open_workspace(page)
        expect(page.locator(".comic-script-workspace")).to_contain_text("队列已暂停")
        report["checks"].append("bulk enqueue closes immediately; durable paused queue permits leaving/reopening")

        script_read_mode.write_text(json.dumps({'error': True}), encoding='utf8')
        page.get_by_role('tab', name='项目资产', exact=True).click()
        page.get_by_label('查看人物资产', exact=True).click()
        page.get_by_label('项目资产列表', exact=True).get_by_role('button', name='阿青', exact=False).click()
        usage = page.get_by_label('跨集引用', exact=True)
        expect(usage).to_contain_text('剧本引用读取失败')
        expect(usage.get_by_role('button', name='第 2 集', exact=False)).to_have_count(1)
        script_read_mode.write_text(json.dumps({'delay': 1200}), encoding='utf8')
        page.get_by_role('button', name='重试读取剧本引用', exact=True).click()
        expect(usage).to_have_attribute('aria-busy', 'true')
        expect(usage).to_have_attribute('aria-busy', 'false')
        expect(usage.get_by_role('button')).to_have_count(1)
        expect(usage).to_contain_text('分镜已引用')
        expect(usage).not_to_contain_text('剧本已确认')
        script_read_mode.unlink()
        report['checks'].append('script usage loading/error/retry preserves applied references and recovers approved episode references')

        # Import real local files through production persistence after no-media checks.
        reference_paths = [ROOT / 'src/assets/drawing-style-previews/ghibli.webp', ROOT / 'src/assets/drawing-style-previews/comic.webp']
        if not reference_paths[1].exists():
            reference_paths[1] = reference_paths[0]
        for index, source in enumerate(reference_paths):
            png = profile / f'qa-reference-{index}.png'
            with Image.open(source) as image:
                image.convert('RGB').save(png)
            reference_paths[index] = png
        page.evaluate('''async ({id, paths}) => {
          const document = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
          for (const [index, path] of paths.entries()) {
            const mutation = await window.storydream.addImageLabRecord({prompt:'Local QA reference '+index, ratio:'16:9', style:'reference', provider:'local-import', imagePath:path, resolution:'2K', quality:'high', smartMode:'reference-edit', upstreamTaskId:id});
            const record = mutation.patch.record;
            document.assets.push({id:'qa-reference-'+index, assetId:'qa-reference', kind:'image', localPath:record.imagePath, provider:'local-import', createdAt:record.createdAt, selected:index===1, pinned:index===1});
          }
          document.assets.push({id:'qa-reference-missing', assetId:'qa-reference', kind:'image', createdAt:document.updatedAt, selected:false, pinned:false});
          document.characters[0].looks[0].referenceAssetVersionIds = ['qa-reference-0','qa-reference-1','qa-reference-missing'];
          await window.storydream.saveMotionComic({id,expectedUpdatedAt:document.updatedAt,document});
        }''', {'id': fixture['id'], 'paths': [str(path) for path in reference_paths]})
        page.reload()
        base.wait_for_app(page)
        base.reopen_created_project(page)
        page.get_by_role('tab', name='项目资产', exact=True).click()
        page.get_by_label('查看人物资产', exact=True).click()
        page.get_by_label('项目资产列表', exact=True).get_by_role('button', name='阿青', exact=False).click()
        reference = page.locator('.motion-comic-reference').first
        expect(reference).to_have_attribute('data-motion-comic-reference', 'fixed')
        expect(reference.get_by_role('button', name='预览参考图版本 2，当前固定', exact=True)).to_have_attribute('aria-pressed', 'true')
        reference.get_by_role('button', name='预览参考图版本 1', exact=True).click()
        expect(reference.get_by_role('button', name='固定此版本', exact=True)).to_be_enabled()
        expect(reference).to_have_attribute('data-motion-comic-reference', 'fixed')
        expect(reference.get_by_role('button', name='预览参考图版本 2，当前固定', exact=True)).to_have_count(1)
        reference.get_by_role('button', name='固定此版本', exact=True).click()
        expect(reference.get_by_role('button', name='预览参考图版本 1，当前固定', exact=True)).to_have_attribute('aria-pressed', 'true')
        reference.get_by_role('button', name='取消固定参考版本', exact=True).click()
        expect(reference).to_have_attribute('data-motion-comic-reference', 'unfixed')
        reference.get_by_role('button', name='固定此版本', exact=True).click()
        reference.get_by_role('button', name='预览参考图版本 3', exact=True).click()
        expect(reference.get_by_role('button', name='固定此版本', exact=True)).to_be_disabled()
        expect(reference.get_by_text('文件不可用', exact=True).first).to_be_visible()
        reference.get_by_role('button', name='重新读取文件', exact=True).click()
        expect(reference.get_by_role('button', name='固定此版本', exact=True)).to_be_disabled()
        reference.get_by_role('button', name='预览参考图版本 1，当前固定', exact=True).click()
        page.get_by_text('人物定义与别名', exact=True).click()
        page.get_by_label('人物别名', exact=True).fill('来信人1、雨夜访客')
        usage.get_by_role('button').first.click()
        page.get_by_role('tab', name='项目资产', exact=True).click()
        page.get_by_text('人物定义与别名', exact=True).click()
        expect(page.get_by_label('人物别名', exact=True)).to_have_value('来信人1、雨夜访客')
        page.get_by_text('人物定义与别名', exact=True).click()
        page.get_by_role('button', name='保存', exact=True).click()
        expect(page.get_by_role('button', name='保存', exact=True)).to_be_disabled()
        saved = page.evaluate('async id=>JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)', fixture['id'])
        assert next(asset['id'] for asset in saved['assets'] if asset.get('selected') and asset.get('pinned')) == 'qa-reference-0'
        report['checks'].append('large preview/version strip: viewing does not pin, explicit pin/unpin persists, missing paths cannot be fixed, cross-episode navigation preserves unsaved edits')
        for theme in ('dark', 'light'):
            base.set_theme(page, theme)
            for width, height in ((1536, 1024), (1280, 800), (1040, 720)):
                base.set_window_size(page, width, height)
                reference.locator('.comic-reference-preview').scroll_into_view_if_needed()
                expect(reference.locator('.comic-reference-preview img')).to_be_visible()
                assert reference.locator('.comic-reference-preview img').evaluate('img => img.complete && img.naturalWidth > 0')
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+2'), 'reference horizontal overflow'
                path = ART / f'{theme}-{width}-reference-versions.png'
                page.screenshot(path=str(path))
                report['screenshots'].append(str(path))
        assert not report["errors"], report["errors"]
        assert not base.read_json_lines(audit), base.read_json_lines(audit)
        report["status"] = "passed"
        browser.close()
except Exception as error:
    report["status"] = "failed"
    report["error"] = repr(error)
    raise
finally:
    (ART / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)
