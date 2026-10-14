$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$Launcher = Join-Path $PSScriptRoot 'start-runtime.ps1'
$PowerShell = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $PowerShell) { $PowerShell = (Get-Command pwsh -ErrorAction SilentlyContinue).Source }
if (-not $PowerShell) { Write-Error 'PowerShell executable not found.'; exit 2 }
$TaskName = 'ZombieCoder Runtime'
$Argument = "-NoProfile -ExecutionPolicy Bypass -File `"$Launcher`""
$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Argument -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description 'Starts ZombieCoder Runtime for the current Windows user.' -Force | Out-Null
Write-Host "Registered '$TaskName' at logon for $env:USERNAME." -ForegroundColor Green
Write-Host 'This is a per-user Task Scheduler task, not a Windows service. Logs are written to LOG_DIR (default ./logs).'
