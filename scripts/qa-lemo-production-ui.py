"""Actual Electron UI QA; fixture-only capability responses and control receipts."""
import json, os, socket, subprocess, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/lemo-production-ui-20261102'
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    env = dict(os.environ)
    for key in ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']: env.pop(key, None)
    env['TEMP'] = env['TMP'] = str(OUT / 'temp'); (OUT / 'temp').mkdir(exist_ok=True)
    report = {'checks': [], 'captures': [], 'errors': [], 'paidRequests': 0, 'realProviderVerified': False}
    process = None
    def check(name, passed=True):
        report['checks'].append({'name': name, 'passed': bool(passed)}); assert passed, name
    try:
        with (OUT / 'electron.log').open('ab') as log:
            process = subprocess.Popen([str(ROOT / 'node_modules/electron/dist/electron.exe'), '--remote-debugging-port=' + str(port), '--remote-debugging-address=127.0.0.1', str(OUT / 'main.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        with sync_playwright() as playwright:
            browser = None
            for _ in range(80):
                try: browser = playwright.chromium.connect_over_cdp('http://127.0.0.1:' + str(port)); break
                except Exception:
                    if process.poll() is not None: raise RuntimeError('Electron exited before debugger started')
                    time.sleep(.25)
            if browser is None: raise RuntimeError('No Electron CDP connection')
            page = browser.contexts[0].pages[0]; page.on('pageerror', lambda e: report['errors'].append(str(e)))
            page.on('console', lambda message: report['errors'].append(message.text) if message.type == 'error' else None)
            page.goto((OUT / 'index.html').as_uri(), wait_until='load'); page.set_default_timeout(15000)
            expect(page.get_by_role('heading', name='Lemo · 能力与制作界面验收')).to_be_visible()
            page.get_by_role('button', name='免费检查已保存配置', exact=True).click()
            expect(page.get_by_role('alert')).to_contain_text('请先保存专用 Messages 配置与密钥')
            expect(page.get_by_role('button', name='验证 Lemo 渠道能力', exact=True)).to_be_disabled()
            check('missing saved provider blocks paid capability test')
            page.evaluate('window.__lemoUiHarness.missing = false')
            page.get_by_role('button', name='免费检查已保存配置', exact=True).click()
            expect(page.get_by_text('主动测试最多 6 次模型请求', exact=False)).to_be_visible()
            check('preflight makes no paid request and discloses exact bounded budget', page.evaluate('window.__lemoUiHarness.calls.every(c => c.name !== "test")'))
            checkbox = page.get_by_role('checkbox', name='我确认执行上述有额度限制的真实模型测试，可能产生服务商费用')
            checkbox.check(); page.evaluate('window.__lemoUiHarness.hold = true')
            page.get_by_role('button', name='验证 Lemo 渠道能力', exact=True).click()
            expect(page.get_by_role('button', name='验证 Lemo 渠道能力', exact=True)).to_be_disabled()
            expect(page.get_by_label('需要验证的最大输出 Token', exact=True)).to_be_disabled()
            check('active paid test locks inputs and double submission')
            page.get_by_role('button', name='取消能力测试', exact=True).click()
            expect(page.get_by_role('alert')).to_contain_text('已在本机取消能力测试')
            check('visible cancellation preserves budget disclosure')
            page.evaluate('window.__lemoUiHarness.hold = false; window.__lemoUiHarness.fail = true')
            page.get_by_role('button', name='验证 Lemo 渠道能力', exact=True).click()
            expect(page.get_by_role('alert')).to_contain_text('不支持所需的输出额度参数'); check('capability rejection stays visible')
            page.evaluate('window.__lemoUiHarness.fail = false')
            page.get_by_role('button', name='验证 Lemo 渠道能力', exact=True).click()
            expect(page.get_by_text('工具调用与结果返回：通过', exact=True)).to_be_visible()
            expect(page.get_by_text('尚未满足生产要求，请完成或重新验证。', exact=True)).to_be_visible()
            check('fixture capability evidence never enables real production readiness')
            page.get_by_text('创意动画执行预算', exact=True).click()
            page.get_by_label('整片最多模型请求', exact=True).fill('12')
            page.get_by_label('最多画面修复轮次', exact=True).fill('1')
            check('budget edits preserve other persisted ceilings', page.evaluate('window.__lemoUiHarness.snapshot.budget.maxRequests === 12 && window.__lemoUiHarness.snapshot.budget.maxRepairRounds === 1 && window.__lemoUiHarness.snapshot.budget.maxOutputTokens === 16384'))
            for width, height, theme in [(1440, 1000, 'dark'), (1040, 760, 'dark'), (1040, 760, 'light')]:
                if theme == 'light': page.get_by_role('button', name='切换主题', exact=True).click()
                page.set_viewport_size({'width': width, 'height': height})
                check(str(width) + '-' + theme + ' capability no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                path = OUT / ('capability-' + str(width) + '-' + theme + '.png'); page.get_by_role('heading', name='Lemo 模型能力验证', exact=True).scroll_into_view_if_needed(); page.screenshot(path=str(path), animations='disabled'); report['captures'].append(str(path))
                page.get_by_text('创意动画执行预算', exact=True).scroll_into_view_if_needed()
                path = OUT / ('budget-' + str(width) + '-' + theme + '.png'); page.screenshot(path=str(path), animations='disabled'); report['captures'].append(str(path))
            page.get_by_role('button', name='查看制作进度', exact=True).click()
            dialog = page.get_by_role('dialog', name='自动制作进度')
            expect(dialog).to_be_visible(); expect(dialog.get_by_text('本次制作预算：最多 12 次请求', exact=False)).to_be_visible()
            expect(dialog.get_by_role('button', name='修复此镜头并导出成片', exact=True)).to_be_disabled()
            dialog.get_by_label('需要修复的镜头', exact=True).select_option('shot-2')
            dialog.get_by_label('镜头修复要求', exact=True).fill('  保持素材和旁白，让路线标注更清晰。  ')
            for width, height, theme in [(1040, 760, 'light'), (1440, 1000, 'dark')]:
                if theme == 'dark':
                    dialog.get_by_role('button', name='关闭', exact=True).click()
                    expect(page.locator('#root')).not_to_have_attribute('aria-hidden', 'true')
                    check('closing progress clears the background accessibility lock')
                    report['afterClose'] = page.evaluate('({ dialogs: document.querySelectorAll("[role=dialog]").length, focus: document.activeElement?.outerHTML.slice(0,600), roots: Array.from(document.body.children).map(e => ({tag:e.tagName, hidden:e.getAttribute("aria-hidden"), classes:e.className})), buttons: Array.from(document.querySelectorAll("button")).map(e=>({text:e.textContent, hidden:e.closest("[aria-hidden=true]")?.outerHTML.slice(0,200)})) })')
                    page.screenshot(path=str(OUT / 'after-close.png'), animations='disabled')
                    page.get_by_role('button', name='切换主题', exact=True).click(); page.get_by_role('button', name='查看制作进度', exact=True).click()
                    dialog.get_by_label('需要修复的镜头', exact=True).select_option('shot-2'); dialog.get_by_label('镜头修复要求', exact=True).fill('  保持素材和旁白，让路线标注更清晰。  ')
                page.set_viewport_size({'width': width, 'height': height})
                dialog.get_by_role('button', name='修复此镜头并导出成片', exact=True).scroll_into_view_if_needed()
                check(str(width) + '-' + theme + ' progress dialog stays in viewport', dialog.evaluate('(e) => { const r=e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && e.scrollWidth <= e.clientWidth + 1; }'))
                path = OUT / ('progress-' + str(width) + '-' + theme + '.png'); page.screenshot(path=str(path), animations='disabled'); report['captures'].append(str(path))
            dialog.get_by_role('button', name='修复此镜头并导出成片', exact=True).click()
            expect(dialog.get_by_role('button', name='修复此镜头并导出成片', exact=True)).to_be_disabled()
            check('repair sends stable shot ID and trimmed instructions exactly once', page.evaluate('window.__lemoUiHarness.calls.filter(c => c.name === "control" && c.input.action === "repair-shot").length === 1 && window.__lemoUiHarness.calls.at(-1).input.shotId === "shot-2" && window.__lemoUiHarness.calls.at(-1).input.instructions === "保持素材和旁白，让路线标注更清晰。"'))
            page.evaluate('window.__lemoUiHarness.finishRepair()')
            expect(dialog.get_by_text('已达到本次制作的镜头修复次数上限。', exact=True)).to_be_visible()
            expect(dialog.get_by_label('需要修复的镜头', exact=True)).to_be_disabled()
            check('persisted repair receipt consumes the original repair cap')
            page.keyboard.press('Escape'); expect(dialog).not_to_be_visible()
            page.get_by_role('button', name='载入不确定结果', exact=True).click()
            expect(dialog.get_by_role('button', name='继续官方步骤', exact=True)).to_be_visible()
            expect(dialog.get_by_role('button', name='修复此镜头并导出成片', exact=True)).to_have_count(0)
            dialog.get_by_text('其他恢复选项', exact=True).click(); dialog.get_by_role('button', name='恢复已保存结果', exact=True).click()
            check('unknown official outcome exposes recovery and blocks repair', page.evaluate('window.__lemoUiHarness.calls.at(-1).input.action === "reconcile"'))
            check('focus stays inside progress dialog after control action', dialog.evaluate('(e) => e.contains(document.activeElement)'))
            page.keyboard.press('Escape'); expect(dialog).not_to_be_visible()
            check('Escape closes progress dialog and returns focus', page.get_by_role('button', name='载入不确定结果', exact=True).evaluate('(e) => e === document.activeElement'))
            expect(page.locator('#root')).not_to_have_attribute('aria-hidden', 'true')
            for _ in range(3):
                page.get_by_role('button', name='查看制作进度', exact=True).click(); expect(dialog).to_be_visible()
                dialog.get_by_role('button', name='关闭', exact=True).focus(); page.keyboard.press('Escape'); expect(dialog).not_to_be_visible()
                expect(page.locator('#root')).not_to_have_attribute('aria-hidden', 'true')
            check('repeated open and Escape preserve keyboard access to the main page')
            page.get_by_role('button', name='切换已保存配置', exact=True).click()
            expect(page.get_by_role('checkbox', name='我确认执行上述有额度限制的真实模型测试，可能产生服务商费用')).to_have_count(0)
            check('switching selected saved profile clears prior test approval')
            check('no renderer exceptions', not report['errors']); report['status'] = 'passed'; browser.close()
    except Exception as error:
        report['status'] = 'failed'; report['error'] = str(error)
        try:
            report['failureUi'] = page.evaluate('({ dialogs: document.querySelectorAll("[role=dialog]").length, focus: document.activeElement?.outerHTML.slice(0,600), roots: Array.from(document.body.children).map(e => ({tag:e.tagName, hidden:e.getAttribute("aria-hidden"), classes:e.className})), buttons: Array.from(document.querySelectorAll("button")).map(e=>e.textContent) })')
            page.screenshot(path=str(OUT / 'failure.png'), animations='disabled')
        except Exception: pass
        raise
    finally:
        (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if process and process.poll() is None: subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
if __name__ == '__main__': main()
