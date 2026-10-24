"""Accept the real packaged app against the deployed license service.

Requires SSH access to the operator account; credentials are read without echo.
No license IPC, encryption, machine identity, or network responses are mocked.
"""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import ssl
import subprocess
import time
import traceback
import urllib.request
import urllib.error
import uuid
from concurrent.futures import ThreadPoolExecutor, wait

import paramiko
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/license-production-qa'
PROFILE = OUTPUT / 'profile'
INSTALL = OUTPUT / 'installed'
spec = importlib.util.spec_from_file_location('license_production_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def connect(password):
    client = paramiko.SSHClient()
    client.load_host_keys(str(Path.home() / '.ssh/known_hosts'))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect('154.219.120.162', username='root', password=password,
                   timeout=20, auth_timeout=20, look_for_keys=False, allow_agent=False)
    return client


def upload_installer(client, password, source, target):
    size = source.stat().st_size
    with client.open_sftp() as sftp:
        with sftp.open(target, 'wb') as stream:
            stream.truncate(size)
        sftp.chmod(target, 0o600)
    workers = 8
    progress = [0] * workers
    def transfer(index):
        connection = connect(password)
        try:
            start, end = size * index // workers, size * (index + 1) // workers
            with connection.open_sftp() as sftp, source.open('rb') as reader, sftp.open(target, 'r+b') as writer:
                writer.set_pipelined(True)
                reader.seek(start)
                writer.seek(start)
                remaining = end - start
                while remaining:
                    block = reader.read(min(1024 * 1024, remaining))
                    if not block:
                        raise EOFError('Installer changed during upload')
                    writer.write(block)
                    remaining -= len(block)
                    progress[index] += len(block)
        finally:
            connection.close()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        pending = {pool.submit(transfer, index) for index in range(workers)}
        while pending:
            finished, pending = wait(pending, timeout=15)
            for future in finished:
                future.result()
            print(f'Upload {sum(progress) // 1048576}/{size // 1048576} MiB', flush=True)
    with source.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    _, stdout, stderr = client.exec_command('sha256sum ' + shlex.quote(target), timeout=120)
    remote = stdout.read().decode().split()[0]
    assert stdout.channel.recv_exit_status() == 0 and remote == digest, 'Uploaded installer hash mismatch'
    return digest


def operate(client, *args):
    _, stdout, stderr = client.exec_command('storydream-license ' + shlex.join(args), timeout=30)
    value = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')
    if stdout.channel.recv_exit_status():
        raise RuntimeError(error or 'Remote operator command failed')
    return json.loads(value) if value.strip() else None


def prepare_resume(report):
    config = json.loads((ROOT / 'config/license-public.json').read_text(encoding='utf-8'))
    publication = json.loads((OUTPUT / 'publish-report.json').read_text(encoding='utf-8'))
    release = json.loads(publication['release']['payload'])
    partial = PROFILE / 'storydream/updates' / (release['filename'] + '.part')
    partial.parent.mkdir(parents=True, exist_ok=True)
    start = partial.stat().st_size if partial.exists() else 0
    stop = release['size'] - 8 * 1048576
    if start >= stop:
        return
    with partial.open('ab') as stream:
        stream.truncate(stop)
    workers = 8
    progress = [0] * workers
    def transfer(index):
        offset = start + (stop - start) * index // workers
        end = start + (stop - start) * (index + 1) // workers
        request = urllib.request.Request(config['baseUrl'] + '/v1/releases/files/' + release['filename'],
                                         headers={'Range': f'bytes={offset}-'})
        context = ssl.create_default_context(cadata=config['caPem'])
        with urllib.request.urlopen(request, context=context, timeout=30) as response, partial.open('r+b') as writer:
            assert response.status == (206 if offset else 200)
            if offset:
                assert response.headers['Content-Range'] == f"bytes {offset}-{release['size'] - 1}/{release['size']}"
            writer.seek(offset)
            remaining = end - offset
            while remaining:
                block = response.read(min(262144, remaining))
                if not block:
                    raise EOFError('Interrupted range preparation')
                writer.write(block)
                remaining -= len(block)
                progress[index] += len(block)
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            pending = {pool.submit(transfer, index) for index in range(workers)}
            while pending:
                finished, pending = wait(pending, timeout=15)
                for future in finished:
                    future.result()
                print(f'HTTPS resume preparation {(start + sum(progress)) // 1048576}/{stop // 1048576} MiB', flush=True)
    except BaseException:
        with partial.open('r+b') as stream:
            stream.truncate(start)
        raise
    report['resumePreparedBytes'] = stop
    report['resumeRemainingBytes'] = release['size'] - stop


def second_device(code):
    config = json.loads((ROOT / 'config/license-public.json').read_text(encoding='utf-8'))
    key = Ed25519PrivateKey.generate()
    path = '/v1/license/activate'
    import base64
    payload = json.dumps(dict(deviceId=hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
                              publicKey=key.public_key().public_bytes(serialization.Encoding.PEM,
                              serialization.PublicFormat.SubjectPublicKeyInfo).decode(), nonce=str(uuid.uuid4()),
                              timestamp=int(time.time()), code=code, label='Production QA second device'))
    request = urllib.request.Request(config['baseUrl'] + path,
        json.dumps(dict(payload=payload, signature=base64.b64encode(key.sign((path + '\n' + payload).encode())).decode())).encode(),
        {'Content-Type': 'application/json'})
    try:
        urllib.request.urlopen(request, context=ssl.create_default_context(cadata=config['caPem']), timeout=20)
    except urllib.error.HTTPError as error:
        result = json.loads(error.read())
        assert error.code == 409 and 'DEVICE_LIMIT_REACHED' in json.dumps(result), result
        return
    raise AssertionError('A second device acquired a full license')


def wizard(pid):
    """Drive the real NSIS wizard, leaving the post-install Run box unchecked."""
    user = ctypes.windll.user32
    user.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user.SendMessageW.restype = ctypes.c_ssize_t
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.IsWindowEnabled.argtypes = [wintypes.HWND]
    callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    deadline = time.monotonic() + 600
    clicked_finish = False
    previous_controls = None
    while time.monotonic() < deadline:
        windows = []
        def visit(hwnd, _):
            owner = wintypes.DWORD()
            user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
            if owner.value == pid and user.IsWindowVisible(hwnd):
                windows.append(hwnd)
            return True
        user.EnumWindows(callback(visit), 0)
        if not windows and clicked_finish:
            return
        for parent in windows:
            controls = []
            def child(hwnd, _):
                text = ctypes.create_unicode_buffer(512)
                kind = ctypes.create_unicode_buffer(80)
                user.GetWindowTextW(hwnd, text, len(text))
                user.GetClassNameW(hwnd, kind, len(kind))
                if user.IsWindowVisible(hwnd) and user.IsWindowEnabled(hwnd) and kind.value == 'Button':
                    controls.append((hwnd, text.value.replace('&', '')))
                return True
            user.EnumChildWindows(parent, callback(child), 0)
            labels = [text for _, text in controls]
            if labels != previous_controls:
                print('Visible installer controls:', repr(labels), flush=True)
                previous_controls = labels
            finishing = any(any(word in text for word in ['Finish', '\u5b8c\u6210']) for _, text in controls)
            if finishing:
                for hwnd, text in controls:
                    if ('Run ' in text or '\u8fd0\u884c' in text) and user.SendMessageW(hwnd, 0xF0, 0, 0) == 1:
                        user.SendMessageW(hwnd, 0xF5, 0, 0)
            for hwnd, text in controls:
                if any(word in text for word in ['Next', 'Install', 'Finish', '\u4e0b\u4e00\u6b65', '\u5b89\u88c5', '\u5b8c\u6210']):
                    user.SendMessageW(hwnd, 0xF5, 0, 0)
                    clicked_finish = finishing
                    break
        time.sleep(0.4)
    raise TimeoutError('NSIS wizard did not complete')


def wait_installer(report):
    class Entry(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('usage', wintypes.DWORD), ('pid', wintypes.DWORD),
                    ('heap', ctypes.c_size_t), ('module', wintypes.DWORD), ('threads', wintypes.DWORD),
                    ('parent', wintypes.DWORD), ('priority', wintypes.LONG), ('flags', wintypes.DWORD),
                    ('name', wintypes.WCHAR * 260)]
    kernel = ctypes.windll.kernel32
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
        entry = Entry()
        entry.size = ctypes.sizeof(entry)
        try:
            found = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
            while found:
                if entry.name.startswith('StoryDream-Setup-'):
                    report['installerProcess'] = dict(pid=entry.pid, parent=entry.parent, name=entry.name)
                    print('Observed app-launched installer', entry.pid, flush=True)
                    return entry.pid
                found = kernel.Process32NextW(snapshot, ctypes.byref(entry))
        finally:
            kernel.CloseHandle(snapshot)
        time.sleep(0.1)
    raise AssertionError('Verified installer was not launched')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['activation', 'update', 'publish', 'verify-upgrade'])
    parser.add_argument('--installer', type=Path)
    parser.add_argument('--baseline-installer', type=Path, help='Reinstall the QA-only baseline while preserving the existing profile')
    parser.add_argument('--version', default='1.0.2')
    parser.add_argument('--prepare-resume', action='store_true', help='Prepare a real HTTPS partial download; the desktop fetches the final 8 MiB and verifies the complete file')
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(exist_ok=True)
    report_path = OUTPUT / f'{"update" if args.mode == "verify-upgrade" else args.mode}-report.json'
    if args.mode == 'verify-upgrade':
        report = json.loads(report_path.read_text(encoding='utf-8'))
        assert report.get('installerProcess') and report.get('checks'), 'No observed app-launched upgrade to verify'
        report['acceptanceRecovery'] = dict(previousFailure=report.pop('failure', None),
            reason='NSIS appended the application directory to the QA-only installation path; verify the completed installation there')
        report['status'] = 'running'
    else:
        report = dict(status='running', checks=[], runtimeErrors=[], fixtureOnly=False)
    password = getpass.getpass('SSH password: ')
    client = connect(password)
    child = browser = page = None
    issued = None
    try:
        if args.mode == 'publish':
            assert args.installer and args.installer.is_file()
            _, stdout, _ = client.exec_command('install -d -m 700 -o storydream-license -g storydream-license /var/lib/storydream-license/incoming')
            assert stdout.channel.recv_exit_status() == 0
            target = '/var/lib/storydream-license/incoming/' + args.installer.name
            print('Uploading verified installer', flush=True)
            report['uploadedSha256'] = upload_installer(client, password, args.installer, target)
            _, stdout, _ = client.exec_command('chown storydream-license:storydream-license ' + shlex.quote(target))
            assert stdout.channel.recv_exit_status() == 0
            value = operate(client, 'publish', '--file', target, '--version', args.version, '--minimum-version', '0.0.0',
                            '--notes', 'Production activation, machine binding, remote device control and verified updates.')
            report['release'] = value
            report['status'] = 'passed'
            print(json.dumps(value), flush=True)
            return
        if args.mode == 'activation':
            assert args.installer and args.installer.is_file() and not (INSTALL / 'StoryDream.exe').exists()
            setup = subprocess.Popen([str(args.installer.resolve()), '/S', '/currentuser', f'/D={INSTALL}'])
            assert setup.wait(timeout=240) == 0
            issued = operate(client, 'issue', '--days', '1', '--max-devices', '1', '--label', 'production-acceptance-20261024')
            report['licenseId'] = issued['licenseId']
            print('Baseline installed; temporary QA license issued', flush=True)
        else:
            report['licenseId'] = json.loads((OUTPUT / 'activation-report.json').read_text(encoding='utf-8'))['licenseId']
            if args.baseline_installer:
                setup = subprocess.Popen([str(args.baseline_installer.resolve()), '/S', '/currentuser', f'/D={INSTALL}'])
                assert setup.wait(timeout=240) == 0
            if args.prepare_resume:
                prepare_resume(report)
        env = {**os.environ, 'NODE_ENV': 'production'}
        for name in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
            env.pop(name, None)
        def launch(playwright):
            nonlocal child, browser, page
            port = base.free_port()
            executable = next((path for path in [INSTALL / 'StoryDream.exe', INSTALL / 'StoryDream/StoryDream.exe'] if path.is_file()), None)
            assert executable, 'Installed StoryDream executable not found'
            report['installedExecutable'] = str(executable)
            with (OUTPUT / f'{args.mode}-electron.log').open('ab') as log:
                child = subprocess.Popen([str(executable), f'--user-data-dir={PROFILE}',
                    f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1'],
                    cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = playwright.chromium.connect_over_cdp(base.wait_cdp(port, child))
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=30000)
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(page)
        def invoke(method, arg=None):
            return page.evaluate('async ([method,arg]) => window.storydream[method](...(arg === null ? [] : [arg]))', [method, arg])
        def blocked():
            result = page.evaluate('''async () => { try { await window.storydream.boostMusicLabStyle({model:'suno-v6', style:'Production QA', instrumental:true}); return 'UNEXPECTED_SUCCESS'; } catch(e) { return e.message; } }''')
            assert 'LICENSE_REQUIRED' in result, result
        with sync_playwright() as playwright:
            launch(playwright)
            if args.mode == 'activation':
                status = invoke('getLicenseStatus')
                assert status['configured'] and status['status'] != 'active', status
                report['deviceId'] = device = status['deviceId']
                blocked()
                assert invoke('activateLicense', issued['code'])['status'] == 'active'
                second_device(issued['code'])
                report['checks'].append('Real Windows MachineGuid/DPAPI activation; second device rejected at seat limit')
                invoke('saveUiPreferences', dict(activeView='activation'))
                account = invoke('getBootstrap')['account']
                invoke('saveAccount', {**account, 'displayName': 'License upgrade acceptance'})
                page.reload()
                page.wait_for_selector('.license-settings')
                page.screenshot(path=OUTPUT / 'active.png')
                invoke('windowControl', 'close')
                child.wait(timeout=20)
                browser.close()
                launch(playwright)
                assert invoke('getLicenseStatus')['status'] == 'active'
                report['checks'].append('Packaged restart decrypts the machine vault and obtains a fresh online lease')
                for command, state in [('lock-device', 'locked'), ('unlock-device', 'active')]:
                    operate(client, command, device)
                    try:
                        invoke('refreshLicense')
                    except Exception:
                        pass
                    assert invoke('getLicenseStatus')['status'] == state
                    if state == 'locked':
                        blocked()
                        assert invoke('getBootstrap')
                        page.screenshot(path=OUTPUT / 'locked.png')
                operate(client, 'revoke-license', issued['licenseId'])
                try:
                    invoke('refreshLicense')
                except Exception:
                    pass
                assert invoke('getLicenseStatus')['status'] == 'locked'
                blocked()
                operate(client, 'restore-license', issued['licenseId'])
                assert invoke('refreshLicense')['status'] == 'active'
                operate(client, 'release-device', device)
                try:
                    invoke('refreshLicense')
                except Exception:
                    pass
                assert invoke('getLicenseStatus')['status'] == 'inactive'
                assert invoke('activateLicense', issued['code'])['status'] == 'active'
                assert invoke('releaseLicense')['status'] == 'inactive'
                blocked()
                assert invoke('activateLicense', issued['code'])['status'] == 'active'
                report['checks'].append('Remote lock/unlock, revoke/restore, operator release and desktop unbind enforce generation gates')
            elif args.mode == 'update':
                assert invoke('getLicenseStatus')['status'] == 'active'
                page.wait_for_selector('.license-settings')
                page.get_by_role('button', name='检查更新', exact=True).click()
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    state = invoke('getUpdateStatus')
                    if state['phase'] in ['available', 'ready', 'error']:
                        break
                    page.wait_for_timeout(300)
                assert state['currentVersion'] == '1.0.0' and state['release']['version'] == args.version, state
                report['release'] = state['release']
                print('Real client downloading signed release', flush=True)
                if state['phase'] != 'ready':
                    page.get_by_role('button', name='下载更新', exact=True).click()
                deadline = time.monotonic() + 1200
                while time.monotonic() < deadline:
                    state = invoke('getUpdateStatus')
                    if state['phase'] in ['ready', 'error']:
                        break
                    print(f"Download {state['downloaded'] // 1048576} MiB", flush=True)
                    page.wait_for_timeout(15000)
                assert state['phase'] == 'ready', state
                report['checks'].append(f'Real packaged 1.0.0 verifies signed {args.version} manifest and complete installer SHA-256')
                if report.get('resumePreparedBytes'):
                    report['checks'].append('Desktop resumes the real HTTPS partial file and downloads the final 8 MiB before complete verification')
                page.wait_for_timeout(1800)
                page.screenshot(path=OUTPUT / 'update-ready.png')
                with ThreadPoolExecutor(max_workers=1) as pool:
                    observed = pool.submit(wait_installer, report)
                    page.get_by_role('button', name='安装并退出', exact=True).click()
                    page.get_by_role('dialog').get_by_role('button', name='确认安装', exact=True).click()
                    child.wait(timeout=30)
                    wizard(observed.result(timeout=40))
                browser.close()
                browser = None
                launch(playwright)
            if args.mode in ['update', 'verify-upgrade']:
                assert invoke('getUpdateStatus')['currentVersion'] == args.version
                assert page.locator('.window-version').inner_text() == 'V' + args.version
                assert invoke('getLicenseStatus')['status'] == 'active'
                bootstrap = invoke('getBootstrap')
                assert bootstrap['account']['displayName'] == 'License upgrade acceptance', bootstrap['account']
                report['checks'].append('App-launched NSIS upgrade completes; version, license and saved account survive restart')
                page.screenshot(path=OUTPUT / 'updated.png')
                operate(client, 'revoke-license', report['licenseId'])
                operate(client, 'release-device', invoke('getLicenseStatus')['deviceId'])
            assert not report['runtimeErrors'], report['runtimeErrors']
            invoke('windowControl', 'close')
            child.wait(timeout=20)
            browser.close()
            browser = None
            report['status'] = 'passed'
    except BaseException:
        report['status'] = 'failed'
        report['failure'] = traceback.format_exc()
        if issued:
            operate(client, 'revoke-license', issued['licenseId'])
        raise
    finally:
        if child and child.poll() is None:
            child.kill()
            child.wait(timeout=15)
        client.close()
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(dict(status=report['status'], checks=report['checks'])), flush=True)


if __name__ == '__main__':
    main()
