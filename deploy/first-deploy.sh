#!/usr/bin/env bash
# First-time deploy ON the Hostinger VPS (run after uploading backend files)
# Usage: sudo bash deploy/first-deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_ROOT="/var/www/moneytrend"
FRONTEND_DIR="${APP_ROOT}/frontend"

cd "${BACKEND_DIR}"

if [[ ! -f .env ]]; then
  echo "==> Creating .env from deploy/env.production.example"
  cp deploy/env.production.example .env
  echo "EDIT ${BACKEND_DIR}/.env before going live (DB, JWT, CORS, Razorpay, SMS)."
fi

mkdir -p logs "${APP_ROOT}/uploads"

echo "==> npm install (production)"
npm ci --omit=dev

echo "==> PM2 start (production env)"
mkdir -p /var/log/pm2 logs
pm2 startOrReload deploy/ecosystem.config.cjs --env production --update-env
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || pm2 startup || true

if [[ -d "${FRONTEND_DIR}" && -f "${FRONTEND_DIR}/index.html" ]]; then
  echo "==> Frontend static files found at ${FRONTEND_DIR}"
else
  echo "==> No frontend yet — upload Fintech dist/ to ${FRONTEND_DIR}"
fi

if [[ ! -f /etc/nginx/sites-enabled/moneytrend ]]; then
  echo "==> Enabling nginx site (edit server_name in deploy/nginx-moneytrend.conf first)"
  cp deploy/nginx-moneytrend.conf /etc/nginx/sites-available/moneytrend
  ln -sf /etc/nginx/sites-available/moneytrend /etc/nginx/sites-enabled/moneytrend
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
fi

echo "==> Health check"
sleep 2
curl -fsS "http://127.0.0.1:5001/api/health" && echo
echo "First deploy complete. Set DNS → VPS IP, then: certbot --nginx -d yourdomain.com"
