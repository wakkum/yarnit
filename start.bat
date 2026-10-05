@echo off
rem Yarnit launcher for Windows. Double-click it in File Explorer.
rem First run installs dependencies (a few minutes); later runs start in seconds.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Yarnit needs Node.js ^(version 22 or newer^). Opening the download page...
  start "" "https://nodejs.org/en/download"
  echo Install Node.js, then run this again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split(/[.]/).map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"
if errorlevel 1 (
  echo Your Node.js is too old. Yarnit needs 22.12 or newer. Get it at https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing ^(this takes a few minutes^)...
  call npm ci
  if errorlevel 1 (
    echo Install failed, see the messages above.
    pause
    exit /b 1
  )
)

echo Starting Yarnit. It opens in your browser; keep this window open while you use it.
call npm start
pause
