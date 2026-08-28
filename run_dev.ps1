# RichiDrama local dev launcher: backend (5679) + frontend (3013)
# Usage: powershell -ExecutionPolicy Bypass -File ./run_dev.ps1
# Why profile: backend starts with MINIDRAMA_PROFILE=dev, which pins storage to
# local and disables the image proxy for videos (the old explicit
# CFG_IMAGE_PROXY__USE_FOR_VIDEO=false semantics). Otherwise video gen uploads
# local ref images to a slow proxy and blocks async tasks for minutes.
# See AGENTS.md. Online is unaffected (prod/preview profiles apply on deploy).

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPort = 5679
$FrontendPort = 3013

function Stop-Port($port) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) { return }
  foreach ($c in $conns) {
    $procId = $c.OwningProcess
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) {
      Write-Host "  port $port in use by $($p.ProcessName) (PID $procId), stopping..." -ForegroundColor Yellow
      Stop-Process -Id $procId -Force
    }
  }
  Start-Sleep -Milliseconds 600
}

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host " RichiDrama dev launcher" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "[1/4] Cleaning stale processes..." -ForegroundColor Cyan
Stop-Port $BackendPort
Stop-Port $FrontendPort

Write-Host ""
Write-Host "[2/4] Starting backend (port $BackendPort)..." -ForegroundColor Cyan
$beScript = "cd '$root\backend-node'; `$env:MINIDRAMA_PROFILE='dev'; Write-Host 'backend running (profile=dev), Ctrl+C to stop' -ForegroundColor Green; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $beScript -WindowStyle Normal

Write-Host ""
Write-Host "[3/4] Starting frontend (port $FrontendPort)..." -ForegroundColor Cyan
$feScript = "cd '$root\frontweb'; Write-Host 'frontend running, Ctrl+C to stop' -ForegroundColor Green; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $feScript -WindowStyle Normal

Write-Host ""
Write-Host "[4/4] Waiting for services..." -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-RestMethod "http://localhost:$BackendPort/health" -TimeoutSec 2
    if ($resp.status -eq 'ok') { $ok = $true; break }
  } catch {}
}

Write-Host ""
if ($ok) { Write-Host "[OK] backend health check passed" -ForegroundColor Green }
else { Write-Host "[WARN] backend not ready in 40s, check backend window" -ForegroundColor Red }

Start-Sleep -Seconds 1
if (Get-NetTCPConnection -LocalPort $FrontendPort -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "[OK] frontend listening on $FrontendPort" -ForegroundColor Green
} else {
  Write-Host "[WARN] frontend not listening, check frontend window" -ForegroundColor Red
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host " Open frontend:  http://localhost:$FrontendPort/" -ForegroundColor White
Write-Host " Backend API:   http://localhost:$BackendPort/api/v1" -ForegroundColor DarkGray
Write-Host "===========================================" -ForegroundColor Green

Start-Process "http://localhost:$FrontendPort/"
