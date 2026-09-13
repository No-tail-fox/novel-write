"""Shared shell visual and geometry checks, using an isolated browser preview."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/storydream-web-redesign/shared-ui-20260912'
URL = os.environ.get('STORYDREAM_QA_URL', 'http://127.0.0.1:5186/')
ROUTES = ['projects', 'new-task', 'person-assets', 'prompt-templates', 'queue', 'settings']


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'status': 'running', 'captures': [], 'errors': []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='msedge', headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        try:
            page.goto(URL, wait_until='domcontentloaded')
            page.wait_for_selector('[data-theme-ready=true] .app-shell')
            for theme in ['light', 'dark']:
                if page.locator('html').get_attribute('data-theme') != theme:
                    page.locator('.theme-toggle').click()
                    expect(page.locator('html')).to_have_attribute('data-theme', theme)
                for width, height in [(1440, 900), (1024, 768), (390, 844)]:
                    page.set_viewport_size({'width': width, 'height': height})
                    for route in ROUTES:
                        group = {'person-assets': 'image-lab', 'prompt-templates': 'prompt-templates', 'queue': 'queue', 'settings': 'settings'}.get(route, 'projects')
                        page.locator(f'.nav-list [data-nav-view="{group}"]').first.click()
                        page.locator(f'.sidebar [data-nav-view="{route}"]').first.click()
                        page.wait_for_selector(f'.app-shell[data-shell-view="{route}"]')
                        page.wait_for_timeout(350)
                        metrics = page.evaluate('''() => {
                          const visible = n => n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0;
                          const rect = n => { const r = n.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
                          const header = document.querySelector('.page-head');
                          const title = header.querySelector('h1');
                          const controls = [...document.querySelectorAll('.sidebar button')].filter(visible);
                          return {
                            font: getComputedStyle(title).fontFamily,
                            providerFont: getComputedStyle(document.querySelector('.storydream-provider')).fontFamily,
                            titleSize: getComputedStyle(title).fontSize,
                            header: rect(header),
                            overflow: document.documentElement.scrollWidth > innerWidth + 1,
                            sidebarControls: controls.map(n => ({label:n.getAttribute('aria-label') || n.textContent, ...rect(n)})),
                            selectedTabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].filter(visible).map(n => ({color:getComputedStyle(n).color, indicator:getComputedStyle(n,'::after').backgroundColor})),
                            controlClips: [...document.querySelectorAll('.project-home-toolbar button, [data-task-creation-type]')].filter(visible).filter(n=>n.scrollWidth > n.clientWidth+1).map(n=>n.textContent),
                          };
                        }''')
                        name = f'{route}-{theme}-{width}.png'
                        page.screenshot(path=OUTPUT / name, animations='disabled')
                        report['captures'].append({'file': name, 'theme': theme, 'width': width, 'route': route, **metrics})
                        assert not metrics['overflow'], name
                        assert not metrics['controlClips'], (name, metrics['controlClips'])
                        assert all(item['height'] <= 46 for item in metrics['sidebarControls']), (name, 'Oversized sidebar control')
                        assert len({item['header']['height'] for item in report['captures'] if item['width'] == width}) == 1, (name, 'Inconsistent header height')
                        if route in ['projects', 'settings']:
                            assert page.locator('.nav-list [aria-current="page"]').count() == 1
                        if route == 'projects':
                            assert page.locator('.nav-list [data-nav-view="projects"]').count() == 1
                            layout = page.get_by_role('tab', name='列表', exact=True)
                            layout.focus()
                            layout.press('Space')
                            expect(layout).to_have_attribute('aria-selected', 'true')
                            page.get_by_role('tab', name='网格', exact=True).click()
                        if route == 'settings' and width < 760:
                            sections = page.get_by_label('设置分类', exact=True)
                            expect(sections).to_be_visible()
                            sections.select_option('appearance')
                            expect(page.locator('.settings-heading h2')).to_have_text('外观')
                            sections.select_option('llm')
                            expect(page.locator('.settings-heading h2')).to_have_text('LLM')
                            assert page.locator('.profile-copy').first.bounding_box()['width'] > 100
                        print(name, flush=True)
            assert not report['errors'], report['errors']
            report['status'] = 'passed'
        except Exception as error:
            report['status'] = 'failed'
            report['failure'] = str(error)
            raise
        finally:
            (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            browser.close()


if __name__ == '__main__':
    main()
