# Refresh the desktop shortcut for 「藏经阁」.
# Removes legacy shortcut names ("AI-Content-Studio.lnk", "AI Content Studio Pro.lnk")
# and creates / updates "藏经阁.lnk" pointing to the latest install dir exe.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -NoProfile -File scripts/refresh-desktop-shortcut.ps1
#   (optional) -InstallDir "C:\path\to\install"
#              -ShortcutName "藏经阁"

param(
  [string]$InstallDir = "",
  [string]$ShortcutName = "藏经阁"
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\AIContentStudio"
}

if (-not (Test-Path -LiteralPath $InstallDir)) {
  Write-Host "[WARN] Install dir not found, skip shortcut refresh: $InstallDir"
  exit 0
}

$exe =
  Get-ChildItem -LiteralPath $InstallDir -Filter "*.exe" -File |
  Where-Object { $_.Name -notmatch "crashpad|ffmpeg|uninstall|update" } |
  Select-Object -First 1

if (-not $exe) {
  Write-Host "[ERROR] No app .exe found under $InstallDir"
  exit 1
}

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

# 旧名称要清掉，避免桌面上同时出现新旧两个图标
$legacyNames = @(
  "AI-Content-Studio.lnk",
  "AI Content Studio Pro.lnk",
  "AI Content Studio.lnk"
)

$desktops = Get-DesktopPaths
foreach ($desk in $desktops) {
  foreach ($n in $legacyNames) {
    $p = Join-Path $desk $n
    if (Test-Path -LiteralPath $p) {
      try {
        Remove-Item -LiteralPath $p -Force
        Write-Host "Removed legacy shortcut: $p"
      } catch {
        Write-Host "[WARN] cannot remove $p ($($_.Exception.Message))"
      }
    }
  }
}

$ws = New-Object -ComObject WScript.Shell
foreach ($desk in $desktops) {
  $lnkPath = Join-Path $desk ("$ShortcutName.lnk")
  $shortcut = $ws.CreateShortcut($lnkPath)
  $shortcut.TargetPath = $exe.FullName
  $shortcut.WorkingDirectory = $InstallDir
  $shortcut.Description = "藏经阁 · 个人内容工作台"
  $shortcut.IconLocation = "$($exe.FullName),0"
  $shortcut.Save()
  Write-Host "Desktop shortcut: $lnkPath"
}

Write-Host "OK: 桌面快捷方式已刷新为「$ShortcutName」"
Write-Host "    Target: $($exe.FullName)"
