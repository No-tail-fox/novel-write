@echo off
setlocal
if "%npm_node_execpath%"=="" (
  echo npm_node_execpath is not available. 1>&2
  exit /b 1
)
if "%~1"=="" (
  echo Usage: run-npm-node.cmd ^<script^> [args...] 1>&2
  exit /b 1
)
"%npm_node_execpath%" %*
exit /b %ERRORLEVEL%
