#!/usr/bin/env bash
# Sync backend + frontend build to Hostinger VPS from your PC (Git Bash / WSL / Mac)
# Usage:
#   export VPS_HOST=123.45.67.89 VPS_USER=root
#   bash deploy/sync-to-vps.sh
# Optional: FRONTEND_DIR=../Fintech  BUILD_FRONTEND=1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
APP_ROOT="${APP_ROOT:-/var/www/moneytrend}"
FRONTEND_DIR="${FRONTEND_DIR:-$(cd "${BACKEND_DIR}/../Fintech" 2>/dev/null && pwd || echo "")}"
BUILD_FRONTEND="${BUILD_FRONTEND:-0}"
SSH_OPTS=(-p "${VPS_PORT}" -o StrictHostKeyChecking=accept-new)

if [[ -z "${VPS_HOST}" ]]; then
  echo "Set VPS_HOST (and optionally VPS_USER, VPS_PORT, APP_ROOT)."
  echo "Example: VPS_HOST=1.2.3.4 VPS_USER=root bash deploy/sync-to-vps.sh"
  exit 1
fi

REMOTE="${VPS_USER}@${VPS_HOST}"
RSYNC_SSH="ssh -p ${VPS_PORT} -o StrictHostKeyChecking=accept-new"

echo "==> Ensure remote directories"
ssh "${SSH_OPTS[@]}" "${REMOTE}" "mkdir -p ${APP_ROOT}/backend ${APP_ROOT}/frontend ${APP_ROOT}/uploads"

echo "==> Sync backend (exclude node_modules, .env, uploads)"
rsync -avz --delete \
  --exclude node_modules \
  --exclude uploads \
  --exclude .env \
  --exclude .env.local \
  --exclude .env.production \
  --exclude logs \
  --exclude "*.log" \
  -e "${RSYNC_SSH}" \
  "${BACKEND_DIR}/" "${REMOTE}:${APP_ROOT}/backend/"

if [[ "${BUILD_FRONTEND}" == "1" && -n "${FRONTEND_DIR}" && -d "${FRONTEND_DIR}" ]]; then
  echo "==> Build frontend at ${FRONTEND_DIR}"
  cd "${FRONTEND_DIR}"
  if [[ ! -f .env.production ]]; then
    cp .env.production.example .env.production 2>/dev/null || true
  fi
  npm ci
  npm run build
  echo "==> Sync frontend dist"
  rsync -avz --delete -e "${RSYNC_SSH}" dist/ "${REMOTE}:${APP_ROOT}/frontend/"
fi

echo "==> Run redeploy on VPS"
ssh "${SSH_OPTS[@]}" "${REMOTE}" "cd ${APP_ROOT}/backend && bash deploy/redeploy.sh"

echo "Done. Test: http://${VPS_HOST}/api/health (after nginx + DNS configured)"
