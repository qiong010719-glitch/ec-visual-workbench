param([switch]$NoBrowser, [ValidateSet('overview','products','listings','generation')][string]$Page = 'overview')
$ErrorActionPreference = 'Stop'
${workspaceApp} = $PSScriptRoot
$workspaceUrl = 'http://127.0.0.1:4196'
$expectedRevision = 'crossborder-category-search-20261127-1'
if (-not (Test-Path -LiteralPath (Join-Path $workspaceApp 'src/server.mjs'))) { throw 'Latest crossborder workspace source is missing. Do not fall back to the old Temu workspace.' }
$ready = $false
try { $status = Invoke-RestMethod -Uri "$workspaceUrl/api/status" -TimeoutSec 3; $ready = $status.workspaceRevision -eq $expectedRevision } catch {}
if ($status -and -not $ready) { throw 'Port 4196 is running an older workspace. Finish current tasks, close it, then reopen the latest workspace.' }
if (-not $ready -or -not $NoBrowser) {
    if ($NoBrowser) {
        $workspaceNode = (Get-Command node.exe -ErrorAction Stop).Source
        $workspaceOutput = Join-Path $workspaceApp 'outputs'
        New-Item -ItemType Directory -Force -Path $workspaceOutput | Out-Null
        Start-Process -FilePath $workspaceNode -ArgumentList @('tools/start-primary-workbench.mjs') -WorkingDirectory $workspaceApp -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workspaceOutput 'primary-server.log') -RedirectStandardError (Join-Path $workspaceOutput 'primary-server-error.log')
    } else {
        $oldData=$env:WORKBENCH_DESKTOP_DATA; $oldPort=$env:WORKBENCH_DESKTOP_PORT; $oldPrimary=$env:WORKBENCH_DESKTOP_PRIMARY
        try {
            $env:WORKBENCH_DESKTOP_DATA=Join-Path $workspaceApp '../desktop-preview-data'
            $env:WORKBENCH_DESKTOP_PORT='4196'
            $env:WORKBENCH_DESKTOP_PRIMARY='true'
            Start-Process -FilePath (Join-Path $workspaceApp 'node_modules/electron/dist/electron.exe') -ArgumentList ('"'+$workspaceApp+'"') -WorkingDirectory $workspaceApp -WindowStyle Hidden
        } finally { $env:WORKBENCH_DESKTOP_DATA=$oldData; $env:WORKBENCH_DESKTOP_PORT=$oldPort; $env:WORKBENCH_DESKTOP_PRIMARY=$oldPrimary }
    }
    for ($attempt=0;$attempt -lt 40;$attempt++) {
        Start-Sleep -Milliseconds 500
        try { $ready=(Invoke-RestMethod -Uri "$workspaceUrl/api/status" -TimeoutSec 2).workspaceRevision -eq $expectedRevision; if($ready){break} } catch {}
    }
}
if (-not $ready) { throw 'Latest crossborder workspace did not become ready on port 4196.' }
$route = switch ($Page) { 'products' { '/products' }; 'listings' { '/listings?mode=images' }; 'generation' { '/content' }; default { '/cockpit.html' } }
Write-Output ("Latest crossborder workspace: "+$workspaceUrl+$route)
if (-not $NoBrowser -and $Page -ne 'overview') { Start-Process ($workspaceUrl+$route) }
