@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
cd /d "%ROOT%" || exit /b 1
set "HOME=%ROOT%runtime\home"
set "COREPACK_HOME=%ROOT%runtime\corepack"
set "PATH=%ROOT%runtime\node-v22.23.4-win-x64;%ROOT%runtime\bin;%PATH%"
set "NODE=%ROOT%runtime\node-v22.23.4-win-x64\node.exe"

if not exist "%NODE%" (
  echo [FAIL] Node runtime not found at %NODE%
  pause
  exit /b 1
)

echo ============================================
echo  Conway Automaton - supervised start
echo ============================================
echo Activation requires explicit confirmation.
set "CONFIRM="
set /p "CONFIRM=Type APPROVED to launch the autonomous runtime: "
if /i not "%CONFIRM%"=="APPROVED" (
  echo Cancelled.
  pause
  exit /b 1
)
set "CONWAY_ACTIVATION=APPROVED"

if not exist "%HOME%\.automaton\wallet.json" (
  echo.
  echo No wallet exists. Creating a wallet generates a new private key on this PC.
  set "WALLET="
  set /p "WALLET=Type CREATE-WALLET to allow generation: "
  if /i not "%WALLET%"=="CREATE-WALLET" (
    echo Cancelled.
    pause
    exit /b 1
  )
  set "CONWAY_ALLOW_WALLET_CREATION=APPROVED"
)

"%NODE%" "%ROOT%runtime\bin\preflight.mjs"
if errorlevel 1 (
  echo.
  echo Start blocked. Review the messages above.
  pause
  exit /b 1
)

"%NODE%" "%ROOT%runtime\bin\rotate-logs.mjs"

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "STAMP=%%i"
set "OUTLOG=%ROOT%logs\automaton-%STAMP%.log"
set "ERRLOG=%ROOT%logs\automaton-%STAMP%.err.log"

powershell -NoProfile -Command "$p = Start-Process -FilePath '%NODE%' -ArgumentList @('%ROOT%dist\index.js','--run') -WorkingDirectory '%ROOT%' -RedirectStandardOutput '%OUTLOG%' -RedirectStandardError '%ERRLOG%' -WindowStyle Hidden -PassThru; Set-Content -Path '%ROOT%logs\automaton.pid' -Value $p.Id; Write-Host ('[PASS] Started pid ' + $p.Id)"
if errorlevel 1 (
  echo [FAIL] Failed to start the runtime.
  pause
  exit /b 1
)

echo.
echo Logs: %OUTLOG%
echo        %ERRLOG%
echo Run HEALTH_CHECK.bat to verify, STOP_CONWAY.bat to stop.
pause
