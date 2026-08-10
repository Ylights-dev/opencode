@echo off
setlocal
title Semena Agent Setup

set "SCRIPT="
for /d %%D in ("%~dp0*") do (
  if exist "%%~fD\Install-SemenaAgent.ps1" set "SCRIPT=%%~fD\Install-SemenaAgent.ps1"
)

if not defined SCRIPT (
  echo Installer files were not found.
  echo Please extract the ZIP archive completely and run this file again.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
if errorlevel 1 (
  echo.
  echo Installation did not finish successfully.
  echo Send the error text from this window to the administrator.
)
echo.
pause
