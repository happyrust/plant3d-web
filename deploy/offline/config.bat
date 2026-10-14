@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================================
:: Plant3D-Web 离线部署版 - 配置脚本
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "CONFIG_DIR=%SCRIPT_DIR%config"
set "CONFIG_FILE=%CONFIG_DIR%\deploy.env"

if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

echo ==========================================
echo   Plant3D-Web 离线部署版 - 部署配置
echo ==========================================
echo.

:: 读取现有配置
set "BACKEND_ADDR=http://127.0.0.1:8022"
set "FRONTEND_PORT=80"
if exist "%CONFIG_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%CONFIG_FILE%") do (
        set "%%a=%%b"
    )
)

echo 当前配置:
echo   后端地址 (gen-model/aios-database): %BACKEND_ADDR%
echo   前端监听端口: %FRONTEND_PORT%
echo   (同时会监听 3100 端口，兼容 PowerPMS)
echo.
echo 请输入新配置（直接回车保持当前值）:
echo.

set /p "NEW_BACKEND=后端地址 [%BACKEND_ADDR%]: "
if not "%NEW_BACKEND%"=="" set "BACKEND_ADDR=%NEW_BACKEND%"

set /p "NEW_PORT=前端端口 [%FRONTEND_PORT%]: "
if not "%NEW_PORT%"=="" set "FRONTEND_PORT=%NEW_PORT%"

:: 保存配置
echo # Plant3D-Web 离线部署配置 > "%CONFIG_FILE%"
echo # 修改此文件或运行 config.bat 重新配置 >> "%CONFIG_FILE%"
echo BACKEND_ADDR=%BACKEND_ADDR% >> "%CONFIG_FILE%"
echo FRONTEND_PORT=%FRONTEND_PORT% >> "%CONFIG_FILE%"

echo.
echo ==========================================
echo   配置已保存
 echo ==========================================
echo.
echo   后端地址: %BACKEND_ADDR%
echo   前端端口: %FRONTEND_PORT% (同时监听 3100)
echo.
echo   配置文件: %CONFIG_FILE%
echo.
echo   请运行 start.bat 启动服务。
echo.
pause
exit /b 0
