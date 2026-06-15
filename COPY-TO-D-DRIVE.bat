@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM Destination folder on D:
set "DEST=D:\AI文档"
set "SRC=%USERPROFILE%\.cursor\projects\empty-window\ai-module"

if not exist "%SRC%\package.json" (
  echo [ERROR] Source not found:
  echo   %SRC%
  echo Put your ai-module folder there, OR edit SRC= inside this bat file.
  pause
  exit /b 1
)

if not exist "%DEST%" mkdir "%DEST%"

echo Copying...
echo   FROM %SRC%
echo   TO   %DEST%
robocopy "%SRC%" "%DEST%" /E /XD node_modules release /R:3 /W:2

if not exist "%DEST%\package.json" (
  echo [ERROR] Still no package.json in destination.
  pause
  exit /b 1
)

echo.
echo SUCCESS. Now run:
echo   cd /d "%DEST%"
echo   npm install
echo.
pause
