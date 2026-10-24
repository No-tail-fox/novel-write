#!/usr/bin/env bash
# Run from the extracted, reviewed bundle on a Debian/Ubuntu systemd host.
set -euo pipefail
umask 077
[[ ${EUID} -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
[[ $# -ge 1 && $# -le 2 ]] || { echo 'Usage: bash deploy.sh PUBLIC_IP [PORT]' >&2; exit 1; }
public_ip=$1
public_port=${2:-443}
bundle=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
code=/opt/storydream-license
data=/var/lib/storydream-license
unit=/etc/systemd/system/storydream-license.service
wrapper=/usr/local/sbin/storydream-license
command -v systemctl >/dev/null
command -v python3 >/dev/null
python3 -c 'import ipaddress,sys; ipaddress.ip_address(sys.argv[1]); assert sys.argv[2].isdigit() and 1 <= int(sys.argv[2]) <= 65535, "Invalid port"' "$public_ip" "$public_port"
[[ -f $bundle/server.py && -f $bundle/requirements.txt && -f $bundle/storydream-license.service ]]
for target in "$code" "$data" "$unit" "$wrapper"; do
  [[ ! -L $target ]] || { echo "Refusing symlink: $target" >&2; exit 1; }
done
if [[ -e $code && ! -f $code/.storydream-managed ]]; then
  echo 'Existing /opt/storydream-license is not managed by this installer.' >&2; exit 1
fi
if [[ -e $unit ]] && ! grep -q '^Description=StoryDream Licensing and Updates$' "$unit"; then
  echo 'Existing service has a different owner.' >&2; exit 1
fi
if [[ -e $wrapper ]] && ! cmp -s "$bundle/licensectl" "$wrapper"; then
  echo 'Existing operator command differs. Review it before replacing.' >&2; exit 1
fi
if systemctl is-active --quiet storydream-license; then
  echo 'Service is running. Back up and stop it during a maintenance window before redeploying.' >&2; exit 1
fi
if command -v ss >/dev/null && [[ -n $(ss -H -ltn "sport = :$public_port") ]]; then
  echo "Port $public_port is occupied. No changes were made." >&2; exit 1
fi
if [[ -e $data/secrets.json ]]; then
  python3 -c 'import json,sys; from pathlib import Path; from urllib.parse import urlparse; u=urlparse(json.loads(Path(sys.argv[1]).read_text())["baseUrl"]); assert u.scheme=="https" and u.hostname==sys.argv[2] and (u.port or 443)==int(sys.argv[3]), "Existing endpoint differs"' "$data/client-public.json" "$public_ip" "$public_port"
elif [[ -d $data && -n $(find "$data" -mindepth 1 -maxdepth 1 -print -quit) ]]; then
  echo 'Data directory is nonempty but incomplete. Restore it before deploying.' >&2; exit 1
fi
if getent passwd storydream-license >/dev/null; then
  account=$(getent passwd storydream-license)
  IFS=: read -r _ _ account_uid _ _ account_home account_shell <<< "$account"
  [[ $account_uid != 0 && $account_home == "$data" && $account_shell == /usr/sbin/nologin ]] || {
    echo 'Existing service account differs. Review it before deploying.' >&2; exit 1
  }
fi
if ! python3 -c 'import venv,ensurepip' 2>/dev/null; then
  command -v apt-get >/dev/null || { echo 'Install python3-venv first.' >&2; exit 1; }
  apt-get update
  apt-get install -y python3-venv
fi
getent passwd storydream-license >/dev/null || useradd --system --home-dir "$data" --shell /usr/sbin/nologin storydream-license
install -d -m 0755 -o root -g root "$code"
install -d -m 0700 -o storydream-license -g storydream-license "$data"
touch "$code/.storydream-managed"
umask 022
python3 -m venv "$code/venv"
"$code/venv/bin/python" -m pip install --disable-pip-version-check -r "$bundle/requirements.txt"
umask 077
install -m 0644 "$bundle/server.py" "$code/server.py"
install -m 0644 "$bundle/requirements.txt" "$code/requirements.txt"
install -m 0644 "$bundle/storydream-license.service" "$unit"
sed -i "s/--port 443$/--port $public_port/" "$unit"
install -m 0755 "$bundle/licensectl" "$wrapper"
if [[ ! -e $data/secrets.json ]]; then
  storydream-license init --host "$public_ip" --port "$public_port" >/dev/null
fi
systemctl daemon-reload
systemctl enable storydream-license
systemctl restart storydream-license
"$code/venv/bin/python" - "$public_ip" "$public_port" <<'PY'
import http.client
import json
import socket
import ssl
import sys
import time

host = sys.argv[1]
port = int(sys.argv[2])
context = ssl.create_default_context(cafile='/var/lib/storydream-license/ca.pem')

class LocalConnection(http.client.HTTPSConnection):
    def connect(self):
        self.sock = context.wrap_socket(socket.create_connection(('127.0.0.1', port), timeout=3), server_hostname=host)

for attempt in range(20):
    connection = LocalConnection(host, port, timeout=3)
    try:
        connection.request('GET', '/v1/health')
        response = connection.getresponse()
        body = response.read(131072)
        if response.status != 200 or json.loads(body).get('status') != 'ok':
            raise RuntimeError('Unexpected health response')
        print(body.decode())
        break
    except (OSError, http.client.HTTPException):
        if attempt == 19:
            raise
        time.sleep(1)
    finally:
        connection.close()
PY
systemctl is-active --quiet storydream-license
echo 'Public desktop trust configuration: /var/lib/storydream-license/client-public.json'
echo "Allow TCP $public_port in the host firewall and cloud security group; existing rules were not modified."
