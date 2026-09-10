<#
.SYNOPSIS
  gen-model /api/v1 接口的只读验证序列（plan 2026-09-06 §7.1）：证接口，再开浏览器。

.DESCRIPTION
  默认只跑 GET：health / tree/roots / tree/children / tree/ancestors / search / dbnums / meshes。
  加 -Ensure 才 POST model/ensure(force=false) + 逐根分页 model/records + 同一批根的多根批量 model/records（spec §4.5.2，
  条数须与逐根之和相同；旧服务端不认识 generation_roots 只记一句不算失败），并对记录里的 geo_hash 逐个 HEAD .mesh。
  加 -Dbnum 7997 才跑整库口径（spec §4.5.3，读透 / kv-mem 形态；收口计划 §17）：GET dbnums/{dbnum}/model/roots 探能力并拿权威根清单
  → POST dbnums/{dbnum}/model/ensure 起任务（202）→ 轮询 GET tasks/{task_id} 到终态（打进度、计时、前后 RSS）→ 全部根按 ≤64 一批
  POST model/records。旧构建没有整库入口（404）、该库以 rocksdb 为准（409）都只记一句不算失败——前端在这两种情况下退回逐 SITE。
  这一段就是前端 show_dbnum 走的四发，也是 plan 2026-09-10 S0 摸底要的三个数（耗时 / 根数 / RSS）的出处。
  每一步打一行「端点 → 状态 / 条数 / 关键字段」；任何一步非 2xx（或形状不对）以非零退出。
  不改任何数据（ensure(force=false) 对已生成的根是零成本命中；对没生成的根会触发一次按需生成——这是显式显示的语义；
  整库 ensure 同理，只是把「没生成的根」摊到整个库）。

.EXAMPLE
  pwsh scripts/verify-gen-model-v1.ps1
  pwsh scripts/verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:18082 -Refno 24381/145018 -Ensure
  pwsh scripts/verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:8022 -Dbnum 7997
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://localhost:8022',
  # a/b 或 a_b 都行
  [string]$Refno = '24381/145018',
  [string]$SearchQuery = 'PIPE',
  [switch]$Ensure,
  # 整库口径：>0 才跑（spec §4.5.3）。
  [int]$Dbnum = 0,
  # 整库任务最多等多久（秒），缺省 2 小时——整库生成按分钟到小时计；与前端 taskWaitTimeoutMs 同量级。
  [int]$DbnumWaitSec = 7200,
  [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$failures = 0

function Normalize-Refno([string]$value) {
  if ($value -match '^\s*(\d+)\s*[/_]\s*(\d+)\s*$') { return "$($Matches[1])/$($Matches[2])" }
  return $value.Trim()
}

function Step([string]$label, [scriptblock]$body) {
  try {
    $result = & $body
    Write-Host ("[ok]   {0} -> {1}" -f $label, $result)
  } catch {
    $script:failures++
    $msg = $_.Exception.Message
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode) { $msg = "HTTP $([int]$resp.StatusCode) $msg" }
    Write-Host ("[FAIL] {0} -> {1}" -f $label, $msg) -ForegroundColor Red
  }
}

function GetJson([string]$path) {
  Invoke-RestMethod -Uri "$base$path" -Method Get -TimeoutSec $TimeoutSec
}

function PostJson([string]$path, $body, [int]$timeout = $TimeoutSec) {
  Invoke-RestMethod -Uri "$base$path" -Method Post -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) -TimeoutSec $timeout
}

$refno = Normalize-Refno $Refno
Write-Host "gen-model /api/v1 verify  base=$base  refno=$refno  ensure=$($Ensure.IsPresent)"

$health = $null
Step 'GET /api/v1/health' {
  $script:health = GetJson '/api/v1/health'
  if ($health.status -ne 'ok') { throw "status=$($health.status)" }
  "project=$($health.project) mdb=$($health.mdb) data_face=$($health.data_face) model_ready=$($health.initialization.model_ready) model_phase_open=$($health.initialization.model_phase_open) version=$($health.version)"
}

$roots = $null
Step 'GET /api/v1/tree/roots' {
  $script:roots = GetJson '/api/v1/tree/roots'
  if (-not $roots.nodes) { throw 'nodes 为空' }
  $withDbnum = @($roots.nodes | Where-Object { $null -ne $_.dbnum }).Count
  "source=$($roots.source) sites=$($roots.nodes.Count) with_dbnum=$withDbnum first=$($roots.nodes[0].refno) $($roots.nodes[0].name)"
}

