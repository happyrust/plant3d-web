# Plant3D-Web 离线部署包 - 自动化测试脚本
# 测试内容：
#   1. nginx 配置语法检查
#   2. nginx 启动/停止
#   3. 静态文件访问（80 端口）
#   4. 兼容端口访问（3100 端口）
#   5. SPA fallback
#   6. API 代理连通性（如果后端可用）
#   7. version.json 版本信息

$ErrorActionPreference = "Continue"
$script:TestResults = @()
$script:PassCount = 0
$script:FailCount = 0

$OFFLINE_DIR = Join-Path $PSScriptRoot "..\deploy\offline"
$NGINX_DIR = Join-Path $OFFLINE_DIR "nginx"
$NGINX_EXE = Join-Path $NGINX_DIR "nginx.exe"
$WWW_DIR = Join-Path $OFFLINE_DIR "www"
$BACKEND_DIR = Join-Path $OFFLINE_DIR "backend"
$BACKEND_EXE = Join-Path $BACKEND_DIR "aios-database.exe"
$RELEASE_MANIFEST = Join-Path $OFFLINE_DIR "release.json"

function Write-TestHeader {
    param([string]$Title)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Write-TestResult {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail = ""
    )
    $status = if ($Passed) { "PASS" } else { "FAIL" }
    $color = if ($Passed) { "Green" } else { "Red" }
    $icon = if ($Passed) { "[OK]" } else { "[XX]" }
    
    Write-Host "  $icon $Name" -ForegroundColor $color
    if ($Detail) {
        Write-Host "       $Detail" -ForegroundColor Gray
    }
    
    $script:TestResults += [PSCustomObject]@{
        Name = $Name
        Passed = $Passed
        Detail = $Detail
    }
    
    if ($Passed) { $script:PassCount++ } else { $script:FailCount++ }
}

function Test-Command {
    param([string]$Name, [scriptblock]$Action)
    try {
        $result = & $Action
        Write-TestResult -Name $Name -Passed $true -Detail $result
        return $true
    } catch {
        Write-TestResult -Name $Name -Passed $false -Detail $_.Exception.Message
        return $false
    }
}

# ============================================================
# 前置检查
# ============================================================
Write-TestHeader "前置检查"

Test-Command "检查 nginx.exe 存在" {
    if (Test-Path $NGINX_EXE) { "找到: $NGINX_EXE" } else { throw "未找到 nginx.exe" }
}

Test-Command "检查 www 目录存在" {
    if (Test-Path $WWW_DIR) { "找到: $WWW_DIR" } else { throw "未找到 www 目录" }
}

Test-Command "检查 index.html 存在" {
    $indexPath = Join-Path $WWW_DIR "index.html"
    if (Test-Path $indexPath) { "找到: $indexPath" } else { throw "未找到 index.html" }
}

Test-Command "检查 version.json 存在" {
    $versionPath = Join-Path $WWW_DIR "version.json"
    if (Test-Path $versionPath) {
        $content = Get-Content $versionPath -Raw | ConvertFrom-Json
        "版本: $($content.version), Commit: $($content.commit.Substring(0,7))"
    } else { throw "未找到 version.json" }
}

Test-Command "检查集成后端存在" {
    if (Test-Path $BACKEND_EXE) { "找到: $BACKEND_EXE" } else { throw "未找到集成后端 aios-database.exe" }
}

Test-Command "检查后端运行资源" {
    $required = @("Start-AMS.ps1", "DbOption.toml", "resource\surreal", "schema", "web\pkg\rs-plant_bg.wasm")
    $missing = @($required | Where-Object { -not (Test-Path (Join-Path $BACKEND_DIR $_)) })
    if ($missing.Count -gt 0) { throw "缺少后端资源: $($missing -join ', ')" }
    "后端启动器、配置、数据库脚本、schema 和 Web 资源齐全"
}

Test-Command "检查前后端发布清单" {
    if (-not (Test-Path $RELEASE_MANIFEST)) { throw "未找到 release.json" }
    $manifest = Get-Content $RELEASE_MANIFEST -Raw | ConvertFrom-Json
    if ($manifest.mode -ne "integrated") { throw "发布模式不是 integrated: $($manifest.mode)" }
    if (-not $manifest.backend.version) { throw "发布清单缺少后端版本" }
    "前端 $($manifest.frontend.version), 后端 $($manifest.backend.version)"
}

# ============================================================
# 测试 1: nginx 配置语法
# ============================================================
Write-TestHeader "测试 1: Nginx 配置语法检查"

Push-Location $NGINX_DIR
$configTest = & $NGINX_EXE -t 2>&1
Pop-Location
$configOk = $configTest -match "syntax is ok" -and $configTest -match "test is successful"
Write-TestResult -Name "nginx 配置语法" -Passed $configOk -Detail ($configTest -join " | ")

# ============================================================
# 测试 2: 启动 nginx
# ============================================================
Write-TestHeader "测试 2: 启动 Nginx"

