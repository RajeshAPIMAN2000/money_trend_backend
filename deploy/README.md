# Money Trend — Hostinger VPS Deploy Guide

Deploy **both** apps on one VPS:

| App | Path on VPS | Runtime |
|-----|-------------|---------|
| Backend (Express API) | `/var/www/moneytrend/backend` | Node.js + PM2 (port 5001) |
| Frontend (Vite/React) | `/var/www/moneytrend/frontend` | Nginx static + `/api` proxy |

## 1. Connect Hostinger Connector in Cursor

1. Install **Hostinger Connector** extension (if not installed).
2. Open the Hostinger sidebar → **Sign in** (browser OAuth) or set API token.
3. Enable these product groups:
   - **VPS** (required — off by default)
   - **Websites** (optional, if also using shared hosting deploy)
   - **Domains** (if you want DNS from chat)
4. **Restart Cursor** so VPS MCP tools load.
5. Come back to chat and say: **"List my VPS and deploy Money Trend"**

Until VPS tools appear, this chat cannot talk to your Hostinger account.

## 2. What the setup script installs

Run once on a fresh Ubuntu VPS (as root / sudo):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
# Or use deploy/setup-vps.sh after uploading files
sudo bash /var/www/moneytrend/backend/deploy/setup-vps.sh
```

Installs: Node 20, Nginx, MySQL, PM2, UFW rules (22, 80, 443), app directories.

## 3. Upload & configure

```bash
# On VPS
mkdir -p /var/www/moneytrend/{backend,frontend,uploads}

# From your PC (example with scp) — replace USER and IP
scp -r money_trend_backend/* USER@VPS_IP:/var/www/moneytrend/backend/
# Frontend: build locally then upload dist, OR build on VPS
```

Backend env:

```bash
cp /var/www/moneytrend/backend/deploy/env.production.example /var/www/moneytrend/backend/.env
nano /var/www/moneytrend/backend/.env   # set DB, JWT, CORS, Razorpay, SMS
```

Frontend env (build time):

```bash
# In Fintech folder before npm run build
# VITE_API_BASE_URL=/api   ← use relative /api so Nginx proxies to backend
```

## 4. Start services

```bash
cd /var/www/moneytrend/backend
npm ci --omit=dev
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup

# Frontend build (on VPS or locally)
cd /path/to/Fintech
npm ci
npm run build
rsync -av dist/ /var/www/moneytrend/frontend/

# Nginx
sudo cp /var/www/moneytrend/backend/deploy/nginx-moneytrend.conf /etc/nginx/sites-available/moneytrend
sudo ln -sf /etc/nginx/sites-available/moneytrend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 5. SSL (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com -d api.yourdomain.com
```

Point DNS A records to your VPS IP first.

## 6. Health checks

- Frontend: `https://yourdomain.com`
- API: `https://yourdomain.com/api/health`
- Swagger: `https://yourdomain.com/api-docs`
- Uploads: `https://yourdomain.com/uploads/...`

## Architecture

```
Internet → Nginx :80/:443
              ├─ /           → /var/www/moneytrend/frontend (SPA)
              ├─ /api/*      → http://127.0.0.1:5001/api/*
              ├─ /api-docs   → http://127.0.0.1:5001/api-docs
              └─ /uploads/*  → http://127.0.0.1:5001/uploads/*
         PM2 → node app.js (PORT=5001)
         MySQL → money_trend DB
```
