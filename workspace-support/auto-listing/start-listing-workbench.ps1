param([switch]$NoBrowser, [ValidateSet('products','listings','generation')][string]$Page = 'listings')
$ErrorActionPreference = 'Stop'
$listingRoot = $PSScriptRoot
$listingApp = Join-Path $listingRoot 'ec-visual-workbench'
$listingPort = 4185
if ($env:LISTING_WORKBENCH_PORT) { $listingPort = [int]$env:LISTING_WORKBENCH_PORT }
$listingUrl = "http://127.0.0.1:$listingPort"
$listingReady = $false
try { $listingReady = (Invoke-RestMethod -Uri "$listingUrl/api/status" -TimeoutSec 3).workbenchVersion -eq 'merchant-1' } catch {}
if (-not $listingReady) {
    foreach ($listingKeyName in @('SUANZHOU_IMAGE_API_KEY','SUANZHOU_API_KEY','PLANNER_API_KEY','PLANNER_BASE_URL','PLANNER_MODEL','PLANNER_REASONING_EFFORT','VISION_API_KEY','VISION_BASE_URL','VISION_MODEL')) {
        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($listingKeyName, 'Process'))) {
            $listingUserValue = [Environment]::GetEnvironmentVariable($listingKeyName, 'User')
            if ($listingUserValue) { [Environment]::SetEnvironmentVariable($listingKeyName, $listingUserValue, 'Process') }
        }
    }
    $listingOccupied = $false
    try { $null = Invoke-WebRequest -UseBasicParsing -Uri "$listingUrl/api/status" -TimeoutSec 2; $listingOccupied = $true } catch {}
    if ($listingOccupied) { throw '统一端口已有旧版工作台。请关闭旧服务后重试，不要另开端口连接同一份任务数据。' }
    $listingNode = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $listingNode) { $listingNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
    if (-not (Test-Path -LiteralPath $listingNode)) { throw '请先安装 Node.js 22 以上版本。' }
    if (-not (Test-Path -LiteralPath (Join-Path $listingApp 'node_modules/sharp/package.json'))) {
        Push-Location -LiteralPath $listingApp
        try { & npm.cmd ci --omit=dev; if ($LASTEXITCODE -ne 0) { throw '工作台依赖安装失败。' } } finally { Pop-Location }
    }
    $listingOldPort = $env:PORT
    try {
        $env:PORT = [string]$listingPort
        New-Item -ItemType Directory -Path (Join-Path $listingRoot 'outputs') -Force | Out-Null
        Start-Process -FilePath $listingNode -ArgumentList @('src/server.mjs') -WorkingDirectory $listingApp -WindowStyle Hidden -RedirectStandardOutput (Join-Path $listingRoot 'outputs/erp-workbench.log') -RedirectStandardError (Join-Path $listingRoot 'outputs/erp-workbench-error.log')
    } finally { $env:PORT = $listingOldPort }
    for ($listingAttempt = 0; $listingAttempt -lt 30; $listingAttempt++) {
        Start-Sleep -Milliseconds 500
        try { if ((Invoke-RestMethod -Uri "$listingUrl/api/temu/erp/config" -TimeoutSec 2).destination -eq 'pending-draft') { $listingReady = $true; break } } catch {}
    }
}
if (-not $listingReady) { throw '工作台未就绪，请查看 outputs/erp-workbench-error.log。' }
Write-Output "上架工作台：$listingUrl/temu/listings"
Write-Output "生图与裂变：$listingUrl/temu"
if (-not $NoBrowser) {
    if ($Page -eq 'generation') { Start-Process "$listingUrl/temu" }
    elseif ($Page -eq 'listings') { Start-Process "$listingUrl/temu/listings" }
    else { Start-Process "$listingUrl/temu/listings" }
}
