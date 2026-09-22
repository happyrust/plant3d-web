param(
  [string]$Base = 'http://127.0.0.1:8027',
  [string]$Room = '24381_35580',
  [string]$RoomSlash = '24381/35580',
  [string]$SecondRoom = '24381_5062',
  [string]$Bran = '24381_105030',
  [int]$Dbnum = 7997,
  [string]$Out,
  [string]$Sha = '65dacd576',
  [switch]$SkipEnsure
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
if ($Out) { New-Item -ItemType Directory -Path $Out -Force | Out-Null }
$checks = New-Object System.Collections.ArrayList
function Check([string]$name, [bool]$pass, $detail) { [void]$checks.Add([ordered]@{ name = $name; pass = $pass; detail = $detail }); if (-not $pass) { Write-Output "FAIL: $name" } }
function Get-Raw([string]$url, [string]$method = 'GET', [string]$body = '{}') {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  if ($method -eq 'POST') {
    $r = Invoke-WebRequest -Uri $url -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 600 -SkipHttpErrorCheck
  } else {
    $r = Invoke-WebRequest -Uri $url -Method $method -UseBasicParsing -TimeoutSec 600 -SkipHttpErrorCheck
  }
  $sw.Stop()
  [pscustomobject]@{ status = [int]$r.StatusCode; elapsed_ms = [int]$sw.ElapsedMilliseconds; body = $r.Content; json = ($(try { $r.Content | ConvertFrom-Json -Depth 32 } catch { $null })) }
}
function Save([string]$name, $obj) { if ($Out) { [System.IO.File]::WriteAllText((Join-Path $Out $name), (($obj | ConvertTo-Json -Depth 32) + "`n"), $utf8) } }
function Sum($arr, $prop) { $s = 0; foreach ($x in @($arr)) { $s += [int]$x.$prop }; $s }
function Has($obj, [string]$name) { $null -ne $obj -and ($obj.PSObject.Properties.Name -contains $name) }

$startedAt = (Get-Date).ToString('o')

# 1. health
$health = Get-Raw "$Base/api/v1/health"
$h = $health.json
Check "health 200 且 build_id 带 $Sha" ($health.status -eq 200 -and "$($h.build_id)" -match $Sha) "build=$($h.build_id) started=$($h.started_at)"
Check 'health room_membership=true' ($h.room_membership -eq $true) $h.room_membership
Save '01-health.json' ([ordered]@{ status = $health.status; elapsed_ms = $health.elapsed_ms; build_id = $h.build_id; started_at = $h.started_at; room_membership = $h.room_membership; delivery_unit_types = $h.delivery_unit_types; spatial_tree = $h.spatial_tree; resident_records = $h.model_cache.resident_records; resident_roots = $h.model_cache.resident_roots })

# 2. 整库 ensure（mem 档重启即空）
$ensure = $null
if (-not $SkipEnsure) {
  $started = Get-Raw "$Base/api/v1/dbnums/$Dbnum/model/ensure" 'POST'
  Check "dbnum $Dbnum 整库 ensure 202" ($started.status -eq 202) "status=$($started.status) task=$($started.json.task_id) expected_roots=$($started.json.expected_roots) already_ready=$($started.json.already_ready)"
  $final = $null
  if ($started.status -eq 202) {
    $taskId = $started.json.task_id
    $deadline = (Get-Date).AddMinutes(8)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 3
      $t = Get-Raw "$Base/api/v1/tasks/$taskId"
      if ($t.json.state -in @('succeeded', 'partial', 'failed', 'cancelled')) { $final = $t; break }
    }
    Check "dbnum $Dbnum 整库 ensure 终态 succeeded|partial" ($null -ne $final -and $final.json.state -in @('succeeded', 'partial')) ($(if ($final) { "state=$($final.json.state) units=$($final.json.units_done)/$($final.json.total_units) failed=$($final.json.result.failed) room_edges=$($final.json.result.room_edges_written) elapsed=$([int]((Get-Date $final.json.finished_at) - (Get-Date $final.json.started_at)).TotalSeconds)s" } else { 'timeout' }))
  }
  $ensure = [ordered]@{ started = $started.json; final = $(if ($final) { $final.json } else { $null }) }
  Save '02-dbnum-model-ensure-task.json' $ensure
}
$h2 = (Get-Raw "$Base/api/v1/health").json
$treeState = [ordered]@{ state = $h2.spatial_tree.state; entries = $h2.spatial_tree.entries; resident_records = $h2.model_cache.resident_records; resident_roots = $h2.model_cache.resident_roots }

