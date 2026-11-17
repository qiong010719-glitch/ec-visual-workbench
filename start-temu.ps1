param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
# Both shortcuts reuse the same backend and task data. This entry opens generation.
$temuLauncher = Join-Path (Split-Path -Parent $PSScriptRoot) 'start-listing-workbench.ps1'
if (-not (Test-Path -LiteralPath $temuLauncher)) { throw '未找到统一工作台入口 start-listing-workbench.ps1。' }
& $temuLauncher -NoBrowser:$NoBrowser -Page generation