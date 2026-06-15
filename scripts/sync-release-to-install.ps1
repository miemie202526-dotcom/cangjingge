# 将项目内 release\win-unpacked 覆盖同步到本机安装目录（与桌面快捷方式指向的位置一致）。
# 仅复制文件，不重复创建快捷方式。用法：npm run sync:release
# 若尚未安装过，请先执行一次：npm run install:desktop

param(
  [string]$SourceDir = "",
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultSourceDir {
  $releaseRoot = Join-Path $PSScriptRoot "..\release"
  $legacy = Join-Path $releaseRoot "win-unpacked"
  if ((Test-Path -LiteralPath $legacy) -and (Get-ChildItem -LiteralPath $legacy -Filter "*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    return $legacy
  }

  if (-not (Test-Path -LiteralPath $releaseRoot)) {
    return $legacy
  }

  $candidates =
    Get-ChildItem -LiteralPath $releaseRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "build-*" } |
    Sort-Object LastWriteTime -Descending

  foreach ($c in $candidates) {
    $unpacked = Join-Path $c.FullName "win-unpacked"
    if ((Test-Path -LiteralPath $unpacked) -and (Get-ChildItem -LiteralPath $unpacked -Filter "*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
      return $unpacked
    }
  }

  return $legacy
}

if (-not $SourceDir) {
  $SourceDir = Resolve-DefaultSourceDir
}
if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\AIContentStudio"
}

if (-not (Test-Path -LiteralPath $SourceDir)) {
  Write-Host "[ERROR] 找不到打包输出，请先执行: npm run dist:dir"
  Write-Host $SourceDir
  exit 1
}

if (-not (Test-Path -LiteralPath $InstallDir)) {
  Write-Host "[ERROR] 尚未安装到本机目录，请先执行一次: npm run install:desktop"
  Write-Host $InstallDir
  exit 1
}

Write-Host ">>> robocopy (关闭正在运行的「AI Content Studio Pro」以免长时间占用)"
# /R /W：避免单个被占用文件无限重试拖死脚本（默认可达数百万次）
robocopy $SourceDir $InstallDir /MIR /NFL /NDL /NJH /NJS /nc /ns /np /R:5 /W:2 | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE (若程序正在运行请先退出后再同步)"
}

Write-Host "OK: 已用最新构建覆盖"
Write-Host $InstallDir
Write-Host "请关闭正在运行的「AI 内容工作室」后，再双击桌面图标打开。"
