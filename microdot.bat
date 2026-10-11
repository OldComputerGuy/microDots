@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem Use fnm's Node 24 if present (MicroDot needs Node 20+); otherwise fall back to PATH.
set "NODE24=%APPDATA%\fnm\node-versions\v24.21.0\installation"
if exist "%NODE24%\node.exe" set "PATH=%NODE24%;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
  echo [MicroDot] Node.js was not found. Install Node 20+ ^(or fnm with Node 24^).
  echo.
  pause
  exit /b 1
)

echo [MicroDot] Node:
node --version
echo.

rem Pass any arguments through, e.g.  microdot.bat --prompt "open example.com"
node --env-file-if-exists=.env "src\cli.mjs" %*
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" (
  echo.
  echo [MicroDot] exited with code %CODE%.
  pause
)
endlocal
