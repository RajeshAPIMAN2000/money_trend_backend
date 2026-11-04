# Sync Money Trend backend (and optional frontend) to Hostinger VPS
# Usage:
#   .\deploy\sync-to-vps.ps1 -VpsHost "123.45.67.89" -VpsUser "root"
#   .\deploy\sync-to-vps.ps1 -VpsHost "123.45.67.89" -BuildFrontend

param(
    [Parameter(Mandatory = $true)]
    [string]$VpsHost,
    [string]$VpsUser = "root",
    [int]$VpsPort = 22,
    [string]$AppRoot = "/var/www/moneytrend",
    [switch]$BuildFrontend
)

$ErrorActionPreference = "Stop"
$BackendDir = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path (Split-Path -Parent $BackendDir) "Fintech"
$Remote = "${VpsUser}@${VpsHost}"

function Require-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $name. Install OpenSSH client or use Git Bash with deploy/sync-to-vps.sh"
    }
}

Require-Command ssh
Require-Command scp

Write-Host "==> Ensure remote directories"
ssh -p $VpsPort -o StrictHostKeyChecking=accept-new $Remote "mkdir -p ${AppRoot}/backend ${AppRoot}/frontend ${AppRoot}/uploads"

Write-Host "==> Create backend archive (exclude node_modules, secrets)"
$staging = Join-Path $env:TEMP "moneytrend-backend-sync"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging | Out-Null

robocopy $BackendDir $staging /E /XD node_modules uploads logs .git /XF .env .env.local .env.production *.log /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null

$tarPath = Join-Path $env:TEMP "moneytrend-backend.tar.gz"
if (Test-Path $tarPath) { Remove-Item -Force $tarPath }

if (Get-Command tar -ErrorAction SilentlyContinue) {
    Push-Location $staging
    tar -czf $tarPath .
    Pop-Location
    scp -P $VpsPort -o StrictHostKeyChecking=accept-new $tarPath "${Remote}:/tmp/moneytrend-backend.tar.gz"
    ssh -p $VpsPort -o StrictHostKeyChecking=accept-new $Remote "mkdir -p ${AppRoot}/backend && tar -xzf /tmp/moneytrend-backend.tar.gz -C ${AppRoot}/backend && rm -f /tmp/moneytrend-backend.tar.gz"
} else {
    Write-Host "tar not found — using scp folder copy (slower)"
    scp -P $VpsPort -r $staging/* "${Remote}:${AppRoot}/backend/"
}

if ($BuildFrontend -and (Test-Path $FrontendDir)) {
    Write-Host "==> Build frontend"
    Push-Location $FrontendDir
    if (-not (Test-Path ".env.production")) {
        Copy-Item ".env.production.example" ".env.production" -ErrorAction SilentlyContinue
    }
    npm ci
    npm run build
    if (Get-Command tar -ErrorAction SilentlyContinue) {
        Push-Location dist
        tar -czf $env:TEMP\moneytrend-frontend.tar.gz .
        Pop-Location
        scp -P $VpsPort $env:TEMP\moneytrend-frontend.tar.gz "${Remote}:/tmp/moneytrend-frontend.tar.gz"
        ssh -p $VpsPort $Remote "mkdir -p ${AppRoot}/frontend && tar -xzf /tmp/moneytrend-frontend.tar.gz -C ${AppRoot}/frontend && rm -f /tmp/moneytrend-frontend.tar.gz"
    } else {
        scp -P $VpsPort -r dist/* "${Remote}:${AppRoot}/frontend/"
    }
    Pop-Location
}

Write-Host "==> Redeploy on VPS"
ssh -p $VpsPort -o StrictHostKeyChecking=accept-new $Remote "cd ${AppRoot}/backend && bash deploy/redeploy.sh"

Write-Host "Done. Configure nginx + .env on VPS if first deploy."
