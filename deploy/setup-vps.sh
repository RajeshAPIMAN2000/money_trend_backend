#!/usr/bin/env bash
# Money Trend — one-time Hostinger/Ubuntu VPS bootstrap
# Usage: sudo bash deploy/setup-vps.sh
set -euo pipefail

APP_ROOT="/var/www/moneytrend"
BACKEND_DIR="${APP_ROOT}/backend"
FRONTEND_DIR="${APP_ROOT}/frontend"
UPLOADS_DIR="${APP_ROOT}/uploads"
NODE_MAJOR=20

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/setup-vps.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Updating apt"
apt-get update -y
apt-get upgrade -y

echo "==> Installing base packages"
apt-get install -y curl ca-certificates gnupg ufw nginx mysql-server git rsync build-essential

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "${NODE_MAJOR}" ]]; then
  echo "==> Installing Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

echo "==> Installing PM2 globally"
npm install -g pm2

echo "==> Creating app directories"
mkdir -p "${BACKEND_DIR}" "${FRONTEND_DIR}" "${UPLOADS_DIR}"
chown -R www-data:www-data "${APP_ROOT}" || true

echo "==> Configuring UFW (22, 80, 443)"
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

echo "==> MySQL note"
echo "Create DB/user manually after this script, e.g.:"
echo "  sudo mysql"
echo "  CREATE DATABASE money_trend CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "  CREATE USER 'moneytrend'@'localhost' IDENTIFIED BY 'STRONG_PASSWORD';"
echo "  GRANT ALL PRIVILEGES ON money_trend.* TO 'moneytrend'@'localhost';"
echo "  FLUSH PRIVILEGES;"

echo "==> Done"
echo "Next:"
echo "  1. Upload backend to ${BACKEND_DIR}"
echo "  2. Copy deploy/env.production.example → ${BACKEND_DIR}/.env and edit"
echo "  3. npm ci --omit=dev && pm2 start deploy/ecosystem.config.cjs"
echo "  4. Build frontend into ${FRONTEND_DIR}"
echo "  5. Enable nginx site from deploy/nginx-moneytrend.conf"
echo "Node: $(node -v)  npm: $(npm -v)  pm2: $(pm2 -v)"
