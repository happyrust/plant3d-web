<#
  把沙箱恢复到回放起点：停两台进程 → 清掉运行目录里后端和库写出来的东西 → 两个被回放的库文件重新从终稿切到基线 → 再起。
  只动 sandbox 目录里的东西；删目录之前先确认里面没有 junction / 符号链接。
#>
param(
  [int]$Base8000 = 1652,
  [int]$Base7998 = 675,
  [int[]]$Watch = @(8000, 7998),
  [string]$KeepLogsAs = ''
)
$ErrorActionPreference = 'Stop'
$sb = '<plant3d-web>\.scratch\incremental-sync\sandbox'
$run = Join-Path $sb 'run'
$fx = Join-Path $sb 'bin\db_session_fixture.debug-20261112.exe'
$dbdir = Join-Path $sb 'projects\E3D3.1\AvevaMarineSample\ams000'

& pwsh -NoProfile -File (Join-Path $sb 'stack.ps1') -Stop | Out-Host
Start-Sleep -Seconds 2
foreach ($port in 8199, 9199) {
  if (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) { throw "端口 $port 还有人在听，不清" }
}
$reparse = @(Get-ChildItem -LiteralPath $run -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue)
if ($reparse.Count -gt 0) { throw "运行目录里有 junction / 符号链接，不做递归删除：$(($reparse | ForEach-Object { $_.FullName }) -join '; ')" }
if ($KeepLogsAs) {
  $keep = Join-Path $sb "logs\$KeepLogsAs"
  New-Item -ItemType Directory -Force -Path $keep | Out-Null
  Get-ChildItem -LiteralPath $run -File | Where-Object { $_.Name -match '^(stdout|surreal).*\.(log|err)$' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $keep }
}
# 留下：DbOption.toml、sandbox-db.secret、resource；其余（库目录、网格、日志、锁、快照）都是这一轮跑出来的
foreach ($item in Get-ChildItem -LiteralPath $run -Force) {
  if ($item.Name -in 'DbOption.toml', 'sandbox-db.secret', 'resource') { continue }
  if (-not $item.FullName.StartsWith($run, [System.StringComparison]::OrdinalIgnoreCase)) { throw "路径不在运行目录下：$($item.FullName)" }
  Remove-Item -LiteralPath $item.FullName -Recurse -Force
}
foreach ($job in @(@{ name = 'ams8000_0001'; final = 'ams8000_0001.sesno1865'; to = $Base8000 }, @{ name = 'ams7998_0001'; final = 'ams7998_0001.sesno683'; to = $Base7998 })) {
  $work = Join-Path $dbdir $job.name
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Force }
  $out = & $fx replay-init --source (Join-Path $sb "finals\$($job.final)") --to $job.to --out $work 2>&1
  if ($LASTEXITCODE -ne 0) { throw "replay-init $($job.name) 失败：$out" }
  "replay-init $($job.name) → $($job.to)：$((Get-Item $work).Length) 字节"
}
"运行目录清好了，剩下：$((Get-ChildItem -LiteralPath $run -Force | Select-Object -ExpandProperty Name) -join ', ')"
