<#
.SYNOPSIS
  Bounded live gate for whole-dbnum frozen-source semantics.

.DESCRIPTION
  Starts an isolated spawned-mem backend against an isolated E3D project copy,
  starts a whole-dbnum task, advances the source session while that task is
  running, restores the source in a second SAVEWORK, and proves:

    * the first task keeps its original source_sesno, total, and ordered roots;
    * it either succeeds from that source or safely rejects a stale overwrite
      after the live watcher publishes the newer source;
    * a subsequent task sees the restored source's newer session.

  The apply/restore macros resize one known BOX from 100 mm to 140 mm and back.
  Both mutations use l3_suite's guarded driver, which records database identity
  and before/after session evidence. The restore is attempted in finally if the
  apply SAVEWORK committed but a later assertion fails.

  No browser is started. The backend, its spawned SurrealDB, and every E3D TTY
  session started by l3_suite are finite-lifetime test processes.
#>
[CmdletBinding()]
param(
  [string]$BackendRepo = 'D:\work\plant-code\old\gen-model-refactor',
  [string]$BackendExe = 'D:\Rust\target\debug\aios-database.exe',
  [string]$L3Exe = 'D:\Rust\target\debug\l3_suite.exe',
  [string]$FixtureExe = 'D:\Rust\target\debug\db_session_fixture.exe',
  [string]$SourceConfig = 'D:\work\plant-code\old\gen-model-refactor\DbOption.toml',
  [string]$ProjectDir = 'D:\AVEVA\Projects\E3D31-DBMDAT-test\AvevaMarineSample',
  [string]$SurrealExe = 'D:\work\plant-code\old\gen-model\bin\surreal.exe',
  [int]$Dbnum = 7997,
  [int]$HttpPort = 18082,
  [int]$StorePort = 18812,
  [int]$GeometryWorkers = 8,
  [int]$TaskWaitSec = 1800,
  [string]$Output = "output/gen-model-v1-frozen-source-live/$(Get-Date -Format yyyyMMdd-HHmmss)"
)

$ErrorActionPreference = 'Stop'
$plantRoot = Split-Path -Parent $PSScriptRoot
$out = if ([IO.Path]::IsPathRooted($Output)) { $Output } else { Join-Path $plantRoot $Output }
[IO.Directory]::CreateDirectory($out) | Out-Null

$targetDbFile = Join-Path $ProjectDir "ams000\ams${Dbnum}_0001"
$projectRoot = Split-Path -Parent $ProjectDir
$baseUrl = "http://127.0.0.1:$HttpPort"
$runtime = Join-Path $env:TEMP ("gen-model-frozen-source-{0}" -f [guid]::NewGuid().ToString('N'))
$runtimeExe = Join-Path $runtime 'aios-database.exe'
$runtimeConfig = Join-Path $runtime 'DbOption.toml'
$runtimeStdout = Join-Path $runtime 'stdout.log'
$runtimeStderr = Join-Path $runtime 'stderr.log'
$backend = $null
$applyCommitted = $false
$restoreCommitted = $false
$failure = $null
$succeeded = $false

$evidence = [ordered]@{
  started_at = (Get-Date).ToString('o')
  backend_repo = $BackendRepo
  backend_exe = $BackendExe
  l3_exe = $L3Exe
  fixture_exe = $FixtureExe
  project_dir = $ProjectDir
  target_db_file = $targetDbFile
  dbnum = $Dbnum
  base_url = $baseUrl
  store_port = $StorePort
  geometry_workers = $GeometryWorkers
  output = $out
  phase = 'preflight'
}

function Assert-That([bool]$condition, [string]$message) {
  if (-not $condition) { throw $message }
}

function Save-Evidence {
  $evidence['updated_at'] = (Get-Date).ToString('o')
  [IO.File]::WriteAllText(
    (Join-Path $out 'evidence.json'),
    ($evidence | ConvertTo-Json -Depth 40),
    [Text.UTF8Encoding]::new($false)
  )
}

