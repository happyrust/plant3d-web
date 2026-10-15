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
:: STORE_MODE 留空 = 不 pin：介质由 DbOption.toml 的 store_mode（向导第②步选的档）决定。
:: deploy.env 里写 STORE_MODE=mem / rocksdb 是运维 pin，会压过向导持久化的选择。
set "STORE_MODE="
if exist "%CONFIG_FILE%" (
    for /f "usebackq tokens=1,* delims== eol=#" %%a in ("%CONFIG_FILE%") do set "%%a=%%b"
)
set "BACKEND_MODE=%BACKEND_MODE: =%"
set "BACKEND_ADDR=%BACKEND_ADDR: =%"
set "FRONTEND_PORT=%FRONTEND_PORT: =%"
set "STORE_MODE=%STORE_MODE: =%"
if not exist "%SCRIPT_DIR%config" mkdir "%SCRIPT_DIR%config"
set "FRONTEND_COMPAT_PORT=3100"
if /I "%BACKEND_MODE%"=="integrated" (
    set "AIOS_OFFLINE_ROOT=%SCRIPT_DIR%"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Sync-OfflineConfig.ps1" -ExportEnv >"%SCRIPT_DIR%config\runtime.env"
    if errorlevel 1 exit /b 1
    for /f "usebackq tokens=1,* delims==" %%a in ("%SCRIPT_DIR%config\runtime.env") do set "%%a=%%b"
)

echo ==========================================
echo   Plant3D-Web Offline Deploy
echo ==========================================
echo.
echo   Frontend:     %WWW_DIR%
echo   Backend mode: %BACKEND_MODE%
if "%STORE_MODE%"=="" (echo   Store mode:   ^<per DbOption.toml store_mode^>) else echo   Store mode:   %STORE_MODE% (pinned)
echo   Backend:      %BACKEND_ADDR%
echo   Ports:        %FRONTEND_PORT% (compat %FRONTEND_COMPAT_PORT%, 0=disabled)
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
    :: 介质未定死时由脚本自己判：STORE_MODE pin 了按 pin，否则看 DbOption.toml 的
    :: store_mode（向导持久化）；mem 档不用库，脚本直接放行。
    if /I not "%STORE_MODE%"=="mem" (
        echo [START] Ensuring SurrealDB if the store mode needs one...
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start-BundledStore.ps1"
        if errorlevel 1 (
            echo [ERROR] SurrealDB did not become ready. Check %BACKEND_DIR%\logs
            pause
            exit /b 1
        )
    )
    echo [START] Starting integrated backend...
    if defined STORE_MODE (
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BACKEND_DIR%\Start-AMS.ps1" -StoreMode %STORE_MODE% -NoBrowser -TimeoutSeconds 120
    ) else (
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BACKEND_DIR%\Start-AMS.ps1" -NoBrowser -TimeoutSeconds 120
    )
    if errorlevel 1 (
        echo [ERROR] Backend failed to become ready. Check %BACKEND_DIR%\logs
        pause
        exit /b 1
    )
) else (
    echo [CHECK] Checking external backend...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Test-OfflineHttp.ps1" -Uri "%BACKEND_ADDR%/api/v1/health" -BackendHealth >nul 2>&1
    if errorlevel 1 echo [WARN] External backend health check failed; nginx will still start.
)

if /I "%BACKEND_MODE%"=="integrated" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Test-OfflineHttp.ps1" -Uri "%BACKEND_ADDR%/api/v1/health" -BackendHealth
    if errorlevel 1 (
        echo [ERROR] Integrated backend health check failed; nginx will not start.
        exit /b 1
    )
)

call :update_nginx_config
if errorlevel 1 exit /b 1

echo [START] Starting nginx...
cd /d "%NGINX_DIR%"
start "Plant3D-Web Nginx" /min nginx.exe
powershell.exe -NoProfile -Command "Start-Sleep -Seconds 2"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Test-OfflineHttp.ps1" -Uri "http://127.0.0.1:%FRONTEND_PORT%/" >nul 2>&1
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
if not "%FRONTEND_COMPAT_PORT%"=="0" echo   Alt:      http://localhost:%FRONTEND_COMPAT_PORT%/
echo   Network:  http://^<your-ip^>:%FRONTEND_PORT%/
echo.
if /I "%~1"=="--no-browser" exit /b 0
if /I "%BACKEND_MODE%"=="integrated" if exist "%BACKEND_DIR%\.first-run-pending" (
    start %BACKEND_ADDR%/setup.html
    exit /b 0
)
start http://localhost:%FRONTEND_PORT%/
exit /b 0

:update_nginx_config
if /I "%BACKEND_MODE%"=="integrated" exit /b 0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Sync-OfflineConfig.ps1" -ExternalBackend "%BACKEND_ADDR%" -FrontendPort %FRONTEND_PORT% -CompatPort %FRONTEND_COMPAT_PORT%
if errorlevel 1 (
    echo [ERROR] Failed to update nginx backend configuration.
    exit /b 1
)
exit /b 0
