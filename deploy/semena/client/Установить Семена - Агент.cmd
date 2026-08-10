@echo off
chcp 65001 >nul
title Установка Семена - Агент
echo Установка приложения "Семена - Агент"
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Служебные файлы\Install-SemenaAgent.ps1"
if errorlevel 1 (
  echo.
  echo Установка не завершилась. Сообщите текст ошибки администратору.
)
echo.
pause
