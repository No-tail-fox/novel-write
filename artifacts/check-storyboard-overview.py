from pathlib import Path
from playwright.sync_api import sync_playwright
p=Path(__file__).resolve().parent
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
 page=b.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 for w,h in [(1440,900),(1024,768),(390,844)]:
  page.set_viewport_size({'width':w,'height':h});page.goto((p/'storyboard-overview.html').as_uri());page.screenshot(path=str(p/f'storyboard-overview-{w}.png'),full_page=True)
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),str(w)
  assert page.locator('img').evaluate_all('(imgs)=>imgs.every(i=>i.complete&&i.naturalWidth>0)')
 page.set_viewport_size({'width':1440,'height':900});page.locator('.board').nth(2).click();assert '03' in page.locator('.inspector-title').inner_text()
 page.locator('#field-1').fill('测试对白');page.locator('.board').nth(0).click();page.locator('.board').nth(2).click();assert page.locator('#field-1').input_value()=='测试对白'
 page.locator('.board').nth(2).dblclick();assert page.locator('.frame').is_visible();page.locator('#overview-mode').click();assert page.locator('.board-grid').is_visible()
 assert not errors,errors
 print('PASS: 1440/1024/390 widths, embedded images, selection, draft retention, single-shot toggle; no page errors.')
 b.close()
