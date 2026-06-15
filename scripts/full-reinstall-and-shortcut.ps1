$ErrorActionPreference = "Stop"

if (-not $PSScriptRoot) {
  Write-Host "[ERROR] Run this script with: powershell -ExecutionPolicy Bypass -File `"path\to\full-reinstall-and-shortcut.ps1`""
  exit 1
}

$root = Split-Path $PSScriptRoot -Parent
$pkg = Join-Path $root "package.json"
$setup = Join-Path $root "release\installer\AI-Content-Studio-Setup.exe"
$shortcutScript = Join-Path $PSScriptRoot "create-desktop-shortcut.ps1"

if (-not (Test-Path -LiteralPath $pkg)) {
  Write-Host "[ERROR] package.json not found. Expected project root:"
  Write-Host $root
  exit 1
}

$squirrelRoot = Join-Path $env:LOCALAPPDATA "ai_desktop_analyst"
$updateExe = Join-Path $squirrelRoot "Update.exe"

if (Test-Path -LiteralPath $updateExe) {
  Write-Host "Step 1/5: Uninstalling previous Squirrel install..."
  Start-Process -FilePath $updateExe -ArgumentList "--uninstall" -Wait
  Start-Sleep -Seconds 2
} else {
  Write-Host "Step 1/5: No Update.exe yet — skip uninstall."
}

if (Test-Path -LiteralPath $squirrelRoot) {
  Write-Host "Step 2/5: Removing leftover install folder (clean reinstall)..."
  Remove-Item -LiteralPath $squirrelRoot -Recurse -Force -ErrorAction Continue
  Start-Sleep -Seconds 1
} else {
  Write-Host "Step 2/5: Install folder already gone."
}

Write-Host "Step 3/5: npm install..."
Push-Location $root
try {
  $npmCmd = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue
  if (-not $npmCmd) {
    throw "npm.cmd not found in PATH. Install Node.js LTS and reopen this window."
  }

  & npm.cmd install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed, exit code $LASTEXITCODE"
  }

  Write-Host "Step 4/5: npm run installer:exe (may take several minutes)..."
  & npm.cmd run installer:exe
  if ($LASTEXITCODE -ne 0) {
    throw "npm run installer:exe failed, exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $setup)) {
  Write-Host ""
  Write-Host "[ERROR] Installer not found:"
  Write-Host $setup
  Write-Host "Fix errors printed above (packager / winstaller), then run again."
  exit 1
}

Write-Host "Step 5/5: Running Setup.exe (complete any prompts)..."
$p = Start-Process -FilePath $setup -Wait -PassThru
if ($p.ExitCode -ne 0) {
  Write-Host "[WARN] Setup.exe exit code: $($p.ExitCode)"
}

Start-Sleep -Seconds 2

Write-Host "Creating desktop shortcut..."
& $shortcutScript

Write-Host ""
Write-Host "Done. Sidebar should show Build: 2026.05.01-v3 on the NEW UI."
