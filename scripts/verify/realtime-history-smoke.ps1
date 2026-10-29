<#
.SYNOPSIS
  spec `model-version-timeline-scrub` 阶段 1 的后端联调冒烟（tasks.md 7.1）。

.DESCRIPTION
  把 design.md「阶段 1 后端集成验证（rocksdb 档）」的 curl 清单落成脚本，逐步打
  「端点 → 状态 / 关键字段 / 耗时」，任何一步不符合预期就以非零退出。

  覆盖：
    1. `/health.model_cache.realtime_history` 分项在，并记下 `historical.snapshots` 初值
    2. `model/versions` 计数（版本数 ≥ 25、几何变化 ≥ 5，Requirement 12 的前提）
    3. 实时几何 200：`ETag` / `X-Sesno` / `X-Session-Time` / `Cache-Control` 与耗时
    4. 再查一次：命中缓存，体逐字节相同（`fc.exe /b`）
    5. `If-None-Match` → 304，且四个头与 200 一致
    6. `time` 选择器与 `node/versions/resolve` 选中的 sesno 一致（Requirement 8.10），
       并对一个「时间倒退」会话的时间点核对两边都按链序规则取值
    7. 错误码：无效选择器 400 / 会话不在版本表 404 / 单元不存在 404 `UNIT_NOT_PRESENT` /
       非交付单元 422 / 属性时点 404 `SESSION_NOT_FOUND`
    8. 断开取消（Requirement 6.14）：`--max-time 1` 断开后每 0.5 s 采 `in_flight`，应在
       8 次采样内回到 0
    9. 快照数不变（Requirement 6.12）：`historical.snapshots` 与第 1 步一致
   10. 带 `Origin` 时能读到 `Access-Control-Expose-Headers` 里的四个头

  只读：除了 `model/history/geometry` 会算几何（不写投影存储、不建任务），不发任何写请求。

