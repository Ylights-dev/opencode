@echo off
title Semena OpenCode Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-SemenaOpenCode.ps1"
if errorlevel 1 (
  echo.
  echo Installation failed. Keep this window open and contact your administrator.
  pause
) else (
  echo.
  echo Installation completed. Use the Semena OpenCode desktop shortcut.
  pause
)
