"""Exercise the real VOX page against an isolated, local-only image API and saved document."""
from __future__ import annotations

import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import threading

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts/editorial-dual-chain')))


def shot(snapshot: dict) -> dict:
    return snapshot['document']['beats'][0]['shots'][0]


def image_bindings(snapshot: dict) -> dict:
    return {layer['id']: layer.get('assetVersionId') for layer in shot(snapshot)['layers'] if not layer.get('content')}


def run() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    build = subprocess.run([
        'I:/nodejs/node.exe', '--input-type=module', '-e',
        "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/editorial-dual-chain.harness.tsx',name:'editorialDualChainQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",
        str(OUTPUT),
    ], cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
    (OUTPUT / 'build.log').write_text(build.stdout, encoding='utf-8')
    build.check_returncode()
    (OUTPUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><style>[data-editorial-collage-workbench]{height:100vh;min-height:0;overflow:hidden}</style><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
    server = None
    for port in range(43210, 43240):
        try:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
            break
        except OSError:
            continue
    if server is None:
        raise RuntimeError('No local QA port is available')
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks: list[str] = []
    errors: list[str] = []
    snapshots: dict[str, dict] = {}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, env=environment, executable_path=os.environ.get('STORYDREAM_QA_BROWSER', 'C:/Program Files/Google/Chrome/Application/chrome.exe'))
            page = browser.new_page(viewport={'width': 1536, 'height': 1024})
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{server.server_port}/') else route.abort())
            read = lambda: page.evaluate('window.editorialDualChainQA.snapshot()')
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            generate = page.get_by_role('button', name='生成分层素材', exact=True)
            expect(generate).to_be_enabled()
            expect(page.get_by_role('tab', name='本地拼贴动画', exact=True)).to_have_attribute('aria-selected', 'true')
            generate.click()
            page.wait_for_function('window.editorialDualChainQA.snapshot().document.assets.length === 2')
            expect(generate).to_be_enabled()
            generated = read()
            assert len(generated['requests']) == 2
            assert [request.get('cutout') for request in generated['requests']] == [None, 'green']
            assert all(request['smartMode'] == 'text-to-image' for request in generated['requests'])
            assert len(set(image_bindings(generated).values())) == 2
            assert any(layer.get('content', {}).get('type') == 'text' for layer in shot(generated)['layers'])
            snapshots['local-success'] = generated
            assert shot(generated)['title'] == '纸片人物走进草原'
            assert len(generated['document']['beats']) == 1
            checks.append('Actual page submits separate background and subject requests; only subject requests green cutout; text stays native')
            slider = page.get_by_role('slider', name='播放进度')
            slider.focus()
            slider.press('Home')
            for _ in range(max(1, int(shot(generated)['durationMs'] * 0.55 / 100))):
                slider.press('ArrowRight')
            subject_layer_id = next(layer['id'] for layer in shot(generated)['layers'] if layer['kind'] == 'subject')
            expect(page.locator(f'[data-preview-layer-id="{subject_layer_id}"] img')).to_be_visible()
            for label in page.locator('.director-preview-text').all():
                assert label.evaluate('(element) => { const box = element.getBoundingClientRect(); const svg = element.querySelector("svg").getBoundingClientRect(); return svg.width <= box.width + 1 && svg.height <= box.height + 1; }')
            page.screenshot(path=str(OUTPUT / 'local-success.png'))

            page.evaluate('window.editorialDualChainQA.reset()')
            expect(generate).to_be_enabled()
            page.evaluate('window.editorialDualChainQA.failNextSubject = true')
            generate.click()
            page.wait_for_function('window.editorialDualChainQA.snapshot().document.providerJobs.some(job => job.status === "failed")')
            fill_missing = page.get_by_role('button', name='补齐分层素材', exact=True)
            expect(fill_missing).to_be_enabled()
            failed = read()
            assert len(failed['requests']) == 2
            assert len(failed['document']['assets']) == 1
            saved_background = next(layer['assetVersionId'] for layer in shot(failed)['layers'] if layer['kind'] == 'background')
            assert not next(layer for layer in shot(failed)['layers'] if layer['kind'] == 'subject').get('assetVersionId')
            snapshots['partial-failure'] = failed
            page.screenshot(path=str(OUTPUT / 'partial-failure.png'))
            fill_missing.click()
            page.wait_for_function('window.editorialDualChainQA.snapshot().document.assets.length === 2')
            expect(generate).to_be_enabled()
            retried = read()
            assert len(retried['requests']) == 3
            assert retried['requests'][-1]['cutout'] == 'green'
            assert next(layer['assetVersionId'] for layer in shot(retried)['layers'] if layer['kind'] == 'background') == saved_background
            assert len(retried['document']['providerJobs']) == 3
            local_bindings = image_bindings(retried)
            snapshots['partial-retried'] = retried
            checks.append('Failed subject preserves saved background; retry submits only the missing subject and keeps failed job history')

            page.get_by_role('tab', name='图生视频', exact=True).click()
            frame_button = page.get_by_role('button', name='生成关键帧', exact=True)
            expect(frame_button).to_be_enabled()
            frame_button.click()
            page.wait_for_function('Boolean(window.editorialDualChainQA.snapshot().document.beats[0].shots[0].keyframeAssetVersionId)')
            expect(page.get_by_role('button', name='更新关键帧', exact=True)).to_be_enabled()
            video_ready = read()
            assert len(video_ready['requests']) == 4
            assert video_ready['requests'][-1]['smartMode'] == 'video-narration'
            assert 'cutout' not in video_ready['requests'][-1]
            assert image_bindings(video_ready) == local_bindings
            keyframe_id = shot(video_ready)['keyframeAssetVersionId']
            assert keyframe_id not in local_bindings.values()
            assert len(video_ready['document']['assets']) == 3
            expect(page.locator('.director-mini-status-label').first).to_have_text('排队中')
            expect(page.locator('.director-video-empty')).to_be_visible()
            snapshots['video-keyframe'] = video_ready
            checks.append('Switching to image-to-video generates a distinct whole-scene keyframe and preserves local layer assets')
            page.screenshot(path=str(OUTPUT / 'video-keyframe.png'))

            page.get_by_label('镜头生成操作', exact=True).get_by_role('button', name='保存版本', exact=True).click()
            page.wait_for_function('window.editorialDualChainQA.snapshot().document.beats[0].shots[0].renderStrategy === "living-poster"')
            page.reload()
            expect(page.get_by_role('tab', name='图生视频', exact=True)).to_have_attribute('aria-selected', 'true')
            expect(page.get_by_role('button', name='更新关键帧', exact=True)).to_be_enabled()
            assert image_bindings(read()) == local_bindings
            page.get_by_role('tab', name='本地拼贴动画', exact=True).click()
            page.get_by_label('镜头生成操作', exact=True).get_by_role('button', name='保存版本', exact=True).click()
            page.wait_for_function('window.editorialDualChainQA.snapshot().document.beats[0].shots[0].renderStrategy === "deterministic-layers"')
            page.reload()
            expect(page.get_by_role('tab', name='本地拼贴动画', exact=True)).to_have_attribute('aria-selected', 'true')
            expect(generate).to_be_enabled()
            restored = read()
            assert image_bindings(restored) == local_bindings
            assert shot(restored)['keyframeAssetVersionId'] == keyframe_id
            assert len(restored['document']['assets']) == 3
            assert len(restored['requests']) == 4
            assert restored['blockedCalls'] == []
            snapshots['reloaded-local'] = restored
            checks.append('Full page reload restores each saved mode and retains background, cutout and separate video keyframe without new generation')
            page.get_by_role('textbox', name='上屏标题', exact=True).fill('草原上的纸片人物')
            page.get_by_label('叙事动作', exact=True).select_option('focus-reveal')
            page.get_by_label('镜头生成操作', exact=True).get_by_role('button', name='保存版本', exact=True).click()
            page.wait_for_function('window.editorialDualChainQA.snapshot().document.beats[0].shots[0].motionStyle === "focus-reveal"')
            edited = read()
            assert shot(edited)['title'] == '草原上的纸片人物'
            assert image_bindings(edited) == local_bindings
            assert len(edited['requests']) == 4
            assert any(layer.get('content', {}).get('text') == '草原上的纸片人物' for layer in shot(edited)['layers'])
            assert shot(edited)['layers'][1]['motion'] != shot(restored)['layers'][1]['motion']
            page.reload()
            expect(page.get_by_role('textbox', name='上屏标题', exact=True)).to_have_value('草原上的纸片人物')
            expect(page.get_by_label('叙事动作', exact=True)).to_have_value('focus-reveal')
            expect(page.locator('.director-preview-title')).to_have_count(0)
            snapshots['edited-title-motion'] = read()
            checks.append('Title and narrative motion edits change actual native text/frames, preserve assets, and survive a full reload')
            browser.close()
        assert not errors, errors
        (OUTPUT / 'result.json').write_text(json.dumps({'passed': True, 'checks': checks, 'errors': errors, 'snapshots': snapshots}, ensure_ascii=False, indent=2), encoding='utf-8')
        (OUTPUT / 'failure.json').unlink(missing_ok=True)
        print(json.dumps({'passed': True, 'checks': len(checks), 'output': str(OUTPUT)}, ensure_ascii=False))
    except Exception:
        (OUTPUT / 'failure.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'snapshots': snapshots}, ensure_ascii=False, indent=2), encoding='utf-8')
        raise
    finally:
        server.shutdown()


if __name__ == '__main__':
    run()
