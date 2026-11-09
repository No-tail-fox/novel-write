"""Real, non-generating UI regression for shell, settings and native/Fluent isolation.
Run against an already isolated Electron instance. Never saves model configuration,
invokes generation, modifies project data, or edits the exported sample.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import traceback
from playwright.sync_api import expect, sync_playwright


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cdp', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--project-title', required=True)
    parser.add_argument('--sample', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'checks': [], 'screenshots': [], 'pageErrors': [], 'generationActionsInvoked': 0}
    report['sampleBefore'] = sha256(args.sample)

    def check(name, passed):
        report['checks'].append({'name': name, 'passed': bool(passed)})
        assert passed, name

    def capture(page, name):
        page.evaluate("""async()=>{await document.fonts.ready; await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>Promise.race([a.finished.catch(()=>{}),new Promise(r=>setTimeout(r,1500))])));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}""")
        path = args.output / (name + '.png')
        page.screenshot(path=str(path))
        report['screenshots'].append(str(path))

    # Only a hash leaves the renderer; credentials/configuration are never printed or written.
    config_fingerprint = """async()=>{const {config}=await window.storydream.getBootstrap();const data=new TextEncoder().encode(JSON.stringify(config));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('')}"""
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(args.cdp)
            page = next(p for c in browser.contexts for p in c.pages if p.url.endswith('dist-renderer/index.html'))
            page.set_default_timeout(15000)
            page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
            session = page.context.new_cdp_session(page)
            session.send('Emulation.setFocusEmulationEnabled', {'enabled': True})
            original_theme = page.locator('html').get_attribute('data-theme')
            original_size = page.evaluate('()=>({width:innerWidth,height:innerHeight})')
            report['configBefore'] = page.evaluate(config_fingerprint)

            def shell():
                back = page.get_by_role('button', name='返回项目', exact=True)
                if back.is_visible(): back.click()
                expect(page.locator('button[data-nav-view="settings"]')).to_be_visible()

            def theme(value):
                if page.locator('html').get_attribute('data-theme') != value:
                    page.get_by_role('button', name='切换' + ('深' if value == 'dark' else '浅') + '色主题', exact=True).click()
                expect(page.locator('html')).to_have_attribute('data-theme', value)

            shell()
            for mode in ['dark', 'light']:
                page.set_viewport_size({'width': 1320, 'height': 860})
                theme(mode)
                page.locator('button[data-nav-view="settings"]').click()
                tabs = page.locator('.settings-navigation')
                select = page.locator('.settings-section-select select')
                expect(tabs).to_be_visible()
                expect(select).to_be_hidden()
                tabs.locator('[data-tab-value="llm"]').click()
                field = page.get_by_label('配置名称', exact=True)
                original_name = field.input_value()
                draft = original_name + ' UI-QA-UNSAVED'
                field.fill(draft)
                tabs.locator('[data-tab-value="llm"]').focus()
                page.keyboard.press('ArrowDown')
                page.keyboard.press('Enter')
                expect(tabs.locator('[data-tab-value="image"]')).to_have_attribute('aria-selected', 'true')
                expect(select).to_have_value('image')
                check(mode + ' keyboard tab selection syncs select', True)
                tabs.locator('[data-tab-value="llm"]').click()
                expect(field).to_have_value(draft)
                check(mode + ' section switching keeps unsaved model draft', True)
                for size_name, width, height in [('normal', 1320, 860), ('compact', 1080, 720), ('narrow', 720, 720)]:
                    page.set_viewport_size({'width': width, 'height': height})
                    if width <= 760:
                        expect(tabs).to_be_hidden()
                        expect(select).to_be_visible()
                        select.select_option('image')
                        expect(tabs.locator('[data-tab-value="image"]')).to_have_attribute('aria-selected', 'true')
                        expect(page.locator('.settings-heading h2')).to_have_text('AI 绘图')
                        select.select_option('llm')
                    else:
                        expect(tabs).to_be_visible()
                        expect(select).to_be_hidden()
                    expect(field).to_have_value(draft)
                    check(mode + ' ' + size_name + ' navigation and draft stay synchronized', True)
                    if width <= 760: select.select_option('appearance')
                    else: tabs.locator('[data-tab-value="appearance"]').click()
                    expect(page.locator('.settings-heading h2')).to_have_text('外观')
                    geometry = page.locator('.settings-layout').evaluate("""e=>({right:e.getBoundingClientRect().right,scrollOverflow:document.documentElement.scrollWidth-innerWidth})""")
                    check(mode + ' ' + size_name + ' no horizontal clipping', geometry['right'] <= width + 1 and geometry['scrollOverflow'] <= 1)
                    check(mode + ' ' + size_name + ' license action reachable', page.locator('button[data-nav-view="activation"]').is_visible())
                    capture(page, mode + '-' + size_name + '-settings')
                    if width <= 760: select.select_option('llm')
                    else: tabs.locator('[data-tab-value="llm"]').click()
                page.set_viewport_size({'width': 1320, 'height': 860})
                expect(tabs.locator('[data-tab-value="llm"]')).to_have_attribute('aria-selected', 'true')
                expect(field).to_have_value(draft)
                check(mode + ' expanding restores selected tab and unsaved draft', True)

                isolation = page.evaluate(r"""()=>{
                    const rules=[];const visit=rs=>{for(const r of rs){if(r.selectorText)rules.push(r);if(r.cssRules)visit(r.cssRules)}};
                    for(const sheet of document.styleSheets){try{visit(sheet.cssRules)}catch{}}
                    const reset=rules.find(r=>/^:where\(button,\s*input,\s*select,\s*textarea\)/.test(r.selectorText));
                    const buttonReset=rules.find(r=>r.selectorText.startsWith(':where(button)')&&r.style.cursor==='pointer');
                    const native=['button','input','select','textarea'].every(tag=>document.createElement(tag).matches(reset?.selectorText||':not(*)'));
                    const fluent=['button','input','select','textarea'].every(tag=>{const e=document.createElement(tag);e.className='fui-Test__slot';return !e.matches(reset?.selectorText||'*')&&!e.matches(buttonReset?.selectorText||'*')});
                    const button= document.querySelector('.settings-content .sd-button--primary');
                    const input=document.querySelector('.settings-content .fui-Input__input');
                    return {native,fluent,buttonReset:!!buttonReset,fontSize:input?parseFloat(getComputedStyle(input).fontSize):0,buttonBorder:button?getComputedStyle(button).borderStyle:null};
                }""")
                check(mode + ' production CSS resets native controls only', isolation['native'] and isolation['fluent'] and isolation['buttonReset'])
                check(mode + ' Fluent input remains legible', isolation['fontSize'] >= 12)
                page.locator('button[data-nav-view="activation"]').focus()
                page.keyboard.press('Enter')
                guard = page.get_by_role('dialog', name='保留未保存的改动？')
                expect(guard).to_be_visible()
                guard.get_by_role('button', name='继续编辑', exact=True).click()
                expect(field).to_have_value(draft)
                check(mode + ' cancel navigation keeps unsaved model draft', True)
                page.locator('button[data-nav-view="activation"]').click()
                expect(guard).to_be_visible()
                guard.get_by_role('button', name='放弃改动并离开', exact=True).click()
                expect(guard).to_have_count(0)
                check(mode + ' discard navigation does not save configuration', True)
                expect(page.locator('.license-settings')).to_be_visible()
                expect(page.locator('button[data-nav-view="activation"]')).to_have_attribute('aria-current', 'page')
                check(mode + ' keyboard license action opens real license page', True)
                page.locator('button[data-nav-view="person-assets"][data-nav-level="primary"]').click()
                expected = ['copy-studio', 'conversation-workbench', 'image-lab', 'voice-lab', 'video-lab', 'music-lab']
                actual = page.locator('button[data-nav-level="secondary"]').evaluate_all('bs=>bs.map(b=>b.dataset.navView)')
                check(mode + ' all six asset tools are reachable without duplicates', actual == expected)
                for route in ['copy-studio', 'conversation-workbench', 'music-lab']:
                    entry = page.locator('button[data-nav-view="' + route + '"]')
                    entry.click()
                    expect(entry).to_have_attribute('aria-current', 'page')
                    check(mode + ' new route opens: ' + route, True)

            shell()
            theme(original_theme)
            page.set_viewport_size(original_size)
            page.locator('button[data-nav-view="projects"]').click()
            page.get_by_role('button', name='打开项目：' + args.project_title, exact=True).click()
            expect(page.locator('.vox-project-action-bar')).to_be_visible()
            video = page.locator('video')
            expect(video).to_have_count(1)
            page.wait_for_function('()=>document.querySelector("video")?.readyState>=1')
            metadata = video.evaluate('v=>({width:v.videoWidth,height:v.videoHeight,error:!!v.error})')
            check('original creative project and exported media remain available', metadata['width'] == 1920 and metadata['height'] == 1080 and not metadata['error'])
            capture(page, 'creative-project-restored')
            report['configAfter'] = page.evaluate(config_fingerprint)
            check('no saved model configuration changed', report['configAfter'] == report['configBefore'])
            check('no renderer runtime errors', not report['pageErrors'])
            session.detach()
        report['sampleAfter'] = sha256(args.sample)
        check('sample file unchanged', report['sampleAfter'] == report['sampleBefore'])
        report['status'] = 'passed'
    except Exception:
        report['status'] = 'failed'
        report['error'] = traceback.format_exc()
        raise
    finally:
        (args.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'status': report['status'], 'passed': sum(c['passed'] for c in report['checks']), 'failed': sum(not c['passed'] for c in report['checks'])}))


if __name__ == '__main__':
    main()
