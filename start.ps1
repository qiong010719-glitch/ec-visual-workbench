param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$workbenchRoot = $PSScriptRoot
$workbenchPort = 4173
if ($env:PORT) { $workbenchPort = [int]$env:PORT }
$workbenchUrl = "http://127.0.0.1:$workbenchPort"
$workbenchReady = $false
try {
    $workbenchStatus = Invoke-RestMethod -Uri "$workbenchUrl/api/status" -TimeoutSec 2
    $workbenchReady = $workbenchStatus.mode -eq 'local'
} catch {}
if (-not $workbenchReady) {
    if ([string]::IsNullOrWhiteSpace($env:SUANZHOU_IMAGE_API_KEY)) {
        $env:SUANZHOU_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable('SUANZHOU_IMAGE_API_KEY', 'User')
    }
    if ([string]::IsNullOrWhiteSpace($env:SUANZHOU_API_KEY)) {
        $env:SUANZHOU_API_KEY = [Environment]::GetEnvironmentVariable('SUANZHOU_API_KEY', 'User')
    }
    New-Item -ItemType Directory -Path (Join-Path $workbenchRoot 'data') -Force | Out-Null
    $workbenchNode = (Get-Command node.exe -ErrorAction Stop).Source
    Start-Process -FilePath $workbenchNode -ArgumentList @('"' + (Join-Path $workbenchRoot 'src\server.mjs') + '"') -WorkingDirectory $workbenchRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workbenchRoot 'data\server.log') -RedirectStandardError (Join-Path $workbenchRoot 'data\server-error.log')
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $workbenchStatus = Invoke-RestMethod -Uri "$workbenchUrl/api/status" -TimeoutSec 1
            if ($workbenchStatus.mode -eq 'local') { $workbenchReady = $true; break }
        } catch {}
    }
}
if (-not $workbenchReady) { throw '工作台启动失败，请检查 data/server-error.log 或端口是否被占用。' }
Write-Output "本地工作台已就绪：$workbenchUrl"
if (-not $NoBrowser) { Start-Process $workbenchUrl }
