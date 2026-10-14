$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $Root
function Get-NodeVersionText {
  if (Get-Command node -ErrorAction SilentlyContinue) { return (& node -p "process.versions.node").Trim() }
  return $null
}
function Test-NodeSupported([string]$VersionText) {
  if (-not $VersionText) { return $false }
  $Parts = $VersionText.Split('.') | ForEach-Object { [int]$_ }
  return ($Parts[0] -gt 22 -or ($Parts[0] -eq 22 -and $Parts[1] -ge 5))
}
$VersionText = Get-NodeVersionText
if (-not (Test-NodeSupported $VersionText)) {
  $VersionLabel = if ($VersionText) { $VersionText } else { 'not installed' }
  Write-Host "Node.js $VersionLabel is missing/too old; ZombieCoder requires >=22.5.0." -ForegroundColor Yellow
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Write-Error 'winget is unavailable. Install Node.js 22.5+ from the official Node.js distribution, then rerun.'; exit 2 }
  $Choice = Read-Host 'Install/upgrade Node.js LTS with winget now? [y/N]'
  if ($Choice -notmatch '^[Yy]$') { Write-Error 'Node.js setup cancelled; runtime not started.'; exit 2 }
  & winget install --id OpenJS.NodeJS.LTS --exact --force --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { Write-Error "winget installation failed with exit code $LASTEXITCODE"; exit 2 }
  $NodeInstall = Join-Path $env:ProgramFiles 'nodejs'
  if (Test-Path (Join-Path $NodeInstall 'node.exe')) { $env:PATH = "$NodeInstall;$env:PATH" }
  $VersionText = Get-NodeVersionText
  if (-not (Test-NodeSupported $VersionText)) { $VersionLabel = if ($VersionText) { $VersionText } else { 'missing' }; Write-Error "Node.js still reports $VersionLabel. Install Node.js >=22.5.0 and rerun."; exit 2 }
}
Write-Host "ZombieCoder Runtime | Node.js $VersionText | root=$Root" -ForegroundColor Cyan
if ($env:PORT) { Write-Host "PORT from process environment: $env:PORT" } else { Write-Host 'PORT: read from .env, otherwise default 3000' }
if ($env:HOST) { Write-Host "HOST from process environment: $env:HOST" } else { Write-Host 'HOST: read from .env, otherwise default 127.0.0.1' }
& node (Join-Path $Root 'start.js')
exit $LASTEXITCODE
