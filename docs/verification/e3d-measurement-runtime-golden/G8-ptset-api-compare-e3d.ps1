param([string]$Base = 'http://127.0.0.1:8023', [string]$Trace = "$env:TEMP\ptset-api-run\e3d-ptset.trace.txt")
$ErrorActionPreference = 'Stop'
$axes = @{ E = @(1,0,0); W = @(-1,0,0); N = @(0,1,0); S = @(0,-1,0); U = @(0,0,1); D = @(0,0,-1) }
function Parse-Dir([string]$s) {
  $tok = $s.Trim() -split '\s+'
  $v = [double[]]($axes[$tok[0]])
  for ($i = 1; $i + 1 -lt $tok.Count; $i += 2) {
    $ang = [double]$tok[$i] * [math]::PI / 180.0
    $a = [double[]]($axes[$tok[$i + 1]])
    $v = @(([math]::Cos($ang) * $v[0] + [math]::Sin($ang) * $a[0]), ([math]::Cos($ang) * $v[1] + [math]::Sin($ang) * $a[1]), ([math]::Cos($ang) * $v[2] + [math]::Sin($ang) * $a[2]))
  }
  return $v
}
function Parse-Pos([string]$s) {
  $p = @(0.0, 0.0, 0.0)
  $tok = $s.Trim() -split '\s+'
  for ($i = 0; $i + 1 -lt $tok.Count; $i += 2) {
    $val = [double]($tok[$i + 1] -replace 'mm$', '')
    switch ($tok[$i]) { 'E' { $p[0] = $val } 'W' { $p[0] = -$val } 'N' { $p[1] = $val } 'S' { $p[1] = -$val } 'U' { $p[2] = $val } 'D' { $p[2] = -$val } }
  }
  return $p
}
# parse trace
$golden = @{}
$cur = $null
foreach ($line in Get-Content $Trace) {
  if ($line -match '^---- =(\S+) type=(\S+)') { $cur = $Matches[1]; $golden[$cur] = @{ type = $Matches[2]; points = @{} }; continue }
  if ($line -match '^P(\d+)\|pos=(.+?)\|dir=(.+?)\|bore=(.+)$') {
    $golden[$cur].points[[int]$Matches[1]] = @{ pos = Parse-Pos $Matches[2]; dir = Parse-Dir $Matches[3]; bore = [double]($Matches[4] -replace 'mm$', '') }
  }
}
$maxPos = 0.0; $maxDir = 0.0; $compared = 0; $bad = 0
foreach ($refno in $golden.Keys) {
  $body = @{ refno = $refno } | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Method Post -Uri "$Base/api/v1/element/ptset" -ContentType 'application/json' -Body $body
  $m = $resp.world_transform
  $apiNums = @{}
  foreach ($pt in $resp.points) {
    $l = $pt.pt
    $w = @(($m[0]*$l[0] + $m[4]*$l[1] + $m[8]*$l[2] + $m[12]), ($m[1]*$l[0] + $m[5]*$l[1] + $m[9]*$l[2] + $m[13]), ($m[2]*$l[0] + $m[6]*$l[1] + $m[10]*$l[2] + $m[14]))
    $d = $pt.dir
    $wd = @(($m[0]*$d[0] + $m[4]*$d[1] + $m[8]*$d[2]), ($m[1]*$d[0] + $m[5]*$d[1] + $m[9]*$d[2]), ($m[2]*$d[0] + $m[6]*$d[1] + $m[10]*$d[2]))
    $apiNums[[int]$pt.number] = $true
    $g = $golden[$refno].points[[int]$pt.number]
    if (-not $g) { "  $refno P$($pt.number): API only (E3D has no such point)"; $bad++; continue }
    $dp = [math]::Sqrt(($w[0]-$g.pos[0])*($w[0]-$g.pos[0]) + ($w[1]-$g.pos[1])*($w[1]-$g.pos[1]) + ($w[2]-$g.pos[2])*($w[2]-$g.pos[2]))
    $dd = [math]::Sqrt(($wd[0]-$g.dir[0])*($wd[0]-$g.dir[0]) + ($wd[1]-$g.dir[1])*($wd[1]-$g.dir[1]) + ($wd[2]-$g.dir[2])*($wd[2]-$g.dir[2]))
    $bore = if ($null -ne $pt.bore) { [double]$pt.bore } else { 0.0 }
    $compared++
    if ($dp -gt $maxPos) { $maxPos = $dp }
    if ($dd -gt $maxDir) { $maxDir = $dd }
    $flag = if ($dp -gt 0.01 -or $dd -gt 1e-4 -or [math]::Abs($bore - $g.bore) -gt 1e-6) { $bad++; ' <-- MISMATCH' } else { '' }
    "{0} {1,-4} P{2,-3} dpos={3,8:F4}mm ddir={4,9:E2} bore api={5} e3d={6}{7}" -f $refno, $resp.noun, $pt.number, $dp, $dd, $bore, $g.bore, $flag
  }
  foreach ($n in $golden[$refno].points.Keys) { if (-not $apiNums.ContainsKey($n) -and $n -ne 0) { "  $refno P$n : E3D only (API lacks it)"; $bad++ } }
}
"compared=$compared mismatches=$bad max_dpos=$([math]::Round($maxPos,5))mm max_ddir=$maxDir"