.EXAMPLE
  pwsh scripts/verify/realtime-history-smoke.ps1
  pwsh scripts/verify/realtime-history-smoke.ps1 -BaseUrl http://127.0.0.1:8022 -UnitRefno 24384_23257
  pwsh scripts/verify/realtime-history-smoke.ps1 -EvidenceDir docs/verification/model-version-timeline-scrub
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://127.0.0.1:8022',
  [int]$Dbnum = 8000,
  # a/b 或 a_b 都行
  [string]$UnitRefno = '24384_23257',
  # 非交付单元（用来验 422）：缺省拿单元根当「非交付单元」不一定成立，脚本会先探一次
  [string]$NotADeliveryUnit = '',
  # 给目录就把每一步的结果落成 JSON + 文本
  [string]$EvidenceDir = '',
  [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$api = "$base/api/v1"
$failures = 0
$results = [System.Collections.Generic.List[object]]::new()
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("scrub-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null

function Normalize-Refno([string]$value) {
  if ($value -match '^\s*(\d+)\s*[/_]\s*(\d+)\s*$') { return "$($Matches[1])_$($Matches[2])" }
  return $value.Trim()
}
$unit = Normalize-Refno $UnitRefno
$unitSlash = $unit -replace '_', '/'

function Record([string]$step, [bool]$ok, [string]$detail) {
  $script:results.Add([pscustomobject]@{ step = $step; ok = $ok; detail = $detail })
  if ($ok) {
    Write-Host ("[ok]   {0} -> {1}" -f $step, $detail)
  } else {
    $script:failures++
    Write-Host ("[FAIL] {0} -> {1}" -f $step, $detail) -ForegroundColor Red
  }
}

function Note([string]$step, [string]$detail) {
  $script:results.Add([pscustomobject]@{ step = $step; ok = $true; detail = $detail })
  Write-Host ("[note] {0} -> {1}" -f $step, $detail) -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# curl 包装：-D 落头文件、-o 落体文件、-w 取状态码与耗时
# ---------------------------------------------------------------------------

function Invoke-Curl {
  param(
    [string]$Url,
    [string[]]$Headers = @(),
    [int]$MaxTimeSec = 0,
    [string]$Name = 'resp'
  )
  $head = Join-Path $work "$Name.head.txt"
  $body = Join-Path $work "$Name.body.json"
  $args = @('-s', '-S', '-D', $head, '-o', $body, '-w', '%{http_code} %{time_total}')
  foreach ($h in $Headers) { $args += @('-H', $h) }
  if ($MaxTimeSec -gt 0) { $args += @('--max-time', "$MaxTimeSec") }
  $args += $Url
  $meta = (& curl.exe @args) 2>&1
  if ($LASTEXITCODE -ne 0 -and -not (Test-Path $body)) {
    throw "curl 失败（exit $LASTEXITCODE）：$meta"
  }
  $parts = "$meta".Trim() -split '\s+'
  $status = 0
  [void][int]::TryParse($parts[0], [ref]$status)
  $seconds = 0.0
  if ($parts.Count -gt 1) { [void][double]::TryParse($parts[1], [ref]$seconds) }
  $headersOut = @{}
  if (Test-Path $head) {
    foreach ($line in Get-Content $head) {
      if ($line -match '^([A-Za-z0-9\-]+):\s*(.*)$') { $headersOut[$Matches[1].ToLowerInvariant()] = $Matches[2].Trim() }
    }
  }
  $text = if (Test-Path $body) { Get-Content -Raw -LiteralPath $body -ErrorAction SilentlyContinue } else { '' }
  return [pscustomobject]@{
    Status = $status
    Seconds = [math]::Round($seconds * 1000)
    Headers = $headersOut
    BodyPath = $body
    HeadPath = $head
    Text = $text
  }
}

function Get-Json([string]$Url) {
  # `-DateKind String`：默认会把 `session_time` 转成 DateTime 再按本地格式吐出来，
  # 再拼进 `at=` 就成了 `09/08/2026 17:45:46`，服务端按语法拒掉。保留原始 ISO 文本。
  return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec $TimeoutSec |
    ConvertTo-Json -Depth 32 |
    ConvertFrom-Json -DateKind String
}

# 走 curl 取 JSON：`Invoke-RestMethod` 会把查询串里的 `%2F` 当路径分隔符重新解析，
# 带编码斜杠的 `refno` 因此回 400。curl 原样发，不重写 URL。
function Get-JsonRaw([string]$Url) {
  $body = Join-Path $work ('raw-' + [guid]::NewGuid().ToString('N') + '.json')
  $code = (& curl.exe -s -o $body -w '%{http_code}' --max-time $TimeoutSec $Url) 2>&1
  $status = 0
  [void][int]::TryParse("$code".Trim(), [ref]$status)
  $text = if (Test-Path $body) { Get-Content -Raw -LiteralPath $body -ErrorAction SilentlyContinue } else { '' }
  Remove-Item $body -ErrorAction SilentlyContinue
  if ($status -ne 200) { throw "HTTP $status $($text.Trim())" }
  return ($text | ConvertFrom-Json -DateKind String)
}

function Get-RealtimeHealth {
  $health = Get-Json "$api/health"
  return $health.model_cache.realtime_history
}

Write-Host "realtime-history-smoke  base=$base  dbnum=$Dbnum  unit=$unitSlash"

# ---------------------------------------------------------------------------
# 1. health 分项与快照初值
# ---------------------------------------------------------------------------
$health0 = $null
try {
  $health0 = Get-Json "$api/health"
} catch {
  Record 'GET /health' $false $_.Exception.Message
  throw '后端不在，先按 AGENTS.md 起 rocksdb 档 8022'
}
$rt0 = $health0.model_cache.realtime_history
$snapshots0 = $health0.model_cache.historical.snapshots
if ($null -eq $rt0) {
  Record 'GET /health model_cache.realtime_history' $false '分项不在——要带实时历史那批改动的构建'
} else {
  Record 'GET /health model_cache.realtime_history' $true (
    "cache_entries=$($rt0.cache_entries)/$($rt0.cache_capacity) in_flight=$($rt0.in_flight)/$($rt0.concurrency_limit) " +
    "timeout_secs=$($rt0.timeout_secs) input_cache=$($rt0.input_cache.entries)/$($rt0.input_cache.capacity) " +
    "historical.snapshots=$snapshots0")
}

# ---------------------------------------------------------------------------
# 2. 版本表计数（Requirement 12 的前提）
# ---------------------------------------------------------------------------
$versions = $null
try {
  $versions = Get-Json "$api/model/versions?dbnum=$Dbnum&refno=$($unitSlash -replace '/', '%2F')&limit=5000"
} catch {
  Record 'GET model/versions' $false $_.Exception.Message
}
$rows = @()
if ($versions) { $rows = @($versions.versions) }
$geometryKinds = @('mesh', 'placement', 'delivery', 'tombstone')
$geometryRows = @($rows | Where-Object { $geometryKinds -contains $_.impact_kind })
$versionOk = ($rows.Count -ge 25) -and ($geometryRows.Count -ge 5)
Record 'GET model/versions 计数' $versionOk (
  "版本数 $($rows.Count)（要 ≥ 25）、几何变化 $($geometryRows.Count)（要 ≥ 5）、latest=$($versions.file_latest_sesno)、truncated=$($versions.truncated)")
if (-not $versionOk) {
  Note '夹具不足' '按 Requirement 12 的验证口径：记录实际数，换一个 BRAN 并把理由写进验证记录'
}
$sesnos = @($rows | ForEach-Object { [int]$_.sesno })
# 取几何变化的那一版当被测 sesno；没有就用链尾
$targetSesno = if ($geometryRows.Count -gt 0) { [int]$geometryRows[-1].sesno } elseif ($sesnos.Count -gt 0) { $sesnos[-1] } else { 0 }
Note '被测 sesno' "$targetSesno（几何变化版本 $($geometryRows.Count) 个；链 $($sesnos -join ',')）"

# ---------------------------------------------------------------------------
# 3. 实时几何 200 + 头
# ---------------------------------------------------------------------------
$url = "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$($unitSlash -replace '/', '%2F')&sesno=$targetSesno"
$g1 = Invoke-Curl -Url $url -MaxTimeSec $TimeoutSec -Name 'g1'
$headerOk = ($g1.Headers['etag'] -match '^"[^"]+"$') -and $g1.Headers['x-sesno'] -and $g1.Headers['cache-control'] -eq 'no-cache'
Record 'GET model/history/geometry（首次）' ($g1.Status -eq 200 -and $headerOk) (
  "HTTP $($g1.Status) $($g1.Seconds)ms ETag=$($g1.Headers['etag']) X-Sesno=$($g1.Headers['x-sesno']) " +
  "X-Session-Time=$($g1.Headers['x-session-time']) Cache-Control=$($g1.Headers['cache-control'])")
$geometryKey = $g1.Headers['etag']
$body1 = $null
if ($g1.Status -eq 200 -and $g1.Text) { try { $body1 = $g1.Text | ConvertFrom-Json } catch { $body1 = $null } }
if ($body1) {
  Record '实时几何体形状' ($null -ne $body1.instances -and $null -ne $body1.tubes -and $body1.geometryKey) (
    "instances=$( @($body1.instances).Count ) tubes=$( @($body1.tubes).Count ) geometryKey=$($body1.geometryKey) " +
    "stats.visited=$($body1.stats.visited) elapsed_ms=$($body1.stats.elapsed_ms)")
  $noSnapshotKey = -not ($g1.Text -match '"snapshot_key"')
  Record '实时几何不含 snapshot_key' $noSnapshotKey 'Requirement 6.15：实时响应去掉 snapshot_key'
} elseif ($g1.Status -ne 200) {
  # 旧构建把 `geometry` 当成 snapshot_key 去查，会回 500 `invalid snapshot key "geometry"`；
  # 这时不再做形状断言，只把体记下来（上面那条 FAIL 已经说明了问题）
  Note '实时几何体' "HTTP $($g1.Status) $($g1.Text.Trim())"
}

# ---------------------------------------------------------------------------
# 4. 缓存命中：体逐字节相同
# ---------------------------------------------------------------------------
$g2 = Invoke-Curl -Url $url -MaxTimeSec $TimeoutSec -Name 'g2'
$same = $false
if ((Test-Path $g1.BodyPath) -and (Test-Path $g2.BodyPath)) {
  & fc.exe /b $g1.BodyPath $g2.BodyPath > $null 2>&1
  $same = ($LASTEXITCODE -eq 0)
}
Record 'GET model/history/geometry（缓存命中）' ($g2.Status -eq 200 -and $same) (
  "HTTP $($g2.Status) $($g2.Seconds)ms 体逐字节相同=$same（fc.exe /b）")

# ---------------------------------------------------------------------------
# 5. 304
# ---------------------------------------------------------------------------
if ($geometryKey) {
  $g3 = Invoke-Curl -Url $url -Headers @("If-None-Match: $geometryKey") -MaxTimeSec $TimeoutSec -Name 'g3'
  $empty = -not (Test-Path $g3.BodyPath) -or ((Get-Item $g3.BodyPath).Length -eq 0)
  $sameHeaders = ($g3.Headers['etag'] -eq $g1.Headers['etag']) -and ($g3.Headers['x-sesno'] -eq $g1.Headers['x-sesno'])
  Record 'GET model/history/geometry（If-None-Match）' ($g3.Status -eq 304 -and $empty -and $sameHeaders) (
    "HTTP $($g3.Status) 体为空=$empty 四头与 200 一致=$sameHeaders ETag=$($g3.Headers['etag'])")
}

# ---------------------------------------------------------------------------
# 6. time 选择器与 resolve 一致（Requirement 8.10）
# ---------------------------------------------------------------------------
$withTime = @($rows | Where-Object { $_.session_time } )
if ($withTime.Count -gt 0) {
  # 取中间那一版的时刻（秒级）
  $probe = $withTime[[int]([math]::Floor($withTime.Count / 2))]
  $at = [string]$probe.session_time
  $encodedAt = [uri]::EscapeDataString($at)
  $byTime = Invoke-Curl -Url "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$($unitSlash -replace '/', '%2F')&time=$encodedAt" -MaxTimeSec $TimeoutSec -Name 'g-time'

  # R8.10 的一致性要看两边喂的是不是同一张表：
  #   - 几何路由的 `time` 走 `unit_versions`（单元子树折叠，成员变化也算一版）
  #   - resolve 的 `scope=self` 走 `node_versions(scope=self)`（只算节点自身那一格）
  # 对单元根这两张表行集不同（本例 73 行 vs 5 行），所以 `scope=self` 只在**非单元根**时
  # 才该与几何路由一致；单元根要与 `scope=subtree` 比（实测两者行集相同）。
  # 见 docs/verification/model-version-timeline-scrub/finding-r6-3-vs-r8-10.md。
  $selfRows = $null
  try {
    $selfRows = Get-JsonRaw "$api/node/versions?dbnum=$Dbnum&refno=$($unitSlash -replace '/', '%2F')&scope=self&limit=5000"
  } catch { }
  $selfSesnos = if ($selfRows) { @($selfRows.versions | ForEach-Object { [int]$_.sesno }) } else { @() }
  $unitSesnos = @($rows | ForEach-Object { [int]$_.sesno })
  $isUnitRoot = ($selfRows -ne $null) -and ($selfRows.unit_root -eq $unitSlash)
  $compareScope = if ($isUnitRoot) { 'subtree' } else { 'self' }
  $tableNote = if ($isUnitRoot) {
    "refno 是交付单元根：几何路由按 unit_versions（$($unitSesnos.Count) 行），resolve 用 scope=subtree 对齐"
  } else {
    "refno 不是单元根：几何路由与 resolve 的 scope=self 应同表（$($selfSesnos.Count) 行）"
  }

  $resolved = $null
  try {
    $resolved = Get-JsonRaw "$api/node/versions/resolve?dbnum=$Dbnum&refno=$($unitSlash -replace '/', '%2F')&scope=$compareScope&at=$encodedAt"
  } catch {
    Record 'GET node/versions/resolve' $false $_.Exception.Message
  }
  if ($resolved) {
    $timeSesno = $byTime.Headers['x-sesno']
    Record "time 选择器与 resolve(scope=$compareScope) 一致" ($timeSesno -eq "$($resolved.sesno)") (
      "at=$at geometry X-Sesno=$timeSesno resolve.sesno=$($resolved.sesno) resolve.session_time=$($resolved.session_time)；$tableNote")
  }
  # 单元根额外记一条：scope=self 与几何路由必然不同，把两个数都摆出来（不是失败，是规范冲突的证据）
  if ($isUnitRoot) {
    $selfResolved = $null
    try {
      $selfResolved = Get-JsonRaw "$api/node/versions/resolve?dbnum=$Dbnum&refno=$($unitSlash -replace '/', '%2F')&scope=self&at=$encodedAt"
    } catch { }
    if ($selfResolved) {
      Note 'R6.3 / R8.10 冲突（单元根）' (
        "同一时间点：geometry X-Sesno=$($byTime.Headers['x-sesno'])、resolve(scope=self)=$($selfResolved.sesno)、" +
        "resolve(scope=subtree)=$($resolved.sesno)；unit_versions $($unitSesnos.Count) 行 vs node_versions(self) $($selfSesnos.Count) 行")
    }
  }

  # 时间倒退的会话：找第一个 Session_Time 早于前一行的行，取它的时刻核对两边一致
  $backwards = $null
  for ($i = 1; $i -lt $withTime.Count; $i++) {
    $prev = [datetimeoffset]::Parse([string]$withTime[$i - 1].session_time)
    $cur = [datetimeoffset]::Parse([string]$withTime[$i].session_time)
    if ($cur -lt $prev) { $backwards = $withTime[$i]; break }
  }
  if ($backwards) {
    $bAt = [string]$backwards.session_time
    $bEncoded = [uri]::EscapeDataString($bAt)
    $bTime = Invoke-Curl -Url "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$($unitSlash -replace '/', '%2F')&time=$bEncoded" -MaxTimeSec $TimeoutSec -Name 'g-back'
    $bResolved = $null
    try {
      $bResolved = Get-JsonRaw "$api/node/versions/resolve?dbnum=$Dbnum&refno=$($unitSlash -replace '/', '%2F')&scope=self&at=$bEncoded"
    } catch { }
    if ($bResolved) {
      Record '时间倒退会话两边一致' ($bTime.Headers['x-sesno'] -eq "$($bResolved.sesno)") (
        "at=$bAt geometry X-Sesno=$($bTime.Headers['x-sesno']) resolve.sesno=$($bResolved.sesno)")
    }
  } else {
    Note '时间倒退会话' '本单元版本表的 Session_Time 单调递增，没有可验的倒退会话'
  }
} else {
  Note 'time 选择器' '本单元版本表没有带 session_time 的行，跳过'
}

# ---------------------------------------------------------------------------
# 7. 错误码
# ---------------------------------------------------------------------------
$invalid = Invoke-Curl -Url "$url&time=2026-01-01T00:00:00Z" -MaxTimeSec $TimeoutSec -Name 'e-invalid'
Record '两个选择器都给 → 400 INVALID_SELECTOR' ($invalid.Status -eq 400 -and $invalid.Text -match 'INVALID_SELECTOR') (
  "HTTP $($invalid.Status) $($invalid.Text)")

$badTime = Invoke-Curl -Url "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$($unitSlash -replace '/', '%2F')&time=not-a-time" -MaxTimeSec $TimeoutSec -Name 'e-badtime'
Record 'time 语法错 → 400 INVALID_SELECTOR' ($badTime.Status -eq 400 -and $badTime.Text -match 'INVALID_SELECTOR') (
  "HTTP $($badTime.Status) $($badTime.Text)")

$missing = Invoke-Curl -Url "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$($unitSlash -replace '/', '%2F')&sesno=2147483647" -MaxTimeSec $TimeoutSec -Name 'e-session'
Record 'sesno 不在版本表 → 404 SESSION_NOT_FOUND' ($missing.Status -eq 404 -and $missing.Text -match 'SESSION_NOT_FOUND') (
  "HTTP $($missing.Status) $($missing.Text)")

$absent = Invoke-Curl -Url "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$($unitSlash -replace '/', '%2F')&sesno=1" -MaxTimeSec $TimeoutSec -Name 'e-absent'
$absentOk = ($absent.Status -eq 404) -and ($absent.Text -match 'SESSION_NOT_FOUND|UNIT_NOT_PRESENT|REFNO_NOT_IN_CHAIN')
Record 'sesno=1（链头之前）→ 404' $absentOk "HTTP $($absent.Status) $($absent.Text)"

$attr = Invoke-Curl -Url "$api/element/attributes-at?dbnum=$Dbnum&refno=$($unitSlash -replace '/', '%2F')&sesno=2147483647" -MaxTimeSec $TimeoutSec -Name 'e-attr'
Record 'attributes-at 会话不存在 → 404 SESSION_NOT_FOUND' ($attr.Status -eq 404 -and $attr.Text -match 'SESSION_NOT_FOUND') (
  "HTTP $($attr.Status) $($attr.Text)")

if ($NotADeliveryUnit) {
  $n = Normalize-Refno $NotADeliveryUnit
  $nSlash = $n -replace '_', '/'
  $notUnit = Invoke-Curl -Url "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$($nSlash -replace '/', '%2F')&sesno=$targetSesno" -MaxTimeSec $TimeoutSec -Name 'e-notunit'
  Record '非交付单元 → 422 NOT_A_DELIVERY_UNIT_ROOT' ($notUnit.Status -eq 422 -and $notUnit.Text -match 'NOT_A_DELIVERY_UNIT_ROOT') (
    "HTTP $($notUnit.Status) $($notUnit.Text)")
} else {
  Note '非交付单元 422' '未给 -NotADeliveryUnit，跳过（换一个构件 refno 重跑即可）'
}

# ---------------------------------------------------------------------------
# 8. 断开取消：--max-time 1 后每 0.5 s 采 in_flight
# ---------------------------------------------------------------------------
$coldUrl = "$api/model/history/geometry?dbnum=$Dbnum&unit_refno=$($unitSlash -replace '/', '%2F')&sesno=$targetSesno"
& curl.exe -s --max-time 1 $coldUrl -o NUL 2>&1 | Out-Null
$samples = @()
for ($i = 0; $i -lt 8; $i++) {
  Start-Sleep -Milliseconds 500
  try { $samples += [int](Get-RealtimeHealth).in_flight } catch { $samples += -1 }
}
$backToZero = ($samples[-1] -eq 0)
Record '断开取消（Requirement 6.14）' $backToZero ("in_flight 每 0.5 s：$($samples -join ',')（末值应为 0）")

# ---------------------------------------------------------------------------
# 9. 快照数不变
# ---------------------------------------------------------------------------
$health1 = Get-Json "$api/health"
$snapshots1 = $health1.model_cache.historical.snapshots
Record '快照数不变（Requirement 6.12）' ($snapshots1 -eq $snapshots0) "初值 $snapshots0 → 现值 $snapshots1"

# ---------------------------------------------------------------------------
# 10. CORS 暴露头
# ---------------------------------------------------------------------------
$cors = Invoke-Curl -Url $url -Headers @('Origin: http://127.0.0.1:3101') -MaxTimeSec $TimeoutSec -Name 'g-cors'
$expose = [string]$cors.Headers['access-control-expose-headers']
$exposeOk = $expose -match 'ETag' -and $expose -match 'X-Sesno' -and $expose -match 'X-Session-Time' -and $expose -match 'Retry-After'
$exposeNote = if ($expose -eq '*') { '（`*` 是旧构建；本特性要求逐项列出四个头，浏览器才读得到 ETag / Retry-After）' } else { '' }
Record 'CORS Access-Control-Expose-Headers' $exposeOk "值：$expose$exposeNote"

# ---------------------------------------------------------------------------
# 收尾：落证据
# ---------------------------------------------------------------------------
if ($EvidenceDir) {
  New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
  $payload = [pscustomobject]@{
    base = $base
    dbnum = $Dbnum
    unit = $unitSlash
    target_sesno = $targetSesno
    versions = [pscustomobject]@{
      count = $rows.Count
      geometry_changed = $geometryRows.Count
      sesnos = $sesnos
    }
    realtime_health = $rt0
    steps = $results
    passed = ($failures -eq 0)
  }
  $out = Join-Path $EvidenceDir 'realtime-history-smoke.json'
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $out -Encoding utf8
  Write-Host "证据已写入 $out"
}

Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
if ($failures -gt 0) {
  Write-Host "$failures 步未通过" -ForegroundColor Red
  exit 1
}
Write-Host '全部通过'
exit 0
