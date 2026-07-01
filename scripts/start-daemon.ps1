param(
  [switch]$Restart,
  [int]$Port = 44777
)

$ErrorActionPreference = "Stop"

Set-Location "$PSScriptRoot\.."

$healthUrl = "http://127.0.0.1:$Port/health"

function Get-UmbHealth {
  param([string]$Url)

  try {
    return Invoke-RestMethod -Uri $Url -Method Get
  } catch {
    return $null
  }
}

function Wait-ForPortRelease {
  param(
    [int]$TargetPort,
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
    if (-not $listener) {
      return $true
    }

    Start-Sleep -Milliseconds 250
  }

  return $false
}

$existingHealth = Get-UmbHealth -Url $healthUrl
if ($existingHealth) {
  $existingPid = $existingHealth.daemon.pid
  if (-not $Restart) {
    Write-Host "UMB daemon is already running on $healthUrl (pid $existingPid). Reusing existing process."
    exit 0
  }

  Write-Host "Stopping existing UMB daemon pid $existingPid on port $Port..."
  Stop-Process -Id $existingPid -Force
  if (-not (Wait-ForPortRelease -TargetPort $Port)) {
    throw "UMB daemon port $Port did not become free after stopping pid $existingPid."
  }
}

pnpm --filter @umb/daemon build

$restartedHealth = Get-UmbHealth -Url $healthUrl
if ($restartedHealth) {
  Write-Host "UMB daemon is already healthy after build on $healthUrl (pid $($restartedHealth.daemon.pid)). Reusing active process."
  exit 0
}

node .\apps\daemon\dist\runtime.js
