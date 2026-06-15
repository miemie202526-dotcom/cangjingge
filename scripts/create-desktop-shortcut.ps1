$ErrorActionPreference = "Stop"

$squirrelRoot = Join-Path $env:LOCALAPPDATA "ai_desktop_analyst"
$updateExe = Join-Path $squirrelRoot "Update.exe"

if (-not (Test-Path -LiteralPath $updateExe)) {
  Write-Host "[ERROR] Squirrel launcher not found (install Setup first):"
  Write-Host $updateExe
  exit 1
}

$candidates = @(
  Get-ChildItem -LiteralPath $squirrelRoot -Filter "*.exe" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne "Update.exe" }
)

$main =
  ($candidates | Where-Object { $_.Name -eq "AI-Content-Studio.exe" } | Select-Object -First 1)
if (-not $main) {
  $main = ($candidates | Where-Object { $_.Name -eq "AI Desktop Analyst.exe" } | Select-Object -First 1)
}
if (-not $main -and $candidates.Count -ge 1) {
  Write-Host "[WARN] Using first non-Update exe found (unexpected name): $($candidates[0].Name)"
  $main = $candidates[0]
}

if (-not $main) {
  Write-Host "[ERROR] No app .exe next to Update.exe. Folder contents:"
  Get-ChildItem -LiteralPath $squirrelRoot -ErrorAction SilentlyContinue | ForEach-Object { Write-Host " - $($_.Name)" }
  exit 1
}

$launchName = $main.Name
Write-Host "Shortcut will start: $launchName (via Update.exe)"

$shortcutArgs = "--processStart `"$launchName`""
$launchArgs = @("--processStart", $launchName)
$workDir = Split-Path -Parent $updateExe

$desktopPaths = New-Object System.Collections.Generic.List[string]

$d1 = [Environment]::GetFolderPath("Desktop")
if ($d1 -and (Test-Path -LiteralPath $d1)) {
  $desktopPaths.Add((Resolve-Path -LiteralPath $d1).Path) | Out-Null
}

$d2 = Join-Path $env:USERPROFILE "Desktop"
if ((Test-Path -LiteralPath $d2) -and -not $desktopPaths.Contains((Resolve-Path -LiteralPath $d2).Path)) {
  $desktopPaths.Add((Resolve-Path -LiteralPath $d2).Path) | Out-Null
}

$d3 = Join-Path $env:USERPROFILE "OneDrive\Desktop"
if ((Test-Path -LiteralPath $d3) -and -not $desktopPaths.Contains((Resolve-Path -LiteralPath $d3).Path)) {
  $desktopPaths.Add((Resolve-Path -LiteralPath $d3).Path) | Out-Null
}

foreach ($desk in $desktopPaths) {
  $lnkPath = Join-Path $desk "AI-Content-Studio.lnk"
  $ws = New-Object -ComObject WScript.Shell
  $shortcut = $ws.CreateShortcut($lnkPath)
  $shortcut.TargetPath = $updateExe
  $shortcut.Arguments = $shortcutArgs
  $shortcut.WorkingDirectory = $workDir
  $shortcut.Save()
  Write-Host "Created shortcut:"
  Write-Host $lnkPath
}

Start-Process -FilePath $updateExe -ArgumentList $launchArgs
Write-Host "Launch attempted."
