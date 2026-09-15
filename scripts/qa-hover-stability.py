"""Capture transient hover/portal regressions without disabling animations."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

from PIL import Image, ImageChops, ImageDraw
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/hover-stability'

START_TRACE = """selector => {
  const target = document.querySelector(selector);
  const box = element => {
    const r = element.getBoundingClientRect();
    return {x:r.x, y:r.y, width:r.width, height:r.height};
  };
  const initial = box(target);
  const x = initial.x + initial.width / 2, y = initial.y + initial.height / 2;
  const started = performance.now();
  const trace = window.hoverTrace = {frames:[], active:true, selector};
  const tick = () => {
    if (!trace.active) return;
    const hit = document.elementFromPoint(x,y);
    trace.frames.push({
      ms:Math.round(performance.now()-started),
      target:box(target), hitTarget:hit === target || target.contains(hit),
      hit:hit?.className?.baseVal ?? hit?.className,
      theme:document.documentElement.dataset.theme,
      rootVisibility:getComputedStyle(document.getElementById('root')).visibility,
      view:document.querySelector('.app-shell')?.dataset.shellView,
      portals:[...document.querySelectorAll('[data-portal-node]')].map(node => ({
        ...box(node), classes:node.className,
        background:getComputedStyle(node).backgroundColor,
        pointerEvents:getComputedStyle(node).pointerEvents,
        theme:getComputedStyle(node).getPropertyValue('--colorNeutralBackground1').trim(),
        rootTheme:getComputedStyle(document.querySelector('#root .storydream-provider')).getPropertyValue('--colorNeutralBackground1').trim(),
      })),
      tooltips:[...document.querySelectorAll('[role=tooltip]')].filter(node =>
        getComputedStyle(node).visibility !== 'hidden').map(node => ({...box(node), text:node.textContent})),
      styles:document.styleSheets.length,
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {x,y};
}"""


def capture_hover(page, directory, name, selector):
    page.mouse.move(5, 5)
    page.wait_for_timeout(500)
    target = page.locator(selector).first
    target.wait_for(state='visible')
    page.screenshot(path=directory / f'{name}-before.png')
    point = page.evaluate(START_TRACE, selector)
    page.mouse.move(point['x'], point['y'])
    for index in range(6):
        page.wait_for_timeout(130)
        page.screenshot(path=directory / f'{name}-{index}.png')
    frames = page.evaluate('() => { window.hoverTrace.active=false; return window.hoverTrace.frames; }')
    page.mouse.move(5, 5)
    page.wait_for_timeout(500)
    page.screenshot(path=directory / f'{name}-after.png')
    first = frames[0]
    # Ignore the hovered control and its small tooltip, not the surrounding page.
    with Image.open(directory / f'{name}-before.png') as before:
        baseline = before.convert('RGB')
    pixel_changes = []
    for index in range(6):
        with Image.open(directory / f'{name}-{index}.png') as shot:
            diff = ImageChops.difference(baseline, shot.convert('RGB'))
        draw = ImageDraw.Draw(diff)
        rectangles = [first['target']] + [tip for frame in frames for tip in frame['tooltips']]
        for rect in rectangles:
            draw.rectangle((rect['x'] - 12, rect['y'] - 12, rect['x'] + rect['width'] + 12, rect['y'] + rect['height'] + 12), fill=0)
        mask = ImageChops.lighter(ImageChops.lighter(*diff.split()[:2]), diff.split()[2]).point(lambda value: 255 if value > 20 else 0)
        pixel_changes.append(round(mask.histogram()[255] / (mask.width * mask.height), 6))
    summary = {
        'name': name, 'selector': selector, 'frames': len(frames),
        'occludedFrames': sum(not frame['hitTarget'] for frame in frames),
        'largePortalFrames': sum(any(p['width'] > 500 and p['height'] > 500 for p in f['portals']) for f in frames),
        'hiddenRootFrames': sum(f['rootVisibility'] != 'visible' for f in frames),
        'layoutChanges': sum(f['target'] != first['target'] for f in frames),
        'viewChanges': sum(f['view'] != first['view'] for f in frames),
        'themeChanges': sum(f['theme'] != first['theme'] for f in frames),
        'tooltipFrames': sum(bool(f['tooltips']) for f in frames),
        'tooltipDrops': sum(bool(a['tooltips']) and not b['tooltips'] for a, b in zip(frames, frames[1:])),
        'portalThemeErrors': sum(any(p['theme'] != p['rootTheme'] or not p['theme'] for p in f['portals']) for f in frames),
        'maxOutsidePixelChange': max(pixel_changes),
        'stylesAdded': frames[-1]['styles'] - first['styles'],
    }
    (directory / f'{name}-trace.json').write_text(json.dumps(frames, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return summary


def check_capture(result):
    for key in ['occludedFrames', 'largePortalFrames', 'hiddenRootFrames', 'layoutChanges', 'viewChanges', 'themeChanges', 'tooltipDrops', 'portalThemeErrors']:
        assert result[key] == 0, (result['name'], key, result[key])
    assert result['maxOutsidePixelChange'] < .005, result
    if 'tooltip' in result['name']:
        assert result['tooltipFrames'] > 0, result


def wait_overlay(locator):
    expect(locator).to_be_visible()
    locator.evaluate('''async node => {
      const portal = node.closest('[data-portal-node]') ?? node;
      await Promise.all(portal.getAnimations({subtree:true})
        .filter(animation => animation.effect.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    }''')


def matrix(page, directory, report, resize, electron, overlays_only=False):
    def capture(name, selector):
        result = capture_hover(page, directory, name, selector)
        report['captures'].append(result)
        check_capture(result)

    for theme in ['dark', 'light']:
        if page.locator('html').get_attribute('data-theme') != theme:
            page.locator('.theme-toggle').click()
        expect(page.locator('html')).to_have_attribute('data-theme', theme)
        for width, height in ([] if overlays_only else [(1440, 900), (1040, 720), (390, 844)]):
            resize(page, width, height)
            prefix = f'{theme}-{width}'
            page.locator('.new-task-button').click()
            page.wait_for_selector('.new-task-type-picker')
            capture(prefix + '-back-tooltip', '.page-back-button')
            capture(prefix + '-back-repeat-tooltip', '.page-back-button')
            if electron:
                capture(prefix + '-window-tooltip', '.window-control-button')
            capture(prefix + '-creation-card', '[data-task-creation-type="html-video"]')
            if page.locator('.top-notice').is_visible():
                capture(prefix + '-draft-tooltip', '.top-notice')
            for creation, view, field in [
                ('html-video', 'html-video', '.hv-create-page textarea'),
                ('music-mv', 'music-mv', '.music-mv-layout input'),
                ('vox', 'editorial-collage', '.director-create-fields input'),
                ('motion-comic', 'motion-comic', '.director-create-fields input'),
            ]:
                page.locator(f'[data-task-creation-type="{creation}"]').click()
                page.wait_for_selector(f'[data-shell-view="{view}"]')
                capture(f'{prefix}-{view}-tooltip', '.page-back-button')
                if width == 1440:
                    capture(f'{prefix}-{view}-field', field)
                page.locator('.page-back-button').click()
                page.wait_for_selector('.new-task-type-picker')
            page.locator('.page-back-button').click()
            page.wait_for_selector('[data-project-home]')
            expect(page.get_by_text('正在加载项目', exact=True)).to_have_count(0, timeout=30000)
            capture(prefix + '-layout-tooltip', '.project-layout-toggle [role="tab"]')
            if width == 1440:
                capture(prefix + '-navigation-preload', '[data-nav-view="settings"]')
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')

        resize(page, 1040, 720)
        page.locator('.new-task-button').click()
        page.locator('[data-task-creation-type="html-video"]').click()
        field = page.locator('.hv-create-page textarea').first
        original = field.input_value()
        field.fill('Hover QA unsaved draft')
        page.locator('.page-back-button').click()
        wait_overlay(page.get_by_role('dialog'))
        page.screenshot(path=directory / f'{theme}-unsaved-dialog.png')
        assert not page.locator('[data-portal-node].storydream-provider').count()
        page.get_by_role('button', name='继续编辑', exact=True).click()
        expect(field).to_have_value('Hover QA unsaved draft')
        field.fill(original)
        page.locator('.page-back-button').click()
        page.wait_for_selector('.new-task-type-picker')

        # Keyboard-triggered tooltips and reduced motion must survive portal isolation.
        page.emulate_media(reduced_motion='reduce')
        back = page.locator('.page-back-button')
        back.focus()
        tip = page.get_by_role('tooltip')
        expect(tip).to_be_visible()
        assert tip.evaluate('node => getComputedStyle(node).transitionDuration') == '1e-05s'
        page.screenshot(path=directory / f'{theme}-keyboard-tooltip.png')
        back.press('Enter')
        page.wait_for_selector('[data-project-home]')
        page.emulate_media(reduced_motion='no-preference')
        report.setdefault('checks', []).append(theme + ': unsaved cancel, keyboard return and reduced motion passed')

        if electron:
            resize(page, 1440, 900)
            search = page.get_by_role('textbox', name='搜索项目', exact=True)
            search.fill('Hover QA VOX')
            expect(page.locator('[data-project-home]')).to_have_attribute('data-project-count', '1')
            page.locator('.project-card-open').click()
            page.wait_for_selector('[data-director-desk-mode="vox"]')
            trigger = page.get_by_role('button', name='更多操作', exact=True)
            trigger.click()
            menu = page.get_by_role('menu')
            wait_overlay(menu)
            assert not page.locator('[data-portal-node].storydream-provider').count()
            page.screenshot(path=directory / f'{theme}-director-menu.png')
            menu.press('Escape')
            expect(menu).not_to_be_visible()
            expect(trigger).to_be_focused()
            stage = page.get_by_role('button', name='制作步骤', exact=True)
            stage.click()
            expect(page.get_by_role('menu')).to_be_visible()
            page.get_by_role('menuitem').first.click()
            expect(page.get_by_role('menu')).not_to_be_visible()
            page.locator('.director-brandline button').first.click()
            page.wait_for_selector('[data-project-home]')
            search.fill('')
            report['checks'].append(theme + ': director menus click, Escape and focus return passed')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--label', default='before')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--matrix', action='store_true')
    parser.add_argument('--electron', action='store_true')
    parser.add_argument('--overlays-only', action='store_true')
    args = parser.parse_args()
    args.matrix = args.matrix or args.overlays_only
    directory = OUTPUT / args.label
    directory.mkdir(parents=True, exist_ok=True)
    report = {'status': 'running', 'captures': [], 'runtimeErrors': []}
    process = None
    try:
        with sync_playwright() as pw:
            if args.electron:
                spec = importlib.util.spec_from_file_location('hover_qa_base', ROOT / 'scripts/qa-director-desk.py')
                base = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(base)
                profile = Path(tempfile.mkdtemp(prefix='profile-', dir=directory))
                env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile)}
                for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
                    env.pop(key, None)
                subprocess.run(['node', str(ROOT / 'node_modules/tsx/dist/cli.mjs'), str(ROOT / 'scripts/qa-hover-seed.ts'), str(profile)], cwd=ROOT, env=env, check=True)
                port = base.free_port()
                with (directory / 'electron.log').open('wb') as log:
                    process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-project-home.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
                browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
                deadline = time.monotonic() + 30
                while not browser.contexts[0].pages and time.monotonic() < deadline:
                    time.sleep(.1)
                page = browser.contexts[0].pages[0]
                base.wait_app(page)
                resize = base.set_size
            else:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                page = browser.new_page(viewport={'width': 1440, 'height': 900})
                page.goto('http://127.0.0.1:5173/')
                page.wait_for_selector('.new-task-type-picker')
                resize = lambda page, width, height: page.set_viewport_size({'width': width, 'height': height})
            try:
                page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                if args.matrix:
                    matrix(page, directory, report, resize, args.electron, args.overlays_only)
                else:
                    for name, selector in [
                        ('back-tooltip', '.page-back-button'),
                        ('draft-tooltip', '.top-notice'),
                        ('navigation-preload', '[data-nav-view="settings"]'),
                        ('creation-card', '[data-task-creation-type="html-video"]'),
                    ]:
                        report['captures'].append(capture_hover(page, directory, name, selector))
                if args.check or args.matrix:
                    for result in report['captures']:
                        check_capture(result)
                    assert not report['runtimeErrors'], report['runtimeErrors']
                if args.electron:
                    ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
                    assert ledger['blockedGeneration'] == 0
                    report['paidGenerationCalls'] = 0
                report['status'] = 'passed' if args.check or args.matrix else 'captured'
            finally:
                browser.close()
    except Exception as error:
        report.update(status='failed', error=str(error))
        raise
    finally:
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        (directory / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