# 3. 单房间树 vs refnos
$q = "refno=$RoomSlash&radius=3000&shape=sphere"
$tree = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q&rooms=$Room"
$T = $tree.json
Save '03-nearby-tree-single-room.json' $T
Check 'nearby/tree 单房间 200' ($tree.status -eq 200) "status=$($tree.status) elapsed_ms=$($tree.elapsed_ms) total=$($T.total_count) leaf_count=$($T.leaf_count) leaves_inline=$($T.leaves_inline)"
if ($tree.status -ne 200 -or -not $T.rooms) { Write-Output "tree call failed: $($tree.body)"; Save '00-summary.json' ([ordered]@{ aborted = $true; checks = $checks }); exit 2 }
Check 'rooms[] 恒一条、refno/room_num 对' (@($T.rooms).Count -eq 1 -and $T.rooms[0].refno -eq $Room -and $T.rooms[0].room_num -eq 'R432') ($T.rooms[0] | Select-Object refno, room_num, name, count)
Check 'rooms[0].count = total_count（单房无跨房）' ($T.rooms[0].count -eq $T.total_count) "$($T.rooms[0].count) vs $($T.total_count)"
Check 'Σ specs.count = rooms[0].count' ((Sum $T.rooms[0].specs 'count') -eq $T.rooms[0].count) "$((Sum $T.rooms[0].specs 'count'))"
$specOk = $true; $utOk = $true; $unitLeafOk = $true; $otherLeafOk = $true; $placed = 0; $specValues = @(); $unitTypeOrders = @(); $unitDistOk = $true
foreach ($spec in @($T.rooms[0].specs)) {
  $specValues += [int]$spec.spec_value
  $utSum = Sum $spec.unit_types 'count'
  if (($utSum + [int]$spec.others.count) -ne [int]$spec.count) { $specOk = $false }
  $unitTypeOrders += ,(@($spec.unit_types | ForEach-Object { $_.noun }))
  foreach ($ut in @($spec.unit_types)) {
    if ((Sum $ut.units 'count') -ne [int]$ut.count) { $utOk = $false }
    $prev = -1
    foreach ($u in @($ut.units)) {
      if ([double]$u.min_distance -lt $prev) { $unitDistOk = $false }; $prev = [double]$u.min_distance
      if (-not (Has $u 'elements') -or @($u.elements).Count -ne [int]$u.count) { $unitLeafOk = $false }
      $placed += @($u.elements).Count
    }
  }
  if ((Sum $spec.others.by_noun 'count') -ne [int]$spec.others.count) { $specOk = $false }
  foreach ($g in @($spec.others.by_noun)) {
    if (-not (Has $g 'elements') -or @($g.elements).Count -ne [int]$g.count) { $otherLeafOk = $false }
    $placed += @($g.elements).Count
  }
}
Check '每个专业：Σ unit_types.count + others.count = spec.count；Σ by_noun.count = others.count' $specOk ($T.rooms[0].specs | ForEach-Object { "$($_.spec_value):$($_.count)=" + (Sum $_.unit_types 'count') + "+$($_.others.count)" })
Check '每个单元类型：Σ units.count = unit_type.count' $utOk
Check '专业 spec_value 升序、0 在前' (($specValues -join ',') -eq (($specValues | Sort-Object) -join ',')) ($specValues -join ',')
$order = $h.delivery_unit_types
$orderOk = $true
foreach ($seq in $unitTypeOrders) { $ranks = @($seq | ForEach-Object { [array]::IndexOf($order, $_) }); if (($ranks -join ',') -ne (($ranks | Sort-Object) -join ',')) { $orderOk = $false } }
Check '单元类型按 delivery_unit_types 配置表顺序' $orderOk ($unitTypeOrders | ForEach-Object { $_ -join '>' })
Check '单元按 min_distance 升序' $unitDistOk
Check 'leaves_inline=true 时每个单元 / noun 组的 elements 数 = count' ($T.leaves_inline -and $unitLeafOk -and $otherLeafOk) "placed=$placed leaf_count=$($T.leaf_count)"
Check 'Σ 内联叶子 = leaf_count' ($placed -eq $T.leaf_count) "$placed vs $($T.leaf_count)"
Check '单房：leaf_count = total_count' ($T.leaf_count -eq $T.total_count) "$($T.leaf_count) vs $($T.total_count)"
Check '响应带 room_status（source=memory, unresolved=0）且 delivery_unit_types 同 /health' ($T.room_status.source -eq 'memory' -and $T.room_status.unresolved -eq 0 -and (($T.delivery_unit_types -join ',') -eq ($h.delivery_unit_types -join ','))) ($T.room_status)
Check '不再给 filter_options / spec_groups / groups / results' (-not (Has $T 'filter_options') -and -not (Has $T 'spec_groups') -and -not (Has $T 'groups') -and -not (Has $T 'results'))