# 先确保没有残留进程
Get-Process nginx -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Push-Location $NGINX_DIR
$startResult = Start-Process -FilePath $NGINX_EXE -WindowStyle Hidden -PassThru
Pop-Location
Start-Sleep -Seconds 2

$nginxRunning = Get-Process nginx -ErrorAction SilentlyContinue
Write-TestResult -Name "nginx 进程启动" -Passed ($null -ne $nginxRunning) -Detail "PID: $($nginxRunning.Id)"

# ============================================================
# 测试 3: 静态文件访问（80 端口）
# ============================================================
Write-TestHeader "测试 3: 静态文件访问（80 端口）"

# 测试 version.json
try {
    $versionResp = Invoke-WebRequest -Uri "http://localhost/version.json" -UseBasicParsing -TimeoutSec 5
    $versionData = $versionResp.Content | ConvertFrom-Json
    Write-TestResult -Name "GET /version.json" -Passed ($versionResp.StatusCode -eq 200) `
        -Detail "版本: $($versionData.version), 状态码: $($versionResp.StatusCode)"
} catch {
    Write-TestResult -Name "GET /version.json" -Passed $false -Detail $_.Exception.Message
}

# 测试 index.html
try {
    $indexResp = Invoke-WebRequest -Uri "http://localhost/" -UseBasicParsing -TimeoutSec 5
    $hasApp = $indexResp.Content -match '<div id="app">'
    Write-TestResult -Name "GET / (index.html)" -Passed ($indexResp.StatusCode -eq 200 -and $hasApp) `
        -Detail "状态码: $($indexResp.StatusCode), 包含 #app: $hasApp"
} catch {
    Write-TestResult -Name "GET / (index.html)" -Passed $false -Detail $_.Exception.Message
}

# 测试 pms-review-simulator.html
try {
    $simResp = Invoke-WebRequest -Uri "http://localhost/pms-review-simulator.html" -UseBasicParsing -TimeoutSec 5
    Write-TestResult -Name "GET /pms-review-simulator.html" -Passed ($simResp.StatusCode -eq 200) `
        -Detail "状态码: $($simResp.StatusCode)"
} catch {
    Write-TestResult -Name "GET /pms-review-simulator.html" -Passed $false -Detail $_.Exception.Message
}

# 测试静态资源（JS/CSS）
try {
    $assetsResp = Invoke-WebRequest -Uri "http://localhost/" -UseBasicParsing -TimeoutSec 5
    if ($assetsResp.Content -match 'assets/index-[^"]+\.js') {
        $jsFile = $Matches[0]
        $jsResp = Invoke-WebRequest -Uri "http://localhost/$jsFile" -UseBasicParsing -TimeoutSec 5
        Write-TestResult -Name "GET 静态资源 (JS bundle)" -Passed ($jsResp.StatusCode -eq 200) `
            -Detail "文件: $jsFile, 状态码: $($jsResp.StatusCode)"
    } else {
        Write-TestResult -Name "GET 静态资源 (JS bundle)" -Passed $false -Detail "未找到 JS bundle 引用"
    }
} catch {
    Write-TestResult -Name "GET 静态资源 (JS bundle)" -Passed $false -Detail $_.Exception.Message
}

# ============================================================
# 测试 4: 兼容端口访问（3100 端口）
# ============================================================
Write-TestHeader "测试 4: 兼容端口访问（3100 端口 - PowerPMS 兼容）"

try {
    $version3100 = Invoke-WebRequest -Uri "http://localhost:3100/version.json" -UseBasicParsing -TimeoutSec 5
    $versionData = $version3100.Content | ConvertFrom-Json
    Write-TestResult -Name "GET :3100/version.json" -Passed ($version3100.StatusCode -eq 200) `
        -Detail "版本: $($versionData.version), 状态码: $($version3100.StatusCode)"
} catch {
    Write-TestResult -Name "GET :3100/version.json" -Passed $false -Detail $_.Exception.Message
}

try {
    $index3100 = Invoke-WebRequest -Uri "http://localhost:3100/" -UseBasicParsing -TimeoutSec 5
    Write-TestResult -Name "GET :3100/ (index.html)" -Passed ($index3100.StatusCode -eq 200) `
        -Detail "状态码: $($index3100.StatusCode)"
} catch {
    Write-TestResult -Name "GET :3100/ (index.html)" -Passed $false -Detail $_.Exception.Message
}

# ============================================================
# 测试 5: SPA Fallback
# ============================================================
Write-TestHeader "测试 5: SPA Fallback（前端路由）"

