@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
cd /d "%ROOT%" || exit /b 1
set "HOME=%ROOT%runtime\home"
set "NODE=%ROOT%runtime\node-v22.23.4-win-x64\node.exe"

if not exist "%NODE%" (
  echo [FAIL] Node runtime not found at %NODE%
  pause
  exit /b 1
)

echo ============================================
echo  Conway Automaton - AI Command Center
echo  local, loopback-only operator console
echo ============================================
echo.
echo This starts the READ-ONLY console. It does not start the Conway
echo agent, does not touch the activation gate, and does not open a wallet.
echo.

"%NODE%" "%ROOT%dashboard\scripts\start.mjs"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [FAIL] The console did not start. Nothing else was attempted.
  pause
  exit /b %RC%
)
if "%~1"=="" pause
exit /b 0