function Set-TomlScalar([string]$text, [string]$key, [string]$line) {
  $active = "(?m)^\s*$([regex]::Escape($key))\s*=.*$"
  if ([regex]::IsMatch($text, $active)) {
    return [regex]::Replace($text, $active, $line, 1)
  }
  $commented = "(?m)^\s*#\s*$([regex]::Escape($key))\s*=.*$"
  if ([regex]::IsMatch($text, $commented)) {
    return [regex]::Replace($text, $commented, $line, 1)
  }
  return $text.TrimEnd() + "`r`n$line`r`n"
}

function Get-Json([string]$path, [int]$timeoutSec = 180) {
  Invoke-RestMethod -Uri "$baseUrl$path" -Method Get -TimeoutSec $timeoutSec
}

function Post-Json([string]$path, $body, [int]$timeoutSec = 180) {
  Invoke-RestMethod -Uri "$baseUrl$path" -Method Post -ContentType 'application/json' `
    -Body ($body | ConvertTo-Json -Compress) -TimeoutSec $timeoutSec
}

function Get-LatestSesno {
  $raw = @(& $FixtureExe inspect --source $targetDbFile 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode) { throw "db_session_fixture inspect failed ($exitCode): $($raw -join "`n")" }
  return [int](($raw -join "`n") | ConvertFrom-Json).latest_sesno
}

