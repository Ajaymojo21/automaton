@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
cd /d "%ROOT%" || exit /b 1

REM ---------------------------------------------------------------------------
REM  Conway Automaton - demonstration launcher
REM
REM  Opens the existing READ-ONLY AI Command Center. It does not start the
REM  Conway agent, does not set CONWAY_ACTIVATION, does not create a wallet and
REM  does not bypass any security gate. It never starts a second console: if one
REM  is already answering on 127.0.0.1:8787 it reuses it.
REM
REM  Stop with STOP_CONWAY_DASHBOARD.bat (this launcher introduces no new process
REM  type, so no separate stop script is needed).
REM ---------------------------------------------------------------------------

set "HOME=%ROOT%runtime\home"
set "NODE=%ROOT%runtime\node-v22.23.4-win-x64\node.exe"
set "URL=http://127.0.0.1:8787"

if not exist "%NODE%" (
  echo [FAIL] Node runtime not found at %NODE%
  exit /b 1
)
if not exist "%ROOT%runtime\home\.automaton\state.db" (
  echo [FAIL] No Conway database under %ROOT%runtime\home
  echo        Refusing to point the console at another home.
  exit /b 1
)

echo ============================================================
echo  Conway Automaton - demonstration console
echo  read-only / loopback-only / agent stays inactive
echo ============================================================
echo.

call :probe
if "%ALREADY%"=="1" (
  echo [PASS] Console is already running on %URL% - reusing it, not starting a duplicate.
  goto :open
)

echo [ .. ] No console answering on %URL% - starting the existing launcher.
echo.
call "%ROOT%START_CONWAY_DASHBOARD.bat" demo
if errorlevel 1 (
  echo.
  echo [FAIL] The console did not start. Nothing else was attempted.
  exit /b 1
)

echo.
echo [ .. ] Waiting for the console to answer ...
set "TRIES=0"
:waitloop
call :probe
if "%ALREADY%"=="1" goto :ready
set /a TRIES+=1
if %TRIES% GEQ 40 goto :timeout
"%NODE%" -e "setTimeout(function(){},250)" >nul 2>&1
goto :waitloop

:timeout
echo [FAIL] The console did not answer on %URL% within about 20 seconds.
echo        Check dashboard\logs\dashboard.err.log
exit /b 1

:ready
echo [PASS] Console answered on %URL%

:open
echo.
echo Opening %URL% in the default browser ...
start "" "%URL%"
echo.
echo ------------------------------------------------------------
echo  Demonstration surface
echo ------------------------------------------------------------
echo   URL     %URL%
echo   HOME    %ROOT%runtime\home
echo   Token   dashboard\state\dashboard.token   ^(paste it once; it is never printed here^)
echo   Health  GET %URL%/api/health
echo   Stop    STOP_CONWAY_DASHBOARD.bat
echo.
echo  What this launcher did NOT do:
echo    - did not start the Conway agent or set CONWAY_ACTIVATION
echo    - did not create or fund a wallet
echo    - did not run a migration or write to state.db
echo    - did not expose the console beyond loopback
echo ------------------------------------------------------------
exit /b 0

:probe
set "ALREADY=0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri '%URL%/api/health' -Headers @{ Origin = '%URL%' } -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 set "ALREADY=1"
exit /b 0
