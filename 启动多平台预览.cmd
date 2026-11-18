@echo off
setlocal
set "WORKBENCH_DESKTOP_DATA=%~dp0..\desktop-preview-data"
set "WORKBENCH_DESKTOP_PORT=4196"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
endlocal
