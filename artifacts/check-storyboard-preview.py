from pathlib import Path
import json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    results=[]
    for w,h in [(1440,900),(1024,768),(390,844)]:
        page.set_viewport_size({'width':w,'height':h})
        page.goto((root/'storyboard-preview.html').as_uri())
        page.screenshot(path=str(root/f'storyboard-preview-{w}.png'),full_page=True)
        results.append({'width':w,'overflow':page.evaluate('document.documentElement.scrollWidth > innerWidth'),'imagesLoaded':page.locator('img').evaluate_all('(imgs)=>imgs.every(i=>i.complete && i.naturalWidth>0)')})
    page.set_viewport_size({'width':1440,'height':900})
    page.locator('.shot').nth(1).click()
    assert page.locator('#scene-title').inner_text().startswith('02')
    page.locator('#field-1').fill('保留编辑内容')
    page.locator('.shot').nth(0).click()
    page.locator('.shot').nth(1).click()
    assert page.locator('#field-1').input_value()=='保留编辑内容'
    page.locator('#preview-toggle').click()
    assert not page.locator('.inspector').is_visible()
    page.locator('#preview-toggle').click()
    assert page.locator('.inspector').is_visible()
    report={'viewports':results,'pageErrors':errors,'selectionDraftFocusMode':'passed'}
    (root/'storyboard-preview-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))
    browser.close()
