param(
  [string]$RepoUrl,
  [string]$InstallDir,
  [string]$FactoryHome,
  [string]$FactoryConfigPath,
  [string]$ServerName = "umb",
  [switch]$SkipClone,
  [switch]$SkipDependencyInstall,
  [switch]$SkipBuild,
  [switch]$SkipDaemonStart,
  [switch]$SkipMcpConfig
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed: $FilePath $($ArgumentList -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Get-UmbHealth {
  param([int]$Port = 44777)

  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Method Get
  } catch {
    return $null
  }
}

function Wait-UmbHealth {
  param(
    [int]$Port = 44777,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $health = Get-UmbHealth -Port $Port
    if ($health) {
      return $health
    }

    Start-Sleep -Milliseconds 500
  }

  return $null
}

Require-Command git
Require-Command node
Require-Command pnpm

$scriptRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = $scriptRepoRoot

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "UMB\github\umb"
}

if (-not $FactoryHome) {
  $FactoryHome = Join-Path $HOME ".factory"
}

if (-not $FactoryConfigPath) {
  $FactoryConfigPath = Join-Path $FactoryHome "mcp.json"
}

if ($RepoUrl) {
  $repoRoot = $InstallDir

  if (-not $SkipClone) {
    if (-not (Test-Path $repoRoot)) {
      New-Item -ItemType Directory -Path (Split-Path $repoRoot -Parent) -Force | Out-Null
      Invoke-Checked -FilePath "git" -ArgumentList @("clone", $RepoUrl, $repoRoot) -WorkingDirectory $PWD.Path
    } elseif (-not (Test-Path (Join-Path $repoRoot ".git"))) {
      throw "InstallDir exists but is not a git repository: $repoRoot"
    } else {
      Invoke-Checked -FilePath "git" -ArgumentList @("-C", $repoRoot, "pull", "--ff-only") -WorkingDirectory $PWD.Path
    }
  }
}

if (-not (Test-Path (Join-Path $repoRoot "package.json"))) {
  throw "UMB repository root not found: $repoRoot"
}

if (-not $SkipDependencyInstall) {
  Invoke-Checked -FilePath "pnpm" -ArgumentList @("install") -WorkingDirectory $repoRoot
}

if (-not $SkipBuild) {
  Invoke-Checked -FilePath "pnpm" -ArgumentList @("build") -WorkingDirectory $repoRoot
}

$extensionCheckJson = & node (Join-Path $repoRoot "scripts\check-extension-installed.js")
if ($LASTEXITCODE -ne 0) {
  throw "Failed to check extension installation."
}

$extensionCheck = $extensionCheckJson | ConvertFrom-Json
$extensionDetected = [bool]$extensionCheck.found -or [bool]$env:UMB_EXTENSION_ID

if ($extensionDetected) {
  Invoke-Checked -FilePath "node" -ArgumentList @((Join-Path $repoRoot "scripts\install-native-host.mjs")) -WorkingDirectory $repoRoot
} else {
  Write-Host ""
  Write-Host "UMB browser step still required:"
  Write-Host "1. Open the Chromium-family browser profile you want to automate."
  Write-Host "2. Open Extensions, enable Developer Mode, and Load unpacked from apps\\extension in the cloned repo."
  Write-Host "3. Rerun this installer or run node .\\scripts\\install-native-host.mjs inside the repo."
  Write-Host ""
}

if (-not $SkipMcpConfig) {
  Invoke-Checked -FilePath "node" -ArgumentList @(
    (Join-Path $repoRoot "scripts\install-droid-mcp-config.mjs"),
    "--repo-dir",
    $repoRoot,
    "--config",
    $FactoryConfigPath,
    "--server-name",
    $ServerName
  ) -WorkingDirectory $repoRoot
}

if (-not $SkipDaemonStart) {
  $health = Get-UmbHealth
  if (-not $health) {
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      (Join-Path $repoRoot "scripts\start-daemon.ps1")
    ) -WindowStyle Hidden

    $health = Wait-UmbHealth
  }

  if ($health) {
    Write-Host "UMB daemon healthy at http://127.0.0.1:44777 (pid $($health.daemon.pid))."
  } else {
    Write-Host "UMB daemon did not become healthy within the timeout window."
  }
}

Write-Host ""
Write-Host "UMB install summary"
Write-Host "Repo: $repoRoot"
Write-Host "Factory MCP config: $FactoryConfigPath"
Write-Host "MCP entrypoint: node .\\scripts\\start-mcp.mjs"
Write-Host "Extension detected: $extensionDetected"
if (-not $extensionDetected) {
  Write-Host "Status: waiting for the one browser-owned Load unpacked step."
  Write-Host ""
  Write-Host "Agent follow-up for the user:"
  Write-Host "Tell the user to open the target Chromium-family browser, go to Extensions, enable Developer Mode, choose Load unpacked, and select apps\\extension from the installed UMB repo."
  Write-Host "Then rerun this installer or run node .\\scripts\\install-native-host.mjs inside that repo."
} else {
  Write-Host "Status: repo, native host, daemon, and Droid MCP wiring are installed."
}
