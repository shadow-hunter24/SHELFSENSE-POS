@echo off
echo ========================================
echo C F Trading ENT POS Builder (Administrator)
echo ========================================
echo.
echo This script will request administrator privileges...
echo.

REM Request administrator privileges
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"

if '%errorlevel%' NEQ '0' (
    echo Requesting administrative privileges...
    goto UACPrompt
) else (
    goto gotAdmin
)

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    exit /B

:gotAdmin
    if exist "%temp%\getadmin.vbs" ( del "%temp%\getadmin.vbs" )
    pushd "%CD%"
    CD /D "%~dp0"

echo.
echo Running with administrator privileges...
echo.

if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Building core installer + portable...
echo.
call npm run build-all
if %errorlevel% NEQ 0 (
    echo ERROR: electron-builder failed.
    pause
    exit /B 1
)

if not exist "dist\internal\setup-core.exe" (
    echo ERROR: dist\internal\setup-core.exe not found.
    pause
    exit /B 1
)

REM Keep portable copy in dist root (no password on portable)
for %%f in ("dist\internal\*Portable*.exe") do (
    echo Copying portable build to dist\...
    copy /Y "%%f" "dist\" >nul
)

echo.
echo Compiling password-protected installer...
echo.

set "MAKENSIS="
if exist "C:\Program Files (x86)\NSIS\makensis.exe" set "MAKENSIS=C:\Program Files (x86)\NSIS\makensis.exe"
if exist "C:\Program Files\NSIS\makensis.exe" set "MAKENSIS=C:\Program Files\NSIS\makensis.exe"
where makensis >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%i in ('where makensis') do set "MAKENSIS=%%i"
)

if "%MAKENSIS%"=="" (
    echo ERROR: NSIS not found. Install from https://nsis.sourceforge.io/Download
    pause
    exit /B 1
)

"%MAKENSIS%" launcher.nsi
if %errorlevel% NEQ 0 (
    echo.
    echo ERROR: NSIS compilation failed.
    pause
    exit /B 1
)

echo.
echo Cleaning up intermediate build files...
if exist "dist\internal\" ( rmdir /s /q "dist\internal" )
if exist "dist\win-unpacked\" ( rmdir /s /q "dist\win-unpacked" )

echo.
echo ========================================
echo Build Complete!
echo ========================================
echo.
echo   dist\C F Trading ENT POS-Setup-1.0.0.exe  (password required)
echo   dist\C F Trading ENT POS-Portable-*.exe   (if built, no password)
echo.
echo Press any key to open dist folder...
pause >nul

start "" "%cd%\dist"