Step 'GET /api/v1/tree/children (first SITE)' {
  if (-not $roots) { throw 'roots 未取到' }
  $site = $roots.nodes[0].refno
  $children = GetJson "/api/v1/tree/children?refno=$([uri]::EscapeDataString($site))"
  "parent=$($children.parent) children=$($children.nodes.Count) sample=$((@($children.nodes | Select-Object -First 3 | ForEach-Object { "$($_.refno):$($_.noun)" })) -join ',')"
}

Step "GET /api/v1/tree/ancestors?refno=$refno" {
  $anc = GetJson "/api/v1/tree/ancestors?refno=$([uri]::EscapeDataString($refno))"
  if (-not $anc.refnos -or $anc.refnos.Count -eq 0) { throw 'refnos 为空' }
  "chain=$($anc.refnos -join ' > ')"
}

Step "GET /api/v1/search?query=$SearchQuery&limit=5" {
  $search = GetJson "/api/v1/search?query=$([uri]::EscapeDataString($SearchQuery))&limit=5"
  $withNoun = @($search.items | Where-Object { $_.noun }).Count
  "total=$($search.total) items=$($search.items.Count) with_noun=$withNoun truncated=$($search.truncated)"
}

Step 'GET /api/v1/dbnums' {
  $dbnums = GetJson '/api/v1/dbnums'
  $desi = @($dbnums.dbnums | Where-Object { $_.db_type -eq 'DESI' })
  $withRef0s = @($desi | Where-Object { $_.ref0s -and $_.ref0s.Count -gt 0 }).Count
  $verdicts = ($desi | Group-Object model_verdict | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' '
  "rows=$($dbnums.dbnums.Count) desi=$($desi.Count) with_ref0s=$withRef0s data_face=$($dbnums.data_face) verdict[$verdicts]"
}

Step 'GET /api/v1/meshes/1.mesh (单位盒 rkyv 直连；运行目录没有 1.mesh 时 404 也算通)' {
  try {
    $r = Invoke-WebRequest -Uri "$base/api/v1/meshes/1.mesh" -Method Get -TimeoutSec $TimeoutSec -SkipHttpErrorCheck
  } catch { $r = Invoke-WebRequest -Uri "$base/api/v1/meshes/1.mesh" -Method Get -TimeoutSec $TimeoutSec }
  if ($r.StatusCode -eq 200) {
    # rkyv 归档没有魔数：验根结构可读——文件尾 60 字节是根，长度必须 4 对齐且装得下根
    $len = $r.Content.Length
    if ($len -lt 60 -or ($len % 4) -ne 0) { throw "非法 .mesh 长度 $len" }
    "200 bytes=$len cache-control=$($r.Headers['Cache-Control'])"
  } elseif ($r.StatusCode -eq 404) {
    "404（运行目录 meshes_path 下没有 1.mesh，端点在）"
  } else { throw "HTTP $($r.StatusCode)" }
}

Step 'GET /api/v1/meshes/1.glb (转换口径，留一个发布周期；同一份 1.mesh 现场转 glTF)' {
  try {
    $r = Invoke-WebRequest -Uri "$base/api/v1/meshes/1.glb" -Method Get -TimeoutSec $TimeoutSec -SkipHttpErrorCheck
  } catch { $r = Invoke-WebRequest -Uri "$base/api/v1/meshes/1.glb" -Method Get -TimeoutSec $TimeoutSec }
  if ($r.StatusCode -eq 200) {
    $magic = [System.Text.Encoding]::ASCII.GetString($r.Content[0..3])
    if ($magic -ne 'glTF') { throw "magic=$magic" }
    "200 bytes=$($r.Content.Length) magic=$magic cache-control=$($r.Headers['Cache-Control'])"
  } elseif ($r.StatusCode -eq 404) {
    "404（运行目录 meshes_path 下没有 1.mesh，端点在）"
  } else { throw "HTTP $($r.StatusCode)" }
}

if ($Ensure) {
  $ensured = $null
  Step "POST /api/v1/model/ensure {refno=$refno, force=false}" {
    $script:ensured = PostJson '/api/v1/model/ensure' @{ refno = $refno } 130
    $rootsList = if ($ensured.generation_roots) { $ensured.generation_roots } elseif ($ensured.generation_root) { @($ensured.generation_root) } else { @($refno) }
    "status=$($ensured.status) roots=$($rootsList.Count) [$($rootsList -join ',')] model_instance_count=$($ensured.model_instance_count)"
  }

  $items = @()
  Step 'POST /api/v1/model/records (逐根分页 limit=5000)' {
    if (-not $ensured) { throw 'ensure 未通过' }
    $rootsList = if ($ensured.generation_roots) { $ensured.generation_roots } elseif ($ensured.generation_root) { @($ensured.generation_root) } else { @($refno) }
    $pages = 0
    foreach ($root in $rootsList) {
      $cursor = $null
      do {
        $body = @{ generation_root = $root; limit = 5000 }
        if ($null -ne $cursor) { $body.cursor = $cursor }
        $page = PostJson '/api/v1/model/records' $body
        $pages++
        $script:items += @($page.items)
        $cursor = if ($page.truncated) { $page.next_cursor } else { $null }
      } while ($null -ne $cursor)
    }
    $refnos = @($items | ForEach-Object { $_.refno } | Sort-Object -Unique)
    $tubi = @($items | Where-Object { $_.insts | Where-Object { $_.is_tubi } }).Count
    "pages=$pages records=$($items.Count) constructs=$($refnos.Count) tubi_records=$tubi source=$($page.source)"
  }

  # 多根批量口径（spec §4.5.2，前端 P9-3 缺省走它）：同一批根一次请求、平铺分页，条数须与逐根之和相同。
  # 旧服务端（0.1.21 出厂包）不认识 generation_roots，JSON 反序列化就拒（422「missing field `generation_root`」）——前端会退回逐根，这里也只记一句、不算失败。
  Step 'POST /api/v1/model/records {generation_roots[]} (多根批量、平铺分页 limit=5000)' {
    if (-not $ensured) { throw 'ensure 未通过' }
    $rootsList = @(if ($ensured.generation_roots) { $ensured.generation_roots } elseif ($ensured.generation_root) { @($ensured.generation_root) } else { @($refno) })
    $batch = @($rootsList | Select-Object -Unique -First 64)
    $expected = @($items | Where-Object { (Normalize-Refno $_.owner) -in @($batch | ForEach-Object { Normalize-Refno $_ }) }).Count
    $cursor = $null; $pages = 0; $got = 0; $first = $null
    do {
      $body = @{ generation_roots = $batch; limit = 5000 }
      if ($null -ne $cursor) { $body.cursor = $cursor }
      try {
        $page = PostJson '/api/v1/model/records' $body
      } catch {
        $resp = $_.Exception.Response
        $status = if ($resp -and $resp.StatusCode) { [int]$resp.StatusCode } else { 0 }
        $text = $_.ErrorDetails.Message
        if ($status -in 400, 422 -and $text -match 'generation_root' -and $text -match 'missing field|unknown field|deserialize') {
          return "服务端不支持多根批量（HTTP $status，旧版；前端退回逐根）"
        }
        throw
      }
      if ($null -eq $first) { $first = $page }
      $pages++
      $got += @($page.items).Count
      $cursor = if ($page.truncated) { $page.next_cursor } else { $null }
    } while ($null -ne $cursor)
    if (-not $first.generation_roots) { throw '响应缺 generation_roots 回显' }
    if (-not $first.roots) { throw '响应缺 roots[]（逐根总数）' }
    $rootsTotal = ($first.roots | Measure-Object -Property total -Sum).Sum
    if ($got -ne $expected) { throw "批量 $got 条 != 逐根之和 $expected 条" }
    if ($rootsTotal -ne $got) { throw "roots[].total 之和 $rootsTotal != 平铺条数 $got" }
    "roots=$($batch.Count) pages=$pages records=$got (== 逐根之和) roots_total=$rootsTotal zero_roots=$(@($first.roots | Where-Object { $_.total -eq 0 }).Count) source=$($first.source)"
  }

  Step 'HEAD /api/v1/meshes/{geo_hash}.mesh (记录里的每个 geo_hash，前端直连口径)' {
    $hashes = @($items | ForEach-Object { $_.insts } | ForEach-Object { $_.geo_hash } | Where-Object { $_ -and $_ -notin @('1','2','3') } | Sort-Object -Unique)
    $ok = 0; $missing = @()
    foreach ($h in $hashes) {
      try {
        $r = Invoke-WebRequest -Uri "$base/api/v1/meshes/$h.mesh" -Method Head -TimeoutSec $TimeoutSec -SkipHttpErrorCheck
      } catch { $r = $null }
      if ($r -and $r.StatusCode -eq 200) { $ok++ } else { $missing += $h }
    }
    if ($missing.Count -gt 0) { throw "缺 $($missing.Count) 个: $($missing[0..([Math]::Min(4, $missing.Count - 1))] -join ',')" }
    "hashes=$($hashes.Count) ok=$ok"
  }
}

if ($Dbnum -gt 0) {
  # 整库口径（spec §4.5.3，读透 / kv-mem 形态；收口计划 §17）：前端 show_dbnum 走的就是下面这四发，顺序与
  # src/model-source/genModelV1/collectDbnum.ts 的 collectDbnumViaServer 一致，只是这里先用只读的 roots 探一次能力——
  # 旧构建整条路由不存在（404）就记一句、后面三步跳过，不算失败（前端此时退回逐 SITE 老路）。
  $terminalStates = @('succeeded', 'partial', 'failed', 'yielded')
  $dbnumRoots = $null
  $dbnumEntry = $true

  Step "GET /api/v1/dbnums/$Dbnum/model/roots (整库权威根清单，只读不生成)" {
    try {
      $script:dbnumRoots = GetJson "/api/v1/dbnums/$Dbnum/model/roots"
    } catch {
      $resp = $_.Exception.Response
      if ($resp -and [int]$resp.StatusCode -eq 404) {
        $script:dbnumEntry = $false
        return '服务端没有整库入口（HTTP 404，旧构建；前端退回逐 SITE）'
      }
      throw
    }
    $list = @($dbnumRoots.roots)
    if ($list.Count -eq 0) { throw 'roots 为空（该库不在本 MDB，或没有 SITE）' }
    if ([int]$dbnumRoots.total -ne $list.Count) { throw "total=$($dbnumRoots.total) != roots.Count=$($list.Count)" }
    $nouns = ($list | Group-Object noun | Sort-Object Count -Descending | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' '
    "source=$($dbnumRoots.source) dbnum=$($dbnumRoots.dbnum) total=$($dbnumRoots.total) nouns[$nouns] first=$($list[0].generation_root) $($list[0].name)"
  }

  $receipt = $null
  $rssBefore = 0
  Step "POST /api/v1/dbnums/$Dbnum/model/ensure (202 起整库生成任务；服务端先同步枚举根)" {
    if (-not $dbnumEntry) { return '跳过（没有整库入口）' }
    $script:rssBefore = [long](GetJson '/api/v1/health').model_concurrency.process_rss_bytes
    try {
      # 202 之前服务端要同步把根枚举完，大库几秒到几十秒——超时与前端 ENSURE_TIMEOUT_MS 同为 130 s
      $script:receipt = PostJson "/api/v1/dbnums/$Dbnum/model/ensure" @{} 130
    } catch {
      $resp = $_.Exception.Response
      if ($resp -and [int]$resp.StatusCode -eq 409) {
        $script:dbnumEntry = $false
        return '该库以 rocksdb 为准（HTTP 409，database 形态，整库重建走 rebuild）；前端退回逐 SITE'
      }
      throw
    }
    if (-not $receipt.task_id) { throw '回执缺 task_id' }
    if ([int]$receipt.expected_roots -ne [int]$dbnumRoots.total) { throw "expected_roots=$($receipt.expected_roots) != roots.total=$($dbnumRoots.total)" }
    "task_id=$($receipt.task_id) state=$($receipt.state) expected_roots=$($receipt.expected_roots) model_source=$($receipt.model_source) durable=$($receipt.durable) rss_before=$([math]::Round($rssBefore / 1MB)) MB"
  }

  $task = $null
  Step "GET /api/v1/tasks/{task_id} 轮询到终态（2 s 一次，最多 $DbnumWaitSec s；只查自己刚发起的这一个）" {
    if (-not $dbnumEntry) { return '跳过' }
    if (-not $receipt) { throw 'ensure 未通过' }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $lastDone = -1
    do {
      Start-Sleep -Seconds 2
      try {
        $script:task = GetJson "/api/v1/tasks/$([uri]::EscapeDataString($receipt.task_id))"
      } catch {
        $resp = $_.Exception.Response
        if ($resp -and [int]$resp.StatusCode -eq 404) { return '任务查不到（HTTP 404：服务端重启过，任务只活在进程内）；按现状取记录' }
        throw
      }
      if ([int]$task.units_done -ne $lastDone) {
        $lastDone = [int]$task.units_done
        Write-Host ('       {0,7:N0} s  {1}/{2}  failed={3}  state={4}' -f $sw.Elapsed.TotalSeconds, $task.units_done, $task.total_units, $task.detail.failed, $task.state)
      }
    } while (($task.state -notin $terminalStates) -and ($sw.Elapsed.TotalSeconds -lt $DbnumWaitSec))
    $rssAfter = [long](GetJson '/api/v1/health').model_concurrency.process_rss_bytes
    if ($task.state -eq 'failed' -and [int]$task.units_done -eq 0) { throw "整库生成失败、一根都没成: $($task.result.error)" }
    if ($task.state -notin $terminalStates) { throw "等了 $([int]$sw.Elapsed.TotalSeconds) s 仍未终态（state=$($task.state) $($task.units_done)/$($task.total_units)）" }
    "state=$($task.state) kind=$($task.kind) completed=$($task.units_done)/$($task.total_units) failed=$($task.detail.failed) elapsed=$([math]::Round($sw.Elapsed.TotalSeconds, 1)) s rss=$([math]::Round($rssBefore / 1MB))->$([math]::Round($rssAfter / 1MB)) MB"
  }

  Step 'POST /api/v1/model/records {generation_roots[]} 整库全部根（≤64 根一批，前端整库口径）' {
    if (-not $dbnumEntry) { return '跳过' }
    if (-not $dbnumRoots) { throw 'roots 未取到' }
    $all = @($dbnumRoots.roots | ForEach-Object { $_.generation_root })
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $records = 0; $pages = 0; $batches = 0; $badRoots = @(); $source = $null; $constructs = @{}
    for ($i = 0; $i -lt $all.Count; $i += 64) {
      $batch = @($all[$i..([Math]::Min($i + 63, $all.Count - 1))])
      $batches++
      $cursor = $null
      try {
        do {
          $body = @{ generation_roots = $batch; limit = 5000 }
          if ($null -ne $cursor) { $body.cursor = $cursor }
          $page = PostJson '/api/v1/model/records' $body 130
          $pages++
          $records += @($page.items).Count
          foreach ($item in @($page.items)) { $constructs[$item.refno] = 1 }
          $source = $page.source
          $cursor = if ($page.truncated) { $page.next_cursor } else { $null }
        } while ($null -ne $cursor)
      } catch {
        # 整批被拒（典型是 409 not_generated：任务 partial 时没成的那几根）→ 与前端同口径退回逐根，记下坏根、不停在半路
        foreach ($root in $batch) {
          $cursor = $null
          try {
            do {
              $body = @{ generation_root = $root; limit = 5000 }
              if ($null -ne $cursor) { $body.cursor = $cursor }
              $page = PostJson '/api/v1/model/records' $body 130
              $pages++
              $records += @($page.items).Count
              foreach ($item in @($page.items)) { $constructs[$item.refno] = 1 }
              $cursor = if ($page.truncated) { $page.next_cursor } else { $null }
            } while ($null -ne $cursor)
          } catch { $badRoots += $root }
        }
      }
    }
    if ($records -eq 0) { throw "整库 0 条记录（roots=$($all.Count)，坏根 $($badRoots.Count)）" }
    $bad = if ($badRoots.Count -gt 0) { " bad_roots=$($badRoots.Count) [$($badRoots[0..([Math]::Min(2, $badRoots.Count - 1))] -join ',')]" } else { '' }
    "roots=$($all.Count) batches=$batches pages=$pages records=$records constructs=$($constructs.Count) source=$source elapsed=$([math]::Round($sw.Elapsed.TotalSeconds, 1)) s$bad"
  }
}

if ($failures -gt 0) {
  Write-Host "`n$failures 步失败" -ForegroundColor Red
  exit 1
}
Write-Host "`n全部通过" -ForegroundColor Green
exit 0
