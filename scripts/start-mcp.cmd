@echo off
setlocal
cd /d "%~dp0\.."

call pnpm --filter @umb/daemon build 1>&2
if errorlevel 1 exit /b %errorlevel%

node .\apps\daemon\dist\mcp-runtime.js
