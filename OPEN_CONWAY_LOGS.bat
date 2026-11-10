@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
if not exist "%ROOT%logs" mkdir "%ROOT%logs"
start "" "%ROOT%logs"
