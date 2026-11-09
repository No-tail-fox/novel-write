"""StoryDream machine licensing and signed release distribution.

Public endpoints use TLS. Operator commands run locally under the service user.
SQLite transactions serialize activation and seat allocation across HTTP threads.
"""

import argparse
import base64
import gzip
import hashlib
import hmac
import json
import io
import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import ssl
import time
import uuid
import zlib
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from getpass import getpass
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import ip_address
from pathlib import Path
from threading import BoundedSemaphore, Lock
from urllib.parse import parse_qs, urlparse

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.rsa import generate_private_key
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


ADMIN_PASSWORD_ITERATIONS = 310_000
ADMIN_SESSION_SECONDS = 8 * 60 * 60
MAX_INSTALLER_BYTES = 4 * 1024 ** 3
MAX_BLOCKMAP_BYTES = 8 * 1024 ** 2


def validate_blockmap(data, installer_size=None):
    try:
        if not 2 <= len(data) <= MAX_BLOCKMAP_BYTES:
            raise ValueError()
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
            raw = stream.read(32 * 1024 ** 2 + 1)
        if len(raw) > 32 * 1024 ** 2:
            raise ValueError()
        value = json.loads(raw)
        if value['version'] not in ('1', '2') or not isinstance(value['files'], list) or not 1 <= len(value['files']) <= 10000:
            raise ValueError()
        offset, names, blocks = 0, set(), 0
        for file in value['files']:
            name, sizes, checksums = file['name'], file['sizes'], file['checksums']
            if not isinstance(name, str) or not name or len(name) > 1024 or name in names or type(file['offset']) is not int or file['offset'] != offset:
                raise ValueError()
            names.add(name)
            if not isinstance(sizes, list) or not isinstance(checksums, list) or not sizes or len(sizes) != len(checksums):
                raise ValueError()
            blocks += len(sizes)
            if blocks > 262144 or any(type(size) is not int or size <= 0 for size in sizes):
                raise ValueError()
            if any(not isinstance(checksum, str) or not 1 <= len(checksum) <= 128 for checksum in checksums):
                raise ValueError()
            offset += sum(sizes)
        if offset > MAX_INSTALLER_BYTES or installer_size is not None and offset != installer_size:
            raise ValueError()
    except (ValueError, KeyError, TypeError, OSError, EOFError, UnicodeError, zlib.error) as error:
        raise Rejected('INVALID_BLOCKMAP', 400) from error


class Rejected(Exception):
    def __init__(self, code, status=403):
        self.code, self.status = code, status


def b64(data):
    return base64.b64encode(data).decode('ascii')


def utf16_length(value):
    return len(value.encode('utf-16-le', errors='surrogatepass')) // 2


def truncate_utf16(value, limit):
    return value.encode('utf-16-le', errors='surrogatepass')[:limit * 2].decode('utf-16-le', errors='ignore')


def set_admin_password(directory, password):
    if not isinstance(password, str) or len(password) < 14 or len(password) > 1024:
        raise ValueError('管理员密码必须为 14 到 1024 个字符。')
    directory = Path(directory)
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, ADMIN_PASSWORD_ITERATIONS)
    target = directory / 'admin-auth.json'
    temporary = directory / f'.admin-auth-{uuid.uuid4()}.tmp'
    payload = json.dumps({'version': 1, 'iterations': ADMIN_PASSWORD_ITERATIONS,
                          'salt': salt.hex(), 'passwordHash': digest.hex()})
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w', encoding='ascii') as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
        os.chmod(target, 0o600)
    finally:
        temporary.unlink(missing_ok=True)


