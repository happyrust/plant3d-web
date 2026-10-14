@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================================
:: Plant3D-Web Offline Deploy - Configuration Script
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "CONFIG_DIR=%SCRIPT_DIR%config"
set "CONFIG_FILE=%CONFIG_DIR%\deploy.env"
if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

set "BACKEND_MODE=integrated"
set "BACKEND_ADDR=http://127.0.0.1:8022"
set "FRONTEND_PORT=80"
if exist "%CONFIG_FILE%" (
    for /f "usebackq tokens=1,* delims== eol=#" %%a in ("%CONFIG_FILE%") do set "%%a=%%b"
)
set "BACKEND_MODE=%BACKEND_MODE: =%"
set "BACKEND_ADDR=%BACKEND_ADDR: =%"
set "FRONTEND_PORT=%FRONTEND_PORT: =%"

echo ==========================================
echo   Plant3D-Web Offline Deploy - Config
echo ==========================================
echo.
echo Current config:
echo   Backend mode: %BACKEND_MODE%
echo   Backend:      %BACKEND_ADDR%
echo   Frontend port:%FRONTEND_PORT%
echo.
set /p "NEW_MODE=Backend mode, integrated or external [%BACKEND_MODE%]: "
if not "%NEW_MODE%"=="" set "BACKEND_MODE=%NEW_MODE%"
if /I "%BACKEND_MODE%"=="external" (
    set /p "NEW_BACKEND=External backend address [%BACKEND_ADDR%]: "
    if not "!NEW_BACKEND!"=="" set "BACKEND_ADDR=!NEW_BACKEND!"
) else (
    set "BACKEND_MODE=integrated"
    echo BACKEND_MODE=integrated>"%CONFIG_FILE%"
    echo Integrated configuration is managed by the AMS setup page.
    echo Run start.bat, then configure the project and all service ports in setup.
    pause
    exit /b 0
)
set /p "NEW_PORT=Frontend port [%FRONTEND_PORT%]: "
if not "%NEW_PORT%"=="" set "FRONTEND_PORT=%NEW_PORT%"

echo # Plant3D-Web Offline Deploy Config>"%CONFIG_FILE%"
echo BACKEND_MODE=%BACKEND_MODE%>>"%CONFIG_FILE%"
echo BACKEND_ADDR=%BACKEND_ADDR%>>"%CONFIG_FILE%"
echo FRONTEND_PORT=%FRONTEND_PORT%>>"%CONFIG_FILE%"

echo.
echo Config saved: %CONFIG_FILE%
echo   Backend mode: %BACKEND_MODE%
echo   Backend:      %BACKEND_ADDR%
echo   Frontend:     %FRONTEND_PORT% (also 3100)
echo.
pause
exit /b 0