$refnos = Get-Raw "$Base/api/v1/spatial/nearby/refnos?$q&rooms=$Room"
$uniq = @($refnos.json.refnos | Sort-Object -Unique)
Check 'total_count = 同参 nearby/refnos 去重 refno 数' ($T.total_count -eq $uniq.Count) "$($T.total_count) vs unique $($uniq.Count) (raw $($refnos.json.refnos.Count), total_count $($refnos.json.total_count))"
$leafSet = @{}
foreach ($spec in @($T.rooms[0].specs)) { foreach ($ut in @($spec.unit_types)) { foreach ($u in @($ut.units)) { foreach ($e in @($u.elements)) { $leafSet[$e.refno] = 1 } } }; foreach ($g in @($spec.others.by_noun)) { foreach ($e in @($g.elements)) { $leafSet[$e.refno] = 1 } } }
$missing = @($uniq | Where-Object { -not $leafSet.ContainsKey($_) })
$extra = @($leafSet.Keys | Where-Object { $_ -notin $uniq })
Check '树叶子集合 = refnos 全集（按 refno）' ($missing.Count -eq 0 -and $extra.Count -eq 0) "missing=$($missing.Count) extra=$($extra.Count)"
Save '03b-nearby-refnos-single-room.json' ([ordered]@{ total_count = $refnos.json.total_count; unique = $uniq.Count; raw = $refnos.json.refnos.Count })

# 4. 两间房
$two = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q&rooms=$Room,$SecondRoom"
$T2 = $two.json
Save '04-nearby-tree-two-rooms.json' $T2
Check 'nearby/tree 两间房 200、rooms 两条、按 room_num 排' ($two.status -eq 200 -and @($T2.rooms).Count -eq 2 -and ($T2.rooms[0].room_num -le $T2.rooms[1].room_num)) ($T2.rooms | ForEach-Object { "$($_.room_num):$($_.count)" })
Check '两间房：Σ rooms.count ≥ total_count' ((Sum $T2.rooms 'count') -ge $T2.total_count) "$((Sum $T2.rooms 'count')) vs $($T2.total_count)"
$shared = @(); foreach ($rm in @($T2.rooms)) { foreach ($spec in @($rm.specs)) { foreach ($ut in @($spec.unit_types)) { foreach ($u in @($ut.units)) { foreach ($e in @($u.elements)) { if (Has $e 'shared_rooms') { $shared += $e.refno } } } }; foreach ($g in @($spec.others.by_noun)) { foreach ($e in @($g.elements)) { if (Has $e 'shared_rooms') { $shared += $e.refno } } } } }
$sharedUnique = @($shared | Sort-Object -Unique)
$sharedTwice = @($sharedUnique | Where-Object { $r = $_; @($shared | Where-Object { $_ -eq $r }).Count -eq 2 })
Check '带 shared_rooms 的构件在两间房下各出现一次；Σ rooms.count − total_count = 跨房构件数' ($sharedTwice.Count -eq $sharedUnique.Count -and ((Sum $T2.rooms 'count') - $T2.total_count) -eq $sharedUnique.Count) "shared=$($sharedUnique.Count) diff=$((Sum $T2.rooms 'count') - $T2.total_count)"

