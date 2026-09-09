<#
.SYNOPSIS
  gen-model /api/v1 接口的只读验证序列（plan 2026-09-06 §7.1）：证接口，再开浏览器。

.DESCRIPTION
  默认只跑 GET：health / tree/roots / tree/children / tree/ancestors / search / dbnums / meshes。
  加 -Ensure 才 POST model/ensure(force=false) + 逐根分页 model/records，并对记录里的 geo_hash 逐个 HEAD .glb。
  每一步打一行「端点 → 状态 / 条数 / 关键字段」；任何一步非 2xx（或形状不对）以非零退出。
  不改任何数据（ensure(force=false) 对已生成的根是零成本命中；对没生成的根会触发一次按需生成——这是显式显示的语义）。

.EXAMPLE
  pwsh scripts/verify-gen-model-v1.ps1
  pwsh scripts/verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:18082 -Refno 24381/145018 -Ensure
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://localhost:8022',
  # a/b 或 a_b 都行
  [string]$Refno = '24381/145018',
  [string]$SearchQuery = 'PIPE',
  [switch]$Ensure,
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

if ($failures -gt 0) {
  Write-Host "`n$failures 步失败" -ForegroundColor Red
  exit 1
}
Write-Host "`n全部通过" -ForegroundColor Green
exit 0
