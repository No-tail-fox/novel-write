"""Real VOX page: recipe persistence, reference images and first/last-frame request QA."""
from pathlib import Path
import functools, http.server, json, shutil, subprocess, threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/editorial-recipes'
OUT.mkdir(parents=True, exist_ok=True)
build = subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e',
    "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/editorial-dual-chain.harness.tsx',name:'editorialRecipesQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUT)], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
(OUT / 'build.log').write_text(build.stdout + build.stderr, encoding='utf-8')
build.check_returncode()
shutil.copyfile(ROOT / '.artifacts/vox-animation-qa/runtime.js', OUT / 'runtime.js')
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><style>[data-editorial-collage-workbench]{height:100vh;min-height:0;overflow:hidden}</style><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
report = {'checks': [], 'errors': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        for width, height in [(1536, 1024), (1040, 720)]:
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.on('pageerror', lambda e: report['errors'].append(str(e)))
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base + '/') else route.abort())
            page.goto(base)
            page.wait_for_function('window.editorialDualChainQA')
            page.evaluate('editorialDualChainQA.recipeFixture()')
            def reveal():
                toggle = page.get_by_role('button', name='显示镜头检查器', exact=True)
                if toggle.is_visible(): toggle.click()
                expect(page.get_by_label('制作方式', exact=True)).to_be_visible()
            reveal()
            read = lambda: page.evaluate('editorialDualChainQA.snapshot()')
            recipe = page.get_by_label('制作方式', exact=True)
            recipe.select_option('paper-cut')
            page.get_by_role('button', name='生成分层素材', exact=True).click()
            page.wait_for_function('editorialDualChainQA.snapshot().requests.length===3 && editorialDualChainQA.snapshot().document.assets.length===5')
            requests = read()['requests']
            assert not requests[0].get('referenceImagePaths')
            assert requests[1]['referenceImagePaths'] == requests[2]['referenceImagePaths']
            assert requests[2]['cutout'] == 'green'
            page.screenshot(path=str(OUT / f'paper-cut-{width}.png'))
            report['checks'].append(f'{width}: hero -> reference background -> alpha subject')

            recipe.select_option('nantian')
            page.get_by_label('首帧图片', exact=True).select_option('qa-first')
            expect(page.get_by_role('button', name='生成视频', exact=True)).to_be_disabled()
            expect(page.get_by_text('缺少可读尾帧', exact=True)).to_be_visible()
            page.get_by_role('button', name='使用下一镜头关键帧', exact=True).click()
            expect(page.get_by_label('尾帧图片', exact=True)).to_have_value('qa-last')
            expect(page.get_by_role('button', name='生成视频', exact=True)).to_be_enabled()
            page.screenshot(path=str(OUT / f'nantian-{width}.png'))
            page.get_by_role('button', name='生成视频', exact=True).click()
            page.wait_for_function('editorialDualChainQA.snapshot().videoRequests.length===1')
            request = read()['videoRequests'][0]
            assert request['firstFramePath'] != request['lastFramePath']
            assert 'Match the last-frame composition' in request['prompt']
            page.reload(); reveal()
            expect(recipe).to_have_value('nantian')
            expect(page.get_by_label('尾帧图片', exact=True)).to_have_value('qa-last')
            report['checks'].append(f'{width}: missing-tail guard, actual two-image request, persistence')

            recipe.select_option('collage-broll')
            expect(page.get_by_label('尾帧图片', exact=True)).to_have_value('')
            page.get_by_label('镜头生成操作', exact=True).get_by_role('button', name='保存版本', exact=True).click()
            page.wait_for_function("editorialDualChainQA.snapshot().document.beats[0].shots[0].productionRecipe==='collage-broll'")
            assert 'four meaningful object groups' in read()['requests'][0].get('prompt', '') or '不超过四组' in read()['document']['beats'][0]['shots'][0]['motionPrompt']
            recipe.select_option('vox-narrated')
            expect(page.get_by_role('tab', name='动画模板', exact=True)).to_be_visible()
            expect(page.locator('[data-vox-ready="true"]')).to_have_count(1, timeout=25000)
            page.screenshot(path=str(OUT / f'narrated-{width}.png'))
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert not read()['blockedCalls']
            report['checks'].append(f'{width}: B-roll motion, Remotion playback, no horizontal overflow')
            page.close()
        browser.close()
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
