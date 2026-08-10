@echo off
chcp 65001 >nul
title Установка приложения Семена - Агент
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-SemenaAgent.ps1"
echo.
pause
