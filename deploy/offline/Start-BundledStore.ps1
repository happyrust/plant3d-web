# 一体化启动的前置：external（rocksdb）档要确保 backend\DbOption.toml 里 v_ip:v_port 上有
# 一台可连的 SurrealDB 2.x。介质分层：deploy.env 的 STORE_MODE pin > DbOption.toml 的
# store_mode（向导持久化）> 默认；mem 档不用库，直接放行。rocks 档下只读配置文件：
#   - 已监听 → 对正在跑的服务查 /version，主版本 2 放行（现场自管的库不强求包内 exe）；
#   - 未监听且指向回环 → 找可用的 surreal.exe（包内 bin\、PATH），二进制自报 2.x 才用，
#     用 rocksdb:<backend>\.surreal\ams 起一台并记 surreal-process.json 供 stop.bat 停；
#   - 未监听且指向外机 → 只警告放行，连不上由后端自己报。
# 离线包默认不含 bin\surreal.exe——现场那台就是来源。
param([int]$TimeoutSeconds = 90)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$configPath = Join-Path $backend 'DbOption.toml'
if (-not (Test-Path -LiteralPath $configPath)) { throw "Missing backend config: $configPath" }
$text = [System.IO.File]::ReadAllText($configPath)

# 生效介质：STORE_MODE pin > 文件 store_mode > 默认 rocksdb。只有 mem 档可以直接放行；
# 认不出的值与后端「按 rocksdb 兜底」同口径——宁可备着库，不能漏备。
$fileMode = [regex]::Match($text, '(?m)^\s*store_mode\s*=\s*["'']?([^"''#\r\n]+)').Groups[1].Value.Trim()
$mode = if ($env:STORE_MODE) { $env:STORE_MODE } elseif ($fileMode) { $fileMode } else { 'rocksdb' }
if ($mode -match '^(?i)(mem|memory|embedded-mem|kv-mem|spawned-mem)$') {
    Write-Output "STORE=mem (in-process); no SurrealDB needed"
    exit 0
}
$ipMatch = [regex]::Match($text, '(?m)^\s*v_ip\s*=\s*["'']?([^"''#\r\n]+)')
$vIp = if ($ipMatch.Success) { $ipMatch.Groups[1].Value.Trim() } else { '127.0.0.1' }
$portMatch = [regex]::Match($text, '(?m)^\s*v_port\s*=\s*"?(\d+)"?')
$vPort = if ($portMatch.Success) { [int]$portMatch.Groups[1].Value } else { 0 }
# 与 Start-Surreal.ps1 同一纪律：v_port=0 是出厂「未设置」哨兵，回落 8010。
if ($vPort -le 0) { $vPort = 8010 }
$requiredMajor = 2
$logRoot = Join-Path $backend 'logs'

function Test-StorePort {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect($vIp, $vPort)
        $client.Close()
        return $true
    } catch { return $false }
}
# 正在跑的库的版本。返回 @{major;raw}；连不上 HTTP 或认不出 surreal 应答时 major=$null。
function Get-StoreVersion {
    try {
        $response = Invoke-WebRequest -Uri ("http://{0}:{1}/version" -f $vIp, $vPort) -UseBasicParsing -TimeoutSec 5
        $raw = ($response.Content | Out-String).Trim()
        $match = [regex]::Match($raw, '(\d+)\.(\d+)')
        if ($match.Success) { return @{ major = [int]$match.Groups[1].Value; raw = $raw } }
        return @{ major = $null; raw = $raw }
    } catch { return @{ major = $null; raw = '' } }
}

if (Test-StorePort) {
    $ver = Get-StoreVersion
    if ($ver.major -eq $requiredMajor) {
        Write-Output ("STORE={0}:{1} already listening ({2}); bundled SurrealDB not started" -f $vIp, $vPort, $ver.raw)
        exit 0
    }
    throw ("{0}:{1} has a listener but it is not SurrealDB {2}.x (response: '{3}'). Stop it or repoint v_ip:v_port." -f $vIp, $vPort, $requiredMajor, $ver.raw)
}
$loopback = @('localhost', '127.0.0.1', '::1', '[::1]') -contains $vIp.ToLowerInvariant()
if (-not $loopback) {
    Write-Output "[WARN] v_ip=$vIp is not loopback; nothing listens on $vIp`:$vPort and no local store will be started. The backend fails if that address has no SurrealDB."
    exit 0
}

# 找一个自报 2.x 的 surreal.exe：包内（--with-surreal 变体或旧包）优先，PATH 兜底。
$candidates = @()
$bundled = Join-Path $backend 'bin\surreal.exe'
if (Test-Path -LiteralPath $bundled) { $candidates += $bundled }
$onPath = Get-Command surreal.exe -ErrorAction SilentlyContinue
if ($onPath -and $onPath.Source) { $candidates += $onPath.Source }
$exe = $null
foreach ($candidate in $candidates) {
    try { $verText = (& $candidate version 2>&1 | Out-String) } catch { continue }
    $match = [regex]::Match($verText, '(?<!\d)(\d+)\.(\d+)')
    if ($match.Success -and [int]$match.Groups[1].Value -eq $requiredMajor) { $exe = $candidate; break }
}
if (-not $exe) {
    throw ("No SurrealDB on {0}:{1} and no usable surreal {2}.x binary found (package ships no bin\surreal.exe; PATH has none). Install/start the repo fork 2.1.x, or repoint v_ip:v_port to a running instance." -f $vIp, $vPort, $requiredMajor)
}
# 与 Start-Surreal.ps1 同一条纪律：响应缓冲置 0，否则 Windows 上每次顺序 RPC 加 ~15ms。
if ([string]::IsNullOrEmpty($env:SURREAL_WEBSOCKET_RESPONSE_BUFFER_SIZE)) {
    $env:SURREAL_WEBSOCKET_RESPONSE_BUFFER_SIZE = '0'
}
New-Item -ItemType Directory -Force $logRoot | Out-Null
$log = Join-Path $logRoot ('surreal-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$datastore = 'rocksdb:' + (Join-Path $backend '.surreal\ams')
$redirected = '/c ""{0}" start --user root --pass root --bind "{1}" "{2}" 1>"{3}" 2>&1"' -f $exe, ('127.0.0.1:' + $vPort), $datastore, $log
Start-Process -FilePath $env:ComSpec -ArgumentList $redirected -WorkingDirectory $backend -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
    if (Test-StorePort) {
        $ver = Get-StoreVersion
        if ($ver.major -eq $requiredMajor) {
            $owner = Get-NetTCPConnection -LocalPort $vPort -State Listen -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty OwningProcess
            if ($owner) {
                @{ pid = $owner; executable = $exe; started_by = 'Start-BundledStore.ps1' } |
                    ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $backend 'surreal-process.json') -Encoding ascii
            }
            Write-Output ("STORE={0}:{1} ready ({2})" -f $vIp, $vPort, $ver.raw)
            exit 0
        }
        throw ("A store answered on {0}:{1} but is not SurrealDB {2}.x (response: '{3}'); see {4}" -f $vIp, $vPort, $requiredMajor, $ver.raw, $log)
    }
    Start-Sleep -Seconds 1
    if (-not (Get-CimInstance Win32_Process -Filter "Name='surreal.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -eq $exe })) {
        throw "SurrealDB ($exe) exited before listening on $vIp`:$vPort; see $log"
    }
} while ((Get-Date) -lt $deadline)
throw "SurrealDB did not listen on $vIp`:$vPort within ${TimeoutSeconds}s; see $log"
