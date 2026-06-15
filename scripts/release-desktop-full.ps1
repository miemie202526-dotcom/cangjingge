# Desktop release: optional patch version -> win-unpacked (isolated dir) -> sync install -> NSIS.
# Each run uses release/build-<timestamp> so locked legacy folders do not block builds.
# After each code update: npm run desktop:release
# Params: -NoBump  -SkipNsis

param(
  [switch]$NoBump,
  [switch]$SkipNsis
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$syncScript = Join-Path $PSScriptRoot "sync-release-to-install.ps1"
$installFreshScript = Join-Path $PSScriptRoot "install-unpacked-with-shortcut.ps1"
$shortcutScript = Join-Path $PSScriptRoot "refresh-desktop-shortcut.ps1"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\AIContentStudio"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$buildStageRel = "release/build-$stamp"
$buildStageRoot = Join-Path $root "release\build-$stamp"
$unpackedBuilt = Join-Path $buildStageRoot "win-unpacked"
$ebOutArg = "--config.directories.output=$buildStageRel"

Push-Location $root
try {
  if (-not $NoBump) {
    Write-Host ">>> npm version patch"
    & npm.cmd version patch --no-git-tag-version
    if ($LASTEXITCODE -ne 0) { throw "npm version patch failed: $LASTEXITCODE" }
  }

  Write-Host ">>> build output dir: $buildStageRoot"

  Write-Host ">>> npm run dist:dir $ebOutArg"
  & npm.cmd run dist:dir -- $ebOutArg
  if ($LASTEXITCODE -ne 0) { throw "dist:dir failed: $LASTEXITCODE" }

  if (-not (Test-Path -LiteralPath $unpackedBuilt)) {
    throw "Expected unpack dir missing: $unpackedBuilt"
  }

  if (Test-Path -LiteralPath $installDir) {
    Write-Host ">>> close running app (legacy + new product names)"
    foreach ($pn in @("AI Content Studio Pro", "藏经阁", "AI-Content-Studio")) {
      try {
        Get-Process -Name $pn -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
      } catch { }
    }
    Start-Sleep -Milliseconds 600

    Write-Host ">>> sync to $installDir"
    & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $syncScript -SourceDir $unpackedBuilt -InstallDir $installDir
    if ($LASTEXITCODE -ne 0) { throw "sync failed: $LASTEXITCODE" }

    Write-Host ">>> refresh desktop shortcut (rename to 藏经阁.lnk + new icon)"
    & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $shortcutScript -InstallDir $installDir
    if ($LASTEXITCODE -ne 0) { throw "refresh-desktop-shortcut failed: $LASTEXITCODE" }
  } else {
    Write-Host ">>> first install to $installDir + desktop shortcut (藏经阁.lnk)"
    & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $installFreshScript -SourceDir $unpackedBuilt -InstallDir $installDir
    if ($LASTEXITCODE -ne 0) { throw "install-unpacked-with-shortcut failed: $LASTEXITCODE" }
  }

  if (-not $SkipNsis) {
    $preRel = Join-Path $buildStageRoot "win-unpacked"
    Write-Host ">>> NSIS from prepackaged (no second unpack)"
    & npx.cmd electron-builder --win nsis --prepackaged $preRel $ebOutArg
    if ($LASTEXITCODE -ne 0) { throw "dist nsis failed: $LASTEXITCODE" }
  } else {
    Write-Host ">>> Skip NSIS"
  }

  Write-Host ""
  Write-Host "OK: desktop release done. Artifacts under $buildStageRoot"
  Write-Host "    Close the app before reopen if files were synced."
} finally {
  Pop-Location
}
