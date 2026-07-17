@echo off
cd /d "%~dp0"
echo ========================================
echo C F Trading ENT POS - Desktop (Dev)
echo ========================================
echo.
if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)
echo Starting Electron desktop app...
call npm start
