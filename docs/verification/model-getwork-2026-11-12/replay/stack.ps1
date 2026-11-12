<#
  沙箱的两台进程：一次性 SurrealDB（8199）+ 只监听被回放库的后端（9199）。
  二进制是现成程序的副本（sandbox\bin），库文件是副本（sandbox\projects），库目录、日志、临时文件全在 sandbox\run。

  -Prepare   派生配置、定环境变量，把实际生效的配置打进日志并逐项核对；有一处指向现网就退出码 3、什么都不起。
  -Start     先过内存闸门（空闲 ≥ MinFreeGB），再起两台进程，写 run\stack.json。
  -Restart   只重起后端（同一个库目录、同一份运行目录），可以换监听名单。
  -Stop      只按 stack.json 里记的进程号停，停之前核对进程路径在 sandbox\bin 下。
#>
param(
  [switch]$Prepare,
  [switch]$Start,
  [switch]$Restart,
  [switch]$Stop,
  [int[]]$Watch = @(8000, 7998),
  [int]$Port = 9199,
  [int]$SurrealPort = 8199,
  [int]$MinFreeGB = 10,
  [int]$GateWaitMinutes = 45
)
$ErrorActionPreference = 'Stop'
$sb = 'D:\work\plant-code\old\plant3d-web\.scratch\incremental-sync\sandbox'
$run = Join-Path $sb 'run'
$bin = Join-Path $sb 'bin'
$logs = Join-Path $sb 'logs'
$projects = Join-Path $sb 'projects\E3D3.1'
$baseConfig = 'D:\work\plant-code\old\gen-model\DbOption.toml'
$resourceSrc = 'D:\work\plant-code\old\gen-model\resource'
$stackPath = Join-Path $run 'stack.json'
$configPath = Join-Path $run 'DbOption.toml'
$secretPath = Join-Path $run 'sandbox-db.secret'
$log = Join-Path $logs 'stack.log'
$serverExe = Join-Path $bin 'aios-database.exe'
$surrealExe = Join-Path $bin 'surreal.exe'
New-Item -ItemType Directory -Force -Path $run, $logs | Out-Null

