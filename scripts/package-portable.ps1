[CmdletBinding()]
param(
  [string]$Source = "",
  [string]$OutDir = "release",
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

if (-not $Version) {
  $raw = Get-Content "package.json" -Raw -Encoding UTF8
  if ($raw -match '"version"\s*:\s*"([^"]+)"') { $Version = $matches[1] }
  else { Write-Error "cannot read version from package.json" }
}

if (-not $Source) {
  $candidates = Get-ChildItem -Path "release" -Directory -Filter "build-*" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    ForEach-Object { Join-Path $_.FullName "win-unpacked" } |
    Where-Object { Test-Path $_ }
  if (-not $candidates -or $candidates.Count -eq 0) {
    Write-Error "no win-unpacked found under release/build-*. run npm run dist:dir first."
  }
  $Source = $candidates[0]
}

if (-not (Test-Path $Source)) { Write-Error "source missing: $Source" }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

# 关闭可能在运行的实例
foreach ($n in @("藏经阁", "AI Content Studio Pro", "AI-Content-Studio")) {
  try { Stop-Process -Name $n -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Milliseconds 500

# 1) 用 robocopy 把源目录复制到临时目录（绕开 Windows Search/Defender 的瞬时只读锁）
$staging = Join-Path $env:TEMP ("acsp-pack-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $staging | Out-Null
Write-Host ">>> source : $Source"
Write-Host ">>> staging: $staging"

# /MIR mirror, /R:5 /W:1 retry, /NFL /NDL quiet, /NP no progress
$rc = Start-Process robocopy -ArgumentList @($Source, $staging, "/MIR", "/R:5", "/W:1", "/NFL", "/NDL", "/NP", "/NJH", "/NJS") -Wait -PassThru -NoNewWindow
# robocopy exit codes 0-7 都视为成功
if ($rc.ExitCode -ge 8) {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  Write-Error ("robocopy failed, exit=" + $rc.ExitCode)
}

# 2) 压缩
$zipName = "藏经阁-portable-$Version.zip"
$zipPath = Join-Path $OutDir $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Write-Host ">>> target : $zipPath"

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# 3) 清理 staging
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

$item = Get-Item $zipPath
$mb   = [math]::Round($item.Length / 1MB, 1)
$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash

Write-Host ""
Write-Host "OK: portable archive ready"
Write-Host ("  Path  : " + $zipPath)
Write-Host ("  Size  : {0} MB" -f $mb)
Write-Host ("  SHA256: " + $hash)
Write-Host ""
Write-Host ("Upload example: gh release create v" + $Version + ' "' + $zipPath + '" --title "Cangjingge v' + $Version + '"')