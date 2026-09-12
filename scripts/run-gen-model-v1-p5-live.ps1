<#
.SYNOPSIS
  Bounded P5 live gate for current gen-model-refactor + plant3d-web.

.DESCRIPTION
  Creates throwaway configs/runtimes, starts each backend only for the duration of its checks,
  and always stops the copied backend plus any owned Surreal child in finally.

  Sequence:
    1. spawned-mem: health, single-root CLI, BRAN/EQUI/ZONE browser, show_dbnum streaming,
       whole-dbnum CLI, browser-held restart/cache invalidation.
    2. embedded-mem: health, single-root CLI, concurrent whole-dbnum POST single-flight.
    3. external: route census and Database=409 / Memory=202 checks against an existing test store.

  It does not edit E3D source files; the frozen-source/session-advance case remains a separate
  operator-assisted gate.
#>
[CmdletBinding()]
param(
  [string]$BackendRepo = 'D:\work\plant-code\old\gen-model-refactor',
  [string]$BackendExe = 'D:\Rust\target\debug\aios-database.exe',
  [string]$SourceConfig = 'D:\work\plant-code\old\gen-model-refactor\db_options\DbOption-room-live-8029.toml',
  [string]$SurrealExe = 'D:\work\plant-code\old\gen-model\bin\surreal.exe',
  [int]$HttpPort = 8022,
  [int]$SpawnedStorePort = 18809,
  [int]$SpawnedRocksStorePort = 18811,
  [int]$ExternalStorePort = 8010,
  [int]$Dbnum = 7997,
  [int]$RocksInitializeDbnum = 7998,
  [int]$DbnumWaitSec = 1800,
  [switch]$SkipBrowser,
  [switch]$SkipExternal,
  [switch]$OnlyExternal,
  [switch]$OnlySpawnedRocks,
  [switch]$InitializeSpawnedRocks
)

$ErrorActionPreference = 'Stop'
$plantRoot = Split-Path -Parent $PSScriptRoot
$verify = Join-Path $PSScriptRoot 'verify-gen-model-v1.ps1'
$baseUrl = "http://127.0.0.1:$HttpPort"

