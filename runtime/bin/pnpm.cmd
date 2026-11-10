@echo off
setlocal
for %%I in ("%~dp0..") do set "RUNTIME=%%~fI"
set "NODE=%RUNTIME%\node-v22.23.4-win-x64\node.exe"
set "COREPACK_HOME=%RUNTIME%\corepack"
"%NODE%" "%RUNTIME%\node-v22.23.4-win-x64\node_modules\corepack\dist\pnpm.js" %*
