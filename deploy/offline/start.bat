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
set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "CONFIG_FILE=%SCRIPT_DIR%config\deploy.env"

set "BACKEND_MODE=integrated"
set "BACKEND_ADDR=http://127.0.0.1:8022"
set "FRONTEND_PORT=80"
if exist "%CONFIG_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%CONFIG_FILE%") do set "%%a=%%b"
)
if /I "%BACKEND_MODE%"=="integrated" set "BACKEND_ADDR=http://127.0.0.1:8022"

echo ==========================================
echo   Plant3D-Web Offline Deploy
echo ==========================================
echo.
echo   Frontend:     %WWW_DIR%
echo   Backend mode: %BACKEND_MODE%
echo   Backend:      %BACKEND_ADDR%
echo   Ports:        %FRONTEND_PORT% (also 3100)
echo.

if not exist "%NGINX_EXE%" (
    echo [ERROR] nginx.exe not found: %NGINX_EXE%
    pause
    exit /b 1
)
if not exist "%WWW_DIR%\index.html" (
    echo [ERROR] index.html not found: %WWW_DIR%\index.html
    pause
    exit /b 1
)

if /I "%BACKEND_MODE%"=="integrated" (
    if not exist "%BACKEND_DIR%\aios-database.exe" (
        echo [ERROR] Integrated backend not found: %BACKEND_DIR%\aios-database.exe
        pause
        exit /b 1
    )
    if not exist "%BACKEND_DIR%\Start-AMS.ps1" (
        echo [ERROR] Backend launcher not found: %BACKEND_DIR%\Start-AMS.ps1
        pause
        exit /b 1
    )
    echo [START] Starting integrated backend...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BACKEND_DIR%\Start-AMS.ps1" -StoreMode mem -NoBrowser -TimeoutSeconds 120
    if errorlevel 1 (
        echo [ERROR] Backend failed to become ready. Check %BACKEND_DIR%\logs
        pause
        exit /b 1
    )
) else (
    echo [CHECK] Checking external backend...
    curl -f -s "%BACKEND_ADDR%/api/v1/health" >nul 2>&1
    if errorlevel 1 echo [WARN] External backend health check failed; nginx will still start.
)

call :update_nginx_config
if errorlevel 1 exit /b 1

echo [START] Starting nginx...
cd /d "%NGINX_DIR%"
start "Plant3D-Web Nginx" /min nginx.exe
powershell.exe -NoProfile -Command "Start-Sleep -Seconds 2"

curl -f -s "http://localhost:%FRONTEND_PORT%/" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] nginx failed to start. Check %NGINX_DIR%\logs\error.log
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   Started successfully!
echo ==========================================
echo.
echo   URL:      http://localhost:%FRONTEND_PORT%/
echo   Alt:      http://localhost:3100/
echo   Network:  http://^<your-ip^>:%FRONTEND_PORT%/
echo.
start http://localhost:%FRONTEND_PORT%/
exit /b 0

:update_nginx_config
set "NGINX_CONF=%NGINX_DIR%\conf\nginx.conf"
set "NGINX_CONF_BAK=%NGINX_DIR%\conf\nginx.conf.bak"
if not exist "%NGINX_CONF_BAK%" copy /y "%NGINX_CONF%" "%NGINX_CONF_BAK%" >nul
copy /y "%NGINX_CONF_BAK%" "%NGINX_CONF%" >nul
powershell.exe -NoProfile -Command "$address = [Uri]'%BACKEND_ADDR%'; $upstream = $address.Host + ':' + $address.Port; (Get-Content '%NGINX_CONF%' -Raw) -replace 'server 127\.0\.0\.1:8022;', ('server ' + $upstream + ';') -replace 'listen       80;', 'listen       %FRONTEND_PORT%;' | Set-Content '%NGINX_CONF%' -NoNewline"
if errorlevel 1 (
    echo [ERROR] Failed to update nginx backend configuration.
    exit /b 1
)
exit /b 0
