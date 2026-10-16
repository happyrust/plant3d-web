param(
    [Parameter(Mandatory = $true)][string]$SourceZip,
    [Parameter(Mandatory = $true)][string]$TargetZip,
    [string]$Output
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.Xml.Linq
$sourcePath = (Resolve-Path -LiteralPath $SourceZip).Path
$targetPath = (Resolve-Path -LiteralPath $TargetZip).Path
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler is required on the build machine' }
function Get-Hash($Stream) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($Stream)).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function File-Hash([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try { return Get-Hash $stream } finally { $stream.Dispose() }
}
# 路径规则（Relative / Protected / Allowed）与补丁运行器共用同一份 C# 源码
# scripts/OfflinePatchRules.cs，避免两套清单漂移；Add-Type 用框架自带编译器现编译。
Add-Type -Path (Join-Path $PSScriptRoot 'OfflinePatchRules.cs')
function Relative-Path([string]$Path) {
    $name = $Path.Replace('\','/')
    while ($name.StartsWith('./')) { $name = $name.Substring(2) }
    return [Plant3dOfflinePatch.PatchRules]::Relative($name)
}
function Protected-Path([string]$Path) { return [Plant3dOfflinePatch.PatchRules]::Protected($Path) }
function Allowed-Path([string]$Path) { return [Plant3dOfflinePatch.PatchRules]::Allowed($Path) }
function Inventory($Archive) {
    $files = @{}
    foreach ($entry in $Archive.Entries) {
        if ($entry.FullName.EndsWith('/')) { continue }
        $name = Relative-Path $entry.FullName
        if ($files.ContainsKey($name)) { throw "Duplicate ZIP entry: $name" }
        $stream = $entry.Open()
        try { $hash = Get-Hash $stream } finally { $stream.Dispose() }
        $files[$name] = [pscustomobject]@{ Path=$name; Hash=$hash; Size=$entry.Length; Entry=$entry }
    }
    return $files
}
function Release-Info($File) {
    $reader = New-Object IO.StreamReader -ArgumentList ($File.Entry.Open())
    try { return $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
}
function Attribute($Element,[string]$Name,$Value) { $Element.SetAttributeValue([Xml.Linq.XName]::Get($Name),[string]$Value) }
function Baseline($Name,$Files) {
    $element = New-Object Xml.Linq.XElement -ArgumentList ([Xml.Linq.XName]::Get($Name))
    foreach ($file in $Files.Values | Where-Object { Allowed-Path $_.Path } | Sort-Object Path) {
        $child = New-Object Xml.Linq.XElement -ArgumentList ([Xml.Linq.XName]::Get('file'))
        Attribute $child 'path' $file.Path; Attribute $child 'sha256' $file.Hash; Attribute $child 'size' $file.Size
        $element.Add($child)
    }
    return $element
}
$old = [IO.Compression.ZipFile]::OpenRead($sourcePath)
$new = [IO.Compression.ZipFile]::OpenRead($targetPath)
try {
    $a = Inventory $old; $b = Inventory $new
    $sourceRelease = Release-Info $a['release.json']; $targetRelease = Release-Info $b['release.json']
    if (-not $sourceRelease.frontend.version -or -not $targetRelease.frontend.version) { throw 'Integrated release metadata is missing' }
    if (-not $Output) { $Output = Join-Path (Split-Path -Parent $targetPath) ("plant3d-web-patch-v{0}-to-v{1}-server2012r2.exe" -f $sourceRelease.frontend.version,$targetRelease.frontend.version) }
    $Output = [IO.Path]::GetFullPath($Output)
    if ((Test-Path -LiteralPath $Output) -or (Test-Path -LiteralPath ($Output + '.sha256'))) { throw "Output already exists; refusing overwrite: $Output" }
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $Output) -PathType Container)) { throw 'Output parent directory does not exist' }
    $sourceHash = File-Hash $sourcePath; $targetHash = File-Hash $targetPath
    $id = $sourceRelease.frontend.version + '-to-' + $targetRelease.frontend.version + '-' + $sourceHash.Substring(0,8) + '-' + $targetHash.Substring(0,8)
    $manifest = New-Object Xml.Linq.XElement -ArgumentList ([Xml.Linq.XName]::Get('patch'))
    Attribute $manifest 'format' 'plant3d-offline-patch-v1'; Attribute $manifest 'id' $id
    Attribute $manifest 'sourceVersion' $sourceRelease.frontend.version; Attribute $manifest 'targetVersion' $targetRelease.frontend.version
    Attribute $manifest 'sourceZipSha256' $sourceHash; Attribute $manifest 'targetZipSha256' $targetHash
    Attribute $manifest 'sourceReleaseHash' $a['release.json'].Hash; Attribute $manifest 'targetReleaseHash' $b['release.json'].Hash
    $manifest.Add((Baseline 'source' $a)); $manifest.Add((Baseline 'target' $b))
    $operations = New-Object Xml.Linq.XElement -ArgumentList ([Xml.Linq.XName]::Get('operations'))
    $changes = @()
    foreach ($name in @($a.Keys + $b.Keys | Sort-Object -Unique)) {
        if (Protected-Path $name) { continue }
        if ($a.ContainsKey($name) -and $b.ContainsKey($name) -and $a[$name].Hash -eq $b[$name].Hash) { continue }
        if (-not (Allowed-Path $name)) { throw "Changed path is not approved for patching: $name" }
        $kind = if (-not $a.ContainsKey($name)) { 'add' } elseif (-not $b.ContainsKey($name)) { 'delete' } else { 'replace' }
        $item = New-Object Xml.Linq.XElement -ArgumentList ([Xml.Linq.XName]::Get('file'))
        Attribute $item 'path' $name; Attribute $item 'kind' $kind
        Attribute $item 'oldHash' $(if ($a.ContainsKey($name)) { $a[$name].Hash } else { '' })
        Attribute $item 'newHash' $(if ($b.ContainsKey($name)) { $b[$name].Hash } else { '' })
        Attribute $item 'size' $(if ($b.ContainsKey($name)) { $b[$name].Size } else { 0 })
        $operations.Add($item); $changes += [pscustomobject]@{Path=$name; Kind=$kind}
    }
    if ($changes.Count -eq 0) { throw 'No patchable differences found' }
    $manifest.Add($operations)
    $build = Join-Path $env:TEMP ('plant3d-patch-build-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $build | Out-Null
    $payload = Join-Path $build 'payload.zip'
    $fileStream = [IO.File]::Open($payload,[IO.FileMode]::CreateNew)
    $zip = New-Object IO.Compression.ZipArchive -ArgumentList $fileStream,([IO.Compression.ZipArchiveMode]::Create)
    try {
        $entry = $zip.CreateEntry('patch.xml',[IO.Compression.CompressionLevel]::Optimal)
        $writer = New-Object IO.StreamWriter -ArgumentList ($entry.Open()),(New-Object Text.UTF8Encoding -ArgumentList $false)
        try { $writer.Write($manifest.ToString()) } finally { $writer.Dispose() }
        foreach ($change in $changes | Where-Object { $_.Kind -ne 'delete' }) {
            $entry = $zip.CreateEntry(('files/' + $change.Path),[IO.Compression.CompressionLevel]::Optimal)
            $inputStream = $b[$change.Path].Entry.Open(); $outputStream = $entry.Open()
            try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
        }
    } finally { $zip.Dispose(); $fileStream.Dispose() }
    $code = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'OfflinePatch.cs')).Replace('__PAYLOAD_SHA256__',(File-Hash $payload))
    $source = Join-Path $build 'OfflinePatch.cs'
    [IO.File]::WriteAllText($source,$code,(New-Object Text.UTF8Encoding -ArgumentList $true))
    $compiled = Join-Path $build 'patch.exe'
    $arguments = @('/nologo','/target:winexe','/platform:x64','/optimize+','/codepage:65001',('/out:' + $compiled),('/resource:' + $payload + ',payload.zip'))
    foreach ($assembly in @('System.dll','System.Core.dll','System.Xml.dll','System.Xml.Linq.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Management.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll')) { $arguments += '/reference:' + (Join-Path $framework $assembly) }
    $arguments += $source
    # 补丁 EXE 同时编译共享规则文件：运行器的 Files.Relative/Allowed 委托给它
    $arguments += (Join-Path $PSScriptRoot 'OfflinePatchRules.cs')
    & $compiler @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Patch compilation failed' }
    [IO.File]::Move($compiled,$Output)
    $digest = (File-Hash $Output).ToUpperInvariant()
    [IO.File]::WriteAllText(($Output + '.sha256'),($digest + '  ' + [IO.Path]::GetFileName($Output) + "`r`n"),[Text.Encoding]::ASCII)
    Write-Output "PATCH=$Output"
    Write-Output "BYTES=$((Get-Item -LiteralPath $Output).Length)"
    Write-Output "SHA256=$digest"
    Write-Output "OPERATIONS=$($changes.Count)"
    $changes | Format-Table Kind,Path -AutoSize
} finally { $old.Dispose(); $new.Dispose() }
