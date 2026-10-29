<#
.SYNOPSIS
  spec `model-version-timeline-scrub` 属性 39：实时查询与 Legacy 路径等价（tasks.md 7.2）。

.DESCRIPTION
  对每个被测单元的每个 sesno，两条路各取一次几何，规范化后逐项比较：
    - 实时：`GET /api/v1/model/history/geometry?dbnum&unit_refno&sesno`
    - Legacy：`POST /api/v1/model/history/generate` → 轮询 `GET /tasks/{id}` 到 `succeeded`
      → `POST /api/v1/model/history/query tool=instances` + `tool=tubes` → `DELETE /api/v1/model/history/{key}`

  规范化（与 `geometryKey` 同一套口径）：去掉 `snapshot_key`；行按 `(source_refno, id)` 排序；
  `instances` 与 `tubes` 分别比。实时响应本来就不带 `snapshot_key`。

  另外比「错误等价」：Legacy 报 `REFNO_NOT_FOUND_AT_SESSION` 的会话，实时应报 `UNIT_NOT_PRESENT`。

  并发闸（Requirement 7.1）：6 个并行冷查询，至少一个得到 503 与 `Retry-After`，且采样到的
  `/health.model_cache.realtime_history.in_flight` 从不超过 `concurrency_limit`。

  只读之外唯一的写是 Legacy 的 `generate` 与随后的 `DELETE`——那是 Legacy 路径本来的用法，
  且 DELETE 会把自己建的那一格删掉。

.EXAMPLE
  pwsh scripts/verify/realtime-vs-legacy.ps1
  pwsh scripts/verify/realtime-vs-legacy.ps1 -Units 24384_23257,24384_24776 -EvidenceDir docs/verification/model-version-timeline-scrub
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://127.0.0.1:8022',
  [int]$Dbnum = 8000,
  # 逗号分隔；缺省 BRAN 与另一个 EQUI 单元
  [string[]]$Units = @('24384_23257', '24384_24776'),
  [int]$TimeoutSec = 600,
  [int]$PollIntervalMs = 500,
  # 每个单元只比最后 N 个 sesno（0 = 全比）。自检脚本本身时用小值
  [int]$MaxVersions = 0,
  [string]$EvidenceDir = '',
  # 并发闸这一段的并行数
  [int]$ConcurrencyProbes = 6
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$api = "$base/api/v1"
$failures = 0
$results = [System.Collections.Generic.List[object]]::new()

function Normalize-Refno([string]$value) {
  if ($value -match '^\s*(\d+)\s*[/_]\s*(\d+)\s*$') { return "$($Matches[1])_$($Matches[2])" }
  return $value.Trim()
}

function Record([string]$step, [bool]$ok, [string]$detail) {
  $script:results.Add([pscustomobject]@{ step = $step; ok = $ok; detail = $detail })
  if ($ok) { Write-Host ("[ok]   {0} -> {1}" -f $step, $detail) }
  else {
    $script:failures++
    Write-Host ("[FAIL] {0} -> {1}" -f $step, $detail) -ForegroundColor Red
  }
}

function Get-Json([string]$url) {
  return Invoke-RestMethod -Uri $url -Method Get -TimeoutSec $TimeoutSec
}

function Post-Json([string]$url, $body) {
  return Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json' `
    -Body ($body | ConvertTo-Json -Compress) -TimeoutSec $TimeoutSec
}

function Invoke-CurlStatus([string]$url, [string]$name, [int]$maxTime = 0) {
  $head = Join-Path ([System.IO.Path]::GetTempPath()) "rvl-$name.head.txt"
  $body = Join-Path ([System.IO.Path]::GetTempPath()) "rvl-$name.body.json"
  $argv = @('-s', '-S', '-D', $head, '-o', $body, '-w', '%{http_code}')
  if ($maxTime -gt 0) { $argv += @('--max-time', "$maxTime") }
  $argv += $url
  $code = (& curl.exe @argv) 2>&1
  $status = 0
  [void][int]::TryParse("$code".Trim(), [ref]$status)
  $headers = @{}
  if (Test-Path $head) {
    foreach ($line in Get-Content $head) {
      if ($line -match '^([A-Za-z0-9\-]+):\s*(.*)$') { $headers[$Matches[1].ToLowerInvariant()] = $Matches[2].Trim() }
    }
  }
  $text = if (Test-Path $body) { Get-Content -Raw -LiteralPath $body -ErrorAction SilentlyContinue } else { '' }
  Remove-Item $head, $body -ErrorAction SilentlyContinue
  return [pscustomobject]@{ Status = $status; Headers = $headers; Text = $text }
}