foreach ($required in @($BackendExe, $SourceConfig, $verify)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "P5 prerequisite missing: $required"
  }
}
if (-not $SkipExternal -and -not (Test-Path -LiteralPath $SurrealExe -PathType Leaf)) {
  throw "P5 Surreal executable missing: $SurrealExe"
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

function New-P5Run([string]$mode, [int]$storePort) {
  $runDir = Join-Path $env:TEMP ("gen-model-p5-{0}-{1}" -f $mode, [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force $runDir | Out-Null
  $exe = Join-Path $runDir 'aios-database.exe'
  $config = Join-Path $runDir 'DbOption.toml'
  Copy-Item -LiteralPath $BackendExe -Destination $exe
  if (Test-Path -LiteralPath (Join-Path $BackendRepo 'resource')) {
    Copy-Item -LiteralPath (Join-Path $BackendRepo 'resource') -Destination (Join-Path $runDir 'resource') -Recurse
  }
  $text = Get-Content -LiteralPath $SourceConfig -Raw
  $text = Set-TomlScalar $text 'v_ip' 'v_ip = "127.0.0.1"'
  $text = Set-TomlScalar $text 'v_port' "v_port = $storePort"
  $text = Set-TomlScalar $text 'store_mode' "store_mode = `"$mode`""
  $face = if ($mode -in @('spawned-mem', 'embedded-mem')) { 'read-through' } else { 'ingest' }
  $text = Set-TomlScalar $text 'data_face' "data_face = `"$face`""
  $text = Set-TomlScalar $text 'http_api_addr' "http_api_addr = `"127.0.0.1:$HttpPort`""
  $text = Set-TomlScalar $text 'http_api_cors' 'http_api_cors = ["*"]'
  $text = Set-TomlScalar $text 'startup_autorun' 'startup_autorun = false'
  $text = Set-TomlScalar $text 'room_membership' 'room_membership = false'
  [IO.File]::WriteAllText($config, $text, [Text.UTF8Encoding]::new($false))
  return [pscustomobject]@{
    Mode = $mode
    StorePort = $storePort
    OwnsStore = $mode -in @('spawned-mem', 'spawned-rocksdb')
    Dir = $runDir
    Exe = $exe
    Config = $config
    Stdout = Join-Path $runDir 'stdout.log'
    Stderr = Join-Path $runDir 'stderr.log'
  }
}

function Get-RunProcesses($run) {
  return @(Get-CimInstance Win32_Process -Filter "Name='aios-database.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $run.Exe })
}

function Stop-P5Run($run) {
  foreach ($item in @(Get-RunProcesses $run)) {
    Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($run.OwnsStore) {
    foreach ($item in @(Get-CimInstance Win32_Process -Filter "Name='surreal.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -match ":$($run.StorePort)(?:\s|$)" })) {
      Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 500
}

function Start-P5Run($run) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $HttpPort -ErrorAction SilentlyContinue
  if ($listener) { throw "P5 HTTP port $HttpPort is already in use by PID $($listener.OwningProcess)" }
  if ($run.OwnsStore) {
    $storeListener = Get-NetTCPConnection -State Listen -LocalPort $run.StorePort -ErrorAction SilentlyContinue
    if ($storeListener) { throw "P5 store port $($run.StorePort) is already in use by PID $($storeListener.OwningProcess)" }
  }

  $old = @{
    DB_OPTION_FILE = $env:DB_OPTION_FILE
    AIOS_STORE_MODE = $env:AIOS_STORE_MODE
    AIOS_SURREAL_EXE = $env:AIOS_SURREAL_EXE
    AIOS_STARTUP_AUTORUN = $env:AIOS_STARTUP_AUTORUN
    AIOS_ROOM_MEMBERSHIP = $env:AIOS_ROOM_MEMBERSHIP
    AIOS_OPEN_BROWSER = $env:AIOS_OPEN_BROWSER
    RUST_MIN_STACK = $env:RUST_MIN_STACK
  }
  try {
    $env:DB_OPTION_FILE = $run.Config
    $env:AIOS_STORE_MODE = $run.Mode
    $env:AIOS_STARTUP_AUTORUN = '0'
    $env:AIOS_ROOM_MEMBERSHIP = '0'
    $env:AIOS_OPEN_BROWSER = '0'
    $env:RUST_MIN_STACK = '134217728'
    if ($run.OwnsStore) { $env:AIOS_SURREAL_EXE = $SurrealExe }
    else { Remove-Item Env:AIOS_SURREAL_EXE -ErrorAction SilentlyContinue }
    Start-Process -FilePath $run.Exe -ArgumentList 'serve' -WorkingDirectory $run.Dir -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $run.Stdout -RedirectStandardError $run.Stderr | Out-Null
  } finally {
    foreach ($name in $old.Keys) {
      if ($null -eq $old[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$name" $old[$name] }
    }
  }

  $deadline = (Get-Date).AddMinutes(6)
  do {
    if ((Get-RunProcesses $run).Count -eq 0) {
      $stderr = if (Test-Path $run.Stderr) { Get-Content $run.Stderr -Raw } else { '' }
      throw "P5 $($run.Mode) backend exited before health: $stderr"
    }
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/v1/health" -TimeoutSec 5
      if ($health) {
        Write-Host "[p5] $($run.Mode) ready: started_at=$($health.started_at) data_face=$($health.data_face) medium=$($health.sul_db.medium) durable=$($health.sul_db.durable)"
        return $health
      }
    } catch {}
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "P5 $($run.Mode) health timeout; logs: $($run.Dir)"
}

function Invoke-Checked([string]$label, [scriptblock]$command) {
  Write-Host "`n[p5] === $label ===" -ForegroundColor Cyan
  & $command
  if ($LASTEXITCODE) { throw "$label failed with exit $LASTEXITCODE" }
}

function Invoke-ConcurrentEnsure([int]$dbnum) {
  $uri = "$baseUrl/api/v1/dbnums/$dbnum/model/ensure"
  $client = [Net.Http.HttpClient]::new()
  try {
    $contentA = [Net.Http.StringContent]::new('{}', [Text.Encoding]::UTF8, 'application/json')
    $contentB = [Net.Http.StringContent]::new('{}', [Text.Encoding]::UTF8, 'application/json')
    $a = $client.PostAsync($uri, $contentA)
    $b = $client.PostAsync($uri, $contentB)
    [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($a, $b))
    $bodyA = $a.Result.Content.ReadAsStringAsync().Result | ConvertFrom-Json
    $bodyB = $b.Result.Content.ReadAsStringAsync().Result | ConvertFrom-Json
    if (-not $a.Result.IsSuccessStatusCode -or -not $b.Result.IsSuccessStatusCode) {
      throw "concurrent ensure HTTP $([int]$a.Result.StatusCode)/$([int]$b.Result.StatusCode)"
    }
    if ($bodyA.task_id -ne $bodyB.task_id) {
      throw "single-flight violated: $($bodyA.task_id) != $($bodyB.task_id)"
    }
    $roots = Invoke-RestMethod -Uri "$baseUrl/api/v1/dbnums/$dbnum/model/roots?task_id=$([uri]::EscapeDataString($bodyA.task_id))&ready=1" -TimeoutSec 130
    Write-Host "[p5] concurrent ensure single-flight task=$($bodyA.task_id) expected=$($bodyA.expected_roots) ready=$($roots.ready_total)"
    return $bodyA.task_id
  } finally {
    $client.Dispose()
  }
}

function Invoke-Playwright([string]$grep) {
  $oldLive = $env:GEN_MODEL_P5_LIVE
  $oldBase = $env:GEN_MODEL_V1_BASE_URL
  $oldDbnum = $env:GEN_MODEL_P5_DBNUM
  try {
    $env:GEN_MODEL_P5_LIVE = '1'
    $env:GEN_MODEL_V1_BASE_URL = $baseUrl
    $env:GEN_MODEL_P5_DBNUM = [string]$Dbnum
    Push-Location $plantRoot
    try {
      & npx.cmd playwright test e2e/gen-model-v1-p5-live.spec.ts --grep $grep --workers 1
    } finally {
      Pop-Location
    }
  } finally {
    if ($null -eq $oldLive) { Remove-Item Env:GEN_MODEL_P5_LIVE -ErrorAction SilentlyContinue } else { $env:GEN_MODEL_P5_LIVE = $oldLive }
    if ($null -eq $oldBase) { Remove-Item Env:GEN_MODEL_V1_BASE_URL -ErrorAction SilentlyContinue } else { $env:GEN_MODEL_V1_BASE_URL = $oldBase }
    if ($null -eq $oldDbnum) { Remove-Item Env:GEN_MODEL_P5_DBNUM -ErrorAction SilentlyContinue } else { $env:GEN_MODEL_P5_DBNUM = $oldDbnum }
  }
}

$runs = [Collections.Generic.List[object]]::new()
$succeeded = $false
try {
  if (-not $OnlyExternal -and -not $OnlySpawnedRocks) {
    $spawned = New-P5Run 'spawned-mem' $SpawnedStorePort
    $runs.Add($spawned)
    $health = Start-P5Run $spawned
    if ($health.data_face -ne 'read-through' -or $health.sul_db.medium -ne 'spawned-mem' -or $health.sul_db.durable -ne $false) {
      throw "spawned-mem health contract mismatch"
    }
    Invoke-Checked 'spawned-mem single-root CLI' {
      & pwsh -NoProfile -File $verify -BaseUrl $baseUrl -Refno '24381/145018' -Ensure -TimeoutSec 180
    }
    if (-not $SkipBrowser) {
      Invoke-Checked 'browser BRAN/EQUI/ZONE' { Invoke-Playwright 'P5 show_refno' }
      Invoke-Checked 'browser show_dbnum streaming' { Invoke-Playwright 'P5 show_dbnum' }
    }
    Invoke-Checked 'spawned-mem whole-dbnum CLI' {
      & pwsh -NoProfile -File $verify -BaseUrl $baseUrl -Dbnum $Dbnum -DbnumWaitSec $DbnumWaitSec -TimeoutSec 180
    }
    if (-not $SkipBrowser) {
      Invoke-Checked 'browser-held backend restart' { Invoke-Playwright 'P5 重启' }
    }
    Stop-P5Run $spawned

    $embedded = New-P5Run 'embedded-mem' ($SpawnedStorePort + 1)
    $runs.Add($embedded)
    $health = Start-P5Run $embedded
    if ($health.data_face -ne 'read-through' -or $health.sul_db.medium -ne 'embedded-mem' -or $health.sul_db.endpoint -ne 'embedded:mem') {
      throw "embedded-mem health contract mismatch"
    }
    Invoke-Checked 'embedded-mem single-root CLI' {
      & pwsh -NoProfile -File $verify -BaseUrl $baseUrl -Refno '24381/145018' -Ensure -TimeoutSec 180
    }
    Invoke-ConcurrentEnsure $Dbnum | Out-Null
    Stop-P5Run $embedded
  }

  if (-not $OnlyExternal) {
    $spawnedRocks = New-P5Run 'spawned-rocksdb' $SpawnedRocksStorePort
    $runs.Add($spawnedRocks)
    $health = Start-P5Run $spawnedRocks
    if ($health.data_face -ne 'ingest' -or $health.sul_db.medium -ne 'spawned-rocksdb' -or $health.sul_db.durable -ne $true) {
      throw "spawned-rocksdb health contract mismatch"
    }
    $rocksResponse = Invoke-WebRequest -Uri "$baseUrl/api/v1/dbnums/$Dbnum/model/ensure" -Method Post `
      -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck -TimeoutSec 130
    if ($rocksResponse.StatusCode -ne 202) {
      throw "fresh spawned-rocksdb Memory-routed dbnum $Dbnum returned HTTP $($rocksResponse.StatusCode), expected 202"
    }
    Write-Host "[p5] fresh spawned-rocksdb: data_face=ingest durable=true; uninitialized dbnum=$Dbnum -> Memory/202"
    Stop-P5Run $spawnedRocks

    if ($InitializeSpawnedRocks) {
      $initializedRocks = New-P5Run 'spawned-rocksdb' ($SpawnedRocksStorePort + 1)
      $runs.Add($initializedRocks)
      Start-P5Run $initializedRocks | Out-Null
      $executeBody = @{
        project = 'AvevaMarineSample'
        mdb = 'ALL'
        namespace = '1516'
        dbnums = @($RocksInitializeDbnum)
      } | ConvertTo-Json -Compress
      $receipt = Invoke-RestMethod -Uri "$baseUrl/api/v1/update/execute" -Method Post `
        -ContentType 'application/json' -Body $executeBody -TimeoutSec 180
      Write-Host "[p5] spawned-rocksdb initialize receipt: $($receipt | ConvertTo-Json -Depth 6 -Compress)"
      $deadline = (Get-Date).AddSeconds($DbnumWaitSec)
      $last = ''
      do {
        $rows = @((Invoke-RestMethod -Uri "$baseUrl/api/v1/dbnums?project=AvevaMarineSample&mdb=ALL&namespace=1516" -TimeoutSec 120).dbnums)
        $row = $rows | Where-Object { $_.dbnum -eq $RocksInitializeDbnum } | Select-Object -First 1
        $summary = "source=$($row.model_source) reason=$($row.model_source_reason) applied=$($row.applied_sesno) model=$($row.model_sesno)"
        if ($summary -ne $last) {
          Write-Host "[p5] spawned-rocksdb dbnum=$RocksInitializeDbnum $summary"
          $last = $summary
        }
        if ($row.model_source -eq 'database') { break }
        $failed = @((Invoke-RestMethod -Uri "$baseUrl/api/v1/tasks?state=failed&limit=20" -TimeoutSec 30).tasks |
          Where-Object { $_.dbnum -eq $RocksInitializeDbnum })
        if ($failed.Count -gt 0) {
          throw "spawned-rocksdb initialization failed: $($failed[0].result | ConvertTo-Json -Depth 6 -Compress)"
        }
        Start-Sleep -Seconds 5
      } while ((Get-Date) -lt $deadline)
      if ($row.model_source -ne 'database') {
        throw "spawned-rocksdb dbnum=$RocksInitializeDbnum did not become Database-routed within $DbnumWaitSec s"
      }
      $databaseResponse = Invoke-WebRequest -Uri "$baseUrl/api/v1/dbnums/$RocksInitializeDbnum/model/ensure" -Method Post `
        -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck -TimeoutSec 130
      if ($databaseResponse.StatusCode -ne 409) {
        throw "initialized spawned-rocksdb dbnum=$RocksInitializeDbnum returned HTTP $($databaseResponse.StatusCode), expected 409"
      }
      Write-Host "[p5] initialized spawned-rocksdb dbnum=$RocksInitializeDbnum -> Database/409"
      Stop-P5Run $initializedRocks
    }
  }

  if (-not $SkipExternal -and -not $OnlySpawnedRocks) {
    $externalListener = Get-NetTCPConnection -State Listen -LocalPort $ExternalStorePort -ErrorAction SilentlyContinue
    if (-not $externalListener) { throw "external test store is not listening on $ExternalStorePort" }
    $external = New-P5Run 'external' $ExternalStorePort
    $runs.Add($external)
    $health = Start-P5Run $external
    if ($health.data_face -ne 'ingest' -or $health.sul_db.medium -ne 'external' -or $health.sul_db.durable -ne $true) {
      throw "external health contract mismatch"
    }
    $rows = @((Invoke-RestMethod -Uri "$baseUrl/api/v1/dbnums?project=AvevaMarineSample&mdb=ALL&namespace=1516" -TimeoutSec 120).dbnums |
      Where-Object { $_.db_type -eq 'DESI' })
    $routeSummary = $rows | Group-Object model_source, model_source_reason | ForEach-Object {
      "$($_.Name)=$($_.Count)"
    }
    Write-Host "[p5] external route census: $($routeSummary -join '; ')"
    Write-Host (($rows | Select-Object -First 5 dbnum, applied_sesno, model_sesno, model_source, model_source_reason | ConvertTo-Json -Compress))
    $database = $rows | Where-Object { $_.model_source -eq 'database' } | Select-Object -First 1
    $memory = $rows |
      Where-Object { $_.model_source -eq 'memory' -and $_.model_source_reason -eq 'model_lagging' } |
      Select-Object -First 1
    if (-not $memory) {
      $memory = $rows |
        Where-Object { $_.model_source -eq 'memory' -and $_.not_in_project -ne $true -and $_.file_name } |
        Select-Object -First 1
    }
    if (-not $database) { throw 'external route census found no Database-routed DESI dbnum' }
    if (-not $memory) { throw 'external route census found no Memory-routed DESI dbnum' }
    $dbResponse = Invoke-WebRequest -Uri "$baseUrl/api/v1/dbnums/$($database.dbnum)/model/ensure" -Method Post `
      -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck -TimeoutSec 130
    if ($dbResponse.StatusCode -ne 409) { throw "Database-routed dbnum $($database.dbnum) returned HTTP $($dbResponse.StatusCode), expected 409" }
    $memoryResponse = Invoke-WebRequest -Uri "$baseUrl/api/v1/dbnums/$($memory.dbnum)/model/ensure" -Method Post `
      -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck -TimeoutSec 130
    if ($memoryResponse.StatusCode -ne 202) { throw "Memory-routed dbnum $($memory.dbnum) returned HTTP $($memoryResponse.StatusCode), expected 202" }
    Write-Host "[p5] external route matrix: database dbnum=$($database.dbnum) -> 409; memory dbnum=$($memory.dbnum) -> 202"
    Stop-P5Run $external
  }

  Write-Warning 'P5 frozen-source advance gate not run: it requires an operator SAVEWORK/source-session mutation.'
  $succeeded = $true
} finally {
  foreach ($run in $runs) { Stop-P5Run $run }
  if ($succeeded) {
    foreach ($run in $runs) { Remove-Item -LiteralPath $run.Dir -Recurse -Force -ErrorAction SilentlyContinue }
  } else {
    foreach ($run in $runs) { Write-Warning "P5 failed; retained logs/config at $($run.Dir)" }
  }
}

Write-Host "`nP5 automated live gates completed." -ForegroundColor Green
