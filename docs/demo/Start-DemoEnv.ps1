<#
.SYNOPSIS
  一键准备功能录屏演示环境（服务器模式）：核对线上部署版本与健康状态、可选预热检查、Bandicam、两个 Chrome 窗口。

.DESCRIPTION
  对应 docs/demo/feature-demo-recording-plan.md §1.1 / §6「录制前」清单。
  默认**不启动任何本机服务**——演示对象是已部署到服务器的环境（默认 http://123.57.182.243/）。
  脚本只做只读检查：version.json 的 commit、/api/v1/health 的 spatial_tree / room_membership、
  各库 model/roots 的 ready_total（几何预热状态）、/api/review/health。
  已就绪的步骤自动跳过，可重复运行。不修改任何配置，不触发部署。

  只有显式加 -WithOffline 时才会拉起 deploy\offline\start.bat（S16 离线包演示）。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File docs/demo/Start-DemoEnv.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File docs/demo/Start-DemoEnv.ps1 -SkipChrome -SkipBandicam
  powershell -NoProfile -ExecutionPolicy Bypass -File docs/demo/Start-DemoEnv.ps1 -WithOffline
  powershell -NoProfile -ExecutionPolicy Bypass -File docs/demo/Start-DemoEnv.ps1 -ServerBase http://10.0.0.5
#>
[CmdletBinding()]
param(
    [string]$ServerBase = 'http://123.57.182.243',
    [string]$PmsUrl = 'http://pms.powerpms.net:1801/sysin.html',
    [string]$BandicamExe = 'D:\Download\Bandicam_8.3.0.2533_Portable_64Bit\Bandicam-8.3.0.2533-x64-Portable\Bandicam\BandicamPortable.exe',
    [string]$OfflineDir,
    [int]$ProbeDbnum = 8000,
    [switch]$WithOffline,
    [switch]$SkipServerCheck,
    [switch]$SkipBandicam,
    [switch]$SkipChrome
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $OfflineDir) { $OfflineDir = Join-Path $repoRoot 'deploy\offline' }
$ServerBase = $ServerBase.TrimEnd('/')
$DemoUrl = "$ServerBase/?output_project=AvevaMarineSample&show_dbnum=$ProbeDbnum"