# 5. 100 m：超上限 + 选择器
$q100 = "refno=$RoomSlash&radius=100000&shape=sphere&rooms=$Room"
$big = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q100"
$B = $big.json
Save '05-nearby-tree-100m-capped.json' ([ordered]@{ status = $big.status; elapsed_ms = $big.elapsed_ms; total_count = $B.total_count; leaf_count = $B.leaf_count; leaf_cap = $B.leaf_cap; leaves_inline = $B.leaves_inline; rooms = @($B.rooms | ForEach-Object { [ordered]@{ room_num = $_.room_num; count = $_.count; specs = @($_.specs | ForEach-Object { [ordered]@{ spec_value = $_.spec_value; count = $_.count; unit_types = @($_.unit_types | ForEach-Object { [ordered]@{ noun = $_.noun; count = $_.count; units = @($_.units).Count } }); others = $_.others.count } }) } }) })
Check '100 m + rooms= 200' ($big.status -eq 200) "elapsed_ms=$($big.elapsed_ms) total=$($B.total_count) leaf_count=$($B.leaf_count)"
$anyElements = $false; $firstUnit = $null; $firstOther = $null
foreach ($rm in @($B.rooms)) { foreach ($spec in @($rm.specs)) { foreach ($ut in @($spec.unit_types)) { foreach ($u in @($ut.units)) { if (Has $u 'elements') { $anyElements = $true }; if (-not $firstUnit) { $firstUnit = $u } } }; foreach ($g in @($spec.others.by_noun)) { if (Has $g 'elements') { $anyElements = $true }; if (-not $firstOther) { $firstOther = $g } } } }
if ($B.leaf_count -gt $B.leaf_cap) {
  Check '超上限：leaves_inline=false 且所有 elements 省略' ((-not $B.leaves_inline) -and (-not $anyElements)) "leaf_count=$($B.leaf_count) cap=$($B.leaf_cap)"
  $sel = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q100&unit=$($firstUnit.refno)"
  $S = $sel.json
  $selUnit = $null; $otherWithLeaves = 0
  foreach ($rm in @($S.rooms)) { foreach ($spec in @($rm.specs)) { foreach ($ut in @($spec.unit_types)) { foreach ($u in @($ut.units)) { if ($u.refno -eq $firstUnit.refno) { $selUnit = $u } elseif (Has $u 'elements') { $otherWithLeaves++ } } }; foreach ($g in @($spec.others.by_noun)) { if (Has $g 'elements') { $otherWithLeaves++ } } } }
  Check 'unit= 只内联点到的单元、inlined=unit:…、leaves_inline 仍 false' ($sel.status -eq 200 -and $null -ne $selUnit -and (Has $selUnit 'elements') -and @($selUnit.elements).Count -eq [int]$selUnit.count -and $otherWithLeaves -eq 0 -and $S.inlined -eq "unit:$($firstUnit.refno)" -and (-not $S.leaves_inline)) "unit=$($firstUnit.refno) count=$($selUnit.count) inlined=$($S.inlined)"
  Save '06-nearby-tree-100m-unit-selector.json' ([ordered]@{ status = $sel.status; elapsed_ms = $sel.elapsed_ms; inlined = $S.inlined; unit = $selUnit })
  if ($firstOther) {
    $selO = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q100&other_noun=$($firstOther.noun)"
    $SO = $selO.json; $groups = @(); foreach ($rm in @($SO.rooms)) { foreach ($spec in @($rm.specs)) { foreach ($g in @($spec.others.by_noun)) { if ($g.noun -eq $firstOther.noun) { $groups += $g } } } }
    Check 'other_noun= 只内联那个 noun 组' ($selO.status -eq 200 -and @($groups).Count -gt 0 -and @($groups | Where-Object { -not (Has $_ 'elements') }).Count -eq 0 -and $SO.inlined -eq "other_noun:$($firstOther.noun)") "noun=$($firstOther.noun) groups=$(@($groups).Count)"
  }
} else {
  Check '100 m 单房叶子未超上限（记录，不判）' $true "leaf_count=$($B.leaf_count) cap=$($B.leaf_cap)"
}

