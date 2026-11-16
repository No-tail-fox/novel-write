import hashlib
import http.client
import json
import socket
import ssl
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Thread
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from server import LicenseHTTPServer, LicenseStore, Rejected, b64, initialize, public_pem, renew_tls, set_admin_password, verify_admin_password


class LicensingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        initialize(cls.root / 'data', '127.0.0.1', 8443)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.now = 1800000000
        self.store = LicenseStore(self.root / 'data', lambda: self.now)
        self.license = self.store.issue(days=1, max_devices=1)

    def start_admin_server(self):
        server = LicenseHTTPServer(('127.0.0.1', 0), self.store)
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        context = ssl.create_default_context(cafile=str(self.root / 'data' / 'ca.pem'))
        connection = http.client.HTTPSConnection('127.0.0.1', server.server_address[1], context=context, timeout=5)
        self.addCleanup(connection.close)
        self.addCleanup(worker.join, 5)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, connection

    def proof(self, path, device, key, **extra):
        payload = json.dumps({'deviceId': hashlib.sha256(device.encode()).hexdigest(), 'publicKey': public_pem(key.public_key()),
                              'nonce': str(uuid.uuid4()), 'timestamp': self.now, **extra})
        return {'payload': payload, 'signature': b64(key.sign((path + '\n' + payload).encode()))}

    def activate(self, device, key):
        return self.store.request('/v1/license/activate', self.proof('/v1/license/activate', device, key, code=self.license['code'], label=device))

    def rejected(self, code, call):
        with self.assertRaises(Rejected) as raised:
            call()
        self.assertEqual(raised.exception.code, code)

    def test_offline_grace_is_optional_clamped_and_bounded_by_expiry(self):
        device = str(uuid.uuid4())
        lease = json.loads(self.activate(device, Ed25519PrivateKey.generate())['payload'])
        self.assertNotIn('offlineGraceUntil', lease)
        for requested, expected in ((3600, 3600), (60, 600), (30 * 86400, 7 * 86400)):
            self.store = LicenseStore(self.root / 'data', lambda: self.now, offline_grace=requested)
            self.license = self.store.issue(days=30, max_devices=1)
            issued = json.loads(self.activate(str(uuid.uuid4()), Ed25519PrivateKey.generate())['payload'])
            self.assertEqual(issued['offlineGraceUntil'] - issued['issuedAt'], expected)
            self.assertGreaterEqual(issued['offlineGraceUntil'], issued['validUntil'])
            self.assertLessEqual(issued['offlineGraceUntil'], issued['expiresAt'])
        # A license that ends sooner than the requested grace must cap the grace at its own expiry.
        self.store = LicenseStore(self.root / 'data', lambda: self.now, offline_grace=7 * 86400)
        self.license = self.store.issue(days=1, max_devices=1)
        short = json.loads(self.activate(str(uuid.uuid4()), Ed25519PrivateKey.generate())['payload'])
        self.assertEqual(short['offlineGraceUntil'], short['expiresAt'])
        self.assertEqual(short['expiresAt'] - short['issuedAt'], 86400)

    def test_activation_replay_key_binding_lock_release_expiry(self):
        device = str(uuid.uuid4())
        key = Ed25519PrivateKey.generate()
        lease = json.loads(self.activate(device, key)['payload'])
        self.assertEqual(lease['validUntil'] - lease['issuedAt'], 600)
        self.assertEqual(lease['expiresAt'] - lease['issuedAt'], 86400)
        self.store.signing_key.public_key().verify(__import__('base64').b64decode(self.store.signed(lease)['signature']), self.store.signed(lease)['payload'].encode())
        path = '/v1/license/refresh'
        proof = self.proof(path, device, key)
        self.store.request(path, proof)
        self.rejected('REQUEST_REPLAYED', lambda: self.store.request(path, proof))
        self.rejected('DEVICE_NOT_BOUND', lambda: self.store.request(path, self.proof(path, device, Ed25519PrivateKey.generate())))
        self.store.operate('lock-device', lease['deviceId'])
        self.rejected('DEVICE_LOCKED', lambda: self.store.request(path, self.proof(path, device, key)))
        self.store.operate('unlock-device', lease['deviceId'])
        self.store.operate('revoke-license', self.license['licenseId'])
        self.rejected('LICENSE_REVOKED', lambda: self.store.request(path, self.proof(path, device, key)))
        self.store.operate('restore-license', self.license['licenseId'])
        self.now += 86401
        self.rejected('LICENSE_EXPIRED', lambda: self.store.request(path, self.proof(path, device, key)))
        self.store.request('/v1/license/release', self.proof('/v1/license/release', device, key))
        self.rejected('DEVICE_NOT_BOUND', lambda: self.store.request(path, self.proof(path, device, key)))

    def test_concurrent_seat_allocation_and_operator_release(self):
        def activate(index):
            device = str(uuid.uuid4())
            try:
                return json.loads(self.activate(device, Ed25519PrivateKey.generate())['payload'])['deviceId']
            except Rejected as error:
                return error.code
        with ThreadPoolExecutor(max_workers=8) as workers:
            results = list(workers.map(activate, range(8)))
        self.assertEqual(results.count('DEVICE_LIMIT_REACHED'), 7)
        device_id = next(value for value in results if value != 'DEVICE_LIMIT_REACHED')
        self.store.operate('release-device', device_id)
        self.activate(str(uuid.uuid4()), Ed25519PrivateKey.generate())

    def v2_request(self, action, device, legacy, key, **extra):
        path = '/v2/license/' + action
        return self.store.request(path, self.proof(path, device, key,
                                  legacyDeviceId=hashlib.sha256(legacy.encode()).hexdigest(), **extra))

    def identity_rows(self):
        db = self.store.connect()
        try:
            return ([dict(row) for row in db.execute('SELECT * FROM devices')],
                    [dict(row) for row in db.execute('SELECT * FROM device_identity_aliases')],
                    [dict(row) for row in db.execute('SELECT * FROM licenses')])
        finally:
            db.close()

    def test_v2_migration_preserves_seat_term_and_retries(self):
        old, new = str(uuid.uuid4()), str(uuid.uuid4())
        key = Ed25519PrivateKey.generate()
        before = json.loads(self.activate(old, key)['payload'])
        original = self.identity_rows()
        self.now += 60
        after = json.loads(self.v2_request('refresh', new, old, key)['payload'])
        self.assertEqual(after['licenseId'], before['licenseId'])
        self.assertEqual(after['expiresAt'], before['expiresAt'])
        self.assertEqual(len(after['devices']), 1)
        self.assertNotEqual(after['deviceId'], before['deviceId'])
        rows, aliases, licenses = self.identity_rows()
        source = next(row for row in original[0] if row['device_id'] == before['deviceId'])
        target = next(row for row in rows if row['device_id'] == after['deviceId'])
        self.assertEqual(target['bound_at'], source['bound_at'])
        self.assertEqual(licenses, original[2])
        self.assertEqual(sum(row['released'] == 0 and row['license_id'] == before['licenseId'] for row in rows), 1)
        self.assertEqual(json.loads(self.v2_request('refresh', new, old, key)['payload'])['deviceId'], after['deviceId'])
        self.assertEqual(self.identity_rows()[1], aliases)
        self.rejected('DEVICE_IDENTITY_MIGRATED', lambda: self.v2_request('refresh', str(uuid.uuid4()), old, key))
        for action in ('activate', 'refresh', 'release'):
            path = '/v1/license/' + action
            self.rejected('DEVICE_IDENTITY_MIGRATED', lambda: self.store.request(path, self.proof(path, old, key, code=self.license['code'], label='old')))
            self.rejected('DEVICE_IDENTITY_MIGRATED', lambda: self.store.request(path, self.proof(path, new, key, code=self.license['code'], label='new')))
        self.v2_request('release', new, old, key)
        self.rejected('DEVICE_NOT_BOUND', lambda: self.v2_request('refresh', new, old, key))
        self.rejected('DEVICE_NOT_BOUND', lambda: self.v2_request('release', new, old, key))
        # Explicit reactivation remains valid, but only at the already pinned destination.
        self.v2_request('activate', new, old, key, code=self.license['code'], label='new')

    def test_v2_colliding_legacy_ids_with_distinct_keys_are_isolated(self):
        old, first, second = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        key_a, key_b = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        original = json.loads(self.activate(old, key_a)['payload'])
        other = self.store.issue(days=2, max_devices=1)
        self.rejected('DEVICE_NOT_BOUND', lambda: self.v2_request('refresh', second, old, key_b))
        fresh = json.loads(self.v2_request('activate', second, old, key_b, code=other['code'], label='B')['payload'])
        self.assertEqual(fresh['licenseId'], other['licenseId'])
        self.assertEqual(json.loads(self.store.request('/v1/license/refresh', self.proof('/v1/license/refresh', old, key_a))['payload'])['licenseId'], original['licenseId'])
        migrated = json.loads(self.v2_request('activate', first, old, key_a, code=self.license['code'], label='A')['payload'])
        self.store.operate('release-device', migrated['deviceId'])
        self.assertEqual(json.loads(self.v2_request('refresh', second, old, key_b)['payload'])['licenseId'], other['licenseId'])
        self.rejected('DEVICE_NOT_BOUND', lambda: self.v2_request('refresh', first, old, key_a))

    def test_v2_locks_and_destination_conflicts_fail_without_migration(self):
        old, new = str(uuid.uuid4()), str(uuid.uuid4())
        key = Ed25519PrivateKey.generate()
        self.activate(old, key)
        before = self.identity_rows()
        for value in (old, new):
            identity = hashlib.sha256(value.encode()).hexdigest()
            self.store.operate('lock-device', identity)
            self.rejected('DEVICE_LOCKED', lambda: self.v2_request('refresh', new, old, key))
            self.assertEqual(self.identity_rows(), before)
            self.store.operate('unlock-device', identity)
        occupied_license = self.store.issue()
        path = '/v1/license/activate'
        self.store.request(path, self.proof(path, new, Ed25519PrivateKey.generate(), code=occupied_license['code'], label='occupied'))
        occupied = self.identity_rows()
        self.rejected('DEVICE_ALREADY_BOUND', lambda: self.v2_request('refresh', new, old, key))
        self.assertEqual(self.identity_rows(), occupied)

    def test_v2_failed_activation_and_invalid_license_roll_back_migration(self):
        old, new = str(uuid.uuid4()), str(uuid.uuid4())
        key = Ed25519PrivateKey.generate()
        self.activate(old, key)
        other = self.store.issue()
        before = self.identity_rows()
        self.rejected('DEVICE_ALREADY_BOUND', lambda: self.v2_request('activate', new, old, key, code=other['code'], label='wrong license'))
        self.assertEqual(self.identity_rows(), before)
        self.store.operate('revoke-license', self.license['licenseId'])
        revoked = self.identity_rows()
        self.rejected('LICENSE_REVOKED', lambda: self.v2_request('refresh', new, old, key))
        self.assertEqual(self.identity_rows(), revoked)
        self.store.operate('restore-license', self.license['licenseId'])
        self.now += 86401
        expired = self.identity_rows()
        self.rejected('LICENSE_EXPIRED', lambda: self.v2_request('refresh', new, old, key))
        self.assertEqual(self.identity_rows(), expired)

    def test_v2_validates_legacy_identity_and_original_signed_path(self):
        old, new, key = str(uuid.uuid4()), str(uuid.uuid4()), Ed25519PrivateKey.generate()
        path = '/v2/license/refresh'
        for extra in ({}, {'legacyDeviceId': None}, {'legacyDeviceId': 'x' * 64},
                      {'legacyDeviceId': hashlib.sha256(new.encode()).hexdigest()}):
            self.rejected('INVALID_DEVICE_PROOF', lambda: self.store.request(path, self.proof(path, new, key, **extra)))
        legacy = hashlib.sha256(old.encode()).hexdigest()
        self.rejected('INVALID_DEVICE_PROOF', lambda: self.store.request(path, self.proof('/v1/license/refresh', new, key, legacyDeviceId=legacy)))
        self.rejected('INVALID_DEVICE_PROOF', lambda: self.store.request('/v1/license/refresh', self.proof('/v1/license/refresh', old, key, legacyDeviceId='invalid')))

    def test_v2_http_route_migration_and_replay(self):
        old, new, key = str(uuid.uuid4()), str(uuid.uuid4()), Ed25519PrivateKey.generate()
        self.activate(old, key)
        _, connection = self.start_admin_server()
        path = '/v2/license/refresh'
        body = json.dumps(self.proof(path, new, key, legacyDeviceId=hashlib.sha256(old.encode()).hexdigest()))
        connection.request('POST', path, body, {'Content-Type': 'application/json'})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(json.loads(response.read())['payload'])['deviceId'], hashlib.sha256(new.encode()).hexdigest())
        connection.request('POST', path, body, {'Content-Type': 'application/json'})
        response = connection.getresponse()
        self.assertEqual(response.status, 409)
        self.assertEqual(json.loads(response.read())['error'], 'REQUEST_REPLAYED')

    def test_v2_release_can_migrate_but_never_revive_a_released_source(self):
        old, new, key = str(uuid.uuid4()), str(uuid.uuid4()), Ed25519PrivateKey.generate()
        self.activate(old, key)
        self.assertEqual(self.v2_request('release', new, old, key), {'released': True})
        self.rejected('DEVICE_NOT_BOUND', lambda: self.v2_request('refresh', new, old, key))
        old, new, key = str(uuid.uuid4()), str(uuid.uuid4()), Ed25519PrivateKey.generate()
        self.activate(old, key)
        self.store.operate('release-device', hashlib.sha256(old.encode()).hexdigest())
        before = self.identity_rows()
        self.rejected('DEVICE_NOT_BOUND', lambda: self.v2_request('refresh', new, old, key))
        self.assertEqual(self.identity_rows(), before)

    def test_v2_migrated_binding_still_checks_legacy_locks_and_alias(self):
        old, new, key = str(uuid.uuid4()), str(uuid.uuid4()), Ed25519PrivateKey.generate()
        self.activate(old, key)
        self.v2_request('refresh', new, old, key)
        self.rejected('DEVICE_IDENTITY_MIGRATED', lambda: self.v2_request('refresh', new, str(uuid.uuid4()), key))
        self.store.operate('lock-device', hashlib.sha256(old.encode()).hexdigest())
        self.rejected('DEVICE_LOCKED', lambda: self.v2_request('refresh', new, old, key))

    def test_v2_signing_failure_rolls_back_identity_and_seat_changes(self):
        old, new, key = str(uuid.uuid4()), str(uuid.uuid4()), Ed25519PrivateKey.generate()
        self.activate(old, key)
        before = self.identity_rows()
        with patch.object(self.store, 'signed', side_effect=RuntimeError('signing unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'signing unavailable'):
                self.v2_request('refresh', new, old, key)
        self.assertEqual(self.identity_rows(), before)
        self.v2_request('refresh', new, old, key)

    def test_v2_concurrent_migration_and_activation_keep_one_seat(self):
        old, new, key = str(uuid.uuid4()), str(uuid.uuid4()), Ed25519PrivateKey.generate()
        self.activate(old, key)
        def attempt(index):
            try:
                if index % 2 == 0:
                    return json.loads(self.v2_request('refresh', new, old, key)['payload'])['deviceId']
                return json.loads(self.v2_request('activate', str(uuid.uuid4()), str(uuid.uuid4()), Ed25519PrivateKey.generate(),
                                                 code=self.license['code'], label='competing device')['payload'])['deviceId']
            except Rejected as error:
                return error.code
        with ThreadPoolExecutor(max_workers=8) as workers:
            results = list(workers.map(attempt, range(8)))
        self.assertEqual(results.count('DEVICE_LIMIT_REACHED'), 4)
        self.assertEqual(results.count(hashlib.sha256(new.encode()).hexdigest()), 4)
        rows, _, _ = self.identity_rows()
        self.assertEqual(sum(row['released'] == 0 and row['license_id'] == self.license['licenseId'] for row in rows), 1)

    def test_v2_fresh_enrollment_pins_alias_and_collisions_do_not_bypass_seats(self):
        old, first, second = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        key = Ed25519PrivateKey.generate()
        self.v2_request('activate', first, old, key, code=self.license['code'], label='first')
        self.rejected('DEVICE_IDENTITY_MIGRATED', lambda: self.v2_request('activate', second, old, key, code=self.license['code'], label='second'))
        self.rejected('DEVICE_LIMIT_REACHED', lambda: self.v2_request('activate', second, old, Ed25519PrivateKey.generate(), code=self.license['code'], label='second'))
        self.store.operate('lock-device', hashlib.sha256(first.encode()).hexdigest())
        self.rejected('DEVICE_LOCKED', lambda: self.v2_request('refresh', first, old, key))
        self.store.operate('unlock-device', hashlib.sha256(first.encode()).hexdigest())
        self.store.operate('lock-device', hashlib.sha256(old.encode()).hexdigest())
        self.rejected('DEVICE_LOCKED', lambda: self.v2_request('activate', second, old, Ed25519PrivateKey.generate(), code=self.license['code'], label='second'))

    def test_binding_token_schema_upgrade_preserves_existing_authorization(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'data'
            initialize(root, '127.0.0.1', 8443)
            store = LicenseStore(root, lambda: self.now)
            issued = store.issue()
            device, key = str(uuid.uuid4()), Ed25519PrivateKey.generate()
            path = '/v1/license/activate'
            store.request(path, self.proof(path, device, key, code=issued['code'], label='existing'))
            with store.transaction() as db:
                db.executescript('''
                    DROP INDEX active_device;
                    ALTER TABLE devices RENAME TO devices_with_token;
                    CREATE TABLE devices (
                      license_id TEXT NOT NULL REFERENCES licenses(id), device_id TEXT NOT NULL,
                      key_hash TEXT NOT NULL, public_key TEXT NOT NULL, label TEXT NOT NULL,
                      bound_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, released INTEGER NOT NULL DEFAULT 0,
                      PRIMARY KEY (license_id, device_id));
                    INSERT INTO devices (license_id,device_id,key_hash,public_key,label,bound_at,last_seen,released)
                      SELECT license_id,device_id,key_hash,public_key,label,bound_at,last_seen,released FROM devices_with_token;
                    DROP TABLE devices_with_token;
                    CREATE UNIQUE INDEX active_device ON devices(device_id) WHERE released=0;
                ''')
            upgraded = LicenseStore(root, lambda: self.now)
            with upgraded.transaction() as db:
                token = db.execute('SELECT binding_token FROM devices').fetchone()[0]
            self.assertRegex(token, r'^[a-f0-9]{64}$')
            reopened = LicenseStore(root, lambda: self.now)
            with reopened.transaction() as db:
                self.assertEqual(db.execute('SELECT binding_token FROM devices').fetchone()[0], token)
            refresh = '/v1/license/refresh'
            self.assertEqual(json.loads(reopened.request(refresh, self.proof(refresh, device, key))['payload'])['licenseId'], issued['licenseId'])

    def test_tampering_and_clock(self):
        path, device, key = '/v1/license/activate', str(uuid.uuid4()), Ed25519PrivateKey.generate()
        proof = self.proof(path, device, key, code=self.license['code'], label=device)
        proof['payload'] += ' '
        self.rejected('INVALID_DEVICE_PROOF', lambda: self.store.request(path, proof))
        proof = self.proof(path, device, key, timestamp=self.now - 301)
        self.rejected('CLOCK_SKEW', lambda: self.store.request(path, proof))

    def test_announcements_are_signed_bounded_and_withdrawable(self):
        installer = self.root / 'announcement-test.exe'
        installer.write_bytes(b'MZ' + bytes(range(64)))
        self.store.publish(installer, '998.0.0', '0.0.0', '😀' * 2500)
        update = self.store.latest_announcements()[0]
        update_payload = json.loads(update['payload'])
        self.assertEqual(update_payload['category'], 'update')
        self.assertEqual(update_payload['version'], '998.0.0')
        self.assertIn('createdAt', update_payload)
        self.assertNotIn('created_at', update_payload)
        self.assertLessEqual(len(update_payload['body'].encode('utf-16-le')) // 2, 2000)
        self.assertEqual(update_payload['body'], '😀' * 1000)

        problem_ids = [self.store.announce(f'问题 {index}', '问题说明') for index in range(10)]
        with self.assertRaises(Rejected):
            self.store.announce('过长内容', '😀' * 1001)
        notices = self.store.latest_announcements()
        self.assertEqual(len(notices), 8)
        self.assertTrue(all(json.loads(item['payload'])['category'] == 'problem' for item in notices))
        self.store.withdraw_announcement(problem_ids[-1])
        self.assertNotIn(problem_ids[-1], [json.loads(item['payload'])['id'] for item in self.store.latest_announcements()])

    def test_admin_website_authentication_and_announcement_workflow(self):
        password = 'correct horse battery staple 2026'
        set_admin_password(self.store.directory, password)
        self.assertTrue(verify_admin_password(self.store.directory, password))
        self.assertFalse(verify_admin_password(self.store.directory, 'wrong password'))
        server, connection = self.start_admin_server()
        origin = f'https://127.0.0.1:{server.server_address[1]}'

        connection.request('GET', '/admin/api/announcements')
        response = connection.getresponse()
        self.assertEqual(response.status, 401)
        response.read()

        login_body = json.dumps({'password': password})
        connection.request('POST', '/admin/api/login', body=login_body,
                           headers={'Content-Type': 'application/json', 'Origin': 'https://attacker.example'})
        response = connection.getresponse()
        self.assertEqual(response.status, 403)
        response.read()

        connection.request('POST', '/admin/api/login', body=login_body,
                           headers={'Content-Type': 'application/json', 'Origin': origin})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        cookie_header = response.getheader('Set-Cookie')
        self.assertIn('Secure', cookie_header)
        self.assertIn('HttpOnly', cookie_header)
        self.assertIn('SameSite=Strict', cookie_header)
        cookie = cookie_header.split(';', 1)[0]
        response.read()

        connection.request('GET', '/admin/', headers={'Cookie': cookie})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertIn("StoryDream 管理后台".encode('utf-8'), response.read())
        self.assertIn("default-src 'self'", response.getheader('Content-Security-Policy'))

        for path, content_type, marker in (
            ('/admin/admin.css', 'text/css', b'.workspace'),
            ('/admin/admin.js', ('application/javascript', 'text/javascript'), b'loadAnnouncements'),
        ):
            connection.request('GET', path)
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertTrue(response.getheader('Content-Type').startswith(content_type))
            self.assertEqual(response.getheader('X-Content-Type-Options'), 'nosniff')
            self.assertEqual(response.getheader('Cache-Control'), 'no-store')
            self.assertIn(marker, response.read())

        connection.request('GET', '/admin')
        response = connection.getresponse()
        self.assertEqual(response.status, 308)
        self.assertEqual(response.getheader('Location'), '/admin/')
        response.read()

        connection.request('POST', '/admin/api/announcements', body=json.dumps({'title': '服务维护', 'body': '图片生成将于今晚维护。'}),
                           headers={'Content-Type': 'application/json', 'Origin': origin, 'Cookie': cookie})
        response = connection.getresponse()
        self.assertEqual(response.status, 201)
        identity = json.loads(response.read())['id']
        self.assertIn(identity, [item['id'] for item in self.store.admin_announcements()])

        update_id = str(uuid.uuid4())
        with self.store.transaction() as db:
            db.execute('INSERT INTO announcements(id,category,title,body,version,created_at) VALUES(?,?,?,?,?,?)',
                       (update_id, 'update', '版本更新', '版本说明', '998.0.0', self.now))
        connection.request('POST', f'/admin/api/announcements/{update_id}/withdraw',
                           headers={'Origin': origin, 'Cookie': cookie})
        response = connection.getresponse()
        self.assertEqual(response.status, 409)
        response.read()

        connection.request('POST', f'/admin/api/announcements/{identity}/withdraw',
                           headers={'Origin': origin, 'Cookie': cookie})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        response.read()
        withdrawn = next(item for item in self.store.admin_announcements() if item['id'] == identity)
        self.assertEqual(withdrawn['withdrawn'], 1)

        connection.request('POST', '/admin/api/logout', headers={'Origin': origin, 'Cookie': cookie})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        response.read()
        connection.request('GET', '/admin/api/session', headers={'Cookie': cookie})
        response = connection.getresponse()
        self.assertEqual(response.status, 401)
        response.read()

    def test_release_order_withdrawal_and_tamper_hash(self):
        installer = self.root / 'test.exe'
        installer.write_bytes(b'MZ' + bytes(range(256)) * 20)
        # Shared fixture database: use a fresh monotonic version for this test.
        envelope = self.store.publish(installer, '999.0.0', '1.0.0', 'fixture')
        manifest = json.loads(envelope['payload'])
        self.assertEqual(manifest['sha256'], hashlib.sha256(installer.read_bytes()).hexdigest())
        self.assertEqual(json.loads(self.store.latest_release()['payload'])['validUntil'], self.now + 86400)
        self.rejected('RELEASE_MUST_INCREASE', lambda: self.store.publish(installer, '998.0.0', '0.0.0', ''))
        with self.store.transaction() as db:
            db.execute('UPDATE releases SET withdrawn=1 WHERE version=?', ('999.0.0',))
        self.assertIsNone(self.store.latest_release())

    def test_certificate_renewal_preserves_client_trust(self):
        from cryptography import x509
        from cryptography.hazmat.primitives import serialization
        directory = self.root / 'data'
        retained = {name: (directory / name).read_bytes() for name in ('ca.pem', 'tls-key.pem', 'signing-key.pem', 'client-public.json')}
        old = x509.load_pem_x509_certificate((directory / 'tls.pem').read_bytes())
        renew_tls(directory)
        new = x509.load_pem_x509_certificate((directory / 'tls.pem').read_bytes())
        self.assertNotEqual(old.serial_number, new.serial_number)
        new.verify_directly_issued_by(x509.load_pem_x509_certificate(retained['ca.pem']))
        tls_key = serialization.load_pem_private_key(retained['tls-key.pem'], password=None)
        self.assertEqual(public_pem(tls_key.public_key()), public_pem(new.public_key()))
        for name, value in retained.items():
            self.assertEqual((directory / name).read_bytes(), value)

    def test_tls_accepts_strict_certificate_verification(self):
        directory = self.root / 'data'
        context = ssl.create_default_context(cafile=str(directory / 'ca.pem'))
        context.verify_flags |= ssl.VERIFY_X509_STRICT
        server = LicenseHTTPServer(('127.0.0.1', 0), self.store)
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with socket.create_connection(server.server_address, timeout=5) as connection:
                with context.wrap_socket(connection, server_hostname='127.0.0.1') as secured:
                    secured.sendall(b'GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
                    self.assertIn(b'200 OK', secured.recv(4096))
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
