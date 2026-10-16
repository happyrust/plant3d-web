param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [int]$TimeoutSeconds = 5,
    [switch]$BackendHealth
)
$ErrorActionPreference = 'Stop'
$response = $null
try {
    $request = [System.Net.WebRequest]::Create($Uri)
    $request.Timeout = $TimeoutSeconds * 1000
    $request.ReadWriteTimeout = $TimeoutSeconds * 1000
    $response = $request.GetResponse()
    if ([int]$response.StatusCode -ne 200) { throw 'Expected HTTP 200' }
    if ($BackendHealth) {
        $reader = New-Object System.IO.StreamReader -ArgumentList ($response.GetResponseStream())
        try { $health = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if (-not $health.status) { throw 'Response is not a backend health document' }
    }
} catch {
    [Console]::Error.WriteLine('HTTP check failed: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($response) { $response.Close() }
}
exit 0