# 5b. 多房间把叶子顶过上限（在册且有面板的房间，取前 N 间），走省略 + 选择器那条路
$roomsList = (Get-Raw "$Base/api/v1/spatial/rooms").json.rooms | Where-Object { $_.panel_count -gt 0 -and $_.dbnum -eq $Dbnum }
$manyRooms = @($roomsList | Select-Object -First 60 | ForEach-Object { $_.refno })
$qMany = "refno=$RoomSlash&radius=100000&shape=sphere&rooms=$($manyRooms -join ',')"
$many = Get-Raw "$Base/api/v1/spatial/nearby/tree?$qMany"
$M = $many.json
Save '05b-nearby-tree-100m-many-rooms-capped.json' ([ordered]@{ status = $many.status; elapsed_ms = $many.elapsed_ms; rooms_requested = $manyRooms.Count; total_count = $M.total_count; leaf_count = $M.leaf_count; leaf_cap = $M.leaf_cap; leaves_inline = $M.leaves_inline; room_status = $M.room_status; rooms = @($M.rooms | ForEach-Object { [ordered]@{ room_num = $_.room_num; count = $_.count } }) })
Check "100 m + $($manyRooms.Count) 间房 200" ($many.status -eq 200) "elapsed_ms=$($many.elapsed_ms) total=$($M.total_count) leaf_count=$($M.leaf_count) rooms_with_members=$(@($M.rooms | Where-Object { $_.count -gt 0 }).Count)"
$anyElementsM = $false; $firstUnitM = $null; $firstOtherM = $null
foreach ($rm in @($M.rooms)) { foreach ($spec in @($rm.specs)) { foreach ($ut in @($spec.unit_types)) { foreach ($u in @($ut.units)) { if (Has $u 'elements') { $anyElementsM = $true }; if (-not $firstUnitM) { $firstUnitM = $u } } }; foreach ($g in @($spec.others.by_noun)) { if (Has $g 'elements') { $anyElementsM = $true }; if (-not $firstOtherM) { $firstOtherM = $g } } } }
if ($M.leaf_count -gt $M.leaf_cap) {
  Check '多房超上限：leaves_inline=false 且所有 elements 省略' ((-not $M.leaves_inline) -and (-not $anyElementsM)) "leaf_count=$($M.leaf_count) cap=$($M.leaf_cap)"
  $selM = Get-Raw "$Base/api/v1/spatial/nearby/tree?$qMany&unit=$($firstUnitM.refno)"
  $SM = $selM.json
  $selUnitM = @(); $otherWithLeavesM = 0
  foreach ($rm in @($SM.rooms)) { foreach ($spec in @($rm.specs)) { foreach ($ut in @($spec.unit_types)) { foreach ($u in @($ut.units)) { if ($u.refno -eq $firstUnitM.refno) { $selUnitM += $u } elseif (Has $u 'elements') { $otherWithLeavesM++ } } }; foreach ($g in @($spec.others.by_noun)) { if (Has $g 'elements') { $otherWithLeavesM++ } } } }
  Check 'unit= 只内联点到的单元（它在的每间房都带）、inlined=unit:…、leaves_inline 仍 false' ($selM.status -eq 200 -and @($selUnitM).Count -gt 0 -and @($selUnitM | Where-Object { -not (Has $_ 'elements') -or @($_.elements).Count -ne [int]$_.count }).Count -eq 0 -and $otherWithLeavesM -eq 0 -and $SM.inlined -eq "unit:$($firstUnitM.refno)" -and (-not $SM.leaves_inline)) "unit=$($firstUnitM.refno) in_rooms=$(@($selUnitM).Count) inlined=$($SM.inlined) elapsed_ms=$($selM.elapsed_ms)"
  Save '06-nearby-tree-many-rooms-unit-selector.json' ([ordered]@{ status = $selM.status; elapsed_ms = $selM.elapsed_ms; inlined = $SM.inlined; unit = $selUnitM })
  if ($firstOtherM) {
    $selO = Get-Raw "$Base/api/v1/spatial/nearby/tree?$qMany&other_noun=$($firstOtherM.noun)"
    $SO = $selO.json; $groups = @(); $othersWithout = 0
    foreach ($rm in @($SO.rooms)) { foreach ($spec in @($rm.specs)) { foreach ($g in @($spec.others.by_noun)) { if ($g.noun -eq $firstOtherM.noun) { $groups += $g } elseif (Has $g 'elements') { $othersWithout++ } }; foreach ($ut in @($spec.unit_types)) { foreach ($u in @($ut.units)) { if (Has $u 'elements') { $othersWithout++ } } } } }
    Check 'other_noun= 只内联那个 noun 组（每间房 / 每个专业下同名组都带）' ($selO.status -eq 200 -and @($groups).Count -gt 0 -and @($groups | Where-Object { -not (Has $_ 'elements') }).Count -eq 0 -and $othersWithout -eq 0 -and $SO.inlined -eq "other_noun:$($firstOtherM.noun)") "noun=$($firstOtherM.noun) groups=$(@($groups).Count) elapsed_ms=$($selO.elapsed_ms)"
    Save '06b-nearby-tree-many-rooms-other-noun-selector.json' ([ordered]@{ status = $selO.status; elapsed_ms = $selO.elapsed_ms; inlined = $SO.inlined; groups = @($groups | Select-Object -First 3) })
  }
} else {
  Check "多房（$($manyRooms.Count) 间）叶子仍未超上限（记录，不判）" $true "leaf_count=$($M.leaf_count) cap=$($M.leaf_cap)"
}
$both = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q&rooms=$Room&unit=$Room&other_noun=PANE"
Check 'unit 与 other_noun 同时给 → 400' ($both.status -eq 400) "$($both.status) $($both.json.message)"

