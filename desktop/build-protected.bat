@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo C F Trading ENT POS - Protected Installer
echo ========================================
echo.

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
  echo.
)

echo [1/3] Building core installer (setup-core.exe)...
call npm run build-core
if errorlevel 1 (
  echo ERROR: electron-builder failed.
  exit /b 1
)

if not exist "dist\internal\setup-core.exe" (
  echo ERROR: dist\internal\setup-core.exe was not created.
  exit /b 1
)

echo.
echo [2/3] Wrapping with password-protected launcher...

set "MAKENSIS="
if exist "C:\Program Files (x86)\NSIS\makensis.exe" set "MAKENSIS=C:\Program Files (x86)\NSIS\makensis.exe"
if exist "C:\Program Files\NSIS\makensis.exe" set "MAKENSIS=C:\Program Files\NSIS\makensis.exe"
where makensis >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%i in ('where makensis') do set "MAKENSIS=%%i"
)

if "%MAKENSIS%"=="" (
  echo ERROR: NSIS not found. Install from https://nsis.sourceforge.io/Download
  exit /b 1
)

"%MAKENSIS%" launcher.nsi
if errorlevel 1 (
  echo ERROR: NSIS compilation failed.
  exit /b 1
)

echo.
echo [3/3] Cleaning up intermediate files...
if exist "dist\internal\" rmdir /s /q "dist\internal"
if exist "dist\win-unpacked\" rmdir /s /q "dist\win-unpacked"

echo.
echo ========================================
echo Build complete!
echo ========================================
echo.
echo Password-protected installer:
echo   dist\C F Trading ENT POS-Setup-1.0.0.exe
echo.
endlocal
