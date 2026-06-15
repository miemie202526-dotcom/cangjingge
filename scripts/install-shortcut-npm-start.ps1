# 在桌面创建快捷方式：每次打开都执行「项目根目录下的 npm start」，始终运行当前源码（无需 dist:dir）。
param(
  [string]$RepoRoot = "",
  [string]$ShortcutName = "AI-Content-Studio-Dev"
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

$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $psExe)) {
  throw "找不到 powershell.exe"
}

# 使用 EncodedCommand 避免路径中的引号问题
$r = $RepoRoot.Replace("'", "''")
$inner = "Set-Location -LiteralPath '$r'; npm start"
$bytes = [System.Text.Encoding]::Unicode.GetBytes($inner)
$encoded = [Convert]::ToBase64String($bytes)
$argLine = "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"

foreach ($desk in Get-DesktopPaths) {
  $lnkPath = Join-Path $desk "$ShortcutName.lnk"
  $ws = New-Object -ComObject WScript.Shell
  $shortcut = $ws.CreateShortcut($lnkPath)
  $shortcut.TargetPath = $psExe
  $shortcut.Arguments = $argLine
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.Description = "AI Content Studio - npm start from repo (latest source each launch)"
  $shortcut.Save()
  Write-Host "已创建/更新快捷方式: $lnkPath"
  Write-Host " -> npm start @ $RepoRoot"
}
