@echo off
chcp 65001 >nul
setlocal

:: ============================================================
:: Plant3D-Web 离线部署版 - 停止脚本
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "NGINX_DIR=%SCRIPT_DIR%nginx"
set "NGINX_EXE=%NGINX_DIR%\nginx.exe"

echo ==========================================
echo   Plant3D-Web 离线部署版 - 停止服务
echo ==========================================
echo.

if not exist "%NGINX_EXE%" (
    echo [错误] 找不到 nginx.exe: %NGINX_EXE%
    pause
    exit /b 1
)

echo [停止] 正在停止 nginx...
cd /d "%NGINX_DIR%"
nginx.exe -s quit 2>nul

:: 等待进程退出
timeout /t 2 /nobreak >nul

:: 检查是否还有残留进程
tasklist /FI "IMAGENAME eq nginx.exe" 2>nul | find /I "nginx.exe" >nul
if %errorlevel% equ 0 (
    echo [强制] 强制结束残留进程...
    taskkill /F /IM nginx.exe >nul 2>&1
)

echo [完成] nginx 已停止。
echo.
pause
exit /b 0
