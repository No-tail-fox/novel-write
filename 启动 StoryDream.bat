@echo off
setlocal
cd /d "%~dp0"
title StoryDream

set "PS_EXE=powershell"
where pwsh >nul 2>nul && set "PS_EXE=pwsh"
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-storydream.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Please send the error above to Codex.
  echo.
  pause
  exit /b 1
)
