@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "HOME=%ROOT%runtime\home"
set "NODE=%ROOT%runtime\node-v22.23.4-win-x64\node.exe"

"%NODE%" "%ROOT%runtime\bin\security-audit.mjs"
set "RC=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %RC%