function Write-Step([string]$Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "   [OK] $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "   [WARN] $Text" -ForegroundColor Yellow }
function Write-Info([string]$Text) { Write-Host "   $Text" -ForegroundColor Gray }

function Get-Json([string]$Url, [int]$TimeoutSec = 20) {
    try {
        return Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing
    } catch {
        throw "请求失败 $Url : $($_.Exception.Message)"
    }
}

Write-Host 'Plant3D-Web 演示环境准备（服务器模式）' -ForegroundColor Cyan
Write-Host "   仓库：$repoRoot"
Write-Host "   演示站：$ServerBase"
Write-Host '   本机不起后端 / 前端；只做只读核对'

# ---------- 1. 线上版本与健康 ----------
if (-not $SkipServerCheck) {
    Write-Step "线上部署核对（$ServerBase）"

    # 1.1 version.json：录制期间必须与 recordings/README.md 记录的 commit 一致
    try {
        $v = Get-Json "$ServerBase/version.json"
        Write-Ok "version.json → version=$($v.version) commit=$($v.commit.Substring(0,[Math]::Min(10,$v.commit.Length))) buildDate=$($v.buildDate)"
        Write-Info "把上面这个 commit 记进 recordings/README.md 的「前端 commit」；16 段必须来自同一 commit"
    } catch {
        Write-Warn2 "读不到 version.json，可能部署未完成或被拦截：$($_.Exception.Message)"
    }

    # 1.2 /api/v1/health：空间树、房间归属、历史能力
    try {
        $h = Get-Json "$ServerBase/api/v1/health" 30
        $spatial = if ($h.spatial_tree) { $h.spatial_tree.state } else { '(未报告)' }
        $entries = if ($h.spatial_tree) { $h.spatial_tree.entries } else { 0 }
        $room = if ($null -ne $h.room_membership) { $h.room_membership } else { '(未报告)' }
        $hist = if ($h.features -and $h.features.history) { $h.features.history.status } else { '(未报告)' }
        $units = if ($h.delivery_unit_types) { ($h.delivery_unit_types -join '/') } else { '(未报告)' }
        Write-Ok "health=$($h.status) · backend=$($h.version) · build=$($h.build_id)"
        Write-Ok "spatial_tree.state=$spatial ($entries 条) · room_membership=$room · history=$hist · 交付单元=$units"

        if ("$spatial" -notmatch '^ready') { Write-Warn2 '空间树未就绪：S08 / S09 要等它变成 ready 再录' }
        if ("$room" -ne 'True') { Write-Warn2 '房间归属未开启：S04 房间页签与 S08 房间过滤会只剩一句原因' }
        if ("$hist" -notmatch 'available') { Write-Warn2 '版本历史不可用：S11 的版本时间线与属性对比会落空' }
        if ("$units" -notmatch 'BRAN') { Write-Warn2 '交付单元类型里没有 BRAN：中心线净距与版本对比的样例都要重新挑' }
    } catch {
        Write-Warn2 "health 接口不通：$($_.Exception.Message)"
    }

    # 1.3 校审后端（S13 / S14 需要）
    try {
        $rv = Get-Json "$ServerBase/api/review/health" 20
        Write-Ok "review/health=$($rv.status) database=$($rv.database)"
    } catch {
        Write-Warn2 "校审后端不通，S13 / S14 会受影响：$($_.Exception.Message)"
    }

    # 1.4 几何预热：ready_total 为 0 说明还没生成过模型
    try {
        $roots = Get-Json "$ServerBase/api/v1/dbnums/$ProbeDbnum/model/roots" 30
        $ready = $roots.ready_total
        $total = $roots.total
        if ($ready -gt 0) {
            Write-Ok "库 $ProbeDbnum 几何已预热：ready $ready / total $total"
        } else {
            Write-Warn2 "库 $ProbeDbnum 还没有生成过几何（ready 0 / total $total）"
            Write-Info 'S08 空间查询会 404「…都没有包围盒（还没生成过模型）」、S09 选不到可算的 BRAN、S11 三维对比没有几何'
            Write-Info '先按 feature-demo-recording-plan.md §1.1.3 跑一次模型生成；注意与 S10 的演示目标错开'
        }
    } catch {
        Write-Warn2 "读不到 model/roots：$($_.Exception.Message)"
    }

    # 1.5 版本对比样例是否在链上（只查 node/versions 的版本数，不产生副作用）
    foreach ($pair in @(@('24384_23262','FTUB'), @('24384_23225','PIPE'))) {
        $rn = $pair[0]; $noun = $pair[1]
        try {
            $nv = Get-Json "$ServerBase/api/v1/node/versions?dbnum=$ProbeDbnum&refno=$rn&scope=subtree" 60
            $sesno = @($nv.versions.sesno)
            $hasA = if ($noun -eq 'FTUB') { $sesno -contains 626 } else { $sesno -contains 300 }
            $hasB = if ($noun -eq 'FTUB') { $sesno -contains 630 } else { $sesno -contains 380 }
            $flag = if ($hasA -and $hasB) { 'A/B 都在链上' } else { 'A/B 缺失，需换样例' }
            Write-Ok "S11 样例 $noun $rn：$($sesno.Count) 版 · $flag"
        } catch {
            Write-Warn2 "S11 样例 $rn 查询失败：$($_.Exception.Message)"
        }
    }

    # 1.6 提醒：remote token 风险
    Write-Info 'S13 / S14 用独立 Chrome 配置，并把地址栏里的 user_token 在剪辑时打码（§1.4）'
}

# ---------- 2. 离线包（仅 S16 演示需要） ----------
if ($WithOffline) {
    Write-Step "离线部署包（$OfflineDir）"
    $startBat = Join-Path $OfflineDir 'start.bat'
    if (Test-Path -LiteralPath $startBat) {
        Write-Ok "找到 $startBat —— S16 录制时双击即可，或现在先试着起一次"
        Write-Info '起完记得 stop.bat；离线包与本机演示站无关，不要在同一段里混用'
    } else {
        Write-Warn2 "找不到 $startBat；S16 只能用录屏素材或改用外部演示"
    }
} else {
    Write-Info '未加 -WithOffline：跳过离线部署包（S16 才需要）'
}

# ---------- 3. Bandicam ----------
if (-not $SkipBandicam) {
    Write-Step 'Bandicam'
    $running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(bdcam|BandicamPortable)' }
    if ($running) {
        Write-Ok 'Bandicam 已在运行'
    } elseif (Test-Path -LiteralPath $BandicamExe) {
        Start-Process -FilePath $BandicamExe | Out-Null
        Write-Ok "已启动（模式「屏幕录制 → 全屏」，2560×1440 原生不缩放，F12 起停，Shift+F12 暂停）"
    } else {
        Write-Warn2 "找不到 $BandicamExe，请用 -BandicamExe 指定"
    }
}

# ---------- 4. Chrome：演示窗口 + PMS（SJ）独立配置窗口 ----------
if (-not $SkipChrome) {
    Write-Step 'Chrome'
    $chrome = $null
    foreach ($candidate in @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )) { if ($candidate -and (Test-Path -LiteralPath $candidate)) { $chrome = $candidate; break } }

    if (-not $chrome) {
        Write-Warn2 '没找到 chrome.exe，请手动打开下面两个地址'
        Write-Host "   演示：$DemoUrl"
        Write-Host "   PMS ：$PmsUrl"
    } else {
        $profileRoot = Join-Path $env:LOCALAPPDATA 'plant3d-demo-profiles'
        foreach ($p in 'demo', 'pms-sj') { New-Item -ItemType Directory -Force (Join-Path $profileRoot $p) | Out-Null }

        # 演示窗口：独立配置，不带书签栏 / 扩展，画面干净
        Start-Process -FilePath $chrome -ArgumentList @(
            "--user-data-dir=`"$(Join-Path $profileRoot 'demo')`"",
            '--new-window', '--start-maximized', '--no-first-run', '--no-default-browser-check',
            "`"$DemoUrl`""
        ) | Out-Null
        Write-Ok "已打开演示窗口：$DemoUrl"

        # PMS 窗口：另一个配置，登录态与演示窗口隔离
        # JH / SH / PZ 各自再开一个目录；S13 录制前清空对应配置的浏览历史（防 user_token 泄露）
        Start-Process -FilePath $chrome -ArgumentList @(
            "--user-data-dir=`"$(Join-Path $profileRoot 'pms-sj')`"",
            '--new-window', '--start-maximized', '--no-first-run', '--no-default-browser-check',
            "`"$PmsUrl`""
        ) | Out-Null
        Write-Ok "已打开 PMS 窗口（配置 pms-sj）：$PmsUrl"
        Write-Info 'JH / SH / PZ 用 pms-jh / pms-sh / pms-pz 各开一个，别共用一个会话'
    }
}

Write-Step '下一步（人工）'
Write-Host '   1. 演示窗口：确认页面加载的是线上包（地址栏是服务器地址），F11 全屏'
Write-Host '   2. 若上面报「几何未预热」：先按 §1.1.3 跑一次模型生成，再回头录 S08 / S09 / S11'
Write-Host '   3. PMS 窗口：SJ 登录（密码从密码管理器粘贴），按 §8.1 预走一遍发起 → 送审'
Write-Host '   4. Bandicam：试录 10 秒确认无水印、有声音、2560×1440'
Write-Host '   5. 对照 docs/demo/recording-cue-card.md，按「录制顺序」而不是编号开录'
