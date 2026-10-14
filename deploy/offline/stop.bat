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
    pushd "%NGINX_DIR%"
    nginx.exe -s quit 2>nul
    popd
    powershell.exe -NoProfile -Command "Start-Sleep -Seconds 2"
    tasklist /FI "IMAGENAME eq nginx.exe" 2>nul | find /I "nginx.exe" >nul
    if not errorlevel 1 taskkill /F /IM nginx.exe >nul 2>&1
)

if exist "%BACKEND_PROCESS%" (
    echo [STOP] Stopping integrated backend...
    powershell.exe -NoProfile -Command "$record = Get-Content '%BACKEND_PROCESS%' -Raw | ConvertFrom-Json; $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $record.pid) -ErrorAction SilentlyContinue; if ($process -and $process.ExecutablePath -eq $record.executable) { Stop-Process -Id $record.pid -Force; Remove-Item '%BACKEND_PROCESS%' -Force } elseif (-not $process) { Remove-Item '%BACKEND_PROCESS%' -Force } else { throw 'PID belongs to a different executable; refusing to stop it' }"
    if errorlevel 1 (
        echo [ERROR] Backend could not be stopped safely. Check %BACKEND_PROCESS%
        pause
        exit /b 1
    )
)

echo [DONE] Plant3D-Web offline services stopped.
echo.
pause
exit /b 0
