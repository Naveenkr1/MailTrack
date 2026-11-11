#!/usr/bin/env bash
set -euo pipefail

# Oracle Cloud Always Free Tier (Ubuntu 22.04 / 24.04 — ARM64 Ampere A1 or AMD Micro)
# Bootstrap script for Mail Track (Node.js 20 + PM2 + Caddy HTTPS + OCI iptables rules)
#
# Usage:
#   chmod +x deploy/oci/setup-oci.sh
#   sudo ./deploy/oci/setup-oci.sh
#   sudo ./deploy/oci/setup-oci.sh --domain mailtrack.in
#   sudo ./deploy/oci/setup-oci.sh --domain 140.238.x.x.sslip.io

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_USER="${SUDO_USER:-$(whoami)}"
DOMAIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: sudo $0 [--domain <mailtrack.in | IP.sslip.io>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run with sudo: sudo $0 $*"
  exit 1
fi

echo "==> App directory: $APP_DIR (owner/runtime user: $APP_USER)"
echo "==> Architecture: $(uname -m)"

# 1. Add 2 GB swap file if none exists (prevents OOM on 1 GB RAM AMD Micro VMs during npm install)
if [[ "$(swapon --show | wc -l)" -eq 0 ]]; then
  echo "==> Creating 2 GB swapfile at /swapfile..."
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
else
  echo "==> Swap already enabled, skipping."
fi

# 2. System packages & build essentials
echo "==> Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg build-essential python3 debian-keyring debian-archive-keyring apt-transport-https

# 3. Install Node.js 20 LTS if missing or < 20
NEED_NODE=true
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ "$NODE_MAJOR" -ge 20 ]]; then
    NEED_NODE=false
  fi
fi

if [[ "$NEED_NODE" == "true" ]]; then
  echo "==> Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "==> Node.js $(node -v) already installed."
fi

# 4. Install PM2 globally
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing PM2..."
  npm install -g pm2
else
  echo "==> PM2 $(pm2 -v) already installed."
fi

# 5. Install Caddy (automatic HTTPS + WebSockets)
if ! command -v caddy >/dev/null 2>&1; then
  echo "==> Installing Caddy..."
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
else
  echo "==> Caddy $(caddy version) already installed."
fi

# 6. Open ports 80 & 443 in OCI Ubuntu iptables & persist across reboots
echo "==> Opening ports 80 and 443 in OS firewall (iptables)..."
apt-get install -y iptables-persistent netfilter-persistent

add_iptables_port() {
  local port="$1"
  if iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT >/dev/null 2>&1; then
    return 0
  fi
  if iptables -C INPUT -p tcp --dport "$port" -j ACCEPT >/dev/null 2>&1; then
    return 0
  fi
  # Insert before the default OCI REJECT line if present, otherwise append near top after ESTABLISHED
  local reject_line
  reject_line="$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')"
  if [[ -n "$reject_line" ]]; then
    iptables -I INPUT "$reject_line" -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
  else
    iptables -I INPUT 1 -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
  fi
}

add_iptables_port 80
add_iptables_port 443
netfilter-persistent save

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

# 7. Install Node dependencies as app owner
echo "==> Installing npm production dependencies in $APP_DIR..."
mkdir -p "$APP_DIR/server/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm install --omit=dev"

# 8. Bootstrap server/.env if not already present
ENV_FILE="$APP_DIR/server/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "==> Creating starter server/.env with generated JWT/session secrets..."
  JWT_VAL="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  SESS_VAL="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  BASE_VAL="https://${DOMAIN:-mailtrack.in}"

  sudo -u "$APP_USER" cp "$APP_DIR/server/.env.example" "$ENV_FILE"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_VAL}|" "$ENV_FILE"
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${SESS_VAL}|" "$ENV_FILE"
  sed -i "s|^BASE_URL=.*|BASE_URL=${BASE_VAL}|" "$ENV_FILE"
  sed -i "s|^DISABLE_TUNNEL=.*|DISABLE_TUNNEL=true|" "$ENV_FILE"
  sed -i "s|^ALLOW_DEV_LOGIN=.*|ALLOW_DEV_LOGIN=false|" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "    IMPORTANT: Edit $ENV_FILE to add your GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and TURSO credentials."
else
  echo "==> Existing $ENV_FILE preserved."
fi

# 9. Configure Caddy if --domain was specified
if [[ -n "$DOMAIN" ]]; then
  echo "==> Writing /etc/caddy/Caddyfile for domain: $DOMAIN"
  if [[ "$DOMAIN" == "mailtrack.in" ]]; then
    cp "$SCRIPT_DIR/Caddyfile" /etc/caddy/Caddyfile
  else
    cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
  encode zstd gzip

  reverse_proxy 127.0.0.1:4000 {
    header_up X-Real-IP {remote_host}
  }
}
EOF
  fi
  caddy validate --config /etc/caddy/Caddyfile
  systemctl enable --now caddy
  systemctl reload caddy
else
  echo "==> Skipping /etc/caddy/Caddyfile overwrite (no --domain flag passed)."
  echo "    When ready, run:"
  echo "      sudo cp '$SCRIPT_DIR/Caddyfile' /etc/caddy/Caddyfile && sudo systemctl reload caddy"
fi

# 10. Start / restart app with PM2 and enable boot persistence
echo "==> Starting Mail Track via PM2..."
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && pm2 startOrRestart deploy/oci/ecosystem.config.js && pm2 save"

APP_HOME="$(eval echo "~${APP_USER}")"
env PATH="$PATH:/usr/local/bin:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" || true

echo ""
echo "================================================================"
echo " Mail Track OCI Setup Complete"
echo "================================================================"
echo " 1) Verify/edit secrets:  nano $ENV_FILE"
echo " 2) Restart app:          pm2 restart mail-track"
echo " 3) Check logs:           pm2 logs mail-track"
echo " 4) Check health locally: curl -fsS http://127.0.0.1:4000/healthz"
echo " 5) Apply Caddyfile:      sudo cp '$SCRIPT_DIR/Caddyfile' /etc/caddy/Caddyfile && sudo systemctl reload caddy"
echo "================================================================"