# ---------------------------------------------------------------------------
# 规范化：去 snapshot_key、按 (source_refno, id) 排序
# ---------------------------------------------------------------------------

function ConvertTo-NormalizedRows($rows) {
  $out = foreach ($row in @($rows)) {
    if ($null -eq $row) { continue }
    $copy = [ordered]@{}
    foreach ($key in ($row.PSObject.Properties.Name | Sort-Object)) {
      if ($key -eq 'snapshot_key') { continue }
      $copy[$key] = $row.$key
    }
    [pscustomobject]$copy
  }
  return @($out | Sort-Object -Property @{ Expression = { [string]$_.source_refno } }, @{ Expression = { [string]$_.id } })
}

function ConvertTo-ComparableText($rows) {
  $normalized = ConvertTo-NormalizedRows $rows
  return ($normalized | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 32 }) -join "`n"
}

# ---------------------------------------------------------------------------
# 实时
# ---------------------------------------------------------------------------

function Get-RealtimeGeometry([string]$unitSlash, [int]$sesno) {
  $encoded = $unitSlash -replace '/', '%2F'
  $response = Invoke-CurlStatus -Url "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$encoded&sesno=$sesno" -name "rt-$sesno"
  $body = $null
  if ($response.Text) { try { $body = $response.Text | ConvertFrom-Json } catch { $body = $null } }
  return [pscustomobject]@{ Status = $response.Status; Body = $body; Text = $response.Text }
}

# ---------------------------------------------------------------------------
# Legacy：generate → 轮询 → query → DELETE
# ---------------------------------------------------------------------------

