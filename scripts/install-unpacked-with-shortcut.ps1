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

if (-not $SourceDir) {
  $SourceDir = Resolve-DefaultSourceDir
}

if (-not (Test-Path -LiteralPath $SourceDir)) {
  Write-Host "[ERROR] Missing unpacked app folder:"
  Write-Host $SourceDir
  Write-Host "Run first: npm run dist:dir"
  exit 1
}

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\AIContentStudio"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
robocopy $SourceDir $InstallDir /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}

$exe =
  Get-ChildItem -LiteralPath $InstallDir -Filter "*.exe" -File |
  Where-Object { $_.Name -notmatch "crashpad|ffmpeg|uninstall|update" } |
  Select-Object -First 1
if (-not $exe) {
  $exe = Get-ChildItem -LiteralPath $InstallDir -Filter "*.exe" -File | Select-Object -First 1
}
if (-not $exe) {
  throw "No .exe found under $InstallDir"
}

$legacyNames = @(
  "AI-Content-Studio.lnk",
  "AI Content Studio Pro.lnk",
  "AI Content Studio.lnk"
)

$ws = New-Object -ComObject WScript.Shell
foreach ($desk in Get-DesktopPaths) {
  foreach ($n in $legacyNames) {
    $p = Join-Path $desk $n
    if (Test-Path -LiteralPath $p) {
      try { Remove-Item -LiteralPath $p -Force } catch { }
    }
  }
  $lnkPath = Join-Path $desk "藏经阁.lnk"
  $shortcut = $ws.CreateShortcut($lnkPath)
  $shortcut.TargetPath = $exe.FullName
  $shortcut.WorkingDirectory = $InstallDir
  $shortcut.Description = "藏经阁 · 个人内容工作台"
  $shortcut.IconLocation = "$($exe.FullName),0"
  $shortcut.Save()
  Write-Host "Desktop shortcut:"
  Write-Host $lnkPath
}

Write-Host "Installed to:"
Write-Host $InstallDir
