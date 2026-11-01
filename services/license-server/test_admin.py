import hashlib
import gzip
import http.client
import json
import ssl
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from threading import Thread
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from server import LicenseHTTPServer, LicenseStore, Rejected, b64, initialize, public_pem, set_admin_password


class AdminManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'data'
        initialize(self.directory, '127.0.0.1', 8443)
        self.store = LicenseStore(self.directory)
        set_admin_password(self.directory, 'isolated admin test password')
        self.server = LicenseHTTPServer(('127.0.0.1', 0), self.store)
        worker = Thread(target=self.server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(worker.join, 5)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.origin = f'https://127.0.0.1:{self.server.server_address[1]}'
        self.context = ssl.create_default_context(cafile=str(self.directory / 'ca.pem'))
        self.cookie = ''
        status, _, headers = self.call('POST', '/admin/api/login', {'password': 'isolated admin test password'})
        self.assertEqual(status, 200)
        self.cookie = headers['Set-Cookie'].split(';')[0]

    def call(self, method, path, body=None, cookie=None, origin=None, extra_headers=None):
        headers = {'Origin': origin or self.origin, 'Cookie': self.cookie if cookie is None else cookie}
        headers.update(extra_headers or {})
        if isinstance(body, bytes):
            headers['Content-Type'] = 'application/octet-stream'
        elif body is not None:
            headers['Content-Type'] = 'application/json'
            body = json.dumps(body).encode()
        connection = http.client.HTTPSConnection('127.0.0.1', self.server.server_address[1], context=self.context, timeout=10)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            raw = response.read()
            value = json.loads(raw) if response.getheader('Content-Type', '').startswith('application/json') else raw
            return response.status, value, dict(response.getheaders())
        finally:
            connection.close()

    def proof(self, path, device, key, **extra):
        payload = json.dumps({'deviceId': device, 'publicKey': public_pem(key.public_key()),
                              'nonce': str(uuid.uuid4()), 'timestamp': int(time.time()), **extra})
        return {'payload': payload, 'signature': b64(key.sign((path + '\n' + payload).encode()))}

    def test_all_management_endpoints_require_auth_and_origin(self):
        for kind in ('summary', 'licenses', 'devices', 'releases', 'audit'):
            self.assertEqual(self.call('GET', f'/admin/api/{kind}', cookie='')[0], 401)
        for path, body in (
            ('/admin/api/licenses', {'days': 30, 'maxDevices': 1}),
            ('/admin/api/uploads', b'MZtest'),
            ('/admin/api/uploads/blockmap', b'bad'),
            ('/admin/api/releases', {}),
            (f'/admin/api/licenses/{uuid.uuid4()}/revoke', {}),
            (f'/admin/api/devices/{"0" * 64}/lock', {}),
        ):
            self.assertEqual(self.call('POST', path, body, cookie='')[0], 401)
            self.assertEqual(self.call('POST', path, body, origin='https://attacker.invalid')[0], 403)
        self.assertEqual(self.call('GET', '/admin/api/licenses?page=bad')[0], 400)
        self.assertEqual(self.call('GET', '/admin/api/licenses?page=0')[0], 400)

    def test_license_and_device_actions_affect_client_authorization(self):
        status, issued, _ = self.call('POST', '/admin/api/licenses', {'days': 30, 'maxDevices': 2, 'label': 'test customer'})
        self.assertEqual(status, 201)
        identity = issued['licenseId']
        key = Ed25519PrivateKey.generate()
        device = hashlib.sha256(b'isolated-test-machine').hexdigest()
        path = '/v1/license/activate'
        self.store.request(path, self.proof(path, device, key, code=issued['code'], label='test machine'))
        refresh = '/v1/license/refresh'

        def assert_rejected(code):
            with self.assertRaises(Rejected) as error:
                self.store.request(refresh, self.proof(refresh, device, key))
            self.assertEqual(error.exception.code, code)

        licenses = self.call('GET', '/admin/api/licenses')[1]['items']
        self.assertEqual(licenses[0]['seats'], 1)
        self.assertNotIn('code', licenses[0])
        self.assertNotIn('code_hash', licenses[0])
        original_expiry = licenses[0]['expires_at']
        self.assertEqual(self.call('POST', f'/admin/api/licenses/{identity}/extend', {'days': 7})[0], 200)
        self.assertEqual(self.call('GET', '/admin/api/licenses')[1]['items'][0]['expires_at'], original_expiry + 7 * 86400)
        self.assertEqual(self.call('POST', f'/admin/api/licenses/{identity}/revoke')[0], 200)
        assert_rejected('LICENSE_REVOKED')
        self.assertEqual(self.call('POST', f'/admin/api/licenses/{identity}/restore')[0], 200)
        self.store.request(refresh, self.proof(refresh, device, key))
        self.assertEqual(self.call('POST', f'/admin/api/devices/{device}/lock', {'reason': 'test lock'})[0], 200)
        assert_rejected('DEVICE_LOCKED')
        row = self.call('GET', '/admin/api/devices')[1]['items'][0]
        self.assertEqual((row['locked'], row['lock_reason']), (1, 'test lock'))
        self.assertNotIn('public_key', row)
        self.assertEqual(self.call('POST', f'/admin/api/devices/{device}/unlock', {})[0], 200)
        self.assertEqual(self.call('POST', f'/admin/api/devices/{device}/release', {})[0], 200)
        assert_rejected('DEVICE_NOT_BOUND')
        self.assertEqual(self.call('GET', '/admin/api/summary')[1]['devices'], 0)
        actions = {row['action'] for row in self.call('GET', '/admin/api/audit')[1]['items']}
        self.assertTrue({'issue', 'revoke-license', 'restore-license', 'extend-license', 'lock-device', 'unlock-device', 'release-device'} <= actions)

    def test_release_upload_publish_download_and_linked_withdrawal(self):
        installer = b'MZ' + b'test-installer' * 1000
        status, upload, _ = self.call('POST', '/admin/api/uploads', installer)
        self.assertEqual(status, 201)
        self.assertEqual(upload['sha256'], hashlib.sha256(installer).hexdigest())
        status, result, _ = self.call('POST', '/admin/api/releases', {'uploadId': upload['uploadId'], 'version': '1.0.1', 'minimumVersion': '1.0.0', 'notes': 'test release'})
        self.assertEqual(status, 201)
        payload = json.loads(result['release']['payload'])
        self.assertEqual(payload['sha256'], upload['sha256'])
        self.assertEqual(self.call('GET', f'/v1/releases/files/{payload["filename"]}')[1], installer)
        self.assertEqual(self.call('GET', '/admin/api/releases')[1]['items'][0]['version'], '1.0.1')
        notices = self.call('GET', '/v1/releases/latest')[1]['announcements']
        self.assertEqual(json.loads(notices[0]['payload'])['version'], '1.0.1')
        self.assertFalse((self.directory / 'admin-uploads' / f'{upload["uploadId"]}.exe').exists())
        self.assertEqual(self.call('POST', '/admin/api/releases/1.0.1/withdraw')[0], 200)
        latest = self.call('GET', '/v1/releases/latest')[1]
        self.assertIsNone(latest['release'])
        self.assertEqual(latest['announcements'], [])
        self.assertEqual(self.call('GET', f'/v1/releases/files/{payload["filename"]}')[0], 404)

    def test_upload_validation_cleanup_and_capacity(self):
        self.assertEqual(self.call('POST', '/admin/api/uploads', b'not an exe')[0], 400)
        self.assertEqual(list((self.directory / 'admin-uploads').iterdir()), [])
        with patch('server.shutil.disk_usage', return_value=SimpleNamespace(free=1)):
            self.assertEqual(self.call('POST', '/admin/api/uploads', b'MZtest')[1]['error'], 'INSUFFICIENT_DISK_SPACE')
        self.assertEqual(self.call('POST', '/admin/api/releases', {'uploadId': '../secrets', 'version': '1.0.0'})[0], 400)
        self.assertEqual(self.call('POST', '/admin/api/releases', {'uploadId': '0' * 32, 'version': '1.0.0'})[0], 404)
        upload = self.call('POST', '/admin/api/uploads', b'MZtest')[1]
        body = {'uploadId': upload['uploadId'], 'version': '1.0.0', 'minimumVersion': '2.0.0'}
        self.assertEqual(self.call('POST', '/admin/api/releases', body)[0], 400)
        self.assertIsNone(self.store.latest_release())

    def test_differential_publication_ranges_legacy_protocol_and_withdrawal(self):
        installer = b'MZ' + b'test-installer' * 1000
        blockmap = gzip.compress(json.dumps({'version': '2', 'files': [{'name': 'file', 'offset': 0,
            'sizes': [len(installer)], 'checksums': ['test-checksum']}]}).encode())
        upload = self.call('POST', '/admin/api/uploads', installer)[1]
        status, uploaded_map, _ = self.call('POST', '/admin/api/uploads/blockmap', blockmap)
        self.assertEqual(status, 201)
        status, result, _ = self.call('POST', '/admin/api/releases', {'uploadId': upload['uploadId'],
            'blockmapUploadId': uploaded_map['uploadId'], 'version': '1.0.1', 'notes': 'differential release'})
        self.assertEqual(status, 201)
        release = json.loads(result['release']['payload'])
        self.assertEqual(set(release), {'schemaVersion', 'kind', 'sequence', 'version', 'minimumVersion', 'platform',
            'arch', 'filename', 'sha256', 'size', 'notes', 'issuedAt', 'validUntil'})
        path = f'/v1/releases/files/{release["filename"]}'
        metadata_path = f'/v1/releases/differential/{release["filename"]}'
        metadata = json.loads(self.call('GET', metadata_path)[1]['differential']['payload'])
        self.assertEqual(metadata['sha512'], b64(hashlib.sha512(installer).digest()))
        self.assertEqual(metadata['blockmap'], {'size': len(blockmap), 'sha256': hashlib.sha256(blockmap).hexdigest()})
        self.assertEqual(self.call('GET', path + '.blockmap')[1], blockmap)
        self.assertFalse((self.directory / 'admin-uploads' / f'{uploaded_map["uploadId"]}.blockmap').exists())
        for header, start, end in [('bytes=0-1', 0, 1), ('bytes=10-20', 10, 20), ('bytes=11-', 11, len(installer) - 1),
                                    ('bytes=0-', 0, len(installer) - 1), ('bytes=10-999999', 10, len(installer) - 1)]:
            status, data, headers = self.call('GET', path, extra_headers={'Range': header})
            self.assertEqual(status, 206)
            self.assertEqual(data, installer[start:end + 1])
            self.assertEqual(headers['Content-Range'], f'bytes {start}-{end}/{len(installer)}')
            self.assertEqual(int(headers['Content-Length']), end - start + 1)
        for header in ('bytes=8-2', 'bytes=999999-', 'bytes=0-1,4-5', 'bytes=-10', 'garbage', ''):
            status, _, headers = self.call('GET', path, extra_headers={'Range': header})
            self.assertEqual(status, 416)
            self.assertEqual(headers['Content-Range'], f'bytes */{len(installer)}')
        self.assertEqual(self.call('POST', '/admin/api/releases/1.0.1/withdraw')[0], 200)
        for resource in (path, path + '.blockmap', metadata_path):
            self.assertEqual(self.call('GET', resource)[0], 404)
        self.assertEqual(self.call('GET', '/v1/releases/latest')[1]['announcements'], [])

    def test_rejects_bad_or_mismatched_blockmaps_without_publishing(self):
        for data in (b'not gzip', gzip.compress(b'[]'), gzip.compress(b'{"version":"3","files":[]}')):
            self.assertEqual(self.call('POST', '/admin/api/uploads/blockmap', data)[0], 400)
        invalid = gzip.compress(json.dumps({'version': '2', 'files': [{'name': 'file', 'offset': 0,
            'sizes': [999], 'checksums': ['test-checksum']}]}).encode())
        uploaded_map = self.call('POST', '/admin/api/uploads/blockmap', invalid)[1]
        installer = self.call('POST', '/admin/api/uploads', b'MZinstaller')[1]
        status, result, _ = self.call('POST', '/admin/api/releases', {'uploadId': installer['uploadId'],
            'blockmapUploadId': uploaded_map['uploadId'], 'version': '1.0.1'})
        self.assertEqual((status, result['error']), (400, 'INVALID_BLOCKMAP'))
        self.assertIsNone(self.store.latest_release())
        self.assertEqual(list((self.directory / 'releases').iterdir()), [])

    def test_pagination_search_and_strict_license_parameters(self):
        for index in range(52):
            self.store.issue(label=f'customer {index}')
        first = self.call('GET', '/admin/api/licenses')[1]
        second = self.call('GET', '/admin/api/licenses?page=2')[1]
        self.assertEqual((first['total'], len(first['items']), len(second['items'])), (52, 50, 2))
        self.assertFalse({row['id'] for row in first['items']} & {row['id'] for row in second['items']})
        self.assertEqual(self.call('GET', '/admin/api/licenses?q=customer%2051')[1]['total'], 1)
        for body in ({'days': True, 'maxDevices': 1}, {'days': 30, 'maxDevices': 0}, {'days': '30', 'maxDevices': 1}):
            self.assertEqual(self.call('POST', '/admin/api/licenses', body)[0], 400)
        identity = first['items'][0]['id']
        self.assertEqual(self.call('POST', f'/admin/api/licenses/{identity}/extend', {'days': 7})[0], 200)
        row = next(item for item in self.call('GET', '/admin/api/licenses')[1]['items'] if item['id'] == identity)
        self.assertIsNone(row['expires_at'])
        self.assertEqual(row['days'], 372)


if __name__ == '__main__':
    unittest.main()
