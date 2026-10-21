@echo off
rem devices_control_v3 launcher. The script asks for administrator rights itself (UAC).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0devices_control_v3.ps1" %*
