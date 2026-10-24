import hashlib
import json
import socket
import ssl
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Thread

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from server import LicenseHTTPServer, LicenseStore, Rejected, b64, initialize, public_pem, renew_tls


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

    def test_tampering_and_clock(self):
        path, device, key = '/v1/license/activate', str(uuid.uuid4()), Ed25519PrivateKey.generate()
        proof = self.proof(path, device, key, code=self.license['code'], label=device)
        proof['payload'] += ' '
        self.rejected('INVALID_DEVICE_PROOF', lambda: self.store.request(path, proof))
        proof = self.proof(path, device, key, timestamp=self.now - 301)
        self.rejected('CLOCK_SKEW', lambda: self.store.request(path, proof))

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
