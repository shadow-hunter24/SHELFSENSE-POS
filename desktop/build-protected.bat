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

echo Step 0 of 4 - Checking for VC++ Redistributable...
if not exist "vc_redist.x64.exe" (
  echo Downloading Microsoft Visual C++ 2015-2022 Redistributable x64...
  echo This is required so PHP works on PCs without Visual Studio installed.
  powershell -Command "Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile 'vc_redist.x64.exe' -UseBasicParsing"
  if errorlevel 1 (
    echo WARNING: Could not download vc_redist.x64.exe automatically.
    echo Please download it manually from: https://aka.ms/vs/17/release/vc_redist.x64.exe
    echo and place it in the desktop folder, then re-run this script.
    pause
    exit /b 1
  )
  echo VC++ Redistributable downloaded successfully.
) else (
  echo vc_redist.x64.exe already present, skipping download.
)
echo.

echo Step 1 of 4 - Building core installer setup-core.exe...
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
echo Step 2 of 4 - Building portable app...
call npm run build-portable
if errorlevel 1 (
  echo ERROR: portable build failed.
  exit /b 1
)

for %%f in ("dist\internal\*Portable*.exe") do (
  echo Copying portable to dist\...
  copy /Y "%%f" "dist\" >nul
)

echo.
echo Step 3 of 4 - Wrapping with password-protected launcher...

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
echo Step 4 of 4 - Cleaning up intermediate files...
if exist "dist\internal\" rmdir /s /q "dist\internal"
if exist "dist\win-unpacked\" rmdir /s /q "dist\win-unpacked"

echo.
echo ========================================
echo Build complete!
echo ========================================
echo.
echo   dist\C F Trading ENT POS-Setup-1.0.0.exe  (password required, includes VC++ runtime)
echo   dist\C F Trading ENT POS-Portable-1.0.0.exe
echo.
endlocal