# 6. rooms/{refno}/tree
$rt = Get-Raw "$Base/api/v1/spatial/rooms/$Room/tree"
$R = $rt.json
Save '07-room-tree.json' $R
Check 'rooms/{refno}/tree 200、rooms 一条、center.source=refno_aabb_center、radius=0、shape=cube' ($rt.status -eq 200 -and @($R.rooms).Count -eq 1 -and $R.center.source -eq 'refno_aabb_center' -and [double]$R.radius -eq 0 -and $R.shape -eq 'cube') "status=$($rt.status) elapsed_ms=$($rt.elapsed_ms) total=$($R.total_count) leaf_count=$($R.leaf_count) center=$($R.center.source)"
$rtM = Get-Raw "$Base/api/v1/spatial/rooms/$Room/tree?radius=500"
Check 'rooms/{refno}/tree?radius=500 外扩：total ≥ 不外扩' ($rtM.status -eq 200 -and $rtM.json.total_count -ge $R.total_count) "$($rtM.json.total_count) vs $($R.total_count)"
$rtN = Get-Raw "$Base/api/v1/spatial/rooms/$Room/tree?nouns=PANE"
Check 'rooms/{refno}/tree?nouns=PANE 过滤透传：叶子全是 PANE' ($rtN.status -eq 200 -and (@($rtN.json.rooms[0].specs | ForEach-Object { $_.unit_types } | ForEach-Object { $_.units } | ForEach-Object { $_.elements } | Where-Object { $_.noun -ne 'PANE' }).Count -eq 0) -and (@($rtN.json.rooms[0].specs | ForEach-Object { $_.others.by_noun } | Where-Object { $_.noun -ne 'PANE' }).Count -eq 0)) "total=$($rtN.json.total_count)"
Save '07b-room-tree-variants.json' ([ordered]@{ margin_500 = [ordered]@{ status = $rtM.status; total_count = $rtM.json.total_count }; nouns_pane = [ordered]@{ status = $rtN.status; total_count = $rtN.json.total_count } })

# 7. 错误
$e1 = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q"
Check 'nearby/tree 不带 rooms= → 400' ($e1.status -eq 400 -and $e1.json.message -match 'rooms') "$($e1.status) $($e1.json.message)"
$e2 = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q&rooms=1_1"
Check 'rooms=1_1（不在册）→ 400' ($e2.status -eq 400) "$($e2.status) $($e2.json.message)"
$e3 = Get-Raw "$Base/api/v1/spatial/rooms/abc/tree"
Check 'rooms/abc/tree → 400' ($e3.status -eq 400) "$($e3.status) $($e3.json.message)"
$e4 = Get-Raw "$Base/api/v1/spatial/rooms/$Room/tree?x=1&y=2&z=3"
Check 'rooms/{refno}/tree?x,y,z → 400' ($e4.status -eq 400) "$($e4.status) $($e4.json.message)"
$e5 = Get-Raw "$Base/api/v1/spatial/rooms/1_1/tree"
Check 'rooms/1_1/tree（不在册）→ 400' ($e5.status -eq 400) "$($e5.status) $($e5.json.message)"
$e6 = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q&rooms=$Room&unit=zzz"
Check 'unit=zzz → 400' ($e6.status -eq 400) "$($e6.status) $($e6.json.message)"
Save '08-errors.json' ([ordered]@{ no_rooms = [ordered]@{ status = $e1.status; body = $e1.json }; unknown_room = [ordered]@{ status = $e2.status; body = $e2.json }; bad_path = [ordered]@{ status = $e3.status; body = $e3.json }; xyz = [ordered]@{ status = $e4.status; body = $e4.json }; unknown_room_path = [ordered]@{ status = $e5.status; body = $e5.json }; bad_unit = [ordered]@{ status = $e6.status; body = $e6.json }; both_selectors = [ordered]@{ status = $both.status; body = $both.json } })

# 8. 计时（记忆热了再来一发）
$w1 = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q&rooms=$Room"
$w2 = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q100"
$timing = [ordered]@{ room_3m_first_ms = $tree.elapsed_ms; room_3m_warm_ms = $w1.elapsed_ms; room_100m_first_ms = $big.elapsed_ms; room_100m_warm_ms = $w2.elapsed_ms; room_tree_ms = $rt.elapsed_ms; refnos_ms = $refnos.elapsed_ms }
Check '记录：耗时（3 m 首发 / 热、100 m 首发 / 热、rooms tree）' $true $timing

