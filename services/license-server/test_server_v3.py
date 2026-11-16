"""Adversarial tests for the v3 identity and mixed-protocol transaction boundary."""
import http.client
import json
import ssl
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from threading import Thread

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from server import LicenseHTTPServer, LicenseStore, Rejected, b64, initialize, public_pem


class V3LicensingTests(unittest.TestCase):
    def setUp(self):
        # Each case has its own database: tests cannot bless leaked records/locks.
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'data'
        initialize(self.root, '127.0.0.1', 8443)
        self.now = 1800000000
        self.store = LicenseStore(self.root, lambda: self.now)
        self.license = self.store.issue(days=1, max_devices=1)

    def proof(self, path, key, **fields):
        serialized = json.dumps({'publicKey': public_pem(key.public_key()),
                                 'nonce': str(uuid.uuid4()), 'timestamp': self.now, **fields})
        return {'payload': serialized, 'signature': b64(key.sign((path + '\n' + serialized).encode()))}

    def request(self, action, key, **fields):
        path = '/v3/license/' + action
        return self.store.request_v3(path, self.proof(path, key, **fields))

    def challenge(self, key, purpose='activate', code=None):
        return self.request('challenge', key, purpose=purpose, code=code or self.license['code'])

    def activate(self, key, code=None, **fields):
        code = code or self.license['code']
        challenge = self.challenge(key, code=code)
        return json.loads(self.request('activate', key, code=code, label='device',
                                      challengeId=challenge['challengeId'], **fields)['payload'])

    @staticmethod
    def context(lease):
        return {name: lease[name] for name in ('deviceRecordId', 'credentialId', 'bindingId',
                                             'bindingRevision', 'licenseId', 'credentialEpoch')}

    def bound(self, action, key, lease, **fields):
        return self.request(action, key, **{**self.context(lease), **fields})

    def recover(self, key):
        challenge = self.challenge(key, 'recovery')
        return self.request('recover', key, code=self.license['code'], label='recovered',
                            challengeId=challenge['challengeId'])

    def legacy(self, key, device_id=None, code=None, action='activate', version=1, **extra):
        path = f'/v{version}/license/{action}'
        return self.store.request(path, self.proof(path, key, deviceId=device_id or 'a' * 64,
                                                  code=code or self.license['code'], label='legacy', **extra))

    def rejected(self, code, call):
        with self.assertRaises(Rejected) as raised:
            call()
        self.assertEqual(raised.exception.code, code)

    def rows(self, table):
        with closing(self.store.connect()) as db:
            return [dict(row) for row in db.execute('SELECT * FROM ' + table)]

    def test_generated_ids_and_same_key_retry(self):
        key = Ed25519PrivateKey.generate()
        chosen_did, chosen_cid = str(uuid.uuid4()), str(uuid.uuid4())
        lease = self.activate(key, deviceRecordId=chosen_did, credentialId=chosen_cid)
        self.assertNotEqual(lease['deviceRecordId'], chosen_did)
        self.assertNotEqual(lease['credentialId'], chosen_cid)
        self.assertEqual(lease['credentialEpoch'], 0)
        self.assertEqual(lease['bindingRevision'], 0)
        self.assertEqual(lease['validUntil'], self.now + 600)
        self.assertEqual(lease['expiresAt'], self.now + 86400)
        self.now += 60
        retry = self.activate(key)  # Initial IDs may be absent, including after response loss.
        self.assertEqual(self.context(retry), self.context(lease))
        self.assertEqual(len(self.rows('device_records')), 1)
        self.assertEqual(len(self.rows('license_bindings')), 1)

    def test_client_ids_cannot_enroll_into_existing_device(self):
        first = self.activate(Ed25519PrivateKey.generate())
        other = self.store.issue(days=1)
        lease = self.activate(Ed25519PrivateKey.generate(), other['code'],
                              deviceRecordId=first['deviceRecordId'], credentialId=first['credentialId'])
        self.assertNotEqual(first['deviceRecordId'], lease['deviceRecordId'])

    def test_same_key_cannot_silently_switch_license(self):
        key = Ed25519PrivateKey.generate()
        lease = self.activate(key)
        other = self.store.issue(days=30)
        self.rejected('DEVICE_ALREADY_BOUND', lambda: self.activate(key, other['code']))
        self.bound('refresh', key, lease)
        self.assertIsNone(next(row for row in self.rows('licenses') if row['id'] == other['licenseId'])['started_at'])

    def test_refresh_release_and_reactivation(self):
        key = Ed25519PrivateKey.generate()
        lease = self.activate(key)
        self.now += 100
        renewed = json.loads(self.bound('refresh', key, lease)['payload'])
        self.assertEqual(renewed['issuedAt'], self.now)
        self.assertEqual(self.bound('release', key, lease), {'released': True})
        self.rejected('DEVICE_NOT_BOUND', lambda: self.bound('refresh', key, lease))
        replacement = self.activate(key)
        self.assertEqual(replacement['deviceRecordId'], lease['deviceRecordId'])
        self.assertNotEqual(replacement['bindingId'], lease['bindingId'])
        self.assertEqual(replacement['expiresAt'], lease['expiresAt'])

    def test_delayed_release_and_refresh_cannot_touch_replacement(self):
        key = Ed25519PrivateKey.generate()
        old = self.activate(key)
        delayed = self.proof('/v3/license/release', key, **self.context(old))
        self.bound('release', key, old)
        new = self.activate(key)
        self.rejected('BINDING_CHANGED', lambda: self.store.request_v3('/v3/license/release', delayed))
        self.rejected('BINDING_CHANGED', lambda: self.bound('refresh', key, old))
        self.bound('refresh', key, new)

    def test_each_signed_context_field_required_and_exact(self):
        key = Ed25519PrivateKey.generate()
        lease = self.activate(key)
        for action in ('refresh', 'release'):
            for name in ('bindingId', 'bindingRevision', 'licenseId', 'credentialEpoch'):
                fields = self.context(lease)
                fields.pop(name)
                self.rejected('BINDING_CHANGED', lambda: self.request(action, key, **fields))
                fields[name] = str(uuid.uuid4()) if name.endswith('Id') else 999
                self.rejected('BINDING_CHANGED', lambda: self.request(action, key, **fields))
        self.bound('refresh', key, lease)

    def test_activation_challenge_missing_expired_wrong_key_code_and_reuse(self):
        key = Ed25519PrivateKey.generate()
        def activate(challenge_id, signer=key, code=None):
            return self.request('activate', signer, code=code or self.license['code'],
                                label='device', challengeId=challenge_id)
        self.rejected('CHALLENGE_INVALID', lambda: activate(''))
        challenge = self.challenge(key)
        self.rejected('CHALLENGE_INVALID', lambda: activate(challenge['challengeId'], Ed25519PrivateKey.generate()))
        other = self.store.issue(days=1)
        self.rejected('CHALLENGE_INVALID', lambda: activate(challenge['challengeId'], code=other['code']))
        activate(challenge['challengeId'])
        self.rejected('CHALLENGE_INVALID', lambda: activate(challenge['challengeId']))
        challenge = self.challenge(key)
        self.now = challenge['expiresAt']
        self.rejected('CHALLENGE_INVALID', lambda: activate(challenge['challengeId']))

    def test_challenge_request_nonce_cannot_be_replayed(self):
        key = Ed25519PrivateKey.generate()
        path = '/v3/license/challenge'
        proof = self.proof(path, key, purpose='activate', code=self.license['code'])
        self.store.request_v3(path, proof)
        self.rejected('REQUEST_REPLAYED', lambda: self.store.request_v3(path, proof))
        self.assertEqual(len(self.rows('auth_challenges')), 1)

    def test_signed_proof_replay_tampering_clock_and_bad_inputs(self):
        key = Ed25519PrivateKey.generate()
        lease = self.activate(key)
        path = '/v3/license/refresh'
        proof = self.proof(path, key, **self.context(lease))
        self.store.request_v3(path, proof)
        self.rejected('REQUEST_REPLAYED', lambda: self.store.request_v3(path, proof))
        proof['payload'] += ' '
        self.rejected('INVALID_DEVICE_PROOF', lambda: self.store.request_v3(path, proof))
        self.rejected('CLOCK_SKEW', lambda: self.request('refresh', key, **self.context(lease), timestamp=self.now-301))
        self.rejected('INVALID_ACTIVATION_CODE', lambda: self.request('activate', key, code=None, label='x'))
        self.rejected('INVALID_DEVICE_LABEL', lambda: self.request('activate', key, code=self.license['code'], label=''))
        self.rejected('INVALID_REQUEST', lambda: self.request('challenge', key, purpose='evil', code=self.license['code']))

    def test_mixed_protocol_seats_both_orders(self):
        for legacy_first in (True, False):
            self.license = self.store.issue(days=1)
            first, second = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
            legacy_id = uuid.uuid4().hex * 2
            if legacy_first:
                self.legacy(first, legacy_id)
                self.rejected('DEVICE_LIMIT_REACHED', lambda: self.activate(second))
            else:
                self.activate(first)
                self.rejected('DEVICE_LIMIT_REACHED', lambda: self.legacy(second, legacy_id))

    def test_concurrent_mixed_protocol_single_seat(self):
        def attempt(index):
            key = Ed25519PrivateKey.generate()
            try:
                if index % 2:
                    self.legacy(key, uuid.uuid4().hex * 2)
                else:
                    self.activate(key)
                return 'ok'
            except Rejected as error:
                return error.code
        with ThreadPoolExecutor(max_workers=8) as workers:
            results = list(workers.map(attempt, range(12)))
        self.assertEqual(results.count('ok'), 1)
        self.assertEqual(results.count('DEVICE_LIMIT_REACHED'), 11)
        self.assertEqual(sum(row['released'] == 0 for row in self.rows('devices')) +
                         sum(row['state'] == 'active' for row in self.rows('license_bindings')), 1)

    def test_legacy_same_key_migration_preserves_expiry_and_retires_proof(self):
        key = Ed25519PrivateKey.generate()
        old = json.loads(self.legacy(key)['payload'])
        bound_at = self.rows('devices')[0]['bound_at']
        self.now += 700
        lease = self.activate(key)
        self.assertEqual(lease['expiresAt'], old['expiresAt'])
        self.assertEqual(self.rows('license_bindings')[0]['bound_at'], bound_at)
        self.assertEqual(self.rows('devices')[0]['released'], 1)
        for action in ('activate', 'refresh', 'release'):
            self.rejected('DEVICE_IDENTITY_MIGRATED', lambda: self.legacy(key, action=action))
        self.bound('release', key, lease)
        self.rejected('DEVICE_IDENTITY_MIGRATED', lambda: self.legacy(key))

    def test_legacy_migration_wrong_code_key_and_lock_preserve_source(self):
        key = Ed25519PrivateKey.generate()
        self.legacy(key)
        before = self.rows('devices')
        other = self.store.issue(days=1)
        self.rejected('DEVICE_ALREADY_BOUND', lambda: self.activate(key, other['code']))
        self.rejected('DEVICE_LIMIT_REACHED', lambda: self.activate(Ed25519PrivateKey.generate()))
        self.store.operate('lock-device', 'a' * 64)
        self.rejected('DEVICE_LOCKED', lambda: self.activate(key))
        self.assertEqual(self.rows('devices'), before)
        self.assertEqual(self.rows('device_records'), [])
        self.assertEqual(self.rows('legacy_binding_map'), [])

    def test_released_legacy_key_does_not_bypass_known_lock(self):
        key = Ed25519PrivateKey.generate()
        self.legacy(key)
        self.legacy(key, action='release')
        self.store.operate('lock-device', 'a' * 64)
        self.rejected('DEVICE_LOCKED', lambda: self.activate(key))
        self.assertEqual(self.rows('device_records'), [])
        self.assertEqual(self.rows('devices')[0]['released'], 1)

    def test_v2_alias_migration_retires_both_old_proofs_and_checks_old_lock(self):
        key = Ed25519PrivateKey.generate()
        self.legacy(key)
        self.legacy(key, 'b' * 64, version=2, legacyDeviceId='a' * 64)
        self.store.operate('lock-device', 'a' * 64)
        self.rejected('DEVICE_LOCKED', lambda: self.activate(key))
        self.store.operate('unlock-device', 'a' * 64)
        self.activate(key)
        self.rejected('DEVICE_IDENTITY_MIGRATED', lambda: self.legacy(key))
        self.rejected('DEVICE_IDENTITY_MIGRATED', lambda: self.legacy(key, 'b' * 64, version=2, legacyDeviceId='a' * 64))

    def test_same_key_migration_concurrent_retry_has_one_binding(self):
        key = Ed25519PrivateKey.generate()
        self.legacy(key)
        with ThreadPoolExecutor(max_workers=4) as workers:
            leases = list(workers.map(lambda _: self.activate(key), range(4)))
        self.assertEqual(len({row['bindingId'] for row in leases}), 1)
        self.assertEqual(len(self.rows('device_records')), 1)

    def test_recovery_approval_discoverable_by_proposed_key_and_original_code(self):
        old_key, new_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        old = self.activate(old_key)
        request = self.recover(new_key)
        self.assertEqual(request['state'], 'pending')
        self.assertIn(request['id'], [row['id'] for row in self.store.admin_recovery_list()])
        self.rejected('RECOVERY_PENDING', lambda: self.activate(new_key))
        self.store.admin_approve_recovery(request['id'])
        # Only public protocol is used to discover assigned credential and signed binding.
        lease = self.activate(new_key)
        self.assertEqual(lease['deviceRecordId'], old['deviceRecordId'])
        self.assertEqual(lease['bindingId'], old['bindingId'])
        self.assertEqual(lease['bindingRevision'], old['bindingRevision'] + 1)
        self.assertEqual(lease['credentialEpoch'], 1)
        self.assertEqual(lease['expiresAt'], old['expiresAt'])
        self.bound('refresh', new_key, lease)
        self.rejected('CREDENTIAL_NOT_FOUND', lambda: self.bound('refresh', old_key, old))
        self.rejected('CREDENTIAL_REVOKED', lambda: self.activate(old_key))
        self.rejected('RECOVERY_ALREADY_PROCESSED', lambda: self.store.admin_approve_recovery(request['id']))

    def test_recovery_approval_revoke_expiry_and_lock_roll_back(self):
        old_key, new_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        lease = self.activate(old_key)
        request = self.recover(new_key)
        before = {name: self.rows(name) for name in ('device_records', 'device_credentials', 'license_bindings', 'recovery_requests')}
        self.store.operate('revoke-license', lease['licenseId'])
        self.rejected('LICENSE_REVOKED', lambda: self.store.admin_approve_recovery(request['id']))
        self.store.operate('restore-license', lease['licenseId'])
        self.now = lease['expiresAt']
        self.rejected('LICENSE_EXPIRED', lambda: self.store.admin_approve_recovery(request['id']))
        self.now = lease['issuedAt']
        self.store.admin_lock_device_v3(lease['deviceRecordId'])
        self.rejected('DEVICE_LOCKED', lambda: self.store.admin_approve_recovery(request['id']))
        self.store.admin_unlock_device_v3(lease['deviceRecordId'])
        for name in ('device_credentials', 'license_bindings', 'recovery_requests'):
            self.assertEqual(self.rows(name), before[name])
        self.assertEqual(self.rows('device_records')[0]['credential_epoch'], 0)
        self.bound('refresh', old_key, lease)

    def test_recovery_rejects_already_active_and_revoked_proposed_keys(self):
        old_key, new_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        old = self.activate(old_key)
        self.rejected('CREDENTIAL_ALREADY_ACTIVE', lambda: self.recover(old_key))
        request = self.recover(new_key)
        self.store.admin_approve_recovery(request['id'])
        self.rejected('CREDENTIAL_REVOKED', lambda: self.recover(old_key))
        # A proposed key can become active on a different license between request and approval.
        third = Ed25519PrivateKey.generate()
        request2 = self.recover(third)
        other = self.store.issue(days=1)
        self.legacy(third, code=other['code'])
        before = self.rows('device_credentials')
        self.rejected('CREDENTIAL_ALREADY_ACTIVE', lambda: self.store.admin_approve_recovery(request2['id']))
        self.assertEqual(self.rows('device_credentials'), before)
        self.assertEqual(self.rows('device_records')[0]['credential_epoch'], 1)

    def test_pending_recovery_key_cannot_allocate_spare_seat_or_target_twice(self):
        self.license = self.store.issue(days=30, max_devices=2)
        self.activate(Ed25519PrivateKey.generate())
        proposed = Ed25519PrivateKey.generate()
        request = self.recover(proposed)
        self.rejected('RECOVERY_PENDING', lambda: self.activate(proposed))
        other = self.store.issue(days=30)
        self.activate(Ed25519PrivateKey.generate(), other['code'])
        first_license = self.license
        self.license = other
        self.rejected('RECOVERY_PENDING', lambda: self.recover(proposed))
        self.license = first_license
        self.assertEqual(len(self.rows('device_records')), 2)
        self.store.admin_reject_recovery(request['id'])
        self.activate(proposed)

    def test_recovery_cannot_import_an_active_legacy_key(self):
        self.activate(Ed25519PrivateKey.generate())
        proposed = Ed25519PrivateKey.generate()
        request = self.recover(proposed)
        other = self.store.issue(days=30)
        self.legacy(proposed, code=other['code'])
        before = self.rows('device_credentials')
        self.rejected('CREDENTIAL_ALREADY_ACTIVE', lambda: self.recover(proposed))
        self.rejected('CREDENTIAL_ALREADY_ACTIVE', lambda: self.store.admin_approve_recovery(request['id']))
        self.assertEqual(self.rows('device_credentials'), before)
        self.assertEqual(self.rows('devices')[0]['released'], 0)

    def test_approval_rejects_proposed_key_revoked_since_request(self):
        self.activate(Ed25519PrivateKey.generate())
        proposed = Ed25519PrivateKey.generate()
        request = self.recover(proposed)
        # Simulate an imported historical revocation appearing after submission.
        from server import key_hash
        with self.store.transaction() as db:
            device_id = str(uuid.uuid4())
            db.execute("INSERT INTO device_records(id,label,created_at,updated_at) VALUES(?,'history',?,?)", (device_id, self.now, self.now))
            db.execute("INSERT INTO device_credentials(id,device_id,public_key,key_hash,status,created_at,revoked_at) VALUES(?,?,?,?,'revoked',?,?)",
                       (str(uuid.uuid4()), device_id, public_pem(proposed.public_key()), key_hash(proposed.public_key()), self.now, self.now))
        before = self.rows('device_credentials')
        self.rejected('CREDENTIAL_REVOKED', lambda: self.store.admin_approve_recovery(request['id']))
        self.assertEqual(self.rows('device_credentials'), before)

    def test_recovery_approval_target_changed_rolls_back(self):
        key = Ed25519PrivateKey.generate()
        lease = self.activate(key)
        request = self.recover(Ed25519PrivateKey.generate())
        self.store.admin_release_binding_v3(lease['bindingId'], lease['bindingRevision'])
        new = self.activate(key)
        before = self.rows('device_credentials')
        self.rejected('BINDING_CHANGED', lambda: self.store.admin_approve_recovery(request['id']))
        self.assertEqual(self.rows('device_credentials'), before)
        self.bound('refresh', key, new)

    def test_independent_keys_same_hardware_lock_and_release_are_isolated(self):
        first_key, second_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        evidence = [{'type': 'machineGuid', 'valueDigest': 'a' * 64}]
        first = self.activate(first_key, evidence=evidence)
        other = self.store.issue(days=1)
        second = self.activate(second_key, other['code'], evidence=evidence)
        self.assertNotEqual(first['deviceRecordId'], second['deviceRecordId'])
        self.store.admin_lock_device_v3(first['deviceRecordId'])
        self.bound('refresh', second_key, second)
        self.store.admin_release_binding_v3(first['bindingId'], first['bindingRevision'])
        self.bound('refresh', second_key, second)

    def test_expired_pending_does_not_block_new_recovery(self):
        self.license = self.store.issue(days=30)
        self.activate(Ed25519PrivateKey.generate())
        first = self.recover(Ed25519PrivateKey.generate())
        self.rejected('RECOVERY_PENDING', lambda: self.recover(Ed25519PrivateKey.generate()))
        self.now = first['expiresAt']
        self.rejected('RECOVERY_EXPIRED', lambda: self.store.admin_approve_recovery(first['id']))
        second = self.recover(Ed25519PrivateKey.generate())
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(self.rows('recovery_requests')[0]['state'], 'expired')

    def test_recovery_challenge_binds_target_revision(self):
        old_key, new_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        lease = self.activate(old_key)
        challenge = self.challenge(new_key, 'recovery')
        self.bound('release', old_key, lease)
        self.activate(old_key)
        self.rejected('CHALLENGE_INVALID', lambda: self.request('recover', new_key,
                      code=self.license['code'], label='new', challengeId=challenge['challengeId']))

    def test_admin_precise_release_lock_reject_and_lists(self):
        key = Ed25519PrivateKey.generate()
        lease = self.activate(key)
        self.rejected('BINDING_REVISION_MISMATCH', lambda: self.store.admin_release_binding_v3(lease['bindingId'], 9))
        self.store.admin_lock_device_v3(lease['deviceRecordId'])
        self.rejected('DEVICE_LOCKED', lambda: self.bound('refresh', key, lease))
        self.store.admin_unlock_device_v3(lease['deviceRecordId'])
        request = self.recover(Ed25519PrivateKey.generate())
        self.store.admin_reject_recovery(request['id'], 'not verified')
        self.rejected('RECOVERY_ALREADY_PROCESSED', lambda: self.store.admin_approve_recovery(request['id']))
        self.assertEqual(self.store.admin_list_v3('devices', '', 1)['total'], 1)
        self.assertEqual(self.store.admin_list_v3('bindings', '', 1)['total'], 1)
        self.assertEqual(self.store.admin_summary()['v3ActiveBindings'], 1)
        self.assertEqual(self.store.admin_list('licenses')['items'][0]['seats'], 1)
        self.store.admin_release_binding_v3(lease['bindingId'], lease['bindingRevision'])
        self.rejected('DEVICE_NOT_BOUND', lambda: self.bound('refresh', key, lease))

    def test_offline_grace_is_bounded_by_license(self):
        self.store = LicenseStore(self.root, lambda: self.now, offline_grace=3600)
        lease = self.activate(Ed25519PrivateKey.generate())
        self.assertEqual(lease['offlineGraceUntil'], self.now + 3600)

    def start_server(self):
        server = LicenseHTTPServer(('127.0.0.1', 0), self.store)
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        context = ssl.create_default_context(cafile=str(self.root / 'ca.pem'))
        conn = http.client.HTTPSConnection('127.0.0.1', server.server_address[1], context=context, timeout=5)
        self.addCleanup(worker.join, 5)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(conn.close)
        return conn

    def http(self, conn, action, proof):
        conn.request('POST', '/v3/license/' + action, json.dumps(proof), {'Content-Type': 'application/json'})
        response = conn.getresponse()
        return response.status, json.loads(response.read())

    def test_http_challenge_activate_refresh_release_and_replay(self):
        conn = self.start_server()
        key = Ed25519PrivateKey.generate()
        status, challenge = self.http(conn, 'challenge', self.proof('/v3/license/challenge', key,
                                     purpose='activate', code=self.license['code']))
        self.assertEqual(status, 200)
        proof = self.proof('/v3/license/activate', key, code=self.license['code'], label='http',
                           challengeId=challenge['challengeId'])
        status, body = self.http(conn, 'activate', proof)
        self.assertEqual(status, 200)
        lease = json.loads(body['payload'])
        status, body = self.http(conn, 'activate', proof)
        self.assertEqual(status, 409)
        self.assertEqual(body['error'], 'REQUEST_REPLAYED')
        status, _ = self.http(conn, 'refresh', self.proof('/v3/license/refresh', key, **self.context(lease)))
        self.assertEqual(status, 200)
        status, body = self.http(conn, 'release', self.proof('/v3/license/release', key, **self.context(lease)))
        self.assertEqual(status, 200)
        self.assertTrue(body['released'])
        status, _ = self.http(conn, 'nonexistent', {})
        self.assertEqual(status, 404)


if __name__ == '__main__':
    unittest.main()
