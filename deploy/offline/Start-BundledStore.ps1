# 一体化启动的前置：rocksdb 档要确保 backend\DbOption.toml 里 v_ip:v_port 上有一台可连的
# SurrealDB。只读配置文件：库地址指向本机回环且没人监听时，用包内 Start-Surreal.ps1 起一台、
# 输出接 backend\logs\；指向外机时只探测不代起（那台库由现场自己管理）。mem 档不会走到这里。
param([int]$TimeoutSeconds = 90)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$configPath = Join-Path $backend 'DbOption.toml'
if (-not (Test-Path -LiteralPath $configPath)) { throw "Missing backend config: $configPath" }
$text = [System.IO.File]::ReadAllText($configPath)
$ipMatch = [regex]::Match($text, '(?m)^\s*v_ip\s*=\s*["'']?([^"''#\r\n]+)')
$vIp = if ($ipMatch.Success) { $ipMatch.Groups[1].Value.Trim() } else { '127.0.0.1' }
$portMatch = [regex]::Match($text, '(?m)^\s*v_port\s*=\s*"?(\d+)"?')
$vPort = if ($portMatch.Success) { [int]$portMatch.Groups[1].Value } else { 0 }
# 与 Start-Surreal.ps1 同一纪律：v_port=0 是出厂「未设置」哨兵，回落 8010。
if ($vPort -le 0) { $vPort = 8010 }
function Test-StorePort {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect($vIp, $vPort)
        $client.Close()
        return $true
    } catch { return $false }
}
if (Test-StorePort) {
    Write-Output "STORE=$vIp`:$vPort already listening; bundled SurrealDB not started"
    exit 0
}
$loopback = @('localhost', '127.0.0.1', '::1', '[::1]') -contains $vIp.ToLowerInvariant()
if (-not $loopback) {
    Write-Output "[WARN] v_ip=$vIp is not loopback; bundled SurrealDB not started. The backend connects to v_ip:v_port directly and fails if nothing listens there."
    exit 0
}
$surrealExe = Join-Path $backend 'bin\surreal.exe'
$launcher = Join-Path $backend 'Start-Surreal.ps1'
if (-not (Test-Path -LiteralPath $surrealExe)) { throw "Bundled store binary missing: $surrealExe" }
if (-not (Test-Path -LiteralPath $launcher)) { throw "Bundled store launcher missing: $launcher" }
$existing = Get-CimInstance Win32_Process -Filter "Name='surreal.exe'" | Where-Object { $_.ExecutablePath -eq $surrealExe }
if (-not $existing) {
    $logRoot = Join-Path $backend 'logs'
    New-Item -ItemType Directory -Force $logRoot | Out-Null
    $log = Join-Path $logRoot ('surreal-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
    # 与 Start-AMS.ps1 同一条路：cmd 接管输出重定向，本脚本侧不带子进程句柄，调它的批处理不会被套住。
    $redirected = '/c ""{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" 1>"{2}" 2>&1"' -f 'powershell.exe', $launcher, $log
    Start-Process -FilePath $env:ComSpec -ArgumentList $redirected -WorkingDirectory $backend -WindowStyle Hidden
}
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
    if (Test-StorePort) {
        Write-Output "STORE=$vIp`:$vPort ready"
        exit 0
    }
    Start-Sleep -Seconds 1
    $existing = Get-CimInstance Win32_Process -Filter "Name='surreal.exe'" | Where-Object { $_.ExecutablePath -eq $surrealExe }
    if (-not $existing) { throw "Bundled SurrealDB exited before listening on $vIp`:$vPort; see $logRoot" }
} while ((Get-Date) -lt $deadline)
throw "Bundled SurrealDB did not listen on $vIp`:$vPort within ${TimeoutSeconds}s; see $logRoot"