def verify_admin_password(directory, password):
    try:
        record = json.loads((Path(directory) / 'admin-auth.json').read_text('ascii'))
        iterations = record['iterations']
        salt = bytes.fromhex(record['salt'])
        expected = bytes.fromhex(record['passwordHash'])
        if record['version'] != 1 or not 100_000 <= iterations <= 1_000_000 or len(salt) != 16 or len(expected) != 32:
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, AttributeError):
        return False


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
                CREATE TABLE IF NOT EXISTS release_differentials (
                  sequence INTEGER PRIMARY KEY REFERENCES releases(sequence), metadata TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS announcements (
                  id TEXT PRIMARY KEY, category TEXT NOT NULL CHECK(category IN ('update','problem')),
                  title TEXT NOT NULL, body TEXT NOT NULL, version TEXT, created_at INTEGER NOT NULL,
                  withdrawn INTEGER NOT NULL DEFAULT 0);
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
            limit = 15 if path.endswith('/activate') else 8 if path.endswith('/admin/api/login') else 120
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

    def publish(self, source, version, minimum_version, notes, blockmap=None):
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
        sha512 = hashlib.sha512()
        blockmap_target = directory / f'{filename}.blockmap'
        try:
            with source.open('rb') as src, target.open('xb') as dst:
                while block := src.read(1024 * 1024):
                    dst.write(block)
                    digest.update(block)
                    sha512.update(block)
                    size += len(block)
                dst.flush()
                os.fsync(dst.fileno())
            with target.open('rb') as header:
                magic = header.read(2)
            if size < 2 or size > 4 * 1024 ** 3 or magic != b'MZ':
                raise Rejected('INVALID_WINDOWS_INSTALLER', 400)
            blockmap_info = None
            if blockmap is not None:
                with Path(blockmap).open('rb') as stream:
                    data = stream.read(MAX_BLOCKMAP_BYTES + 1)
                validate_blockmap(data, size)
                with blockmap_target.open('xb') as output:
                    output.write(data)
                    output.flush()
                    os.fsync(output.fileno())
                blockmap_info = {'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}
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
                if blockmap_info:
                    metadata = {'sha512': base64.b64encode(sha512.digest()).decode(), 'blockmap': blockmap_info}
                    db.execute('INSERT INTO release_differentials(sequence,metadata) VALUES(?,?)', (cursor.lastrowid, json.dumps(metadata)))
                announcement_body = truncate_utf16(notes.strip(), 2000).strip()
                db.execute('INSERT INTO announcements(id,category,title,body,version,created_at) VALUES(?,?,?,?,?,?)',
                           (str(uuid.uuid4()), 'update', f'StoryDream {version} 已发布', announcement_body or f'StoryDream {version} 现已发布。', version, now))
                self.audit(db, 'publish', version)
            return envelope
        except BaseException:
            target.unlink(missing_ok=True)
            blockmap_target.unlink(missing_ok=True)
            raise

    def differential_release(self, filename):
        with closing(self.connect()) as db:
            row = db.execute('SELECT r.manifest,d.metadata FROM releases r JOIN release_differentials d ON d.sequence=r.sequence WHERE r.filename=? AND r.withdrawn=0', (filename,)).fetchone()
        if not row:
            raise Rejected('NOT_FOUND', 404)
        release = json.loads(json.loads(row['manifest'])['payload'])
        payload = {key: release[key] for key in ('sequence', 'version', 'filename', 'sha256', 'size')}
        payload.update(json.loads(row['metadata']))
        now = int(self.clock())
        return self.signed(dict(payload, schemaVersion=1, kind='differential', issuedAt=now, validUntil=now + 86400))

    def latest_release(self):
        with closing(self.connect()) as db:
            # A withdrawn latest release must never make an older release the new latest.
            row = db.execute('SELECT * FROM releases ORDER BY sequence DESC LIMIT 1').fetchone()
            if not row or row['withdrawn']:
                return None
            payload = json.loads(json.loads(row['manifest'])['payload'])
            payload.update(issuedAt=int(self.clock()), validUntil=int(self.clock()) + 86400)
            return self.signed(payload)

    def announce(self, title, body):
        title, body = title.strip(), body.strip()
        if not title or utf16_length(title) > 120 or not body or utf16_length(body) > 2000:
            raise Rejected('INVALID_ANNOUNCEMENT', 400)
        identity, now = str(uuid.uuid4()), int(self.clock())
        with self.transaction() as db:
            db.execute('INSERT INTO announcements(id,category,title,body,version,created_at) VALUES(?,?,?,?,NULL,?)',
                       (identity, 'problem', title, body, now))
            self.audit(db, 'announce', identity, title)
        return identity

    def withdraw_announcement(self, identity):
        with self.transaction() as db:
            row = db.execute('SELECT category FROM announcements WHERE id=?', (identity,)).fetchone()
            if not row:
                raise Rejected('ANNOUNCEMENT_NOT_FOUND', 404)
            if row['category'] != 'problem':
                raise Rejected('UPDATE_ANNOUNCEMENT_MANAGED_BY_RELEASE', 409)
            db.execute('UPDATE announcements SET withdrawn=1 WHERE id=?', (identity,))
            self.audit(db, 'withdraw-announcement', identity)

    def admin_announcements(self):
        with closing(self.connect()) as db:
            rows = db.execute('SELECT id,category,title,body,version,created_at,withdrawn FROM announcements ORDER BY created_at DESC,rowid DESC LIMIT 200').fetchall()
        return [dict(row) for row in rows]

    def withdraw_release(self, version):
        version_tuple(version)
        with self.transaction() as db:
            if not db.execute('SELECT 1 FROM releases WHERE version=?', (version,)).fetchone():
                raise Rejected('RELEASE_NOT_FOUND', 404)
            db.execute('UPDATE releases SET withdrawn=1 WHERE version=?', (version,))
            db.execute("UPDATE announcements SET withdrawn=1 WHERE version=? AND category='update'", (version,))
            self.audit(db, 'withdraw', version)

    def extend_license(self, identity, days):
        if type(days) is not int or not 1 <= days <= 36500:
            raise Rejected('INVALID_LICENSE_PARAMETERS', 400)
        with self.transaction() as db:
            row = db.execute('SELECT * FROM licenses WHERE id=?', (identity,)).fetchone()
            if not row:
                raise Rejected('LICENSE_NOT_FOUND', 404)
            if row['days'] + days > 36500:
                raise Rejected('INVALID_LICENSE_PARAMETERS', 400)
            expires = None if row['started_at'] is None else max(int(self.clock()), row['expires_at']) + days * 86400
            db.execute('UPDATE licenses SET days=days+?,expires_at=? WHERE id=?', (days, expires, identity))
            self.audit(db, 'extend-license', identity, str(days))

    def admin_summary(self):
        with closing(self.connect()) as db:
            latest = db.execute('SELECT version,withdrawn FROM releases ORDER BY sequence DESC LIMIT 1').fetchone()
            return {'licenses': db.execute('SELECT count(*) FROM licenses').fetchone()[0],
                    'devices': db.execute('SELECT count(*) FROM devices WHERE released=0').fetchone()[0],
                    'blockedDevices': db.execute('SELECT count(*) FROM blocked_devices').fetchone()[0],
                    'announcements': db.execute('SELECT count(*) FROM announcements WHERE withdrawn=0').fetchone()[0],
                    'latestRelease': dict(latest) if latest else None, 'serverTime': int(self.clock())}

    def admin_list(self, kind, query='', page=1):
        if type(page) is not int or not 1 <= page <= 100000 or len(query) > 200:
            raise Rejected('INVALID_REQUEST', 400)
        specs = {
            'licenses': ("licenses l", "l.id,l.tail,l.label,l.days,l.max_devices,l.created_at,l.started_at,l.expires_at,l.revoked,(SELECT count(*) FROM devices d WHERE d.license_id=l.id AND d.released=0) AS seats", "l.id LIKE ? OR l.label LIKE ? OR l.tail LIKE ?", 'l.created_at DESC,l.rowid DESC'),
            'devices': ("devices d JOIN licenses l ON l.id=d.license_id LEFT JOIN blocked_devices b ON b.device_id=d.device_id", "d.license_id,d.device_id,d.label,d.bound_at,d.last_seen,d.released,l.label AS license_label,l.tail,CASE WHEN b.device_id IS NULL THEN 0 ELSE 1 END AS locked,b.reason AS lock_reason", "d.device_id LIKE ? OR d.label LIKE ? OR l.label LIKE ?", 'd.last_seen DESC,d.rowid DESC'),
            'releases': ('releases', 'version,manifest,withdrawn', 'version LIKE ?', 'sequence DESC'),
            'audit': ('audit', 'id,at,action,target,detail', 'action LIKE ? OR target LIKE ? OR detail LIKE ?', 'id DESC'),
        }
        if kind not in specs:
            raise Rejected('NOT_FOUND', 404)
        table, columns, where, order = specs[kind]
        arguments = [f'%{query}%'] * where.count('?')
        with closing(self.connect()) as db:
            total = db.execute(f'SELECT count(*) FROM {table} WHERE {where}', arguments).fetchone()[0]
            rows = db.execute(f'SELECT {columns} FROM {table} WHERE {where} ORDER BY {order} LIMIT 50 OFFSET ?',
                              [*arguments, (page - 1) * 50]).fetchall()
        items = [dict(row) for row in rows]
        if kind == 'releases':
            for item in items:
                item.update(json.loads(json.loads(item.pop('manifest'))['payload']))
        return {'items': items, 'total': total, 'page': page, 'pageSize': 50}

    def latest_announcements(self):
        with closing(self.connect()) as db:
            rows = db.execute('SELECT id,category,title,body,version,created_at FROM announcements WHERE withdrawn=0 ORDER BY created_at DESC,rowid DESC LIMIT 8').fetchall()
        return [self.signed({'schemaVersion': 1, 'kind': 'announcement', 'id': row['id'],
                             'category': row['category'], 'title': row['title'], 'body': row['body'],
                             'version': row['version'], 'createdAt': row['created_at']}) for row in rows]


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
    admin_sessions = {}
    admin_sessions_lock = Lock()
    admin_upload_lock = Lock()
    admin_root = (Path(__file__).with_name('admin-dist')).resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version, sys_version = 'StoryDreamLicense/1', ''

        def setup(self):
            self.request.settimeout(15)
            super().setup()

        def log_message(self, *args):
            pass

        def respond(self, value, status=200, headers=None):
            data = json.dumps(value, separators=(',', ':')).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Referrer-Policy', 'no-referrer')
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)

        def read_json(self, maximum):
            length = int(self.headers.get('Content-Length', '0'))
            if not 1 <= length <= maximum or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise Rejected('INVALID_REQUEST', 400)
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise Rejected('INVALID_REQUEST', 400)
            return value

        def admin_token(self):
            cookies = SimpleCookie()
            try:
                cookies.load(self.headers.get('Cookie', ''))
            except Exception:
                return None
            morsel = cookies.get('storydream_admin')
            if not morsel:
                return None
            token = morsel.value
            with admin_sessions_lock:
                expires = admin_sessions.get(token)
                if expires is None:
                    return None
                if expires <= time.time():
                    admin_sessions.pop(token, None)
                    return None
            return token

        def require_admin(self):
            if self.admin_token():
                return True
            self.respond({'error': 'ADMIN_AUTH_REQUIRED'}, 401)
            return False

        def require_same_origin(self):
            origin = urlparse(self.headers.get('Origin', ''))
            host = self.headers.get('Host', '').lower()
            if origin.scheme != 'https' or origin.netloc.lower() != host:
                raise Rejected('INVALID_ORIGIN', 403)

        def serve_admin_file(self, relative):
            try:
                file = (admin_root / relative).resolve()
                file.relative_to(admin_root)
            except (OSError, ValueError):
                raise Rejected('NOT_FOUND', 404)
            if not file.is_file():
                raise Rejected('ADMIN_UI_NOT_BUILT', 503)
            data = file.read_bytes()
            content_type = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def admin_get(self, path):
            if path == '/admin/api/summary':
                if not self.require_admin():
                    return
                return self.respond(store.admin_summary())
            if path in ('/admin/api/licenses', '/admin/api/devices', '/admin/api/releases', '/admin/api/audit'):
                if not self.require_admin():
                    return
                query = parse_qs(urlparse(self.path).query)
                return self.respond(store.admin_list(path.rsplit('/', 1)[1], query.get('q', [''])[0], int(query.get('page', ['1'])[0])))
            if path == '/admin/api/session':
                if not self.require_admin():
                    return
                return self.respond({'authenticated': True})
            if path == '/admin/api/announcements':
                if not self.require_admin():
                    return
                return self.respond({'announcements': store.admin_announcements()})
            if path == '/admin/':
                return self.serve_admin_file('index.html')
            if re.fullmatch(r'/admin/[A-Za-z0-9._-]+', path):
                return self.serve_admin_file(path.removeprefix('/admin/'))
            raise Rejected('NOT_FOUND', 404)

        def upload_installer(self, blockmap=False):
            length = int(self.headers.get('Content-Length', '0'))
            if not 2 <= length <= (MAX_BLOCKMAP_BYTES if blockmap else MAX_INSTALLER_BYTES) or self.headers.get('Content-Type') != 'application/octet-stream':
                raise Rejected('INVALID_BLOCKMAP' if blockmap else 'INVALID_INSTALLER_UPLOAD', 400)
            if not admin_upload_lock.acquire(blocking=False):
                raise Rejected('UPLOAD_BUSY', 409)
            temporary = None
            try:
                directory = store.directory / 'admin-uploads'
                directory.mkdir(mode=0o700, exist_ok=True)
                for stale in directory.iterdir():
                    if re.fullmatch(r'[a-f0-9]{32}\.(exe|blockmap|part)', stale.name) and stale.stat().st_mtime < time.time() - 86400:
                        stale.unlink()
                if shutil.disk_usage(directory).free < length * 2 + 256 * 1024 ** 2:
                    raise Rejected('INSUFFICIENT_DISK_SPACE', 409)
                identity = uuid.uuid4().hex
                temporary = directory / f'{identity}.part'
                self.connection.settimeout(60)
                remaining, digest = length, hashlib.sha256()
                with temporary.open('xb') as output:
                    os.chmod(temporary, 0o600)
                    while remaining:
                        block = self.rfile.read(min(1024 * 1024, remaining))
                        if not block:
                            raise Rejected('INCOMPLETE_UPLOAD', 400)
                        if not blockmap and remaining == length and block[:2] != b'MZ':
                            raise Rejected('INVALID_WINDOWS_INSTALLER', 400)
                        output.write(block)
                        digest.update(block)
                        remaining -= len(block)
                    output.flush()
                    os.fsync(output.fileno())
                if blockmap:
                    validate_blockmap(temporary.read_bytes())
                temporary.replace(directory / f'{identity}.{"blockmap" if blockmap else "exe"}')
                return self.respond({'uploadId': identity, 'size': length, 'sha256': digest.hexdigest()}, 201)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
                admin_upload_lock.release()

        def admin_post(self, path):
            self.require_same_origin()
            if path == '/admin/api/login':
                store.rate_limit(self.client_address[0], path)
                body = self.read_json(4096)
                password = body.get('password')
                if not isinstance(password, str) or len(password) > 1024:
                    raise Rejected('INVALID_CREDENTIALS', 401)
                if not (store.directory / 'admin-auth.json').is_file():
                    raise Rejected('ADMIN_LOGIN_NOT_CONFIGURED', 503)
                if not verify_admin_password(store.directory, password):
                    raise Rejected('INVALID_CREDENTIALS', 401)
                token = secrets.token_urlsafe(32)
                now = time.time()
                with admin_sessions_lock:
                    for current, expires in list(admin_sessions.items()):
                        if expires <= now:
                            admin_sessions.pop(current, None)
                    admin_sessions[token] = now + ADMIN_SESSION_SECONDS
                cookie = f'storydream_admin={token}; Path=/admin/api; Max-Age={ADMIN_SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict'
                return self.respond({'authenticated': True}, headers={'Set-Cookie': cookie})
            if path == '/admin/api/logout':
                token = self.admin_token()
                if not token:
                    return self.respond({'error': 'ADMIN_AUTH_REQUIRED'}, 401)
                with admin_sessions_lock:
                    admin_sessions.pop(token, None)
                cookie = 'storydream_admin=; Path=/admin/api; Max-Age=0; Secure; HttpOnly; SameSite=Strict'
                return self.respond({'authenticated': False}, headers={'Set-Cookie': cookie})
            if not self.require_admin():
                return
            if path == '/admin/api/uploads':
                return self.upload_installer()
            if path == '/admin/api/uploads/blockmap':
                return self.upload_installer(blockmap=True)
            if path == '/admin/api/licenses':
                body = self.read_json(4096)
                days, seats, label = body.get('days'), body.get('maxDevices'), body.get('label', '')
                if type(days) is not int or type(seats) is not int or not isinstance(label, str):
                    raise Rejected('INVALID_LICENSE_PARAMETERS', 400)
                return self.respond(store.issue(days, seats, label), 201)
            match = re.fullmatch(r'/admin/api/licenses/([a-f0-9-]{36})/(revoke|restore|extend)', path)
            if match:
                if match[2] == 'extend':
                    store.extend_license(match[1], self.read_json(1024).get('days'))
                else:
                    store.operate(f'{match[2]}-license', match[1])
                return self.respond({'ok': True})
            match = re.fullmatch(r'/admin/api/devices/([a-f0-9]{64})/(lock|unlock|release)', path)
            if match:
                body = self.read_json(4096)
                reason = body.get('reason', '')
                if not isinstance(reason, str) or len(reason) > 500:
                    raise Rejected('INVALID_REQUEST', 400)
                with closing(store.connect()) as db:
                    if not db.execute('SELECT 1 FROM devices WHERE device_id=?', (match[1],)).fetchone():
                        raise Rejected('DEVICE_NOT_FOUND', 404)
                store.operate(f'{match[2]}-device', match[1], reason)
                return self.respond({'ok': True})
            if path == '/admin/api/releases':
                body = self.read_json(40_000)
                identity, notes = body.get('uploadId'), body.get('notes', '')
                blockmap_id = body.get('blockmapUploadId')
                if blockmap_id is not None and (not isinstance(blockmap_id, str) or not re.fullmatch(r'[a-f0-9]{32}', blockmap_id)):
                    raise Rejected('INVALID_RELEASE', 400)
                version, minimum = body.get('version'), body.get('minimumVersion', '0.0.0')
                if not isinstance(identity, str) or not re.fullmatch(r'[a-f0-9]{32}', identity) or not isinstance(notes, str):
                    raise Rejected('INVALID_RELEASE', 400)
                version_tuple(version)
                version_tuple(minimum)
                if not admin_upload_lock.acquire(blocking=False):
                    raise Rejected('UPLOAD_BUSY', 409)
                try:
                    source = store.directory / 'admin-uploads' / f'{identity}.exe'
                    blockmap_source = source.parent / f'{blockmap_id}.blockmap' if blockmap_id else None
                    if not source.is_file():
                        raise Rejected('UPLOAD_NOT_FOUND', 404)
                    if blockmap_source and not blockmap_source.is_file():
                        raise Rejected('UPLOAD_NOT_FOUND', 404)
                    if shutil.disk_usage(source.parent).free < source.stat().st_size + 256 * 1024 ** 2:
                        raise Rejected('INSUFFICIENT_DISK_SPACE', 409)
                    release = store.publish(source, version, minimum, notes, blockmap_source)
                    source.unlink()
                    if blockmap_source:
                        blockmap_source.unlink()
                    return self.respond({'release': release}, 201)
                finally:
                    admin_upload_lock.release()
            match = re.fullmatch(r'/admin/api/releases/([0-9.]+)/withdraw', path)
            if match:
                store.withdraw_release(match[1])
                return self.respond({'withdrawn': True})
            if path == '/admin/api/announcements':
                body = self.read_json(16_384)
                title, message = body.get('title'), body.get('body')
                if not isinstance(title, str) or not isinstance(message, str):
                    raise Rejected('INVALID_ANNOUNCEMENT', 400)
                identity = store.announce(title, message)
                return self.respond({'id': identity}, 201)
            match = re.fullmatch(r'/admin/api/announcements/([a-f0-9-]{36})/withdraw', path)
            if match:
                store.withdraw_announcement(match[1])
                return self.respond({'withdrawn': True})
            raise Rejected('NOT_FOUND', 404)

        def do_POST(self):
            try:
                self.connection.settimeout(15)
                admin_path = urlparse(self.path).path
                if admin_path.startswith('/admin/api/'):
                    return self.admin_post(admin_path)
                if self.path not in ('/v1/license/activate', '/v1/license/refresh', '/v1/license/release'):
                    raise Rejected('NOT_FOUND', 404)
                store.rate_limit(self.client_address[0], self.path)
                self.respond(store.request(self.path, self.read_json(16384)))
            except Rejected as error:
                self.respond({'error': error.code}, error.status)
            except (ValueError, KeyError, UnicodeError, TypeError):
                self.respond({'error': 'INVALID_REQUEST'}, 400)
            except Exception:
                self.respond({'error': 'SERVER_UNAVAILABLE'}, 503)

        def do_GET(self):
            try:
                self.connection.settimeout(30)
                admin_path = urlparse(self.path).path
                if admin_path == '/admin':
                    self.send_response(308)
                    self.send_header('Location', '/admin/')
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    return
                if admin_path.startswith('/admin/'):
                    return self.admin_get(admin_path)
                if self.path == '/v1/health':
                    return self.respond({'status': 'ok', 'protocol': 1})
                if self.path == '/v1/releases/latest':
                    return self.respond({'release': store.latest_release(), 'announcements': store.latest_announcements()})
                metadata_match = re.fullmatch(r'/v1/releases/differential/(StoryDream-Setup-[0-9.]+-[a-f0-9]{12}\.exe)', self.path)
                if metadata_match:
                    return self.respond({'differential': store.differential_release(metadata_match[1])})
                match = re.fullmatch(r'/v1/releases/files/(StoryDream-Setup-[0-9.]+-[a-f0-9]{12}\.exe)(\.blockmap)?', self.path)
                if not match:
                    raise Rejected('NOT_FOUND', 404)
                filename = match[1]
                with closing(store.connect()) as db:
                    row = db.execute('SELECT 1 FROM releases WHERE filename=? AND withdrawn=0', (filename,)).fetchone()
                if not row:
                    raise Rejected('NOT_FOUND', 404)
                file = store.directory / 'releases' / (filename + (match[2] or ''))
                if not file.is_file() or file.is_symlink():
                    raise Rejected('NOT_FOUND', 404)
                size, offset = file.stat().st_size, 0
                end = size - 1
                ranged = self.headers.get('Range') is not None
                if ranged:
                    range_match = re.fullmatch(r'bytes=(\d+)-(\d*)', self.headers['Range'])
                    if not range_match or int(range_match[1]) >= size:
                        return self.respond({'error': 'INVALID_RANGE'}, 416,
                                            {'Content-Range': f'bytes */{size}', 'Accept-Ranges': 'bytes'})
                    offset = int(range_match[1])
                    if range_match[2]:
                        end = min(int(range_match[2]), size - 1)
                    if end < offset:
                        return self.respond({'error': 'INVALID_RANGE'}, 416,
                                            {'Content-Range': f'bytes */{size}', 'Accept-Ranges': 'bytes'})
                self.send_response(206 if ranged else 200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Length', str(end - offset + 1))
                self.send_header('Accept-Ranges', 'bytes')
                if ranged:
                    self.send_header('Content-Range', f'bytes {offset}-{end}/{size}')
                self.end_headers()
                with file.open('rb') as stream:
                    stream.seek(offset)
                    remaining = end - offset + 1
                    while remaining:
                        data = stream.read(min(1024 * 1024, remaining))
                        if not data:
                            break
                        self.wfile.write(data)
                        remaining -= len(data)
            except Rejected as error:
                self.respond({'error': error.code}, error.status)
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass
            except (ValueError, KeyError, TypeError):
                self.respond({'error': 'INVALID_REQUEST'}, 400)
            except Exception:
                self.respond({'error': 'SERVER_UNAVAILABLE'}, 503)
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
    publish.add_argument('--blockmap', help='Matching electron-builder .exe.blockmap (optional)')
    publish.add_argument('--version', required=True)
    publish.add_argument('--minimum-version', default='0.0.0')
    publish.add_argument('--notes', default='')
    withdraw = sub.add_parser('withdraw')
    withdraw.add_argument('version')
    announce = sub.add_parser('announce')
    announce.add_argument('--title', required=True)
    announce.add_argument('--body', required=True)
    withdraw_notice = sub.add_parser('withdraw-announcement')
    withdraw_notice.add_argument('id')
    sub.add_parser('announcements')
    sub.add_parser('set-admin-password')
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
    elif args.command == 'set-admin-password':
        password = getpass('New admin password (at least 14 characters): ')
        confirmation = getpass('Confirm admin password: ')
        if password != confirmation:
            raise SystemExit('Passwords do not match; no changes were made.')
        set_admin_password(store.directory, password)
        print('Admin password updated.')
    elif args.command == 'issue':
        print(json.dumps(store.issue(args.days, args.max_devices, args.label)))
    elif args.command in ('licenses', 'devices', 'audit'):
        queries = {'licenses': 'SELECT id,tail,label,days,max_devices,started_at,expires_at,revoked FROM licenses',
                   'devices': 'SELECT license_id,device_id,label,bound_at,last_seen,released FROM devices',
                   'audit': 'SELECT * FROM audit ORDER BY id DESC LIMIT 200'}
        with closing(store.connect()) as db:
            print(json.dumps([dict(row) for row in db.execute(queries[args.command])], indent=2))
    elif args.command == 'publish':
        print(json.dumps(store.publish(args.file, args.version, args.minimum_version, args.notes, args.blockmap), indent=2))
    elif args.command == 'withdraw':
        store.withdraw_release(args.version)
    elif args.command == 'announce':
        print(store.announce(args.title, args.body))
    elif args.command == 'withdraw-announcement':
        store.withdraw_announcement(args.id)
    elif args.command == 'announcements':
        with closing(store.connect()) as db:
            print(json.dumps([dict(row) for row in db.execute('SELECT id,category,title,body,version,created_at,withdrawn FROM announcements ORDER BY created_at DESC,rowid DESC')], indent=2, ensure_ascii=False))
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
