param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'backend\DbOption.toml'),
    [switch]$Reload,
    [switch]$ExportEnv,
    [string]$ExternalBackend,
    [int]$FrontendPort = 80,
    [int]$CompatPort = 3100
)
$ErrorActionPreference = 'Stop'
$nginxRoot = Join-Path $PSScriptRoot 'nginx'
$nginxExe = Join-Path $nginxRoot 'nginx.exe'
$configFile = Join-Path $nginxRoot 'conf\nginx.conf'
$template = Join-Path $PSScriptRoot 'nginx.conf.template'

function Read-Setting([string]$Text, [string]$Key, [string]$Default) {
    $match = [regex]::Match($Text, ('(?m)^\s*' + [regex]::Escape($Key) + '\s*=\s*(?:"([^"\r\n]*)"|''([^''\r\n]*)''|(\d+))\s*(?:#.*)?$'))
    if (-not $match.Success) { return $Default }
    foreach ($index in 1..3) {
        if ($match.Groups[$index].Success) { return $match.Groups[$index].Value }
    }
}

if ($ExternalBackend) {
    $backend = [Uri]$ExternalBackend
} else {
    $text = [System.IO.File]::ReadAllText($ConfigPath)
    $address = Read-Setting $text 'http_api_addr' ''
    if (-not $address) { $address = Read-Setting $text 'server_release_ip' '127.0.0.1:9099' }
    $backend = [Uri]('http://' + $address)
    $FrontendPort = [int](Read-Setting $text 'frontend_port' '80')
    $CompatPort = [int](Read-Setting $text 'frontend_compat_port' '3100')
}
if ($backend.Scheme -ne 'http' -or -not $backend.IsAbsoluteUri -or $backend.Port -lt 1) { throw 'Invalid backend HTTP address' }
if ($FrontendPort -lt 1 -or $FrontendPort -gt 65535 -or $CompatPort -lt 0 -or $CompatPort -gt 65535) { throw 'Invalid frontend port (1-65535) or compatibility port (0-65535)' }
if ($FrontendPort -eq $backend.Port -or ($CompatPort -ne 0 -and ($CompatPort -eq $FrontendPort -or $CompatPort -eq $backend.Port))) { throw 'Backend, frontend and compatibility ports must be different' }
$hostName = $backend.Host
if ($hostName -eq '0.0.0.0') { $hostName = '127.0.0.1' }
if ($hostName -eq '[::]' -or $hostName -eq '::') { $hostName = '[::1]' }
$upstream = $hostName + ':' + $backend.Port
$rendered = [System.IO.File]::ReadAllText($template)
$rendered = $rendered.Replace('server 127.0.0.1:8022;', ('server ' + $upstream + ';'))
$rendered = $rendered.Replace('listen       80;', ('listen       ' + $FrontendPort + ';'))
$compatListen = if ($CompatPort -eq 0) { '' } else { 'listen       ' + $CompatPort + ';' }
$rendered = $rendered.Replace('listen       3100;', $compatListen)
$pidFile = Join-Path $nginxRoot 'logs\nginx.pid'
$owned = $null
if (Test-Path -LiteralPath $pidFile) {
    $pidText = ([System.IO.File]::ReadAllText($pidFile)).Trim()
    if ($pidText) {
        $nginxPid = 0
        if (-not [int]::TryParse($pidText, [ref]$nginxPid) -or $nginxPid -le 0) { throw 'Invalid package nginx PID file' }
        $owned = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $nginxPid) -ErrorAction SilentlyContinue
        if ($owned -and $owned.ExecutablePath -ne $nginxExe) { throw 'nginx PID belongs to another executable; refusing reload' }
    }
}
$previous = if (Test-Path -LiteralPath $configFile) { [System.IO.File]::ReadAllText($configFile) } else { '' }
$oldPorts = @()
if ($owned) {
    $oldPorts = @([regex]::Matches($previous, '(?m)^\s*listen\s+(\d+)\s*;') | ForEach-Object { [int]$_.Groups[1].Value })
}
$probes = @()
try {
    foreach ($port in @($FrontendPort, $CompatPort) | Where-Object { $_ -gt 0 }) {
        if ($port -in $oldPorts) { continue }
        $probe = New-Object System.Net.Sockets.TcpListener -ArgumentList ([System.Net.IPAddress]::Any), $port
        $probe.Server.ExclusiveAddressUse = $true
        $probe.Start()
        $probes += $probe
    }
} finally {
    foreach ($probe in $probes) { $probe.Stop() }
}
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($configFile, $rendered, $utf8)
function Invoke-Nginx([string[]]$Arguments) {
    $preference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $nginxExe @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $preference
    }
    foreach ($line in $output) { [Console]::Error.WriteLine($line) }
    if ($exitCode -ne 0) { throw ('nginx command failed: ' + ($Arguments -join ' ')) }
}
Push-Location $nginxRoot
try {
    Invoke-Nginx -Arguments @('-t')
    if ($Reload -and $owned) { Invoke-Nginx -Arguments @('-s', 'reload') }
} catch {
    [System.IO.File]::WriteAllText($configFile, $previous, $utf8)
    throw
} finally {
    Pop-Location
}
if ($ExportEnv) {
    Write-Output ('BACKEND_ADDR=http://' + $upstream)
    Write-Output ('FRONTEND_PORT=' + $FrontendPort)
    Write-Output ('FRONTEND_COMPAT_PORT=' + $CompatPort)
}