function Get-RootFingerprint($view) {
  $lines = @($view.roots | ForEach-Object {
    "$($_.generation_root)|$($_.noun)|$($_.name)"
  })
  $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Save-Roots([string]$name, $view) {
  $lines = @($view.roots | ForEach-Object {
    "$($_.generation_root)`t$($_.noun)`t$($_.name)`tready=$($_.ready)"
  })
  [IO.File]::WriteAllLines((Join-Path $out "$name.roots.txt"), $lines, [Text.UTF8Encoding]::new($false))
}

function Get-TaskRoots([string]$taskId) {
  $escaped = [uri]::EscapeDataString($taskId)
  Get-Json "/api/v1/dbnums/$Dbnum/model/roots?task_id=$escaped"
}

function Get-Task([string]$taskId) {
  Get-Json "/api/v1/tasks/$([uri]::EscapeDataString($taskId))"
}

function Get-RootSummary($view) {
  [ordered]@{
    task_id = $view.task_id
    source_sesno = [int]$view.source_sesno
    total = [int]$view.total
    ready_total = [int]$view.ready_total
    fingerprint = Get-RootFingerprint $view
  }
}

function Wait-Task([string]$taskId, [string]$label, [switch]$RequireSucceeded) {
  $terminal = @('succeeded', 'partial', 'failed')
  $deadline = (Get-Date).AddSeconds($TaskWaitSec)
  $last = ''
  do {
    $task = Get-Task $taskId
    $summary = "$($task.state) $($task.units_done)/$($task.total_units)"
    if ($summary -ne $last) {
      Write-Host "[gate] $label $summary"
      $last = $summary
    }
    if ($task.state -in $terminal) { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  Assert-That ($task.state -in $terminal) "$label did not reach a terminal state within $TaskWaitSec s"
  if ($RequireSucceeded) {
    Assert-That ($task.state -eq 'succeeded') "$label terminal state=$($task.state): $($task.result | ConvertTo-Json -Depth 10 -Compress)"
  }
  return $task
}

function Write-GateMacros {
  $macroDir = Join-Path $out 'macros'
  [IO.Directory]::CreateDirectory($macroDir) | Out-Null

  $probe = Join-Path $macroDir 'probe.mac'
  $apply = Join-Path $macroDir 'apply.mac'
  $restore = Join-Path $macroDir 'restore.mac'
  $probeLog = ([IO.Path]::ChangeExtension($probe, 'log') -replace '\\', '/')
  $applyLog = ([IO.Path]::ChangeExtension($apply, 'log') -replace '\\', '/')
  $restoreLog = ([IO.Path]::ChangeExtension($restore, 'log') -replace '\\', '/')

  $probeText = @"
ALPHA LOG "$probeLog" OVER
/Copy-of-RCS106MV
VAR !BOXES COLLECT ALL BOX FOR CE
`$!BOXES[1]
Q CE
Q REF
Q XLEN
ALPHA LOG END
"@
  $applyText = @"
ALPHA LOG "$applyLog" OVER
/Copy-of-RCS106MV
VAR !BOXES COLLECT ALL BOX FOR CE
`$!BOXES[1]
Q CE
Q REF
Q XLEN
XLEN 140
Q XLEN
SAVEWORK 'CODEX frozen-source gate apply XLEN 100 to 140'
ALPHA LOG END
"@
  $restoreText = @"
ALPHA LOG "$restoreLog" OVER
/Copy-of-RCS106MV
VAR !BOXES COLLECT ALL BOX FOR CE
`$!BOXES[1]
Q CE
Q REF
Q XLEN
XLEN 100
Q XLEN
SAVEWORK 'CODEX frozen-source gate restore XLEN 100'
ALPHA LOG END
"@

  foreach ($item in @(
    @{ Path = $probe; Text = $probeText },
    @{ Path = $apply; Text = $applyText },
    @{ Path = $restore; Text = $restoreText }
  )) {
    [IO.File]::WriteAllText($item.Path, $item.Text, [Text.Encoding]::ASCII)
  }

  $probeSaves = @($probeText -split "`r?`n" | Where-Object { $_.Trim() -match '^SAVE\s*WORK\b' }).Count
  $applySaves = @($applyText -split "`r?`n" | Where-Object { $_.Trim() -match '^SAVE\s*WORK\b' }).Count
  $restoreSaves = @($restoreText -split "`r?`n" | Where-Object { $_.Trim() -match '^SAVE\s*WORK\b' }).Count
  Assert-That ($probeSaves -eq 0) "probe macro unexpectedly contains SAVEWORK"
  Assert-That ($applySaves -eq 1) "apply macro must contain exactly one SAVEWORK"
  Assert-That ($restoreSaves -eq 1) "restore macro must contain exactly one SAVEWORK"
  foreach ($text in @($probeText, $applyText, $restoreText)) {
    Assert-That ($text -notmatch '(?im)^\s*(QUIT|FINISH|MERGE|PURGE|COMPACT)\b') 'gate macro contains a forbidden command'
  }

  return [pscustomobject]@{ Probe = $probe; Apply = $apply; Restore = $restore }
}

function New-L3Process([string]$macro, [string]$driverOut, [bool]$stateful) {
  [IO.Directory]::CreateDirectory($driverOut) | Out-Null
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $L3Exe
  $psi.WorkingDirectory = $BackendRepo
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($arg in @(
    '--check-driver', $macro,
    '--project-dir', $ProjectDir,
    '--e3d-project', 'AMS',
    '--e3d-login', 'SYSTEM/XXXXXX',
    '--e3d-mdb', '/ALL',
    '--output', $driverOut
  )) {
    $psi.ArgumentList.Add([string]$arg)
  }
  if ($stateful) {
    foreach ($arg in @(
      '--target-db-file', $targetDbFile,
      '--target-dbnum', [string]$Dbnum,
      '--aios-project', 'AvevaMarineSample'
    )) {
      $psi.ArgumentList.Add([string]$arg)
    }
  }
  # The already-open user session points at E3D3.1. This gate uses the separate
  # E3D31-DBMDAT-test project root, so l3_suite may safely baseline and ignore it.
  $psi.Environment['L3_ALLOW_EXISTING_E3D_SESSION'] = '1'
  $psi.Environment['L3_E3D_TIMEOUT_SECONDS'] = '1200'

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $psi
  Assert-That ($process.Start()) "could not start l3_suite"
  return $process
}

function Complete-L3Process($process, [string]$driverOut, [string]$label) {
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  [IO.File]::WriteAllText((Join-Path $driverOut 'l3.stdout.log'), $stdout, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $driverOut 'l3.stderr.log'), $stderr, [Text.UTF8Encoding]::new($false))
  if ($process.ExitCode -ne 0) {
    throw "$label l3_suite failed ($($process.ExitCode)): $stderr $stdout"
  }
}

function Invoke-ReadOnlyProbe([string]$macro, [string]$label, [string]$expected) {
  $driverOut = Join-Path $out $label
  Write-Host "[gate] $label"
  $process = New-L3Process $macro $driverOut $false
  Complete-L3Process $process $driverOut $label
  $macroLog = [IO.Path]::ChangeExtension($macro, 'log')
  Assert-That (Test-Path -LiteralPath $macroLog) "$label macro log is missing: $macroLog"
  $text = [IO.File]::ReadAllText($macroLog)
  Assert-That ($text -match [regex]::Escape($expected)) "$label output does not contain '$expected': $text"
  return [ordered]@{ expected = $expected; log = $macroLog; output = $text.Trim() }
}

function Invoke-MutationDuringTask(
  [string]$macro,
  [string]$label,
  [string]$taskId,
  [int]$beforeSesno
) {
  $driverOut = Join-Path $out $label
  Write-Host "[gate] $label start (source sesno=$beforeSesno)"
  $process = New-L3Process $macro $driverOut $true
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $observed = $null
  while (-not $process.HasExited) {
    $currentSesno = Get-LatestSesno
    if ($null -eq $observed -and $currentSesno -gt $beforeSesno) {
      $task = Get-Task $taskId
      $observed = [ordered]@{
        observed_at = (Get-Date).ToString('o')
        source_sesno = $currentSesno
        task_state = $task.state
        task_units_done = [int]$task.units_done
        task_total_units = [int]$task.total_units
      }
      Write-Host "[gate] $label SAVEWORK observed; task=$($task.state) $($task.units_done)/$($task.total_units)"
    }
    Start-Sleep -Milliseconds 250
  }
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  [IO.File]::WriteAllText((Join-Path $driverOut 'l3.stdout.log'), $stdout, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $driverOut 'l3.stderr.log'), $stderr, [Text.UTF8Encoding]::new($false))

  $reportPath = Join-Path $driverOut 'check-driver-evidence.json'
  $report = if (Test-Path -LiteralPath $reportPath) {
    [IO.File]::ReadAllText($reportPath) | ConvertFrom-Json
  } else { $null }
  if ($null -eq $observed -and $report -and [int]$report.after_sesno -gt $beforeSesno) {
    $task = Get-Task $taskId
    $observed = [ordered]@{
      observed_at = (Get-Date).ToString('o')
      source_sesno = [int]$report.after_sesno
      task_state = $task.state
      task_units_done = [int]$task.units_done
      task_total_units = [int]$task.total_units
    }
  }
  if ($process.ExitCode -ne 0) {
    throw "$label l3_suite failed ($($process.ExitCode)): $stderr $stdout"
  }
  Assert-That ($null -ne $report) "$label did not write check-driver-evidence.json"
  return [ordered]@{
    before_sesno = [int]$report.before_sesno
    after_sesno = [int]$report.after_sesno
    outcome = [string]$report.outcome
    classification_error = $report.classification_error
    task_at_save = $observed
    evidence_file = $reportPath
  }
}

function Start-Backend {
  foreach ($port in @($HttpPort, $StorePort)) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    Assert-That (-not $listener) "port $port is already in use by PID $($listener.OwningProcess)"
  }
  [IO.Directory]::CreateDirectory($runtime) | Out-Null
  [IO.File]::Copy($BackendExe, $runtimeExe, $true)
  $resource = Join-Path $BackendRepo 'resource'
  if (Test-Path -LiteralPath $resource -PathType Container) {
    Copy-Item -LiteralPath $resource -Destination (Join-Path $runtime 'resource') -Recurse
  }

  $text = [IO.File]::ReadAllText($SourceConfig)
  $root = $projectRoot.Replace('\', '/')
  $meshes = (Join-Path $runtime 'meshes').Replace('\', '/')
  $text = Set-TomlScalar $text 'project_path' "project_path = `"$root`""
  $text = Set-TomlScalar $text 'v_ip' 'v_ip = "127.0.0.1"'
  $text = Set-TomlScalar $text 'v_port' "v_port = $StorePort"
  $text = Set-TomlScalar $text 'store_mode' 'store_mode = "spawned-mem"'
  $text = Set-TomlScalar $text 'data_face' 'data_face = "read-through"'
  $text = Set-TomlScalar $text 'http_api_addr' "http_api_addr = `"127.0.0.1:$HttpPort`""
  $text = Set-TomlScalar $text 'http_api_cors' 'http_api_cors = ["*"]'
  $text = Set-TomlScalar $text 'startup_autorun' 'startup_autorun = false'
  $text = Set-TomlScalar $text 'auto_initialize_new_dbnums' 'auto_initialize_new_dbnums = true'
  $text = Set-TomlScalar $text 'room_membership' 'room_membership = false'
  $text = Set-TomlScalar $text 'watch_dbnums' "watch_dbnums = [$Dbnum]"
  $text = Set-TomlScalar $text 'geometry_workers' "geometry_workers = $GeometryWorkers"
  $text = Set-TomlScalar $text 'meshes_path' "meshes_path = `"$meshes`""
  [IO.File]::WriteAllText($runtimeConfig, $text, [Text.UTF8Encoding]::new($false))

  $old = [ordered]@{
    DB_OPTION_FILE = $env:DB_OPTION_FILE
    AIOS_STORE_MODE = $env:AIOS_STORE_MODE
    AIOS_SURREAL_EXE = $env:AIOS_SURREAL_EXE
    AIOS_STARTUP_AUTORUN = $env:AIOS_STARTUP_AUTORUN
    AIOS_ROOM_MEMBERSHIP = $env:AIOS_ROOM_MEMBERSHIP
    AIOS_OPEN_BROWSER = $env:AIOS_OPEN_BROWSER
    RUST_MIN_STACK = $env:RUST_MIN_STACK
  }
  try {
    $env:DB_OPTION_FILE = $runtimeConfig
    $env:AIOS_STORE_MODE = 'spawned-mem'
    $env:AIOS_SURREAL_EXE = $SurrealExe
    $env:AIOS_STARTUP_AUTORUN = '0'
    $env:AIOS_ROOM_MEMBERSHIP = '0'
    $env:AIOS_OPEN_BROWSER = '0'
    $env:RUST_MIN_STACK = '134217728'
    $script:backend = Start-Process -FilePath $runtimeExe -ArgumentList 'serve' `
      -WorkingDirectory $runtime -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $runtimeStdout -RedirectStandardError $runtimeStderr
  } finally {
    foreach ($name in $old.Keys) {
      if ($null -eq $old[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$name" $old[$name] }
    }
  }

  $deadline = (Get-Date).AddMinutes(6)
  do {
    if ($backend.HasExited) {
      throw "backend exited before health; inspect retained backend.stderr.log"
    }
    try {
      $health = Get-Json '/api/v1/health' 5
      if ($health) { break }
    } catch {}
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  Assert-That ($null -ne $health) 'backend health timed out'
  Assert-That ($health.data_face -eq 'read-through') "data_face=$($health.data_face), expected read-through"
  Assert-That ($health.sul_db.medium -eq 'spawned-mem') "medium=$($health.sul_db.medium), expected spawned-mem"
  Assert-That ($health.sul_db.durable -eq $false) 'spawned-mem unexpectedly reports durable=true'
  Assert-That ($health.capabilities.dbnum_model_ensure -eq $true) 'dbnum_model_ensure capability is not true'
  return $health
}

function Stop-Backend {
  if ($backend -and -not $backend.HasExited) {
    Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
    [void]$backend.WaitForExit(10000)
  }
  foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='aios-database.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $runtimeExe })) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='surreal.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match ":$StorePort(?:\s|$)" })) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500
  foreach ($pair in @(
    @{ Source = $runtimeStdout; Name = 'backend.stdout.log' },
    @{ Source = $runtimeStderr; Name = 'backend.stderr.log' },
    @{ Source = $runtimeConfig; Name = 'DbOption.gate.toml' }
  )) {
    if (Test-Path -LiteralPath $pair.Source) {
      [IO.File]::Copy($pair.Source, (Join-Path $out $pair.Name), $true)
    }
  }
}

try {
  foreach ($required in @($BackendRepo, $BackendExe, $L3Exe, $FixtureExe, $SourceConfig, $ProjectDir, $targetDbFile, $SurrealExe)) {
    Assert-That (Test-Path -LiteralPath $required) "required path is missing: $required"
  }
  Assert-That ($ProjectDir -notmatch '(?i)\\E3D3\.1\\AvevaMarineSample$') `
    'this gate refuses the primary E3D3.1 project; use an isolated project copy'
  Assert-That ($GeometryWorkers -ge 1) 'GeometryWorkers must be at least 1'

  $macros = Write-GateMacros
  $baselineSesno = Get-LatestSesno
  $evidence['baseline_sesno'] = $baselineSesno
  $evidence['macros'] = [ordered]@{ probe = $macros.Probe; apply = $macros.Apply; restore = $macros.Restore }
  Save-Evidence

  $probeBefore = Invoke-ReadOnlyProbe $macros.Probe 'probe-before' 'Xlength 100mm'
  Assert-That ((Get-LatestSesno) -eq $baselineSesno) 'read-only probe advanced the database session'
  $evidence['probe_before'] = $probeBefore

  $evidence['phase'] = 'backend-start'
  $health = Start-Backend
  $evidence['health'] = [ordered]@{
    started_at = $health.started_at
    version = $health.version
    build_id = $health.build_id
    data_face = $health.data_face
    medium = $health.sul_db.medium
    durable = $health.sul_db.durable
    geometry_quota = $health.geometry_concurrency.quota
  }
  Save-Evidence
  Write-Host "[gate] backend ready build=$($health.build_id) geometry=$($health.geometry_concurrency.quota)"

  $evidence['phase'] = 'task-a-start'
  $receiptA = Post-Json "/api/v1/dbnums/$Dbnum/model/ensure" @{}
  Assert-That ([int]$receiptA.source_sesno -eq $baselineSesno) "task A source=$($receiptA.source_sesno), expected $baselineSesno"
  Assert-That ($receiptA.state -eq 'running') "task A was not running at creation: $($receiptA.state)"
  $rootsA0 = Get-TaskRoots $receiptA.task_id
  $taskA0 = Get-Task $receiptA.task_id
  $rootsA0Summary = Get-RootSummary $rootsA0
  Save-Roots 'task-a-before' $rootsA0
  Assert-That ([int]$receiptA.expected_roots -eq [int]$rootsA0.total) 'task A receipt/root total mismatch'
  Assert-That ([int]$taskA0.total_units -eq [int]$rootsA0.total) 'task A task/root total mismatch'
  Assert-That ([int]$rootsA0.source_sesno -eq $baselineSesno) 'task A roots source mismatch'
  $evidence['task_a_before'] = [ordered]@{
    receipt = $receiptA
    task = $taskA0
    roots = $rootsA0Summary
  }
  Save-Evidence
  Write-Host "[gate] task A=$($receiptA.task_id) source=$baselineSesno roots=$($rootsA0.total)"

  $evidence['phase'] = 'apply'
  $applyRun = Invoke-MutationDuringTask $macros.Apply 'apply-driver' $receiptA.task_id $baselineSesno
  $applyCommitted = [int]$applyRun.after_sesno -gt $baselineSesno
  $evidence['apply'] = $applyRun
  Save-Evidence
  Assert-That ([int]$applyRun.before_sesno -eq $baselineSesno) 'apply before_sesno drifted'
  Assert-That ([int]$applyRun.after_sesno -eq ($baselineSesno + 1)) 'apply must advance exactly one session'
  Assert-That ($applyRun.task_at_save.task_state -eq 'running') `
    "apply SAVEWORK was not observed while task A was running: $($applyRun.task_at_save.task_state)"

  $rootsA1 = Get-TaskRoots $receiptA.task_id
  $taskA1 = Get-Task $receiptA.task_id
  $rootsA1Summary = Get-RootSummary $rootsA1
  Save-Roots 'task-a-after-apply' $rootsA1
  Assert-That ([int]$rootsA1.source_sesno -eq $baselineSesno) 'task A source_sesno changed after apply'
  Assert-That ([int]$rootsA1.total -eq [int]$rootsA0.total) 'task A total changed after apply'
  Assert-That ($rootsA1Summary.fingerprint -eq $rootsA0Summary.fingerprint) 'task A ordered roots changed after apply'
  Assert-That ([int]$taskA1.total_units -eq [int]$rootsA0.total) 'task A total_units changed after apply'
  Assert-That ([int]$taskA1.detail.frozen_source.source_sesno -eq $baselineSesno) 'task A frozen source detail changed after apply'
  $evidence['task_a_after_apply'] = [ordered]@{ task = $taskA1; roots = $rootsA1Summary }
  Save-Evidence

  $evidence['phase'] = 'restore'
  $restoreRun = Invoke-MutationDuringTask $macros.Restore 'restore-driver' $receiptA.task_id ($baselineSesno + 1)
  $restoreCommitted = [int]$restoreRun.after_sesno -gt ($baselineSesno + 1)
  $evidence['restore'] = $restoreRun
  Save-Evidence
  Assert-That ([int]$restoreRun.before_sesno -eq ($baselineSesno + 1)) 'restore before_sesno drifted'
  Assert-That ([int]$restoreRun.after_sesno -eq ($baselineSesno + 2)) 'restore must advance exactly one session'

  $probeAfter = Invoke-ReadOnlyProbe $macros.Probe 'probe-after' 'Xlength 100mm'
  Assert-That ((Get-LatestSesno) -eq ($baselineSesno + 2)) 'post-restore probe advanced or observed the wrong session'
  $evidence['probe_after'] = $probeAfter

  $rootsA2 = Get-TaskRoots $receiptA.task_id
  $taskA2 = Get-Task $receiptA.task_id
  $rootsA2Summary = Get-RootSummary $rootsA2
  Save-Roots 'task-a-after-restore' $rootsA2
  Assert-That ([int]$rootsA2.source_sesno -eq $baselineSesno) 'task A source_sesno changed after restore'
  Assert-That ([int]$rootsA2.total -eq [int]$rootsA0.total) 'task A total changed after restore'
  Assert-That ($rootsA2Summary.fingerprint -eq $rootsA0Summary.fingerprint) 'task A ordered roots changed after restore'
  Assert-That ([int]$taskA2.total_units -eq [int]$rootsA0.total) 'task A total_units changed after restore'
  $evidence['task_a_after_restore'] = [ordered]@{ task = $taskA2; roots = $rootsA2Summary }
  Save-Evidence

  $evidence['phase'] = 'task-a-wait'
  $taskATerminal = Wait-Task $receiptA.task_id 'task A'
  Assert-That ([int]$taskATerminal.result.source_sesno -eq $baselineSesno) 'task A terminal source_sesno changed'
  Assert-That ([int]$taskATerminal.total_units -eq [int]$rootsA0.total) 'task A terminal total changed'
  if ($taskATerminal.state -ne 'succeeded') {
    $staleSession = [string]$taskATerminal.result.error
    Assert-That ($staleSession -match "^stale e3d-model session $baselineSesno cannot overwrite projected session \d+") `
      "task A non-success terminal was not the stale-session safety gate: $($taskATerminal.result | ConvertTo-Json -Depth 10 -Compress)"
  }
  $evidence['task_a_terminal'] = $taskATerminal
  Save-Evidence

  $evidence['phase'] = 'task-b-start'
  $latestSesno = Get-LatestSesno
  Assert-That ($latestSesno -eq ($baselineSesno + 2)) "latest source session=$latestSesno, expected $($baselineSesno + 2)"
  $receiptB = Post-Json "/api/v1/dbnums/$Dbnum/model/ensure" @{}
  Assert-That ($receiptB.task_id -ne $receiptA.task_id) 'task B reused terminal task A id'
  Assert-That ([int]$receiptB.source_sesno -eq $latestSesno) "task B source=$($receiptB.source_sesno), expected $latestSesno"
  $rootsB = Get-TaskRoots $receiptB.task_id
  $rootsBSummary = Get-RootSummary $rootsB
  Save-Roots 'task-b' $rootsB
  Assert-That ([int]$rootsB.source_sesno -eq $latestSesno) 'task B roots source mismatch'
  Assert-That ([int]$rootsB.total -eq [int]$rootsA0.total) 'restored task B root total differs from task A'
  Assert-That ($rootsBSummary.fingerprint -eq $rootsA0Summary.fingerprint) 'restored task B ordered roots differ from task A'
  $evidence['task_b_before'] = [ordered]@{ receipt = $receiptB; roots = $rootsBSummary }
  Save-Evidence
  Write-Host "[gate] task B=$($receiptB.task_id) source=$latestSesno roots=$($rootsB.total)"

  $evidence['phase'] = 'task-b-wait'
  $taskBTerminal = Wait-Task $receiptB.task_id 'task B' -RequireSucceeded
  Assert-That ([int]$taskBTerminal.result.source_sesno -eq $latestSesno) 'task B terminal source mismatch'
  Assert-That ([int]$taskBTerminal.total_units -eq [int]$rootsB.total) 'task B terminal total mismatch'
  $evidence['task_b_terminal'] = $taskBTerminal
  $evidence['phase'] = 'completed'
  $succeeded = $true
} catch {
  $failure = $_
  $evidence['phase'] = 'failed'
  $evidence['error'] = "$_"
} finally {
  if ($applyCommitted -and -not $restoreCommitted) {
    try {
      Write-Warning 'apply committed but normal restore did not; attempting guarded restore in finally'
      $beforeRestore = Get-LatestSesno
      $taskId = if ($receiptA) { [string]$receiptA.task_id } else { '' }
      if ($backend -and -not $backend.HasExited -and $taskId) {
        $fallback = Invoke-MutationDuringTask $macros.Restore 'restore-driver-finally' $taskId $beforeRestore
      } else {
        $driverOut = Join-Path $out 'restore-driver-finally'
        $process = New-L3Process $macros.Restore $driverOut $true
        Complete-L3Process $process $driverOut 'restore-driver-finally'
        $report = [IO.File]::ReadAllText((Join-Path $driverOut 'check-driver-evidence.json')) | ConvertFrom-Json
        $fallback = [ordered]@{
          before_sesno = [int]$report.before_sesno
          after_sesno = [int]$report.after_sesno
          outcome = [string]$report.outcome
          evidence_file = Join-Path $driverOut 'check-driver-evidence.json'
        }
      }
      $restoreCommitted = [int]$fallback.after_sesno -gt $beforeRestore
      $evidence['restore_finally'] = $fallback
      Assert-That $restoreCommitted 'fallback restore did not advance the source session'
    } catch {
      $evidence['restore_finally_error'] = "$_"
      if ($failure) {
        $failure = [Exception]::new("$failure`nFallback restore also failed: $_")
      } else {
        $failure = $_
      }
    }
  }
  Stop-Backend
  $evidence['finished_at'] = (Get-Date).ToString('o')
  $evidence['succeeded'] = $succeeded
  $evidence['apply_committed'] = $applyCommitted
  $evidence['restore_committed'] = $restoreCommitted
  Save-Evidence
  if ($succeeded) {
    Remove-Item -LiteralPath $runtime -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    $evidence['retained_runtime'] = $runtime
    Save-Evidence
  }
}

if ($failure) { throw $failure }

Write-Host ''
Write-Host 'Frozen-source live gate PASS' -ForegroundColor Green
Write-Host "  source sessions: $baselineSesno -> $($baselineSesno + 1) -> $($baselineSesno + 2)"
Write-Host "  task A: source=$baselineSesno roots=$($rootsA0.total) state=$($taskATerminal.state)"
Write-Host "  task B: source=$($baselineSesno + 2) roots=$($rootsB.total) state=$($taskBTerminal.state)"
Write-Host "  evidence: $(Join-Path $out 'evidence.json')"