function Say([string]$text) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $text"
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}
function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}
function Get-FreeGB { [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1) }
function Get-DiskFreeGB([string]$drive) { [math]::Round((Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$drive'").FreeSpace / 1GB, 2) }
function Test-PortBusy([int]$PortNumber) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $PortNumber); return $true } catch { return $false } finally { $client.Dispose() }
}
function Get-Listener([int]$PortNumber) {
  @(Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}
$secretPattern = '(?i)pass|pwd|secret|token|user|auth|credential|apikey|api_key|access'

# 后端子进程的环境：先把继承来的、和后端或部署有关的变量全摘掉（只记名字），再放自己这几项。
$serverEnv = [ordered]@{
  DB_OPTION_FILE                         = (Join-Path $run 'DbOption')
  AIOS_STORE_MODE                        = 'rocksdb'
  AIOS_DATA_FACE                         = 'ingest'
  AIOS_STARTUP_AUTORUN                   = '1'
  AIOS_MODEL_GENERATION_INPUT_MAX_DBNUMS = '1'
  AIOS_MODEL_ELEMENT_CACHE_MAX_ENTRIES   = '60000'
  AIOS_WRITER_LOCK_DIR                   = (Join-Path $run 'writer-locks')
  PLANT_ASSET_ROOT                       = (Join-Path $run 'assets')
  GEN_MODEL_RUN_DIR                      = $run
  RUST_MIN_STACK                         = '134217728'
  TEMP                                   = (Join-Path $run 'tmp')
  TMP                                    = (Join-Path $run 'tmp')
}
$scrubPattern = '^(AIOS_|PLANT_|GEN_MODEL_|SURREAL|DB_OPTION|DATABASE_URL$|JWT_|RVM_|E3D_|L3_|AUX_DATA|MODEL_HISTORY|UPDATE_GROUP|AMS_|N5_)'

function Get-DerivedConfig {
  if (-not (Test-Path -LiteralPath $secretPath)) {
    $bytes = New-Object byte[] 18
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    Write-Utf8NoBom $secretPath ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', 'x')
  }
  $dbPass = (Get-Content -LiteralPath $secretPath -Raw).Trim()
  $project = $projects -replace '\\', '/'
  $overrides = [ordered]@{
    project_path               = "`"$project`""
    http_api_addr              = "`"127.0.0.1:$Port`""
    watch_dbnums               = "[$($Watch -join ', ')]"
    auto_initialize_new_dbnums = 'true'
    v_ip                       = '"127.0.0.1"'
    v_port                     = "$SurrealPort"
    v_user                     = '"sandbox"'
    v_password                 = "`"$dbPass`""
    # 下面几项这版后端的服务路径用不到，但本机上 1883（mosquitto）和 3306（mysqld）真有人在听：一律改到没人听的 9 号口。
    mqtt_host                  = '"127.0.0.1"'
    mqtt_port                  = '9'
    port                       = '"9"'
    kv_port                    = '"9"'
    arangodb_url               = '"http://127.0.0.1:9"'
    file_server_host           = '"http://127.0.0.1:9/assets/archives"'
    arangodb_user              = '"sandbox-unused"'
    arangodb_password          = '"sandbox-unused"'
    user                       = '"sandbox-unused"'
    password                   = '"sandbox-unused"'
    puhua_database_user        = '""'
    puhua_database_password    = '""'
  }
  $seen = @{}
  $out = [System.Collections.Generic.List[string]]::new()
  foreach ($line in (Get-Content -LiteralPath $baseConfig -Encoding UTF8)) {
    $trimmed = $line.Trim()
    if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
    if ($trimmed -notmatch '^([A-Za-z0-9_]+)\s*=') { throw "仓根配置里有认不出的一行（不是 键 = 值）：$($trimmed.Substring(0, [math]::Min(60, $trimmed.Length)))" }
    $key = $Matches[1]
    if ($overrides.Contains($key)) {
      $seen[$key] = $true
      $out.Add("$key = $($overrides[$key])")
    } else {
      $out.Add($trimmed)
    }
  }
  foreach ($key in $overrides.Keys) {
    if (-not $seen.ContainsKey($key)) { throw "仓根 DbOption.toml 里没有键 $key，派生不了配置" }
  }
  return [pscustomobject]@{ Lines = $out; DbPass = $dbPass; Overridden = @($overrides.Keys) }
}

function Invoke-Preflight([object]$derived) {
  $problems = [System.Collections.Generic.List[string]]::new()
  $forbidden = @('8009', '8022', 'D:/AVEVA', 'D:\AVEVA', 'gen-model/.surreal', 'gen-model\.surreal', '.surreal/ams', '.surreal\ams', 'plant-code/old/gen-model', 'plant-code\old\gen-model', '192.168.')
  Say '---- 实际生效的配置（run\DbOption.toml；账号密码类的值遮住）----'
  foreach ($line in $derived.Lines) {
    $key = ($line -split '=', 2)[0].Trim()
    $shown = if ($key -match $secretPattern) { "$key = <已遮住>" } else { $line }
    $mark = if ($derived.Overridden -contains $key) { '  ← 沙箱改写' } else { '' }
    Say "  $shown$mark"
    if ($key -match $secretPattern) { continue }
    foreach ($needle in $forbidden) {
      if ($line.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $problems.Add("配置 $key 里出现 `"$needle`"：$line") }
    }
  }
  Say '---- 配置里所有像地址、路径的值 ----'
  foreach ($line in $derived.Lines) {
    $key = ($line -split '=', 2)[0].Trim()
    if ($key -match $secretPattern) { continue }
    $value = ($line -split '=', 2)[1]
    if ($value -match '[A-Za-z]:[\\/]|https?://|localhost|\d+\.\d+\.\d+\.\d+|_port|_ip' -or $key -match '_port$|_ip$|^port$|^ip$|_addr$|_host|_url$|_path$') { Say "  $line" }
  }
  Say '---- 后端子进程的环境变量 ----'
  $inherited = @(Get-ChildItem Env: | Where-Object { $_.Name -match $scrubPattern } | Select-Object -ExpandProperty Name)
  Say "  从当前环境摘掉的（只记名字，不带给后端）：$(if ($inherited.Count) { $inherited -join ', ' } else { '无' })"
  foreach ($name in $serverEnv.Keys) {
    Say "  $name = $($serverEnv[$name])"
    foreach ($needle in $forbidden) {
      if (([string]$serverEnv[$name]).IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $problems.Add("环境变量 $name 里出现 `"$needle`"") }
    }
  }
  Say '---- 两台进程 ----'
  $store = Join-Path $run 'store'
  Say "  SurrealDB：$surrealExe start --bind 127.0.0.1:$SurrealPort rocksdb:$store（账号密码走 SURREAL_USER / SURREAL_PASS 环境变量，不上命令行）"
  Say "  后端：$serverExe（无参数），工作目录 $run"
  foreach ($text in @($surrealExe, $serverExe, $store, $run)) {
    if (-not $text.StartsWith($sb, [System.StringComparison]::OrdinalIgnoreCase)) { $problems.Add("路径不在沙箱下：$text") }
  }

  # 正面核对：该是什么就是什么。
  $value = @{}
  foreach ($line in $derived.Lines) { $parts = $line -split '=', 2; $value[$parts[0].Trim()] = ($parts[1] -replace '\s+#.*$', '').Trim() }
  $projectValue = $value['project_path'].Trim('"') -replace '/', '\'
  if (-not $projectValue.StartsWith($sb, [System.StringComparison]::OrdinalIgnoreCase)) { $problems.Add("project_path 不在沙箱下：$projectValue") }
  if (-not (Test-Path -LiteralPath $projectValue)) { $problems.Add("project_path 不存在：$projectValue") }
  if ($value['http_api_addr'] -ne "`"127.0.0.1:$Port`"") { $problems.Add("http_api_addr 不是 127.0.0.1:${Port}：$($value['http_api_addr'])") }
  if ($value['v_ip'] -ne '"127.0.0.1"' -or $value['v_port'] -ne "$SurrealPort") { $problems.Add("库地址不是 127.0.0.1:${SurrealPort}：$($value['v_ip']):$($value['v_port'])") }
  if ($value['watch_dbnums'] -ne "[$($Watch -join ', ')]") { $problems.Add("watch_dbnums 不对：$($value['watch_dbnums'])") }
  foreach ($key in 'project_search_paths', 'included_projects', 'remote_file_server_hosts') {
    if ($value.ContainsKey($key) -and $value[$key] -ne '[]') { $problems.Add("$key 不是空的：$($value[$key])") }
  }
  # 沙箱工程根里不许有 junction / 符号链接，也不许有硬链接（否则顺着它就到了真工程）。
  $reparse = @(Get-ChildItem -LiteralPath $projects -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue)
  if ($reparse.Count -gt 0) { $problems.Add("沙箱工程根里有 junction / 符号链接：$(($reparse | ForEach-Object { $_.FullName }) -join '; ')") }
  $reparseRun = @(Get-ChildItem -LiteralPath $run -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue)
  if ($reparseRun.Count -gt 0) { $problems.Add("运行目录里有 junction / 符号链接：$(($reparseRun | ForEach-Object { $_.FullName }) -join '; ')") }
  foreach ($name in $Watch) {
    $hits = @(Get-ChildItem -LiteralPath $projects -Recurse -File | Where-Object { $_.Name -match "^[a-z]{3}${name}_0001$" })
    foreach ($file in $hits) {
      $names = @(& fsutil hardlink list $file.FullName 2>$null | Where-Object { $_ -and $_.Trim() })
      if ($names.Count -ne 1) { $problems.Add("被监听的库文件是硬链接：$($file.FullName)") }
      Say "  被监听的库 $name 的文件：$($file.FullName)（$($file.Length) 字节，$($names.Count) 个名字）"
    }
    if ($hits.Count -eq 0) { $problems.Add("沙箱工程根里没有库 $name 的文件") }
  }
  Say "  现网进程（只看不动）：8022 由进程 $((Get-Listener 8022) -join ',') 监听，8009 由进程 $((Get-Listener 8009) -join ',') 监听"
  if ($problems.Count -gt 0) {
    Say "核对没过，共 $($problems.Count) 处，什么都不起："
    foreach ($problem in $problems) { Say "  ✗ $problem" }
    return $false
  }
  Say '核对通过：配置、环境变量、命令行里没有一处指向 8009 / 8022、真实工程目录、gen-model 的库目录或 gen-model 检出。'
  return $true
}

function Start-Server([object]$derived, [string]$tag) {
  New-Item -ItemType Directory -Force -Path $serverEnv.PLANT_ASSET_ROOT, $serverEnv.AIOS_WRITER_LOCK_DIR, $serverEnv.TEMP | Out-Null
  $saved = @{}
  $scrubbed = @(Get-ChildItem Env: | Where-Object { $_.Name -match $scrubPattern } | Select-Object -ExpandProperty Name)
  foreach ($name in $scrubbed) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  foreach ($name in $serverEnv.Keys) {
    if (-not $saved.ContainsKey($name)) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    [Environment]::SetEnvironmentVariable($name, $serverEnv[$name], 'Process')
  }
  try {
    return Start-Process -FilePath $serverExe -WorkingDirectory $run -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $run "$tag.log") -RedirectStandardError (Join-Path $run "$tag.err")
  } finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  }
}

function Wait-MemoryGate {
  $deadline = (Get-Date).AddMinutes($GateWaitMinutes)
  $announced = $false
  while ((Get-FreeGB) -lt $MinFreeGB) {
    if ((Get-Date) -ge $deadline) { Say "等了 $GateWaitMinutes 分钟，空闲内存还是不到 $MinFreeGB GB（现在 $(Get-FreeGB) GB），不起"; return $false }
    if (-not $announced) { Say "空闲内存 $(Get-FreeGB) GB，不到 $MinFreeGB GB，先不起，等它回升（最多 $GateWaitMinutes 分钟）"; $announced = $true }
    Start-Sleep -Seconds 15
  }
  Say "内存闸门通过：空闲 $(Get-FreeGB) GB ≥ $MinFreeGB GB；C 盘可用 $(Get-DiskFreeGB 'C:') GB，D 盘可用 $(Get-DiskFreeGB 'D:') GB；别的会话的 rustc $((Get-Process -Name rustc -ErrorAction SilentlyContinue | Measure-Object).Count) 个"
  return $true
}

function Stop-Sandbox([string[]]$which) {
  if (-not (Test-Path -LiteralPath $stackPath)) { Say '没有 stack.json，没有可停的'; return }
  $stack = Get-Content -LiteralPath $stackPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($name in $which) {
    $procId = [int]$stack.$name
    if (-not $procId) { continue }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
    if (-not $proc) { Say "$name 进程 $procId 已经不在"; continue }
    if (-not ([string]$proc.ExecutablePath).StartsWith($bin, [System.StringComparison]::OrdinalIgnoreCase)) {
      Say "进程 $procId 的路径不在沙箱下（$($proc.ExecutablePath)），不动它"
      continue
    }
    Stop-Process -Id $procId -Force
    Say "停了 $name 进程 $procId（$($proc.ExecutablePath)）"
  }
}

if ($Stop) {
  Stop-Sandbox @('server_pid', 'surreal_pid')
  Start-Sleep -Seconds 2
  Say "端口：$Port $(if (Test-PortBusy $Port) { '还有人在听' } else { '没人在听' })，$SurrealPort $(if (Test-PortBusy $SurrealPort) { '还有人在听' } else { '没人在听' })"
  return
}

$derived = Get-DerivedConfig
if ($Prepare -or $Start -or $Restart) {
  Say "===== $(if ($Prepare) { '准备' } elseif ($Start) { '启动' } else { '重起后端' })：监听 [$($Watch -join ', ')] ====="
  if (-not (Invoke-Preflight $derived)) { exit 3 }
  Write-Utf8NoBom $configPath (($derived.Lines -join "`n") + "`n")
  # resource 整个目录拷一份（小文本和字典），不用 junction。
  $resourceDst = Join-Path $run 'resource'
  if (-not (Test-Path -LiteralPath (Join-Path $resourceDst 'surreal'))) {
    Copy-Item -LiteralPath $resourceSrc -Destination $resourceDst -Recurse
    Say "拷了 resource：$((Get-ChildItem -LiteralPath $resourceDst -Recurse -File | Measure-Object).Count) 个文件"
  }
  Say "配置写到 $configPath"
}
if ($Prepare) { return }

if ($Start) {
  foreach ($portNumber in @($Port, $SurrealPort)) {
    if (Test-PortBusy $portNumber) { Say "端口 $portNumber 已被占用，不起"; exit 4 }
  }
  if ((Get-DiskFreeGB 'C:') -lt 3) { Say 'C 盘可用不到 3 GB，不起'; exit 5 }
  if (-not (Wait-MemoryGate)) { exit 97 }
  $store = Join-Path $run 'store'
  $saved = @{}
  $scrubbed = @(Get-ChildItem Env: | Where-Object { $_.Name -match $scrubPattern } | Select-Object -ExpandProperty Name)
  foreach ($name in $scrubbed) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  foreach ($pair in @(@('SURREAL_USER', 'sandbox'), @('SURREAL_PASS', $derived.DbPass), @('TEMP', $serverEnv.TEMP), @('TMP', $serverEnv.TMP))) {
    if (-not $saved.ContainsKey($pair[0])) { $saved[$pair[0]] = [Environment]::GetEnvironmentVariable($pair[0], 'Process') }
    [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
  }
  New-Item -ItemType Directory -Force -Path $serverEnv.TEMP | Out-Null
  try {
    $surreal = Start-Process -FilePath $surrealExe -WorkingDirectory $run -PassThru -WindowStyle Hidden `
      -ArgumentList @('start', '--bind', "127.0.0.1:$SurrealPort", "rocksdb:$store") `
      -RedirectStandardOutput (Join-Path $run 'surreal.log') -RedirectStandardError (Join-Path $run 'surreal.err')
  } finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  }
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-PortBusy $SurrealPort)) {
    if ($surreal.HasExited) { Say "SurrealDB 启动即退出（退出码 $($surreal.ExitCode)），看 $run\surreal.err"; exit 6 }
    if ((Get-Date) -gt $deadline) { Say "60 秒内 SurrealDB $SurrealPort 没有起来"; Stop-Process -Id $surreal.Id -Force; exit 6 }
    Start-Sleep -Milliseconds 500
  }
  Say "SurrealDB 起来了：进程 $($surreal.Id)，127.0.0.1:$SurrealPort，库目录 $store"
  $server = Start-Server $derived 'stdout'
  Say "后端起来了：进程 $($server.Id)，监听 [$($Watch -join ', ')]"
  $stack = [ordered]@{
    server_pid  = $server.Id
    surreal_pid = $surreal.Id
    base_url    = "http://127.0.0.1:$Port"
    surreal     = "127.0.0.1:$SurrealPort"
    watch       = $Watch
    run_dir     = $run
    started_at  = (Get-Date).ToString('o')
    restarts    = 0
  }
  Write-Utf8NoBom $stackPath ($stack | ConvertTo-Json -Depth 4)
  return
}

if ($Restart) {
  $stack = Get-Content -LiteralPath $stackPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Stop-Sandbox @('server_pid')
  $deadline = (Get-Date).AddSeconds(30)
  while (Test-PortBusy $Port) {
    if ((Get-Date) -gt $deadline) { Say "30 秒了 $Port 还有人在听，不重起"; exit 7 }
    Start-Sleep -Milliseconds 500
  }
  if (-not (Wait-MemoryGate)) { exit 97 }
  $restarts = [int]$stack.restarts + 1
  $server = Start-Server $derived "stdout-r$restarts"
  Say "后端重起了：进程 $($server.Id)，监听 [$($Watch -join ', ')]，日志 stdout-r$restarts.log"
  $stack.server_pid = $server.Id
  $stack.watch = $Watch
  $stack.restarts = $restarts
  $stack | Add-Member -NotePropertyName restarted_at -NotePropertyValue (Get-Date).ToString('o') -Force
  Write-Utf8NoBom $stackPath ($stack | ConvertTo-Json -Depth 4)
  return
}
