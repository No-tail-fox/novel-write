"""Build the local design prototype and export inspected browser concepts."""
from pathlib import Path
import json
import subprocess
from playwright.sync_api import sync_playwright, expect

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
subprocess.run([
    str(ROOT / 'scripts/run-npm-node.cmd'), '--input-type=module', '-e',
    "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:true,target:'chrome120',lib:{entry:process.argv[2],name:'comicConcept',formats:['iife'],fileName:()=> 'concept.js',cssFileName:'concept'}}});",
    str(HERE / 'rendered'), str(HERE / 'concept.tsx'),
], cwd=ROOT, check=True)
errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
    page = browser.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    for theme in ('light', 'dark'):
        for view in ('production', 'assets'):
            for width, height in ((1440, 960), (1040, 720)):
                page.set_viewport_size({'width': width, 'height': height})
                page.goto(f'{(HERE / "index.html").as_uri()}?view={view}&theme={theme}')
                expect(page.get_by_role('heading', name='河畔来信', exact=True)).to_be_visible()
                if view == 'production':
                    expect(page.get_by_role('tab', name='分幕分场', exact=True)).to_be_in_viewport()
                    page.get_by_role('button', name='01 书铺的午后 临河书铺', exact=False).click()
                    expect(page.get_by_label('剧情内容', exact=True)).to_be_in_viewport()
                else:
                    page.wait_for_function('Array.from(document.images).every(image => image.complete && image.naturalWidth > 0)')
                    expect(page.get_by_label('身份定义', exact=True)).to_be_in_viewport()
                assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
                page.screenshot(path=str(HERE / f'concept-{view}-{theme}-{width}.png'))
    assert not errors, errors
    browser.close()
print(json.dumps({'status': 'passed', 'screenshots': 8, 'pageErrors': errors, 'source': 'code-rendered UI concept, not image generation'}))
