"""StoryDream machine licensing and signed release distribution.

Public endpoints use TLS. Operator commands run locally under the service user.
SQLite transactions serialize activation and seat allocation across HTTP threads.
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import ssl
import time
import uuid
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import ip_address
from pathlib import Path
from threading import BoundedSemaphore
from urllib.parse import urlparse

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.rsa import generate_private_key
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


class Rejected(Exception):
    def __init__(self, code, status=403):
        self.code, self.status = code, status


def b64(data):
    return base64.b64encode(data).decode('ascii')


def public_pem(key):
    return key.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode('ascii')


def key_hash(key):
    return hashlib.sha256(key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()


def version_tuple(value):
    if not isinstance(value, str) or not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', value):
        raise Rejected('INVALID_VERSION', 400)
    return tuple(map(int, value.split('.')))


class LicenseStore:
    def __init__(self, directory, clock=time.time):
        self.directory = Path(directory)
        self.clock = clock
        self.config = json.loads((self.directory / 'secrets.json').read_text('utf-8'))
        self.signing_key = serialization.load_pem_private_key((self.directory / 'signing-key.pem').read_bytes(), password=None)
        with closing(self.connect()) as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS licenses (
                  id TEXT PRIMARY KEY, code_hash TEXT UNIQUE NOT NULL, tail TEXT NOT NULL,
                  label TEXT NOT NULL, days INTEGER NOT NULL, max_devices INTEGER NOT NULL,
                  created_at INTEGER NOT NULL, started_at INTEGER, expires_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS devices (
                  license_id TEXT NOT NULL REFERENCES licenses(id), device_id TEXT NOT NULL,
                  key_hash TEXT NOT NULL, public_key TEXT NOT NULL, label TEXT NOT NULL,
                  bound_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, released INTEGER NOT NULL DEFAULT 0,
                  PRIMARY KEY (license_id, device_id));
                CREATE UNIQUE INDEX IF NOT EXISTS active_device ON devices(device_id) WHERE released=0;
                CREATE TABLE IF NOT EXISTS blocked_devices (device_id TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS releases (sequence INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT UNIQUE NOT NULL,
                  filename TEXT NOT NULL, manifest TEXT NOT NULL, withdrawn INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, started_at INTEGER NOT NULL, count INTEGER NOT NULL);
            ''')

    def connect(self):
        db = sqlite3.connect(self.directory / 'license.sqlite3', timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA synchronous=FULL')
        return db

    @contextmanager
    def transaction(self):
        db = self.connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def audit(self, db, action, target, detail=''):
        db.execute('INSERT INTO audit(at,action,target,detail) VALUES(?,?,?,?)', (int(self.clock()), action, target, detail))

    def digest(self, code):
        return hmac.new(bytes.fromhex(self.config['codePepper']), code.strip().upper().encode('ascii'), hashlib.sha256).hexdigest()

    def signed(self, payload):
        serialized = json.dumps(payload, separators=(',', ':'), ensure_ascii=True)
        return {'payload': serialized, 'signature': b64(self.signing_key.sign(serialized.encode('utf-8')))}

    def issue(self, days=365, max_devices=1, label=''):
        if not 1 <= days <= 36500 or not 1 <= max_devices <= 100 or len(label) > 200:
            raise Rejected('INVALID_LICENSE_PARAMETERS', 400)
        code = 'SD-' + '-'.join(secrets.token_hex(4).upper() for _ in range(4))
        identity = str(uuid.uuid4())
        with self.transaction() as db:
            db.execute('INSERT INTO licenses(id,code_hash,tail,label,days,max_devices,created_at) VALUES(?,?,?,?,?,?,?)',
                       (identity, self.digest(code), code[-4:], label, days, max_devices, int(self.clock())))
            self.audit(db, 'issue', identity)
        return {'licenseId': identity, 'code': code, 'days': days, 'maxDevices': max_devices}

    def rate_limit(self, address, path):
        now = int(self.clock())
        with self.transaction() as db:
            db.execute('DELETE FROM rate_limits WHERE started_at < ?', (now - 120,))
            bucket = f'{address}:{path}'
            row = db.execute('SELECT * FROM rate_limits WHERE bucket=?', (bucket,)).fetchone()
            limit = 15 if path.endswith('/activate') else 120
            if row and row['started_at'] > now - 60 and row['count'] >= limit:
                raise Rejected('RATE_LIMITED', 429)
            if not row or row['started_at'] <= now - 60:
                db.execute('INSERT OR REPLACE INTO rate_limits VALUES(?,?,1)', (bucket, now))
            else:
                db.execute('UPDATE rate_limits SET count=count+1 WHERE bucket=?', (bucket,))

    def authenticate(self, path, envelope):
        try:
            serialized = envelope['payload']
            if not isinstance(serialized, str) or len(serialized) > 8192:
                raise ValueError()
            payload = json.loads(serialized)
            device_id, nonce = payload['deviceId'], payload['nonce']
            if not re.fullmatch(r'[a-f0-9]{64}', device_id) or not re.fullmatch(r'[a-f0-9-]{36}', nonce):
                raise ValueError()
            if not isinstance(payload['timestamp'], int) or abs(self.clock() - payload['timestamp']) > 300:
                raise Rejected('CLOCK_SKEW', 400)
            key = serialization.load_pem_public_key(payload['publicKey'].encode('ascii'))
            if not isinstance(key, Ed25519PublicKey):
                raise ValueError()
            key.verify(base64.b64decode(envelope['signature'], validate=True), (path + '\n' + serialized).encode('utf-8'))
        except Rejected:
            raise
        except Exception:
            raise Rejected('INVALID_DEVICE_PROOF', 400) from None
        return payload, key

    def request(self, path, envelope):
        payload, key = self.authenticate(path, envelope)
        now, device_id, digest = int(self.clock()), payload['deviceId'], key_hash(key)
        with self.transaction() as db:
            db.execute('DELETE FROM nonces WHERE expires_at < ?', (now,))
            try:
                db.execute('INSERT INTO nonces VALUES(?,?)', (payload['nonce'], now + 600))
            except sqlite3.IntegrityError:
                raise Rejected('REQUEST_REPLAYED', 409) from None
            if db.execute('SELECT 1 FROM blocked_devices WHERE device_id=?', (device_id,)).fetchone():
                raise Rejected('DEVICE_LOCKED')
            if path == '/v1/license/activate':
                code, label = payload.get('code', ''), payload.get('label', '')
                if not isinstance(code, str) or not re.fullmatch(r'SD-(?:[A-Fa-f0-9]{8}-){3}[A-Fa-f0-9]{8}', code.strip(), re.IGNORECASE):
                    raise Rejected('INVALID_ACTIVATION_CODE', 400)
                if not isinstance(label, str) or not 1 <= len(label) <= 120:
                    raise Rejected('INVALID_DEVICE_LABEL', 400)
                license_row = db.execute('SELECT * FROM licenses WHERE code_hash=?', (self.digest(code),)).fetchone()
                self.assert_license(license_row, now)
                existing = db.execute('SELECT * FROM devices WHERE device_id=? AND released=0', (device_id,)).fetchone()
                if existing and (existing['license_id'] != license_row['id'] or existing['key_hash'] != digest):
                    raise Rejected('DEVICE_ALREADY_BOUND', 409)
                count = db.execute('SELECT count(*) FROM devices WHERE license_id=? AND released=0', (license_row['id'],)).fetchone()[0]
                if not existing and count >= license_row['max_devices']:
                    raise Rejected('DEVICE_LIMIT_REACHED', 409)
                if not license_row['started_at']:
                    db.execute('UPDATE licenses SET started_at=?,expires_at=? WHERE id=?',
                               (now, now + license_row['days'] * 86400, license_row['id']))
                    license_row = db.execute('SELECT * FROM licenses WHERE id=?', (license_row['id'],)).fetchone()
                db.execute('INSERT OR REPLACE INTO devices VALUES(?,?,?,?,?,?,?,0)',
                           (license_row['id'], device_id, digest, public_pem(key), label, existing['bound_at'] if existing else now, now))
                self.audit(db, 'activate', device_id, license_row['id'])
            else:
                device = db.execute('SELECT * FROM devices WHERE device_id=? AND released=0 AND key_hash=?', (device_id, digest)).fetchone()
                if not device:
                    raise Rejected('DEVICE_NOT_BOUND')
                license_row = db.execute('SELECT * FROM licenses WHERE id=?', (device['license_id'],)).fetchone()
                if path == '/v1/license/release':
                    db.execute('UPDATE devices SET released=1 WHERE license_id=? AND device_id=?', (license_row['id'], device_id))
                    self.audit(db, 'release', device_id, license_row['id'])
                    return {'released': True}
                self.assert_license(license_row, now)
                if path != '/v1/license/refresh':
                    raise Rejected('NOT_FOUND', 404)
                db.execute('UPDATE devices SET last_seen=? WHERE license_id=? AND device_id=?', (now, license_row['id'], device_id))
            devices = [dict(row) for row in db.execute('SELECT device_id AS deviceId,label,last_seen AS lastSeen FROM devices WHERE license_id=? AND released=0', (license_row['id'],))]
            return self.signed({'schemaVersion': 1, 'kind': 'lease', 'status': 'active', 'licenseId': license_row['id'],
                                'deviceId': device_id, 'keyHash': digest, 'issuedAt': now,
                                'validUntil': min(now + 600, license_row['expires_at']), 'expiresAt': license_row['expires_at'],
                                'maxDevices': license_row['max_devices'], 'devices': devices})

    @staticmethod
    def assert_license(row, now):
        if not row:
            raise Rejected('INVALID_ACTIVATION_CODE')
        if row['revoked']:
            raise Rejected('LICENSE_REVOKED')
        if row['expires_at'] is not None and row['expires_at'] <= now:
            raise Rejected('LICENSE_EXPIRED')

    def operate(self, action, target, reason=''):
        with self.transaction() as db:
            if action == 'lock-device':
                if not re.fullmatch(r'[a-f0-9]{64}', target):
                    raise Rejected('INVALID_DEVICE_ID', 400)
                db.execute('INSERT OR REPLACE INTO blocked_devices VALUES(?,?,?)', (target, reason, int(self.clock())))
            elif action == 'unlock-device':
                db.execute('DELETE FROM blocked_devices WHERE device_id=?', (target,))
            elif action == 'release-device':
                db.execute('UPDATE devices SET released=1 WHERE device_id=?', (target,))
            elif action in ('revoke-license', 'restore-license'):
                if not db.execute('SELECT 1 FROM licenses WHERE id=?', (target,)).fetchone():
                    raise Rejected('LICENSE_NOT_FOUND', 404)
                db.execute('UPDATE licenses SET revoked=? WHERE id=?', (int(action == 'revoke-license'), target))
            else:
                raise Rejected('INVALID_OPERATION', 400)
            self.audit(db, action, target, reason[:500])

    def publish(self, source, version, minimum_version, notes):
        current, minimum = version_tuple(version), version_tuple(minimum_version)
        if minimum > current or len(notes) > 8000:
            raise Rejected('INVALID_RELEASE', 400)
        source = Path(source).resolve(strict=True)
        if source.suffix.lower() != '.exe' or not source.is_file():
            raise Rejected('EXE_INSTALLER_REQUIRED', 400)
        directory = self.directory / 'releases'
        directory.mkdir(exist_ok=True, mode=0o700)
        filename = f'StoryDream-Setup-{version}-{secrets.token_hex(6)}.exe'
        target, digest, size = directory / filename, hashlib.sha256(), 0
        try:
            with source.open('rb') as src, target.open('xb') as dst:
                while block := src.read(1024 * 1024):
                    dst.write(block)
                    digest.update(block)
                    size += len(block)
                dst.flush()
                os.fsync(dst.fileno())
            with target.open('rb') as header:
                magic = header.read(2)
            if size < 2 or size > 4 * 1024 ** 3 or magic != b'MZ':
                raise Rejected('INVALID_WINDOWS_INSTALLER', 400)
            with self.transaction() as db:
                previous = db.execute('SELECT version FROM releases ORDER BY sequence DESC LIMIT 1').fetchone()
                if previous and version_tuple(previous['version']) >= current:
                    raise Rejected('RELEASE_MUST_INCREASE', 409)
                cursor = db.execute('INSERT INTO releases(version,filename,manifest) VALUES(?,?,?)', (version, filename, '{}'))
                now = int(self.clock())
                envelope = self.signed({'schemaVersion': 1, 'kind': 'release', 'sequence': cursor.lastrowid,
                                        'version': version, 'minimumVersion': minimum_version, 'platform': 'win32', 'arch': 'x64',
                                        'filename': filename, 'sha256': digest.hexdigest(), 'size': size,
                                        'notes': notes, 'issuedAt': now, 'validUntil': now + 86400})
                db.execute('UPDATE releases SET manifest=? WHERE sequence=?', (json.dumps(envelope), cursor.lastrowid))
                self.audit(db, 'publish', version)
            return envelope
        except BaseException:
            target.unlink(missing_ok=True)
            raise

    def latest_release(self):
        with closing(self.connect()) as db:
            # A withdrawn latest release must never make an older release the new latest.
            row = db.execute('SELECT * FROM releases ORDER BY sequence DESC LIMIT 1').fetchone()
            if not row or row['withdrawn']:
                return None
            payload = json.loads(json.loads(row['manifest'])['payload'])
            payload.update(issuedAt=int(self.clock()), validUntil=int(self.clock()) + 86400)
            return self.signed(payload)


def initialize(directory, host, port):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if any(directory.iterdir()):
        raise RuntimeError('Initialization requires an empty data directory.')
    ip = ip_address(host)
    now = datetime.now(timezone.utc)
    ca_key, tls_key = generate_private_key(public_exponent=65537, key_size=3072), generate_private_key(public_exponent=65537, key_size=3072)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'StoryDream Private CA')])
    ca = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key())
          .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=3650))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False, data_encipherment=False,
                                      key_agreement=False, key_cert_sign=True, crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
          .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
          .sign(ca_key, hashes.SHA256()))
    leaf = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)]))
            .issuer_name(name).public_key(tls_key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ip)]), critical=False)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(tls_key.public_key()), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=True, data_encipherment=False,
                                        key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True).sign(ca_key, hashes.SHA256()))
    signing = Ed25519PrivateKey.generate()
    for filename, key in [('ca-key.pem', ca_key), ('tls-key.pem', tls_key), ('signing-key.pem', signing)]:
        with (directory / filename).open('xb') as file:
            os.chmod(file.name, 0o600)
            file.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    ca_pem = ca.public_bytes(serialization.Encoding.PEM).decode('ascii')
    (directory / 'ca.pem').write_text(ca_pem, 'ascii')
    (directory / 'tls.pem').write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
    secret = directory / 'secrets.json'
    secret.write_text(json.dumps({'codePepper': secrets.token_hex(32)}), 'ascii')
    os.chmod(secret, 0o600)
    public = {'schemaVersion': 1, 'baseUrl': f'https://{host}:{port}', 'caPem': ca_pem, 'signingPublicKey': public_pem(signing.public_key())}
    (directory / 'client-public.json').write_text(json.dumps(public, indent=2), 'ascii')
    LicenseStore(directory)
    return public


def renew_tls(directory):
    directory = Path(directory)
    public = json.loads((directory / 'client-public.json').read_text('ascii'))
    host = urlparse(public['baseUrl']).hostname
    now = datetime.now(timezone.utc)
    ca = x509.load_pem_x509_certificate((directory / 'ca.pem').read_bytes())
    if ca.not_valid_after_utc <= now + timedelta(days=366):
        raise RuntimeError('CA renewal requires a coordinated desktop trust update before expiration.')
    ca_key = serialization.load_pem_private_key((directory / 'ca-key.pem').read_bytes(), password=None)
    tls_key = serialization.load_pem_private_key((directory / 'tls-key.pem').read_bytes(), password=None)
    leaf = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)]))
            .issuer_name(ca.subject).public_key(tls_key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ip_address(host))]), critical=False)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(tls_key.public_key()), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=True, data_encipherment=False,
                                        key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True).sign(ca_key, hashes.SHA256()))
    temporary = directory / f'tls-{uuid.uuid4()}.tmp'
    try:
        with temporary.open('xb') as file:
            os.chmod(file.name, 0o600)
            file.write(leaf.public_bytes(serialization.Encoding.PEM))
            file.flush()
            os.fsync(file.fileno())
        temporary.replace(directory / 'tls.pem')
    finally:
        temporary.unlink(missing_ok=True)


def handler_for(store):
    class Handler(BaseHTTPRequestHandler):
        server_version, sys_version = 'StoryDreamLicense/1', ''

        def setup(self):
            self.request.settimeout(15)
            super().setup()

        def log_message(self, *args):
            pass

        def respond(self, value, status=200):
            data = json.dumps(value, separators=(',', ':')).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            try:
                self.connection.settimeout(15)
                if self.path not in ('/v1/license/activate', '/v1/license/refresh', '/v1/license/release'):
                    raise Rejected('NOT_FOUND', 404)
                store.rate_limit(self.client_address[0], self.path)
                length = int(self.headers.get('Content-Length', '0'))
                if not 1 <= length <= 16384 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise Rejected('INVALID_REQUEST', 400)
                raw = self.rfile.read(length)
                self.respond(store.request(self.path, json.loads(raw)))
            except Rejected as error:
                self.respond({'error': error.code}, error.status)
            except (ValueError, KeyError, UnicodeError, TypeError):
                self.respond({'error': 'INVALID_REQUEST'}, 400)
            except Exception:
                self.respond({'error': 'SERVER_UNAVAILABLE'}, 503)

        def do_GET(self):
            try:
                self.connection.settimeout(30)
                if self.path == '/v1/health':
                    return self.respond({'status': 'ok', 'protocol': 1})
                if self.path == '/v1/releases/latest':
                    return self.respond({'release': store.latest_release()})
                match = re.fullmatch(r'/v1/releases/files/(StoryDream-Setup-[0-9.]+-[a-f0-9]{12}\.exe)', self.path)
                if not match:
                    raise Rejected('NOT_FOUND', 404)
                filename = match[1]
                with closing(store.connect()) as db:
                    row = db.execute('SELECT 1 FROM releases WHERE filename=? AND withdrawn=0', (filename,)).fetchone()
                if not row:
                    raise Rejected('NOT_FOUND', 404)
                file = store.directory / 'releases' / filename
                size, offset = file.stat().st_size, 0
                if self.headers.get('Range'):
                    range_match = re.fullmatch(r'bytes=(\d+)-', self.headers['Range'])
                    if not range_match or int(range_match[1]) >= size:
                        raise Rejected('INVALID_RANGE', 416)
                    offset = int(range_match[1])
                self.send_response(206 if offset else 200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Length', str(size - offset))
                self.send_header('Accept-Ranges', 'bytes')
                if offset:
                    self.send_header('Content-Range', f'bytes {offset}-{size - 1}/{size}')
                self.end_headers()
                with file.open('rb') as stream:
                    stream.seek(offset)
                    while data := stream.read(1024 * 1024):
                        self.wfile.write(data)
            except Rejected as error:
                self.respond({'error': error.code}, error.status)
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass
    return Handler


class LicenseHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, address, store):
        self.slots = BoundedSemaphore(64)
        self.tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.tls.minimum_version = ssl.TLSVersion.TLSv1_2
        self.tls.load_cert_chain(store.directory / 'tls.pem', store.directory / 'tls-key.pem')
        super().__init__(address, handler_for(store))

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            request.settimeout(10)
            # Handshakes run in bounded workers, so a slow peer cannot block accept().
            secured = self.tls.wrap_socket(request, server_side=True)
            super().process_request_thread(secured, address)
        except (OSError, ssl.SSLError):
            request.close()
        finally:
            self.slots.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    init = sub.add_parser('init')
    init.add_argument('--host', required=True)
    init.add_argument('--port', type=int, default=8443)
    serve = sub.add_parser('serve')
    serve.add_argument('--bind', default='0.0.0.0')
    serve.add_argument('--port', type=int, default=8443)
    issue = sub.add_parser('issue')
    issue.add_argument('--days', type=int, default=365)
    issue.add_argument('--max-devices', type=int, default=1)
    issue.add_argument('--label', default='')
    for action in ('lock-device', 'unlock-device', 'release-device', 'revoke-license', 'restore-license'):
        operation = sub.add_parser(action)
        operation.add_argument('target')
        operation.add_argument('--reason', default='')
    for action in ('licenses', 'devices', 'audit'):
        sub.add_parser(action)
    publish = sub.add_parser('publish')
    publish.add_argument('--file', required=True)
    publish.add_argument('--version', required=True)
    publish.add_argument('--minimum-version', default='0.0.0')
    publish.add_argument('--notes', default='')
    withdraw = sub.add_parser('withdraw')
    withdraw.add_argument('version')
    backup = sub.add_parser('backup')
    backup.add_argument('destination')
    sub.add_parser('renew-tls')
    args = parser.parse_args()
    if args.command == 'init':
        print(json.dumps(initialize(args.data, args.host, args.port), indent=2))
        return
    store = LicenseStore(args.data)
    if args.command == 'serve':
        server = LicenseHTTPServer((args.bind, args.port), store)
        server.serve_forever()
    elif args.command == 'issue':
        print(json.dumps(store.issue(args.days, args.max_devices, args.label)))
    elif args.command in ('licenses', 'devices', 'audit'):
        queries = {'licenses': 'SELECT id,tail,label,days,max_devices,started_at,expires_at,revoked FROM licenses',
                   'devices': 'SELECT license_id,device_id,label,bound_at,last_seen,released FROM devices',
                   'audit': 'SELECT * FROM audit ORDER BY id DESC LIMIT 200'}
        with closing(store.connect()) as db:
            print(json.dumps([dict(row) for row in db.execute(queries[args.command])], indent=2))
    elif args.command == 'publish':
        print(json.dumps(store.publish(args.file, args.version, args.minimum_version, args.notes), indent=2))
    elif args.command == 'withdraw':
        with store.transaction() as db:
            db.execute('UPDATE releases SET withdrawn=1 WHERE version=?', (args.version,))
            store.audit(db, 'withdraw', args.version)
    elif args.command == 'backup':
        with closing(store.connect()) as source, closing(sqlite3.connect(args.destination)) as destination:
            source.backup(destination)
        os.chmod(args.destination, 0o600)
    elif args.command == 'renew-tls':
        renew_tls(args.data)
    else:
        store.operate(args.command, args.target, args.reason)


if __name__ == '__main__':
    main()
