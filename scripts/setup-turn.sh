#!/usr/bin/env bash
# NextDesk one-click TURN relay setup (coturn).
#
# Installs and configures coturn on this Linux host so WebRTC calls work
# reliably even behind symmetric carrier/home NATs, opens firewall ports,
# and writes TURN_URL / TURN_USERNAME / TURN_CREDENTIAL into NextDesk's .env
# WITHOUT overwriting any existing non-empty TURN values.
#
# Usage:
#   sudo bash scripts/setup-turn.sh [--env-file /path/to/.env] [--external-ip x.x.x.x] [--realm example.com]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
EXTERNAL_IP=""
REALM=""
TURN_PORT=3478
MIN_PORT=49152
MAX_PORT=65535

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --external-ip)
      EXTERNAL_IP="$2"
      shift 2
      ;;
    --realm)
      REALM="$2"
      shift 2
      ;;
    --port)
      TURN_PORT="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: sudo bash scripts/setup-turn.sh [--env-file PATH] [--external-ip IP] [--realm DOMAIN] [--port 3478]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run as root (e.g. sudo bash scripts/setup-turn.sh)." >&2
  exit 1
fi

echo "==> NextDesk TURN Relay Setup (coturn)"

if [[ -z "${EXTERNAL_IP}" ]]; then
  for url in "https://api.ipify.org" "https://ifconfig.me/ip" "https://icanhazip.com"; do
    candidate="$(curl -4fsS --max-time 6 "${url}" 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ "${candidate}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      EXTERNAL_IP="${candidate}"
      break
    fi
  done
fi

if [[ -z "${EXTERNAL_IP}" ]]; then
  echo "Could not auto-detect public IPv4 address. Pass --external-ip <IP>." >&2
  exit 1
fi

if [[ -z "${REALM}" ]]; then
  REALM="${EXTERNAL_IP}"
fi

echo "    Public IP : ${EXTERNAL_IP}"
echo "    Realm     : ${REALM}"
echo "    Env file  : ${ENV_FILE}"

if ! command -v turnserver >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "==> Installing coturn via apt-get..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq coturn openssl
  elif command -v dnf >/dev/null 2>&1; then
    echo "==> Installing coturn via dnf..."
    dnf install -y -q coturn openssl
  else
    echo "Unsupported package manager. Install 'coturn' manually and re-run." >&2
    exit 1
  fi
fi

read_env_val() {
  local key="$1"
  if [[ -f "${ENV_FILE}" ]]; then
    grep -E "^[[:space:]]*${key}=" "${ENV_FILE}" | tail -n 1 | cut -d'=' -f2- | sed -E 's/^[[:space:]]*"?|"?[[:space:]]*$//g' || true
  fi
}

EXISTING_URL="$(read_env_val TURN_URL)"
EXISTING_USER="$(read_env_val TURN_USERNAME)"
EXISTING_CRED="$(read_env_val TURN_CREDENTIAL)"

GEN_USER="${EXISTING_USER:-nextdesk_$(openssl rand -hex 4)}"
GEN_CRED="${EXISTING_CRED:-$(openssl rand -hex 20)}"
GEN_URL="${EXISTING_URL:-turn:${EXTERNAL_IP}:${TURN_PORT}}"

if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
fi

cat > /etc/turnserver.conf <<EOF
# Managed by NextDesk scripts/setup-turn.sh
listening-port=${TURN_PORT}
external-ip=${EXTERNAL_IP}
realm=${REALM}
fingerprint
lt-cred-mech
user=${GEN_USER}:${GEN_CRED}
min-port=${MIN_PORT}
max-port=${MAX_PORT}
no-cli
no-multicast-peers
no-loopback-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
stale-nonce=600
total-quota=100
bps-capacity=0
syslog
EOF
chmod 640 /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf 2>/dev/null || true

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "==> Opening TURN ports in UFW..."
  ufw allow "${TURN_PORT}/udp" >/dev/null 2>&1 || true
  ufw allow "${TURN_PORT}/tcp" >/dev/null 2>&1 || true
  ufw allow "${MIN_PORT}:${MAX_PORT}/udp" >/dev/null 2>&1 || true
fi

echo "==> Starting coturn service..."
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn

upsert_env_if_empty() {
  local key="$1"
  local val="$2"
  touch "${ENV_FILE}"
  local current
  current="$(read_env_val "${key}")"
  if [[ -n "${current}" ]]; then
    echo "    Keeping existing non-empty ${key} in ${ENV_FILE}"
    return 0
  fi
  if grep -qE "^[[:space:]]*#?[[:space:]]*${key}=" "${ENV_FILE}"; then
    sed -i -E "s|^[[:space:]]*#?[[:space:]]*${key}=.*|${key}=${val}|" "${ENV_FILE}"
  else
    printf '\n%s=%s\n' "${key}" "${val}" >> "${ENV_FILE}"
  fi
  echo "    Set ${key} in ${ENV_FILE}"
}

echo "==> Updating ${ENV_FILE}..."
upsert_env_if_empty "TURN_URL" "${GEN_URL}"
upsert_env_if_empty "TURN_USERNAME" "${GEN_USER}"
upsert_env_if_empty "TURN_CREDENTIAL" "${GEN_CRED}"

echo ""
echo "TURN relay is active on ${EXTERNAL_IP}:${TURN_PORT} (UDP/TCP, relay ${MIN_PORT}-${MAX_PORT}/UDP)."
echo "Restart NextDesk so the server picks up the new TURN credentials."
