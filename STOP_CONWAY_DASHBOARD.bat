@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
cd /d "%ROOT%" || exit /b 1
set "HOME=%ROOT%runtime\home"
set "NODE=%ROOT%runtime\node-v22.23.4-win-x64\node.exe"

if not exist "%NODE%" (
  echo [FAIL] Node runtime not found.
  pause
  exit /b 1
)

"%NODE%" "%ROOT%dashboard\scripts\stop.mjs"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo [FAIL] The console was not stopped. See the message above.
if "%~1"=="" pause
exit /b %RC%
