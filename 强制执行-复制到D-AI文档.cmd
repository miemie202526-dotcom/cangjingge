@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM ========= 强制复制整个项目到 D:\AI文档 =========
REM 跳过 node_modules、release（节省体积）；完成后请在目标目录执行 npm install

set "DEST=D:\AI文档"
set "HERE=%~dp0"
set "HERE=!HERE:~0,-1!"
set "LOG=!HERE!\robocopy-D-AI-doc.log"

if exist "!HERE!\package.json" (
  set "SRC=!HERE!"
) else (
  set "SRC=%USERPROFILE%\.cursor\projects\empty-window\ai-module"
)

if not exist "!SRC!\package.json" (
  echo [ERROR] 找不到源码目录（需要其中有 package.json）
  echo 已尝试: !HERE!
  echo 已尝试: !SRC!
  echo 请右键本脚本 → 编辑，把下一行的 SRC 改成你的 ai-module 完整路径。
  pause
  exit /b 1
)

mkdir "%DEST%" 2>nul

echo.
echo 源目录 : !SRC!
echo 目标   : %DEST%
echo 日志   : !LOG!
echo.

robocopy "!SRC!" "%DEST%" /E /XD node_modules release /R:15 /W:5 /LOG:"!LOG!" /TEE /NP /NDL /NJH /NJS

set "RC=!ERRORLEVEL!"
echo.

if not exist "%DEST%\package.json" (
  echo [失败] 目标里没有 package.json，请打开日志查看:
  echo   !LOG!
  pause
  exit /b 1
)

if !RC! GTR 7 (
  echo [警告] robocopy 退出码 !RC! ^（大于 7 通常表示出错^）
  echo 若已有 package.json，可继续；否则请看日志。
  echo.
)

echo [完成] 项目已在: %DEST%
echo.
echo 下一步在 CMD 执行:
echo   cd /d "%DEST%"
echo   npm install
echo.

explorer.exe "%DEST%"
pause
exit /b 0
