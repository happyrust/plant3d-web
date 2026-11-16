<#
  沙箱看门狗：每 5 秒看一次空闲内存、C 盘、D 盘和沙箱两台进程的占用。
  空闲内存 < 4 GB、C 盘 < 3 GB 或 D 盘 < 6 GB，就按 stack.json 里记的进程号把沙箱停掉（先核对路径在 sandbox\bin 下），
  写 logs\watchdog.TRIPPED 后退出。stack.json 不在了、或者两台进程都不在了，也退出。
  峰值记在 logs\watchdog-peaks.json，每 30 秒往 logs\watchdog.log 记一行。
#>
param(
  [double]$MinFreeMemGB = 4,
  [double]$MinFreeCGB = 3,
  [double]$MinFreeDGB = 6,
  [int]$PollSeconds = 5
)
$ErrorActionPreference = 'Continue'
$sb = 'D:\work\plant-code\old\plant3d-web\.scratch\incremental-sync\sandbox'
$bin = Join-Path $sb 'bin'
$stackPath = Join-Path $sb 'run\stack.json'
$log = Join-Path $sb 'logs\watchdog.log'
$peaksPath = Join-Path $sb 'logs\watchdog-peaks.json'
$tripPath = Join-Path $sb 'logs\watchdog.TRIPPED'

function Say([string]$text) { Add-Content -LiteralPath $log -Value "[$(Get-Date -Format 'HH:mm:ss')] $text" -Encoding UTF8 }
function FreeMemGB { [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2) }
function DiskFreeGB([string]$drive) { [math]::Round((Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$drive'").FreeSpace / 1GB, 2) }

$peaks = [ordered]@{
  started_at = (Get-Date).ToString('o'); samples = 0
  min_free_mem_gb = 999.0; min_free_mem_at = ''
  min_free_c_gb = 999.0; min_free_d_gb = 999.0
  max_server_ws_mb = 0.0; max_server_ws_at = ''; max_server_private_mb = 0.0
  max_surreal_ws_mb = 0.0; max_surreal_private_mb = 0.0
  max_foreign_rustc = 0
}
# 沙箱重置后看门狗会重起：接着上一次的峰值记（整轮验证只出一份峰值）
if (Test-Path -LiteralPath $peaksPath) {
  try {
    $previous = Get-Content -LiteralPath $peaksPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($name in @($peaks.Keys)) {
      if ($null -ne $previous.$name) { $peaks[$name] = $previous.$name }
    }
  } catch { }
}
Say "看门狗开始：空闲内存下限 $MinFreeMemGB GB，C 盘下限 $MinFreeCGB GB，D 盘下限 $MinFreeDGB GB"
$tick = 0
$missing = 0
while ($true) {
  if (-not (Test-Path -LiteralPath $stackPath)) {
    $missing++
    if ($missing -ge 6) { Say 'stack.json 不在了，看门狗退出'; break }
    Start-Sleep -Seconds $PollSeconds
    continue
  }
  $missing = 0
  $stack = Get-Content -LiteralPath $stackPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $server = Get-Process -Id ([int]$stack.server_pid) -ErrorAction SilentlyContinue
  $surreal = Get-Process -Id ([int]$stack.surreal_pid) -ErrorAction SilentlyContinue
  $mem = FreeMemGB
  $c = DiskFreeGB 'C:'
  $d = DiskFreeGB 'D:'
  $now = Get-Date -Format 'HH:mm:ss'
  $peaks.samples++
  if ($mem -lt $peaks.min_free_mem_gb) { $peaks.min_free_mem_gb = $mem; $peaks.min_free_mem_at = $now }
  if ($c -lt $peaks.min_free_c_gb) { $peaks.min_free_c_gb = $c }
  if ($d -lt $peaks.min_free_d_gb) { $peaks.min_free_d_gb = $d }
  $serverWs = 0.0; $serverPrivate = 0.0; $surrealWs = 0.0; $surrealPrivate = 0.0
  if ($server) {
    $serverWs = [math]::Round($server.WorkingSet64 / 1MB, 1); $serverPrivate = [math]::Round($server.PrivateMemorySize64 / 1MB, 1)
    if ($serverWs -gt $peaks.max_server_ws_mb) { $peaks.max_server_ws_mb = $serverWs; $peaks.max_server_ws_at = $now }
    if ($serverPrivate -gt $peaks.max_server_private_mb) { $peaks.max_server_private_mb = $serverPrivate }
  }
  if ($surreal) {
    $surrealWs = [math]::Round($surreal.WorkingSet64 / 1MB, 1); $surrealPrivate = [math]::Round($surreal.PrivateMemorySize64 / 1MB, 1)
    if ($surrealWs -gt $peaks.max_surreal_ws_mb) { $peaks.max_surreal_ws_mb = $surrealWs }
    if ($surrealPrivate -gt $peaks.max_surreal_private_mb) { $peaks.max_surreal_private_mb = $surrealPrivate }
  }
  $rustc = (Get-Process -Name rustc -ErrorAction SilentlyContinue | Measure-Object).Count
  if ($rustc -gt $peaks.max_foreign_rustc) { $peaks.max_foreign_rustc = $rustc }
  $peaks.last_at = $now
  [System.IO.File]::WriteAllText($peaksPath, ($peaks | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))

  $reason = $null
  if ($mem -lt $MinFreeMemGB) { $reason = "空闲内存 $mem GB 低于 $MinFreeMemGB GB" }
  elseif ($c -lt $MinFreeCGB) { $reason = "C 盘可用 $c GB 低于 $MinFreeCGB GB" }
  elseif ($d -lt $MinFreeDGB) { $reason = "D 盘可用 $d GB 低于 $MinFreeDGB GB" }
  if ($reason) {
    Say "触发：$reason——停沙箱"
    foreach ($procId in @([int]$stack.server_pid, [int]$stack.surreal_pid)) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
      if ($proc -and ([string]$proc.ExecutablePath).StartsWith($bin, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Say "停了进程 $procId（$($proc.ExecutablePath)）"
      }
    }
    [System.IO.File]::WriteAllText($tripPath, "$(Get-Date -Format 'o') $reason", (New-Object System.Text.UTF8Encoding $false))
    break
  }
  if (-not $server -and -not $surreal) { Say '沙箱两台进程都不在了，看门狗退出'; break }
  if ($tick % 6 -eq 0) {
    Say "空闲内存 $mem GB；C $c GB；D $d GB；后端 工作集 $serverWs MB / 私有 $serverPrivate MB；SurrealDB 工作集 $surrealWs MB / 私有 $surrealPrivate MB；rustc $rustc 个"
  }
  $tick++
  Start-Sleep -Seconds $PollSeconds
}
