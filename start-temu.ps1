param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$temuRoot = $PSScriptRoot
$temuPort = 4183
if ($env:TEMU_WORKBENCH_PORT) { $temuPort = [int]$env:TEMU_WORKBENCH_PORT }
$temuBaseUrl = "http://127.0.0.1:$temuPort"
$temuReady = $false
try { $temuReady = (Invoke-RestMethod -Uri "$temuBaseUrl/api/temu/config" -TimeoutSec 2).platform -eq 'temu' } catch {}
if (-not $temuReady) {
    if (-not (Test-Path -LiteralPath (Join-Path $temuRoot 'node_modules/sharp/package.json'))) {
        Push-Location -LiteralPath $temuRoot
        try { & npm.cmd ci --omit=dev; if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查网络后重试。' } } finally { Pop-Location }
    }
    foreach ($temuKeyName in @('SUANZHOU_IMAGE_API_KEY','SUANZHOU_API_KEY','PLANNER_API_KEY','PLANNER_BASE_URL','PLANNER_MODEL','VISION_API_KEY','VISION_BASE_URL','VISION_MODEL')) {
        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($temuKeyName, 'Process'))) {
            $temuUserValue = [Environment]::GetEnvironmentVariable($temuKeyName, 'User')
            if ($temuUserValue) { [Environment]::SetEnvironmentVariable($temuKeyName, $temuUserValue, 'Process') }
        }
    }
    $temuOldPort = $env:PORT
    try {
        $env:PORT = [string]$temuPort
        New-Item -ItemType Directory -Path (Join-Path $temuRoot 'data') -Force | Out-Null
        $temuNode = (Get-Command node.exe -ErrorAction Stop).Source
        Start-Process -FilePath $temuNode -ArgumentList @('"' + (Join-Path $temuRoot 'src/server.mjs') + '"') -WorkingDirectory $temuRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $temuRoot 'data/temu-server.log') -RedirectStandardError (Join-Path $temuRoot 'data/temu-server-error.log')
    } finally { $env:PORT = $temuOldPort }
    for ($temuAttempt = 0; $temuAttempt -lt 30; $temuAttempt++) {
        Start-Sleep -Milliseconds 500
        try { if ((Invoke-RestMethod -Uri "$temuBaseUrl/api/temu/config" -TimeoutSec 1).platform -eq 'temu') { $temuReady = $true; break } } catch {}
    }
}
if (-not $temuReady) { throw '启动失败，请查看 data/temu-server-error.log，确认端口是否被占用。' }
Write-Output "Temu 工作台已就绪：$temuBaseUrl/temu"
Write-Output "亚马逊入口：$temuBaseUrl/"
if (-not $NoBrowser) { Start-Process "$temuBaseUrl/temu" }
