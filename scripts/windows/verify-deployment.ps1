$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $Root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'Node.js >=22.5.0 is required.'; exit 2 }
if (-not $env:ZC_VERIFY_URL) {
  $Port = $env:PORT
  if (-not $Port) {
    $EnvFile = Join-Path $Root '.env'
    if (Test-Path $EnvFile) { $Match = Select-String -Path $EnvFile -Pattern '^\s*PORT\s*=\s*["'']?([0-9]+)["'']?\s*$' | Select-Object -Last 1; if ($Match -and $Match.Matches.Count) { $Port = $Match.Matches[0].Groups[1].Value } }
  }
  if (-not $Port) { $Port = '3000' }
  $env:ZC_VERIFY_URL = "http://127.0.0.1:$Port"
}
& node (Join-Path $Root 'scripts/verify-deployment.mjs') @args
exit $LASTEXITCODE