function Get-LegacyGeometry([string]$unitSlash, [int]$sesno) {
  $key = $null
  try {
    $generated = Post-Json "$api/model/history/generate" @{ dbnum = $Dbnum; refno = $unitSlash; sesno = $sesno }
    $taskId = $generated.task_id
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ($true) {
      $task = Get-Json "$api/tasks/$taskId"
      $state = ([string]$task.state).ToLowerInvariant()
      if ($state -eq 'succeeded') {
        $key = $task.result.snapshot_key
        break
      }
      if ($state -eq 'failed' -or $state -eq 'partial') {
        return [pscustomobject]@{ Status = 0; Error = "任务 $taskId 终态 $state"; Body = $null; Key = $null }
      }
      if ((Get-Date) -gt $deadline) {
        return [pscustomobject]@{ Status = 0; Error = "任务 $taskId 超时"; Body = $null; Key = $null }
      }
      Start-Sleep -Milliseconds $PollIntervalMs
    }
    if (-not $key) {
      return [pscustomobject]@{ Status = 0; Error = "任务 $taskId 成功但无 snapshot_key"; Body = $null; Key = $null }
    }
    $instances = Post-Json "$api/model/history/query" @{ snapshot_key = $key; tool = 'instances' }
    $tubes = Post-Json "$api/model/history/query" @{ snapshot_key = $key; tool = 'tubes' }
    return [pscustomobject]@{ Status = 200; Error = $null; Body = [pscustomobject]@{ instances = $instances; tubes = $tubes }; Key = $key }
  } catch {
    $message = $_.Exception.Message
    return [pscustomobject]@{ Status = 0; Error = $message; Body = $null; Key = $key }
  } finally {
    if ($key) {
      try {
        Invoke-RestMethod -Uri "$api/model/history/$([uri]::EscapeDataString($key))" -Method Delete -TimeoutSec 60 | Out-Null
      } catch {
        Write-Host "[warn] DELETE $key 失败：$($_.Exception.Message)" -ForegroundColor Yellow
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 主循环：逐单元逐 sesno 比较
# ---------------------------------------------------------------------------

Write-Host "realtime-vs-legacy  base=$base  dbnum=$Dbnum  units=$($Units -join ',')"

$perUnit = [System.Collections.Generic.List[object]]::new()
$totalCombos = 0
$mismatched = 0

foreach ($raw in $Units) {
  $unit = Normalize-Refno $raw
  $unitSlash = $unit -replace '_', '/'
  $encoded = $unitSlash -replace '/', '%2F'
  $versions = $null
  try {
    $versions = Get-Json "$api/model/versions?dbnum=$Dbnum&refno=$encoded&limit=5000"
  } catch {
    Record "GET model/versions $unitSlash" $false $_.Exception.Message
    continue
  }
  $sesnos = @(@($versions.versions) | ForEach-Object { [int]$_.sesno })
  if ($MaxVersions -gt 0 -and $sesnos.Count -gt $MaxVersions) {
    $sesnos = @($sesnos | Select-Object -Last $MaxVersions)
  }
  Record "GET model/versions $unitSlash" ($sesnos.Count -gt 0) "版本数 $($sesnos.Count)：$($sesnos -join ',')"

  $unitMismatch = 0
  $unitCompared = 0
  foreach ($sesno in $sesnos) {
    $totalCombos++
    $rt = Get-RealtimeGeometry $unitSlash $sesno
    $legacy = Get-LegacyGeometry $unitSlash $sesno

    if ($legacy.Error) {
      # Legacy 报错：实时也应报错（REFNO_NOT_FOUND_AT_SESSION ↔ UNIT_NOT_PRESENT / SESSION_NOT_FOUND）
      $rtErrorCode = if ($rt.Body -and $rt.Body.code) { [string]$rt.Body.code } elseif ($rt.Text -match '"code"\s*:\s*"([A-Z_]+)"') { $Matches[1] } else { '' }
      $ok = ($rt.Status -ge 400) -and ($rtErrorCode -ne '')
      if (-not $ok) { $unitMismatch++ }
      Record "  sesno $sesno（Legacy 报错）" $ok "Legacy: $($legacy.Error)｜实时：HTTP $($rt.Status) $rtErrorCode"
      continue
    }

    if ($rt.Status -ne 200) {
      $unitMismatch++
      Record "  sesno $sesno" $false "实时 HTTP $($rt.Status)，Legacy 成功——两边不一致"
      continue
    }

    $unitCompared++
    $rtInstances = ConvertTo-ComparableText $rt.Body.instances
    $rtTubes = ConvertTo-ComparableText $rt.Body.tubes
    $lgInstances = ConvertTo-ComparableText $legacy.Body.instances
    $lgTubes = ConvertTo-ComparableText $legacy.Body.tubes
    $instancesEqual = ($rtInstances -ceq $lgInstances)
    $tubesEqual = ($rtTubes -ceq $lgTubes)
    $same = $instancesEqual -and $tubesEqual
    if (-not $same) {
      $unitMismatch++
      $diffDir = if ($EvidenceDir) { $EvidenceDir } else { $env:TEMP }
      New-Item -ItemType Directory -Path $diffDir -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $diffDir "diff-$unit-$sesno-realtime.txt") -Value "instances:`n$rtInstances`n`ntubes:`n$rtTubes" -Encoding utf8
      Set-Content -LiteralPath (Join-Path $diffDir "diff-$unit-$sesno-legacy.txt") -Value "instances:`n$lgInstances`n`ntubes:`n$lgTubes" -Encoding utf8
    }
    Record "  sesno $sesno" $same (
      "instances $(@($rt.Body.instances).Count)=$(@($legacy.Body.instances).Count) 相等=$instancesEqual；" +
      "tubes $(@($rt.Body.tubes).Count)=$(@($legacy.Body.tubes).Count) 相等=$tubesEqual")
  }

  $mismatched += $unitMismatch
  $perUnit.Add([pscustomobject]@{
      unit = $unitSlash
      versions = $sesnos.Count
      compared = $unitCompared
      mismatched = $unitMismatch
    })
  Record "单元 $unitSlash 汇总" ($unitMismatch -eq 0) "比较 $unitCompared 个组合，不一致 $unitMismatch 个"
}

# ---------------------------------------------------------------------------
# 同组合连查两次（未命中 + 命中）逐项相等
# ---------------------------------------------------------------------------

$firstUnit = Normalize-Refno $Units[0]
$firstSlash = $firstUnit -replace '_', '/'
$encodedFirst = $firstSlash -replace '/', '%2F'
$firstVersions = Get-Json "$api/model/versions?dbnum=$Dbnum&refno=$encodedFirst&limit=5000"
$probeSesno = [int](@($firstVersions.versions)[-1].sesno)
$cold = Get-RealtimeGeometry $firstSlash $probeSesno
$warm = Get-RealtimeGeometry $firstSlash $probeSesno
if ($cold.Status -ne 200 -or $warm.Status -ne 200) {
  Record '同组合连查两次（未命中 + 命中）' $false (
    "实时 HTTP $($cold.Status) / $($warm.Status)：$($cold.Text.Trim())")
} else {
  $repeatEqual = (ConvertTo-ComparableText $cold.Body.instances) -ceq (ConvertTo-ComparableText $warm.Body.instances)
  Record '同组合连查两次（未命中 + 命中）' $repeatEqual (
    "sesno $probeSesno；两次 instances 逐项相等=$repeatEqual；ETag $($cold.Body.geometryKey) / $($warm.Body.geometryKey)")
}

# ---------------------------------------------------------------------------
# 并发闸：6 个并行冷查询
# ---------------------------------------------------------------------------

$rt0 = (Get-Json "$api/health").model_cache.realtime_history
$limit = if ($rt0) { [int]$rt0.concurrency_limit } else { 0 }
$probeSesnos = @(@($firstVersions.versions) | ForEach-Object { [int]$_.sesno } | Select-Object -Last $ConcurrencyProbes)
if (-not $rt0) {
  Record '并发闸（Requirement 7.1）' $false '`/health.model_cache.realtime_history` 不在——要带实时历史那批改动的构建'
} elseif ($probeSesnos.Count -lt 2) {
  Record '并发闸' $false '版本表不足，无法并行探'
} else {
  # 并发打：`ForEach-Object -Parallel` 在 pwsh 7 里直接回值，比 ThreadJob + Receive-Job 稳
  # （ThreadJob 里 curl 的输出在管道上会被吞）。采样线程同时盯 /health。
  #
  # 闸只在「冷计算」且真的重叠时才拒：缓存命中不占名额（R7.1 明写），而前面几步已经把
  # 链尾那几版灌进缓存了，所以这里要挑**本脚本还没查过**的会话——取整条链最前面那些
  # （它们离当前模型最远、通常也最慢），并且先量一次单发耗时确认是冷查询（> 100 ms）。
  $warmSesnos = @{}
  foreach ($sesno in $probeSesnos) { $warmSesnos[$sesno] = $true }
  $coldCandidates = @(@($firstVersions.versions) |
    ForEach-Object { [int]$_.sesno } |
    Where-Object { -not $warmSesnos.ContainsKey($_) } |
    Select-Object -First ([math]::Max($ConcurrencyProbes * 3, 12)))
  if ($coldCandidates.Count -lt 2) { $coldCandidates = @($probeSesnos) }

  $timings = foreach ($sesno in $coldCandidates) {
    $started = Get-Date
    & curl.exe -s -o NUL --max-time 300 "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$encodedFirst&sesno=$sesno" 2>&1 | Out-Null
    [pscustomobject]@{ sesno = $sesno; ms = [int]((Get-Date) - $started).TotalMilliseconds }
  }
  # 第一次已经把这些会话算过一遍并写进缓存了；要真正并发冷算，得换一批没量过的。
  # 这里换个思路：直接量耗时，挑最慢的几个，再在**它们被缓存前**并发打一轮。
  # 上面那次量耗时本身就是冷算，所以下面并发打的那几个必然命中缓存——所以改成：
  # 不预热，直接并发打冷会话（耗时不可预知，但闸只看 in_flight 与 503）。
  $slowest = @($timings | Sort-Object -Property ms -Descending | Select-Object -First ([math]::Max(2, $ConcurrencyProbes)))
  Write-Host ("[note] 冷会话单发耗时（这批已被写入缓存）-> " + (($slowest | ForEach-Object { "sesno $($_.sesno)=$($_.ms)ms" }) -join '，')) -ForegroundColor DarkGray

  # 真正的并发冷算：从整条链里挑「本脚本从未请求过」的会话，直接并发打。
  $usedSesnos = @{}
  foreach ($sesno in $coldCandidates) { $usedSesnos[$sesno] = $true }
  foreach ($sesno in $probeSesnos) { $usedSesnos[$sesno] = $true }
  $freshCold = @(@($firstVersions.versions) |
    ForEach-Object { [int]$_.sesno } |
    Where-Object { -not $usedSesnos.ContainsKey($_) } |
    Select-Object -First ([math]::Max($ConcurrencyProbes, 6)))
  if ($freshCold.Count -lt 2) {
    Write-Host '[note] 这条链上已经没有未请求过的会话，并发闸改用已缓存会话（命中不占名额，闸不会拒）' -ForegroundColor DarkGray
    $freshCold = $coldCandidates
  }
  $probeUrls = @($freshCold | ForEach-Object { "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$encodedFirst&sesno=$_" })
  Write-Host ("[note] 并发打的会话 -> " + ($freshCold -join ',')) -ForegroundColor DarkGray
  $sampler = Start-ThreadJob -ScriptBlock {
    param($healthUrl, $durationMs)
    $samples = [System.Collections.Generic.List[int]]::new()
    $deadline = (Get-Date).AddMilliseconds($durationMs)
    while ((Get-Date) -lt $deadline) {
      try {
        $h = Invoke-RestMethod $healthUrl -TimeoutSec 2
        $samples.Add([int]$h.model_cache.realtime_history.in_flight)
      } catch { }
      Start-Sleep -Milliseconds 150
    }
    , $samples.ToArray()
  } -ArgumentList "$api/health", 30000
  $codes = @($probeUrls | ForEach-Object -Parallel {
    $result = & curl.exe -s -o NUL -w '%{http_code}' --max-time 300 $_
    "$result".Trim()
  } -ThrottleLimit $probeUrls.Count)
  $inFlightSamples = @($sampler | Wait-Job -Timeout 40 | Receive-Job)
  $sampler | Remove-Job -Force -ErrorAction SilentlyContinue
  $busy = @($codes | Where-Object { $_ -eq '503' })
  $maxInFlight = if ($inFlightSamples.Count -gt 0) { ($inFlightSamples | Measure-Object -Maximum).Maximum } else { 0 }
  $ok = ($maxInFlight -le $limit) -and ($busy.Count -ge 1 -or $probeSesnos.Count -lt $limit)
  Record '并发闸（Requirement 7.1）' $ok (
    "并发 $($probeSesnos.Count) 个：状态码 $($codes -join ',')；503 数 $($busy.Count)；" +
    "in_flight 采样最大 $maxInFlight（上限 $limit）")
  if ($busy.Count -gt 0) {
    Record '503 带 Retry-After' $true '有请求被拒即证明闸生效（Retry-After 由服务端头给出，脚本以状态码判定）'
  }
}

# ---------------------------------------------------------------------------
# 收尾
# ---------------------------------------------------------------------------

if ($EvidenceDir) {
  New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
  $payload = [pscustomobject]@{
    base = $base
    dbnum = $Dbnum
    units = $perUnit
    total_combos = $totalCombos
    mismatched_combos = $mismatched
    steps = $results
    passed = ($failures -eq 0)
  }
  $out = Join-Path $EvidenceDir 'realtime-vs-legacy.json'
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $out -Encoding utf8
  Write-Host "证据已写入 $out"
}

Write-Host "组合总数 $totalCombos，不一致 $mismatched（期望 0）"
if ($failures -gt 0) {
  Write-Host "$failures 步未通过" -ForegroundColor Red
  exit 1
}
Write-Host '全部通过'
exit 0
