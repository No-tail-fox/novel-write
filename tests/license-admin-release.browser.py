"""Isolated browser regression for scoped device release; no production requests."""
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'services' / 'license-server' / 'admin-dist'
OUTPUT = ROOT / 'artifacts' / 'license-device-identity'
OUTPUT.mkdir(parents=True, exist_ok=True)


def check(browser, width, height):
    context = browser.new_context(viewport={'width': width, 'height': height})
    page = context.new_page()
    errors, requests, confirmations = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    row = {'device_id': 'a' * 64, 'license_id': '11111111-2222-3333-4444-555555555555',
           'bindingToken': 'b' * 64, 'label': '测试设备 A', 'license_label': '测试客户 A',
           'tail': '1234', 'last_seen': 1800000000, 'released': 0, 'locked': 0}
    state = {'stale': False, 'released': False}

    def respond(route):
        request = route.request
        path = urlparse(request.url).path
        if path in ('/admin/', '/admin/admin.js', '/admin/admin.css'):
            name = 'index.html' if path == '/admin/' else path.rsplit('/', 1)[-1]
            mime = {'index.html': 'text/html', 'admin.js': 'application/javascript', 'admin.css': 'text/css'}[name]
            route.fulfill(status=200, content_type=mime, body=(STATIC / name).read_bytes())
            return
        status, result = 200, {}
        if path == '/admin/api/session':
            result = {'authenticated': True}
        elif path == '/admin/api/summary':
            result = {'serverTime': 1800000000, 'licenses': 2, 'devices': 1, 'blockedDevices': 0, 'latestRelease': None}
        elif path == '/admin/api/announcements':
            result = {'announcements': []}
        elif path == '/admin/api/devices':
            result = {'items': [{**row, 'released': int(state['released'])}], 'pageSize': 50, 'total': 1}
        elif path == f'/admin/api/devices/{row["device_id"]}/release':
            requests.append(request.post_data_json)
            if state['stale']:
                status, result = 409, {'error': 'DEVICE_BINDING_CHANGED'}
            else:
                state['released'] = True
                result = {'ok': True}
        else:
            raise AssertionError(f'Unexpected browser request: {path}')
        route.fulfill(status=status, content_type='application/json', body=json.dumps(result))

    context.route('**/*', respond)
    page.goto('http://license-fixture.invalid/admin/')
    page.locator('[data-view="devices"]').click()
    page.get_by_role('button', name='解绑', exact=True).wait_for()

    def cancel(dialog):
        confirmations.append(dialog.message)
        dialog.dismiss()

    page.once('dialog', cancel)
    page.get_by_role('button', name='解绑', exact=True).click()
    assert not requests, 'Cancel must not send a release request'
    assert '测试客户 A' in confirmations[-1] and '1234' in confirmations[-1]
    page.screenshot(path=str(OUTPUT / f'admin-devices-{width}.png'), full_page=True)

    state['stale'] = True
    page.once('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='解绑', exact=True).click()
    page.get_by_text('设备绑定已变化，本次未解绑。请刷新设备列表，核对客户与授权后重试。', exact=True).wait_for()
    assert requests[-1] == {'licenseId': row['license_id'], 'bindingToken': row['bindingToken']}
    assert not state['released']
    assert page.get_by_role('button', name='解绑', exact=True).is_enabled()
    page.screenshot(path=str(OUTPUT / f'admin-stale-binding-{width}.png'), full_page=True)

    state['stale'] = False
    row['bindingToken'] = 'c' * 64
    page.locator('#refresh-button').click()
    page.get_by_role('button', name='解绑', exact=True).wait_for()
    # Waiting for the refresh response ensures the click captures the new binding token.
    page.wait_for_function("document.querySelector('#devices-rows')?.textContent.includes('测试客户 A')")
    page.once('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='解绑', exact=True).click()
    page.locator('#devices-rows').get_by_text('已解绑', exact=True).wait_for()
    assert requests[-1]['bindingToken'] == 'c' * 64
    assert state['released']
    assert page.get_by_role('button', name='解绑', exact=True).count() == 0
    assert not errors, errors
    context.close()
    return {'viewport': [width, height], 'cancelledWithoutRequest': True, 'staleConflictVisible': True, 'scopedRelease': True}


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel='msedge')
    try:
        results = [check(browser, 1440, 900), check(browser, 1000, 720)]
        (OUTPUT / 'admin-release-qa.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(results, ensure_ascii=True))
    finally:
        browser.close()
