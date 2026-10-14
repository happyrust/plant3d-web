@echo off
chcp 65001 >nul
setlocal

:: ============================================================
:: Plant3D-Web Offline Deploy - Stop Script
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "NGINX_DIR=%SCRIPT_DIR%nginx"
set "NGINX_EXE=%NGINX_DIR%\nginx.exe"

echo ==========================================
echo   Plant3D-Web Offline Deploy - Stop
echo ==========================================
echo.

if not exist "%NGINX_EXE%" (
    echo [ERROR] nginx.exe not found: %NGINX_EXE%
    pause
    exit /b 1
)

echo [STOP] Stopping nginx...
cd /d "%NGINX_DIR%"
nginx.exe -s quit 2>nul

:: Wait for process to exit
timeout /t 2 /nobreak >nul

:: Force kill if still running
tasklist /FI "IMAGENAME eq nginx.exe" 2>nul | find /I "nginx.exe" >nul
if %errorlevel% equ 0 (
    echo [FORCE] Force killing remaining process...
    taskkill /F /IM nginx.exe >nul 2>&1
)

echo [DONE] nginx stopped.
echo.
pause
exit /b 0
