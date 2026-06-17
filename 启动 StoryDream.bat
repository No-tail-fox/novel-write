@echo off
setlocal
cd /d "%~dp0"
title StoryDream

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-storydream.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Please send the error above to Codex.
  echo.
  pause
  exit /b 1
)