# 9. tubes=1（方案 B · T1，gen-model-model-cache spec §4.13.5「tubes=1」；上面 1–8 都不带 tubes=，响应形状与改前相同）
$tubeKeys = @('tube_count', 'tubes', 'total_tube_count', 'tubes_truncated')
function Strip($obj, [string[]]$keys) {
  if ($null -eq $obj) { return $null }
  if ($obj -is [System.Array]) { return @($obj | ForEach-Object { Strip $_ $keys }) }
  if ($obj -is [pscustomobject]) { $o = [ordered]@{}; foreach ($p in $obj.PSObject.Properties) { if ($keys -notcontains $p.Name) { $o[$p.Name] = Strip $p.Value $keys } }; return [pscustomobject]$o }
  return $obj
}
function TubeAudit($resp, [double]$radiusLimit) {
  # 逐层 Σ tube_count 自洽、内联时 tubes 数 = tube_count、Σ elements + Σ tubes = leaf_count、每段字段齐且 distance ≤ 上限；回一份账。
  $a = [ordered]@{ layers_ok = $true; inline_ok = $true; shape_ok = $true; elements = 0; tubes = 0; units_with_tubes = 0; far = 0; through_wall = 0 }
  foreach ($rm in @($resp.rooms)) {
    if ((Sum $rm.specs 'tube_count') -ne [int]$rm.tube_count) { $a.layers_ok = $false }
    foreach ($spec in @($rm.specs)) {
      if ((Sum $spec.unit_types 'tube_count') -ne [int]$spec.tube_count) { $a.layers_ok = $false }
      foreach ($ut in @($spec.unit_types)) {
        if ((Sum $ut.units 'tube_count') -ne [int]$ut.tube_count) { $a.layers_ok = $false }
        foreach ($u in @($ut.units)) {
          $a.elements += @($u.elements).Count; $a.tubes += @($u.tubes).Count
          if (-not (Has $u 'tube_count')) { $a.inline_ok = $false }
          if ([int]$u.tube_count -gt 0) { $a.units_with_tubes++ }
          if ($resp.leaves_inline -and (-not (Has $u 'tubes') -or @($u.tubes).Count -ne [int]$u.tube_count)) { $a.inline_ok = $false }
          $elemSet = @{}; foreach ($e in @($u.elements)) { $elemSet[$e.refno] = 1 }
          foreach ($tb in @($u.tubes)) {
            if (-not ((Has $tb 'ordinal') -and (Has $tb 'from') -and (Has $tb 'to') -and (Has $tb 'from_noun') -and (Has $tb 'to_noun') -and (Has $tb 'length') -and (Has $tb 'aabb') -and (Has $tb 'invalid') -and [double]$tb.length -gt 0 -and [double]$tb.distance -ge 0 -and $tb.from -ne $tb.to)) { $a.shape_ok = $false }
            if ([double]$tb.distance -gt $radiusLimit) { $a.far++ }
            if (-not ($tb.from -eq $u.refno -or $tb.to -eq $u.refno -or $elemSet.ContainsKey($tb.from) -or $elemSet.ContainsKey($tb.to))) { $a.through_wall++ }
          }
        }
      }
      foreach ($g in @($spec.others.by_noun)) { $a.elements += @($g.elements).Count }
    }
  }
  $a
}
$leakedKeys = @(($tubeKeys + @('from_noun')) | Where-Object { $tree.body.Contains("`"$_`"") -or $rt.body.Contains("`"$_`"") })
Check '不带 tubes= 的 nearby/tree 与 rooms/{refno}/tree 里没有任何直段键（缺省关；上面 1–8 的形状与改前相同）' ($leakedKeys.Count -eq 0) ($leakedKeys -join ',')
$tubedNear = Get-Raw "$Base/api/v1/spatial/nearby/tree?$q&rooms=$Room&tubes=1"; $TN = $tubedNear.json
Save '03c-nearby-tree-single-room-tubes.json' $TN
$ta = TubeAudit $TN 3000
Check 'nearby/tree 3 m 球 tubes=1：200、total_tube_count > 0、total_count / leaf 不变、逐层 Σ tube_count 自洽、Σ elements + Σ tubes = leaf_count、每段 distance ≤ 3000' ($tubedNear.status -eq 200 -and [int]$TN.total_tube_count -gt 0 -and $TN.tubes_truncated -eq $false -and $TN.total_count -eq $T.total_count -and $ta.layers_ok -and $ta.inline_ok -and $ta.shape_ok -and $ta.far -eq 0 -and ($ta.elements + $ta.tubes) -eq [int]$TN.leaf_count -and $ta.elements -eq [int]$T.leaf_count) "elapsed_ms=$($tubedNear.elapsed_ms) (plain $($tree.elapsed_ms)) total=$($TN.total_count) total_tube_count=$($TN.total_tube_count) leaf_count=$($TN.leaf_count) units_with_tubes=$($ta.units_with_tubes) through_wall=$($ta.through_wall)"
$rtt = Get-Raw "$Base/api/v1/spatial/rooms/$Room/tree?tubes=1"; $RN = $rtt.json
Save '07c-room-tree-tubes.json' $RN
$ra = TubeAudit $RN ([double]::PositiveInfinity)
$branUnit = $null; foreach ($spec in @($RN.rooms[0].specs)) { foreach ($ut in @($spec.unit_types)) { foreach ($u in @($ut.units)) { if ($u.refno -eq $Bran) { $branUnit = $u } } } }
$records = Get-Raw "$Base/api/v1/model/records" 'POST' "{`"generation_root`":`"$Bran`",`"limit`":5000}"
$tubiInsts = 0; foreach ($it in @($records.json.items)) { foreach ($i in @($it.insts)) { if ($i.is_tubi -eq $true) { $tubiInsts++ } } }
$stripped = (Strip $RN ($tubeKeys + @('leaf_count'))) | ConvertTo-Json -Depth 32 -Compress
$plainStripped = (Strip $R @('leaf_count')) | ConvertTo-Json -Depth 32 -Compress
Check "rooms/{refno}/tree?tubes=1：200、逐层自洽、单房 rooms[0].tube_count = total_tube_count、BRAN $Bran 的 tube_count ≤ model/records TUBI 数、去掉直段键与 leaf_count 后与不带 tubes 逐字相同" ($rtt.status -eq 200 -and $ra.layers_ok -and $ra.inline_ok -and $ra.shape_ok -and ($ra.elements + $ra.tubes) -eq [int]$RN.leaf_count -and $RN.rooms[0].tube_count -eq $RN.total_tube_count -and $null -ne $branUnit -and [int]$branUnit.tube_count -le $tubiInsts -and $stripped -eq $plainStripped) "elapsed_ms=$($rtt.elapsed_ms) (plain $($rt.elapsed_ms)) total_tube_count=$($RN.total_tube_count) leaf_count=$($RN.leaf_count) bran_tube_count=$($branUnit.tube_count)/records_tubi=$tubiInsts through_wall=$($ra.through_wall) stripped_equal=$($stripped -eq $plainStripped)"
Save '07c-room-tree-tubes-account.json' ([ordered]@{ total_tube_count = $RN.total_tube_count; leaf_count = $RN.leaf_count; plain_leaf_count = $R.leaf_count; audit = $ra; bran = [ordered]@{ refno = $Bran; count = $branUnit.count; tube_count = $branUnit.tube_count; model_records_tubi = $tubiInsts }; sphere_3m = [ordered]@{ total_tube_count = $TN.total_tube_count; leaf_count = $TN.leaf_count; audit = $ta }; elapsed_ms = [ordered]@{ room_tree_plain = $rt.elapsed_ms; room_tree_tubes = $rtt.elapsed_ms; near_3m_plain = $tree.elapsed_ms; near_3m_tubes = $tubedNear.elapsed_ms } })

$result = [ordered]@{
  base = $Base; room = $Room; dbnum = $Dbnum; started_at = $startedAt; finished_at = (Get-Date).ToString('o')
  health = [ordered]@{ build_id = $h.build_id; started_at = $h.started_at; delivery_unit_types = $h.delivery_unit_types }
  after_ensure = $treeState
  single_room = [ordered]@{ total_count = $T.total_count; leaf_count = $T.leaf_count; leaves_inline = $T.leaves_inline; specs = @($T.rooms[0].specs | ForEach-Object { [ordered]@{ spec_value = $_.spec_value; count = $_.count; unit_types = @($_.unit_types | ForEach-Object { [ordered]@{ noun = $_.noun; count = $_.count; units = @($_.units).Count } }); others = [ordered]@{ count = $_.others.count; nouns = @($_.others.by_noun | ForEach-Object { "$($_.noun):$($_.count)" }) } } }) }
  two_rooms = [ordered]@{ total_count = $T2.total_count; rooms = @($T2.rooms | ForEach-Object { "$($_.room_num):$($_.count)" }); shared = $sharedUnique.Count }
  capped_100m = [ordered]@{ total_count = $B.total_count; leaf_count = $B.leaf_count; leaves_inline = $B.leaves_inline }
  many_rooms_100m = [ordered]@{ rooms_requested = $manyRooms.Count; total_count = $M.total_count; leaf_count = $M.leaf_count; leaves_inline = $M.leaves_inline; elapsed_ms = $many.elapsed_ms }
  room_tree = [ordered]@{ total_count = $R.total_count; leaf_count = $R.leaf_count; center = $R.center }
  timing = $timing
  checks = $checks
  pass = @($checks | Where-Object { $_.pass }).Count
  fail = @($checks | Where-Object { -not $_.pass }).Count
}
Save '00-summary.json' $result
Write-Output "pass=$($result.pass) fail=$($result.fail)"
foreach ($ck in $checks) { if (-not $ck.pass) { Write-Output ("FAIL: {0} :: {1}" -f $ck.name, (($ck.detail | ConvertTo-Json -Compress -Depth 4))) } }
