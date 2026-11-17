@echo off
cd /d "%~dp0ec-visual-workbench"
start "" "node_modules\electron\dist\electron.exe" "."
