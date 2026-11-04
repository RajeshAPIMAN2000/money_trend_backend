#!/usr/bin/env bash
# Redeploy backend + frontend on the VPS (run ON the server after files are synced)
set -euo pipefail

APP_ROOT="/var/www/moneytrend"
BACKEND_DIR="${APP_ROOT}/backend"
FRONTEND_SRC="${1:-}"   # optional: path to Fintech repo on VPS for rebuild

echo "==> Backend npm install + restart"
cd "${BACKEND_DIR}"
npm ci --omit=dev
mkdir -p /var/log/pm2
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

if [[ -n "${FRONTEND_SRC}" && -d "${FRONTEND_SRC}" ]]; then
  echo "==> Building frontend from ${FRONTEND_SRC}"
  cd "${FRONTEND_SRC}"
  if [[ ! -f .env.production ]]; then
    cp .env.production.example .env.production 2>/dev/null || true
  fi
  npm ci
  npm run build
  rsync -a --delete dist/ "${APP_ROOT}/frontend/"
fi

echo "==> Nginx reload"
nginx -t && systemctl reload nginx

echo "==> Health"
curl -fsS "http://127.0.0.1:5001/api/health" || curl -fsS "http://127.0.0.1:5001/health" || true
echo
echo "Redeploy complete."