try {
    # 测试一个不存在的静态文件，应该 fallback 到 index.html
    $spaResp = Invoke-WebRequest -Uri "http://localhost/some/route/that/does/not/exist" -UseBasicParsing -TimeoutSec 5
    $isSpa = $spaResp.Content -match '<div id="app">'
    Write-TestResult -Name "SPA fallback 路由" -Passed ($spaResp.StatusCode -eq 200 -and $isSpa) `
        -Detail "状态码: $($spaResp.StatusCode), 返回 index.html: $isSpa"
} catch {
    Write-TestResult -Name "SPA fallback 路由" -Passed $false -Detail $_.Exception.Message
}

# ============================================================
# 测试 6: API 代理连通性
# ============================================================
Write-TestHeader "测试 6: API 代理连通性（后端 127.0.0.1:8022）"

# 检查后端是否可访问
$backendUp = $false
try {
    $healthResp = Invoke-WebRequest -Uri "http://127.0.0.1:8022/api/v1/health" -UseBasicParsing -TimeoutSec 3
    $backendUp = ($healthResp.StatusCode -eq 200)
} catch {
    # 后端可能未启动，这是正常的
}

if ($backendUp) {
    # 后端在线，测试代理
    try {
        $proxyResp = Invoke-WebRequest -Uri "http://localhost/api/v1/health" -UseBasicParsing -TimeoutSec 5
        Write-TestResult -Name "API 代理 /api/v1/health" -Passed ($proxyResp.StatusCode -eq 200) `
            -Detail "状态码: $($proxyResp.StatusCode), 响应: $($proxyResp.Content.Substring(0, [Math]::Min(100, $proxyResp.Content.Length)))"
    } catch {
        Write-TestResult -Name "API 代理 /api/v1/health" -Passed $false -Detail $_.Exception.Message
    }
} else {
    Write-TestResult -Name "集成后端健康检查" -Passed $false `
        -Detail "127.0.0.1:8022 未就绪；请先运行 deploy/offline/start.bat"
}

# ============================================================
# 测试 7: 响应头检查
# ============================================================
Write-TestHeader "测试 7: 响应头检查"

try {
    $resp = Invoke-WebRequest -Uri "http://localhost/version.json" -UseBasicParsing -TimeoutSec 5
    $cacheControl = $resp.Headers["Cache-Control"]
    $hasNoCache = $cacheControl -match "no-store"
    Write-TestResult -Name "Cache-Control 头 (version.json)" -Passed $hasNoCache -Detail "值: $cacheControl"
} catch {
    Write-TestResult -Name "Cache-Control 头 (version.json)" -Passed $false -Detail $_.Exception.Message
}

try {
    $resp = Invoke-WebRequest -Uri "http://localhost/" -UseBasicParsing -TimeoutSec 5
    $contentType = $resp.Headers["Content-Type"]
    $isHtml = $contentType -match "text/html"
    Write-TestResult -Name "Content-Type 头 (index.html)" -Passed $isHtml -Detail "值: $contentType"
} catch {
    Write-TestResult -Name "Content-Type 头 (index.html)" -Passed $false -Detail $_.Exception.Message
}

# ============================================================
# 测试 8: 停止 nginx
# ============================================================
Write-TestHeader "测试 8: 停止 Nginx"

Push-Location $NGINX_DIR
& $NGINX_EXE -s quit 2>&1 | Out-Null
Pop-Location
Start-Sleep -Seconds 2

$nginxStillRunning = Get-Process nginx -ErrorAction SilentlyContinue
Write-TestResult -Name "nginx 进程停止" -Passed ($null -eq $nginxStillRunning) -Detail "残留进程: $(if ($nginxStillRunning) { '是' } else { '无' })"

# ============================================================
# 测试报告
# ============================================================
Write-TestHeader "测试报告"

Write-Host ""
Write-Host "  测试结果汇总:" -ForegroundColor White
Write-Host "  ------------------------------------------" -ForegroundColor Gray

foreach ($result in $script:TestResults) {
    $status = if ($result.Passed -eq $true) { "PASS" } elseif ($result.Passed -eq $false) { "FAIL" } else { "SKIP" }
    $color = if ($result.Passed -eq $true) { "Green" } elseif ($result.Passed -eq $false) { "Red" } else { "Yellow" }
    $icon = if ($result.Passed -eq $true) { "[OK]" } elseif ($result.Passed -eq $false) { "[XX]" } else { "[--]" }
    Write-Host "    $icon $($result.Name)" -ForegroundColor $color
}

Write-Host ""
Write-Host "  ------------------------------------------" -ForegroundColor Gray
Write-Host "  通过: $script:PassCount  失败: $script:FailCount  跳过: $($script:TestResults.Count - $script:PassCount - $script:FailCount)" -ForegroundColor White
Write-Host "  ------------------------------------------" -ForegroundColor Gray

$totalTests = $script:PassCount + $script:FailCount
if ($totalTests -gt 0) {
    $passRate = [math]::Round($script:PassCount / $totalTests * 100, 1)
    Write-Host "  通过率: $passRate%" -ForegroundColor $(if ($passRate -eq 100) { "Green" } elseif ($passRate -ge 80) { "Yellow" } else { "Red" })
}

Write-Host ""
if ($script:FailCount -eq 0) {
    Write-Host "  [SUCCESS] 所有测试通过！离线部署包可以正常使用。" -ForegroundColor Green
} else {
    Write-Host "  [FAILED] 有 $script:FailCount 个测试失败，请检查上述错误。" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  测试完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 返回退出码
exit $script:FailCount
