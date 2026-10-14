@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================================
:: Plant3D-Web Offline Deploy - Start Script
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "NGINX_DIR=%SCRIPT_DIR%nginx"
set "NGINX_EXE=%NGINX_DIR%\nginx.exe"
set "WWW_DIR=%SCRIPT_DIR%www"
set "CONFIG_FILE=%SCRIPT_DIR%config\deploy.env"

:: Read config
set "BACKEND_ADDR=http://127.0.0.1:8022"
set "FRONTEND_PORT=80"
if exist "%CONFIG_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%CONFIG_FILE%") do (
        set "%%a=%%b"
    )
)

echo ==========================================
echo   Plant3D-Web Offline Deploy
echo ==========================================
echo.
echo   Frontend: %WWW_DIR%
echo   Backend:  %BACKEND_ADDR%
echo   Ports:    %FRONTEND_PORT% (also 3100)
echo.

:: Check nginx exists
if not exist "%NGINX_EXE%" (
    echo [ERROR] nginx.exe not found: %NGINX_EXE%
    echo Please run the packaging script first.
    pause
    exit /b 1
)

:: Check frontend files exist
if not exist "%WWW_DIR%\index.html" (
    echo [ERROR] index.html not found: %WWW_DIR%\index.html
    echo Please check www directory.
    pause
    exit /b 1
)

:: Check port availability
netstat -ano | findstr ":%FRONTEND_PORT% " >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARN] Port %FRONTEND_PORT% is in use, trying to continue...
)

:: Update nginx config with backend address
call :update_nginx_config

:: Start nginx
echo [START] Starting nginx...
cd /d "%NGINX_DIR%"
start "Plant3D-Web Nginx" /min nginx.exe

:: Wait for startup
timeout /t 2 /nobreak >nul

:: Verify startup
curl -s -o nul -w "%%{http_code}" "http://localhost:%FRONTEND_PORT%/" 2>nul >nul
if %errorlevel% equ 0 (
    echo.
    echo ==========================================
    echo   Started successfully!
    echo ==========================================
    echo.
    echo   URL:      http://localhost:%FRONTEND_PORT%/
    echo   Alt:      http://localhost:3100/
    echo   Network:  http://^<your-ip^>:%FRONTEND_PORT%/
    echo.
    echo   Press any key to open in browser...
    pause >nul
    start http://localhost:%FRONTEND_PORT%/
) else (
    echo.
    echo [ERROR] nginx failed to start. Please check:
    echo   1. Ports %FRONTEND_PORT% and 3100 are not in use
    echo   2. Check log: %NGINX_DIR%\logs\error.log
    pause
    exit /b 1
)

exit /b 0

:: ============================================================
:: Update nginx config with backend address
:: ============================================================
:update_nginx_config
set "NGINX_CONF=%NGINX_DIR%\conf\nginx.conf"
set "NGINX_CONF_BAK=%NGINX_DIR%\conf\nginx.conf.bak"

:: Backup original config
if not exist "%NGINX_CONF_BAK%" copy /y "%NGINX_CONF%" "%NGINX_CONF_BAK%" >nul

:: Replace backend address
powershell -Command "(Get-Content '%NGINX_CONF%' -Raw) -replace 'server 127\.0\.0\.1:8022;', 'server %BACKEND_ADDR:http://=%;' -replace 'set \$backend_addr \"http://127\.0\.0\.1:8022\";', 'set \$backend_addr \"%BACKEND_ADDR%\";' | Set-Content '%NGINX_CONF%' -NoNewline"

goto :eof
