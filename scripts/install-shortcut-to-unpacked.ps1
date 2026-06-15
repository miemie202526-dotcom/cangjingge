# 在桌面创建快捷方式，直接指向「项目内」release\win-unpacked 下的 exe。
# 之后每次执行 npm run dist:dir 覆盖该目录，再双击图标即为最新打包版，无需 sync:release。
param(
  [string]$RepoRoot = "",
  # 使用纯 ASCII 文件名，避免部分系统创建 .lnk 时编码异常；可在桌面自行重命名快捷方式。
  [string]$ShortcutName = "AI-Content-Studio"
)

$ErrorActionPreference = "Stop"

function Get-DesktopPaths {
  $list = New-Object System.Collections.Generic.List[string]
  $d1 = [Environment]::GetFolderPath("Desktop")
  if ($d1 -and (Test-Path -LiteralPath $d1)) {
    $list.Add((Resolve-Path -LiteralPath $d1).Path) | Out-Null
  }
  $d2 = Join-Path $env:USERPROFILE "Desktop"
  if ((Test-Path -LiteralPath $d2) -and -not $list.Contains((Resolve-Path -LiteralPath $d2).Path)) {
    $list.Add((Resolve-Path -LiteralPath $d2).Path) | Out-Null
  }
  $d3 = Join-Path $env:USERPROFILE "OneDrive\Desktop"
  if ((Test-Path -LiteralPath $d3) -and -not $list.Contains((Resolve-Path -LiteralPath $d3).Path)) {
    $list.Add((Resolve-Path -LiteralPath $d3).Path) | Out-Null
  }
  return $list
}

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$unpacked = Join-Path $RepoRoot "release\win-unpacked"
if (-not (Test-Path -LiteralPath $unpacked)) {
  Write-Host "[ERROR] 请先执行: npm run dist:dir"
  Write-Host $unpacked
  exit 1
}

$exe =
  Get-ChildItem -LiteralPath $unpacked -Filter "*.exe" -File |
  Where-Object { $_.Name -notmatch "crashpad|ffmpeg|uninstall|update" } |
  Select-Object -First 1
if (-not $exe) {
  $exe = Get-ChildItem -LiteralPath $unpacked -Filter "*.exe" -File | Select-Object -First 1
}
if (-not $exe) {
  throw "未在 win-unpacked 下找到主程序 .exe"
}

$workDir = $unpacked
foreach ($desk in Get-DesktopPaths) {
  $lnkPath = Join-Path $desk "$ShortcutName.lnk"
  $ws = New-Object -ComObject WScript.Shell
  $shortcut = $ws.CreateShortcut($lnkPath)
  $shortcut.TargetPath = $exe.FullName
  $shortcut.WorkingDirectory = $workDir
  $shortcut.Description = "AI Content Studio -> repo release/win-unpacked (run dist:dir to refresh)"
  $shortcut.Save()
  Write-Host "已创建/更新快捷方式: $lnkPath"
  Write-Host " -> $($exe.FullName)"
}
