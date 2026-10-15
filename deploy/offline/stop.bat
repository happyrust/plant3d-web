@echo off
chcp 65001 >nul
setlocal

:: ============================================================
:: Plant3D-Web Offline Deploy - Stop Script
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "NGINX_DIR=%SCRIPT_DIR%nginx"
set "NGINX_EXE=%NGINX_DIR%\nginx.exe"
set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "BACKEND_PROCESS=%BACKEND_DIR%\process.json"

echo ==========================================
echo   Plant3D-Web Offline Deploy - Stop
echo ==========================================
echo.

if exist "%NGINX_EXE%" (
    echo [STOP] Stopping nginx...
    powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '%NGINX_EXE%' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
)

if exist "%BACKEND_DIR%\aios-database.exe" (
    echo [STOP] Stopping integrated backend...
    powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '%BACKEND_DIR%\aios-database.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Remove-Item '%BACKEND_PROCESS%' -Force -ErrorAction SilentlyContinue"
    if errorlevel 1 (
        echo [ERROR] Backend could not be stopped safely. Check %BACKEND_PROCESS%
        pause
        exit /b 1
    )
)

if exist "%BACKEND_DIR%\surreal-process.json" (
    echo [STOP] Stopping SurrealDB started by this package...
    powershell.exe -NoProfile -Command "try { $p = Get-Content '%BACKEND_DIR%\surreal-process.json' -Raw | ConvertFrom-Json; if ($p.pid) { Stop-Process -Id $p.pid -Force -ErrorAction SilentlyContinue } } catch {}; Remove-Item '%BACKEND_DIR%\surreal-process.json' -Force -ErrorAction SilentlyContinue"
)
if exist "%BACKEND_DIR%\bin\surreal.exe" (
    echo [STOP] Stopping bundled SurrealDB...
    powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '%BACKEND_DIR%\bin\surreal.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
)

echo [DONE] Plant3D-Web offline services stopped.
echo.
pause
exit /b 0
