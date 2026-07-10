@echo off
setlocal
if "%npm_node_execpath%"=="" (
  echo npm_node_execpath is not available. 1>&2
  exit /b 1
)
if "%~1"=="" (
  echo Usage: run-npm-powershell.cmd ^<script.ps1^> 1>&2
  exit /b 1
)
"%npm_node_execpath%" "%~dp0run-powershell.mjs" "%~1"
exit /b %ERRORLEVEL%
