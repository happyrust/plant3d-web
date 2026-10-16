param(
    [string]$Output = 'D:\work\plant-code\old\gen-model\releases\plant3d-web-patch-maker.exe',
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler is required on the build machine' }
$Output = [IO.Path]::GetFullPath($Output)
if ((Test-Path -LiteralPath $Output) -or (Test-Path -LiteralPath ($Output + '.sha256'))) {
    if (-not $Force) { throw "Output already exists; pass -Force to overwrite: $Output" }
    Remove-Item -LiteralPath $Output -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath ($Output + '.sha256') -Force -ErrorAction SilentlyContinue
}
if (-not (Test-Path -LiteralPath (Split-Path -Parent $Output) -PathType Container)) { throw 'Output parent directory does not exist' }
$maker = Join-Path $PSScriptRoot 'OfflinePatchMaker.cs'
$rules = Join-Path $PSScriptRoot 'OfflinePatchRules.cs'
$patch = Join-Path $PSScriptRoot 'OfflinePatch.cs'
$work = Join-Path $env:TEMP ('plant3d-patch-maker-build-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $compiled = Join-Path $work 'maker.exe'
    $arguments = @('/nologo','/target:winexe','/platform:x64','/optimize+','/codepage:65001',('/out:' + $compiled),
        ('/resource:' + $patch + ',OfflinePatch.cs'), ('/resource:' + $rules + ',OfflinePatchRules.cs'))
    foreach ($assembly in @('System.dll','System.Core.dll','System.Xml.dll','System.Xml.Linq.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Management.dll','System.Web.Extensions.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll')) {
        $arguments += '/reference:' + (Join-Path $framework $assembly)
    }
    $arguments += $maker
    $arguments += $rules
    & $compiler @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Patch maker compilation failed' }
    [IO.File]::Move($compiled, $Output)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $stream = [IO.File]::OpenRead($Output)
        try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToUpperInvariant() }
        finally { $stream.Dispose() }
    } finally { $sha.Dispose() }
    [IO.File]::WriteAllText(($Output + '.sha256'), ($digest + '  ' + [IO.Path]::GetFileName($Output) + "`r`n"), [Text.Encoding]::ASCII)
    Write-Output "MAKER=$Output"
    Write-Output "BYTES=$((Get-Item -LiteralPath $Output).Length)"
    Write-Output "SHA256=$digest"
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
