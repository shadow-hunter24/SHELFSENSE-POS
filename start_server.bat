@echo off
cls
echo ========================================
echo C F Trading ENT POS
echo ========================================
echo.
echo Starting PHP Development Server...
echo.
echo IMPORTANT:
echo   - Server URL: http://localhost:8000
echo   - Default login: admin (change password on first sign-in)
echo   - Press Ctrl+C to stop the server
echo.
echo ========================================
echo.

REM Start PHP server
php -S localhost:8000

echo.
echo Server stopped.
pause
