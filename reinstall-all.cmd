@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo Running full reinstall from:
echo %CD%
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\full-reinstall-and-shortcut.ps1"
set ERR=%ERRORLEVEL%
echo.
if not %ERR%==0 echo EXIT CODE: %ERR%
pause
exit /b %ERR%
