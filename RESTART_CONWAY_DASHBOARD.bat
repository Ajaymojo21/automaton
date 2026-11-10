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

echo ============================================
echo  Conway Automaton - AI Command Center
echo  restart
echo ============================================
"%NODE%" "%ROOT%dashboard\scripts\stop.mjs"
if errorlevel 1 (
  echo [FAIL] Refusing to start a second console on top of one that would not stop.
  pause
  exit /b 1
)
"%NODE%" "%ROOT%dashboard\scripts\start.mjs"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo [FAIL] Restart failed. The console is NOT running.
if "%~1"=="" pause
exit /b %RC%
