@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "HOME=%ROOT%runtime\home"
set "NODE=%ROOT%runtime\node-v22.23.4-win-x64\node.exe"

if not exist "%NODE%" (
  echo [FAIL] Node runtime not found.
  pause
  exit /b 1
)

"%NODE%" "%ROOT%runtime\bin\stop.mjs"
if errorlevel 1 (
  echo [FAIL] Stop failed.
  pause
  exit /b 1
)
if "%~1"=="" pause
