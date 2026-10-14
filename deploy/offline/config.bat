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

echo ==========================================
echo   Plant3D-Web Offline Deploy - Config
echo ==========================================
echo.

:: Read existing config
set "BACKEND_ADDR=http://127.0.0.1:8022"
set "FRONTEND_PORT=80"
if exist "%CONFIG_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%CONFIG_FILE%") do (
        set "%%a=%%b"
    )
)

echo Current config:
echo   Backend (gen-model): %BACKEND_ADDR%
echo   Frontend port:       %FRONTEND_PORT%
echo   (Also listens on 3100 for PowerPMS compatibility)
echo.
echo Enter new values (press Enter to keep current):
echo.

set /p "NEW_BACKEND=Backend address [%BACKEND_ADDR%]: "
if not "%NEW_BACKEND%"=="" set "BACKEND_ADDR=%NEW_BACKEND%"

set /p "NEW_PORT=Frontend port [%FRONTEND_PORT%]: "
if not "%NEW_PORT%"=="" set "FRONTEND_PORT=%NEW_PORT%"

:: Save config
echo # Plant3D-Web Offline Deploy Config > "%CONFIG_FILE%"
echo # Edit this file or run config.bat to reconfigure >> "%CONFIG_FILE%"
echo BACKEND_ADDR=%BACKEND_ADDR% >> "%CONFIG_FILE%"
echo FRONTEND_PORT=%FRONTEND_PORT% >> "%CONFIG_FILE%"

echo.
echo ==========================================
echo   Config saved
echo ==========================================
echo.
echo   Backend:      %BACKEND_ADDR%
echo   Frontend:     %FRONTEND_PORT% (also 3100)
echo.
echo   Config file: %CONFIG_FILE%
echo.
echo   Run start.bat to start the service.
echo.
pause
exit /b 0
