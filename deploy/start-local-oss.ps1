param(
  [Parameter(Mandatory = $true)]
  [string]$SourceEnvFile
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (!(Test-Path -LiteralPath $SourceEnvFile)) { throw "OSS environment file not found: $SourceEnvFile" }

$source = @{}
Get-Content -LiteralPath $SourceEnvFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $source[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
  }
}
foreach ($name in 'OSS_ENDPOINT', 'OSS_BUCKET_NAME', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_CDN_DOMAIN') {
  if ([string]::IsNullOrWhiteSpace($source[$name])) { throw "Missing $name in OSS environment file" }
}

$env:CFG_IMAGE_PROXY__USE_FOR_VIDEO = 'false'
$env:CFG_STORAGE__TYPE = 'oss'
$env:CFG_STORAGE__OSS__ENDPOINT = $source['OSS_ENDPOINT']
$env:CFG_STORAGE__OSS__BUCKET = $source['OSS_BUCKET_NAME']
$env:CFG_STORAGE__OSS__ACCESS_KEY_ID = $source['OSS_ACCESS_KEY_ID']
$env:CFG_STORAGE__OSS__ACCESS_KEY_SECRET = $source['OSS_ACCESS_KEY_SECRET']
$env:CFG_STORAGE__OSS__PREFIX = 'local-mini-drama'
$env:CFG_STORAGE__OSS__PUBLIC_BASE_URL = $source['OSS_CDN_DOMAIN']
# Migration is an explicit, separately verified operation. New completed video
# outputs will archive independently; existing files remain local during QA.
$env:CFG_STORAGE__OSS__AUTO_ARCHIVE_ENABLED = 'false'

$listener = Get-NetTCPConnection -LocalPort 5679 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) { Stop-Process -Id $listener.OwningProcess -Force }

$logs = Join-Path $root 'data'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$outLog = Join-Path $logs 'local-oss-backend.out.log'
$errLog = Join-Path $logs 'local-oss-backend.err.log'
Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue
$node = (Get-Command node -ErrorAction Stop).Source
$process = Start-Process -FilePath $node -ArgumentList 'src/server.js' -WorkingDirectory (Join-Path $root 'backend-node') -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:5679/health'
    if ($health.status -eq 'ok') {
      Write-Output "Local OSS backend ready (PID $($process.Id)); historical auto-archive remains disabled."
      exit 0
    }
  } catch {}
}
Get-Content -LiteralPath $outLog, $errLog -Tail 60 -ErrorAction SilentlyContinue
throw 'Local OSS backend did not become healthy.'
