<#
  造沙箱的工程根：把后端 MDB 闭包里的库文件真拷贝一份（不用 junction、不用硬链接），
  被回放的两个库（8000、7998）不拷真件，留给 db_session_fixture replay-init 写出来。
  对原件只读：只用 [System.IO.File]::Copy 读它们。
#>
param(
  [int]$MinFreeAfterGB = 12
)
$ErrorActionPreference = 'Stop'
$sb = 'D:\work\plant-code\old\plant3d-web\.scratch\incremental-sync\sandbox'
$srcRoot = 'D:\AVEVA\Projects\E3D3.1'
$dstRoot = Join-Path $sb 'projects\E3D3.1'
$log = Join-Path $sb 'logs\build-sandbox.log'
$replayed = @('ams8000_0001', 'ams7998_0001')

function Say([string]$text) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $text"
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8
}
function FreeGB([string]$drive) {
  [math]::Round((Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$drive'").FreeSpace / 1GB, 2)
}

$plan = Get-Content -LiteralPath (Join-Path $sb 'copy-plan.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$todo = [System.Collections.Generic.List[object]]::new()
foreach ($entry in $plan) {
  $srcDir = [string]$entry.dir
  if (-not $srcDir.StartsWith($srcRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "闭包目录不在工程根下：$srcDir" }
  $rel = $srcDir.Substring($srcRoot.Length).TrimStart('\')
  $names = @($entry.files | ForEach-Object { $_.name }) + @($entry.special | Where-Object { $_ -notmatch 'codex-before' })
  foreach ($name in $names) {
    if ($replayed -contains $name) { continue }
    $src = Join-Path $srcDir $name
    $item = Get-Item -LiteralPath $src
    if ($item.PSIsContainer) { continue }
    $todo.Add([pscustomobject]@{ Src = $src; Dst = (Join-Path (Join-Path $dstRoot $rel) $name); Size = $item.Length })
  }
}
$totalGB = [math]::Round((($todo | Measure-Object Size -Sum).Sum) / 1GB, 2)
$needGB = [math]::Round(((($todo | Where-Object { -not (Test-Path -LiteralPath $_.Dst) -or (Get-Item -LiteralPath $_.Dst).Length -ne $_.Size }) | Measure-Object Size -Sum).Sum) / 1GB, 2)
$freeD = FreeGB 'D:'
$freeC = FreeGB 'C:'
Say "要拷 $($todo.Count) 个文件共 $totalGB GB（还差 $needGB GB）；D 盘可用 $freeD GB，C 盘可用 $freeC GB"
if ($freeC -lt 3) { throw "C 盘可用不到 3 GB（$freeC），不做" }
if (($freeD - $needGB) -lt $MinFreeAfterGB) { throw "拷完 D 盘会剩不到 $MinFreeAfterGB GB（现在 $freeD，要拷 $needGB），不做" }

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$copied = 0
foreach ($job in $todo) {
  $dir = Split-Path -Parent $job.Dst
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if ((Test-Path -LiteralPath $job.Dst) -and (Get-Item -LiteralPath $job.Dst).Length -eq $job.Size) { continue }
  [System.IO.File]::Copy($job.Src, $job.Dst, $true)
  $copied++
}
$sw.Stop()
Say "拷了 $copied 个文件，用时 $([math]::Round($sw.Elapsed.TotalSeconds, 1)) 秒"

# 核对：大小逐个相等；没有 junction / 符号链接；每个文件只有一个名字（不是硬链接）；被回放的两个文件不存在真件的拷贝。
$bad = @($todo | Where-Object { -not (Test-Path -LiteralPath $_.Dst) -or (Get-Item -LiteralPath $_.Dst).Length -ne $_.Size })
if ($bad.Count -gt 0) { throw "这些文件没拷对：$(($bad | ForEach-Object { $_.Dst }) -join '; ')" }
$reparse = @(Get-ChildItem -LiteralPath $dstRoot -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue)
if ($reparse.Count -gt 0) { throw "沙箱工程根里有 junction / 符号链接：$(($reparse | ForEach-Object { $_.FullName }) -join '; ')" }
$linked = @()
foreach ($file in Get-ChildItem -LiteralPath $dstRoot -Recurse -File) {
  $names = @(& fsutil hardlink list $file.FullName 2>$null | Where-Object { $_ -and $_.Trim() })
  if ($names.Count -ne 1) { $linked += "$($file.FullName)（$($names.Count) 个名字）" }
}
if ($linked.Count -gt 0) { throw "沙箱工程根里有硬链接：$($linked -join '; ')" }
$all = Get-ChildItem -LiteralPath $dstRoot -Recurse -File
Say "核对通过：沙箱工程根 $($all.Count) 个文件，$([math]::Round((($all | Measure-Object Length -Sum).Sum) / 1GB, 2)) GB；没有 junction、没有硬链接"
foreach ($dir in Get-ChildItem -LiteralPath $dstRoot -Directory) {
  foreach ($db in Get-ChildItem -LiteralPath $dir.FullName -Directory) {
    $files = Get-ChildItem -LiteralPath $db.FullName -File
    Say ("  {0}\{1}: {2} 个文件 {3:N1} MB" -f $dir.Name, $db.Name, $files.Count, ((($files | Measure-Object Length -Sum).Sum) / 1MB))
  }
}
Say "D 盘可用 $(FreeGB 'D:') GB，C 盘可用 $(FreeGB 'C:') GB"
