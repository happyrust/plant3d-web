@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================================
:: Plant3D-Web 离线部署版 - 启动脚本
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "NGINX_DIR=%SCRIPT_DIR%nginx"
set "NGINX_EXE=%NGINX_DIR%\nginx.exe"
set "WWW_DIR=%SCRIPT_DIR%www"
set "CONFIG_FILE=%SCRIPT_DIR%config\deploy.env"

:: 读取配置
set "BACKEND_ADDR=http://127.0.0.1:8022"
set "FRONTEND_PORT=80"
if exist "%CONFIG_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%CONFIG_FILE%") do (
        set "%%a=%%b"
    )
)

echo ==========================================
echo   Plant3D-Web 离线部署版
echo ==========================================
echo.
echo   前端目录: %WWW_DIR%
echo   后端地址: %BACKEND_ADDR%
echo   监听端口: %FRONTEND_PORT% (同时监听 3100)
echo.

:: 检查 nginx 是否存在
if not exist "%NGINX_EXE%" (
    echo [错误] 找不到 nginx.exe: %NGINX_EXE%
    echo 请先运行打包脚本准备 nginx，或参考 README.md 手动准备。
    pause
    exit /b 1
)

:: 检查前端文件是否存在
if not exist "%WWW_DIR%\index.html" (
    echo [错误] 找不到前端文件: %WWW_DIR%\index.html
    echo 请确认 www 目录包含构建产物。
    pause
    exit /b 1
)

:: 检查端口是否被占用
netstat -ano | findstr ":%FRONTEND_PORT% " >nul 2>&1
if %errorlevel% equ 0 (
    echo [警告] 端口 %FRONTEND_PORT% 已被占用，尝试继续启动...
)

:: 更新 nginx 配置中的后端地址
call :update_nginx_config

:: 启动 nginx
echo [启动] 正在启动 nginx...
cd /d "%NGINX_DIR%"
start "Plant3D-Web Nginx" /min nginx.exe

:: 等待启动
timeout /t 2 /nobreak >nul

:: 验证启动
curl -s -o nul -w "%%{http_code}" "http://localhost:%FRONTEND_PORT%/" 2>nul >nul
if %errorlevel% equ 0 (
    echo.
    echo ==========================================
    echo   启动成功！
    echo ==========================================
    echo.
    echo   访问地址: http://localhost:%FRONTEND_PORT%/
    echo   或:       http://localhost:3100/
    echo   本机 IP:  http://^<本机IP^>:%FRONTEND_PORT%/
    echo.
    echo   按任意键在浏览器中打开...
    pause >nul
    start http://localhost:%FRONTEND_PORT%/
) else (
    echo.
    echo [错误] nginx 启动失败，请检查：
    echo   1. 端口 %FRONTEND_PORT% 和 3100 是否被占用
    echo   2. 查看日志: %NGINX_DIR%\logs\error.log
    pause
    exit /b 1
)

exit /b 0

:: ============================================================
:: 更新 nginx 配置中的后端地址
:: ============================================================
:update_nginx_config
set "NGINX_CONF=%NGINX_DIR%\conf\nginx.conf"
set "NGINX_CONF_BAK=%NGINX_DIR%\conf\nginx.conf.bak"

:: 备份原配置
if not exist "%NGINX_CONF_BAK%" copy /y "%NGINX_CONF%" "%NGINX_CONF_BAK%" >nul

:: 替换后端地址
powershell -Command "(Get-Content '%NGINX_CONF%' -Raw) -replace 'server 127\.0\.0\.1:8022;', 'server %BACKEND_ADDR:http://=%;' -replace 'set \$backend_addr \"http://127\.0\.0\.1:8022\";', 'set \$backend_addr \"%BACKEND_ADDR%\";' | Set-Content '%NGINX_CONF%' -NoNewline"

goto :eof
