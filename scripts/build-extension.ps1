$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\.."
pnpm --filter @umb/extension build
Write-Host "Extension build complete. Load unpacked from apps/extension."
