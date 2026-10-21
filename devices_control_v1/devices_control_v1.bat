@echo off
rem devices_control_v1 launcher. The script asks for administrator rights itself (UAC).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0devices_control_v1.ps1" %*
