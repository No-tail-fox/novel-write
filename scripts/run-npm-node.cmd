@echo off
setlocal EnableExtensions
set "NODE_EXE=%npm_node_execpath%"
if not defined NODE_EXE (
  for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"
)
if not defined NODE_EXE goto :node_unavailable
if not exist "%NODE_EXE%" goto :node_unavailable
set "NODE_ATTRIBUTES="
for %%I in ("%NODE_EXE%") do set "NODE_ATTRIBUTES=%%~aI"
if not defined NODE_ATTRIBUTES goto :node_unavailable
if /i "%NODE_ATTRIBUTES:~0,1%"=="d" goto :node_unavailable
if "%~1"=="" (
  >&2 echo(Usage: run-npm-node.cmd ^<script^> [args...]
  exit /b 1
)
"%NODE_EXE%" %*
exit /b %ERRORLEVEL%

:node_unavailable
>&2 echo(Node executable is not available from npm or PATH.
exit /b 1
